/**
 * Watch / alert engine — the "be ready the moment it drops" part.
 *
 * Two ways to arm it, both per-chat (one active watch at a time, kept simple):
 *
 *  1. ⏰ Countdown — you give a fire time ("10m", "1h30m", "15:30", or a unix
 *     timestamp from the project's page). The bot shows a live-updating countdown
 *     and, at zero, either ALERTS you (you tap GO) or AUTO-FIRES — depending on
 *     your firing-mode toggle in the snipe settings.
 *
 *  2. 📡 Watch until live — the bot polls the contract's sale flags / paused /
 *     sold-out every few seconds. The instant it looks OPEN, it alerts or
 *     auto-fires (same toggle). This catches surprise/stealth "sale is live now"
 *     flips you'd otherwise miss.
 *
 * SAFETY POSTURE (matches the rest of the bot):
 *  - Auto-fire only happens if BOTH your firing-mode toggle is on AND the snipe
 *    is actually fireable (function chosen, active wallet, a buildable call).
 *    Otherwise it downgrades to a loud ALERT rather than firing blind.
 *  - Every real fire goes through fireAndReport() — the SAME path (ceiling check,
 *    simulate/bump, auto-forget) as the manual GO button. No shortcut path.
 *  - Watches are in-memory only; a restart forgets them (no surprise fire after a
 *    crash + restart hours later).
 *
 * Mechanics: Node's event loop keeps timers running between long-poll cycles, so
 * a setTimeout loop ticks fine while getUpdates is parked. Each watch holds a
 * single pending timer we can cancel; loops re-check a `stopped` flag first.
 */

import { TelegramClient, type InlineButton } from "./telegram";
import { WalletStore } from "./walletStore";
import { SessionState, type Target } from "./session";
import { fireAndReport, buildMintCall } from "./snipe";
import { probeSaleState, isMintOpen, type SaleState } from "./recon";

/** How long between "is it live?" polls, and the hard lifetime cap for a watch. */
const POLL_MS = 4000;
const LIVE_MAX_MS = 6 * 60 * 60 * 1000; // stop a live-watch after 6h
const COUNTDOWN_MAX_MS = 14 * 24 * 60 * 60 * 1000; // refuse countdowns > 14 days out
const MAX_POLL_FAILS = 10; // stop after this many consecutive probe failures

interface ActiveWatch {
  chatId: number;
  kind: "countdown" | "live";
  label: string;
  /** The status message we keep editing in place (countdown / heartbeat). */
  statusMsgId?: number;
  /** The single pending timer for this watch, so we can cancel it. */
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  failCount: number;
}

export class WatchManager {
  private readonly watches = new Map<number, ActiveWatch>();

  constructor(
    private readonly tg: TelegramClient,
    private readonly store: WalletStore,
    private readonly session: SessionState
  ) {}

  /** Is there an active watch for this chat? */
  has(chatId: number): boolean {
    return this.watches.has(chatId);
  }

  /** Cancel any active watch for this chat. Returns true if one was running. */
  cancel(chatId: number): boolean {
    const w = this.watches.get(chatId);
    if (!w) return false;
    this.clear(w);
    return true;
  }

  /** Tear down a watch: stop its loop, drop its timer, forget it. */
  private clear(w: ActiveWatch): void {
    w.stopped = true;
    if (w.timer) {
      clearTimeout(w.timer);
      w.timer = undefined;
    }
    this.watches.delete(w.chatId);
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  /** Handle a watch:* button tap. Returns true if consumed. */
  async handleCallback(chatId: number, data: string): Promise<boolean> {
    if (data === "watch:cancel") {
      const had = this.cancel(chatId);
      await this.tg.sendMessage(chatId, had ? "🛑 Watch cancelled." : "No active watch to cancel.");
      return true;
    }

    const target = this.session.getTarget(chatId);

    if (data === "watch:countdown") {
      if (!target?.address) {
        await this.needContract(chatId);
        return true;
      }
      this.session.set(chatId, { kind: "awaiting_watch_time" });
      const mode = target.snipe?.autoFire
        ? "At zero it will <b>AUTO-FIRE</b> (your firing mode is auto)."
        : "At zero it will <b>ALERT you</b> to tap GO (your firing mode is confirm).";
      await this.tg.sendMessage(
        chatId,
        [
          "⏰ <b>Set a countdown</b>",
          "",
          "Send when to fire. I understand:",
          "• <code>10m</code>, <code>90s</code>, <code>1h30m</code> — time from now",
          "• <code>15:30</code> or <code>3:30pm</code> — next time that clock hits (your PC's local time)",
          "• a <code>unix timestamp</code> the project posts (10 digits)",
          "",
          mode,
          "Send /cancel to abort.",
        ].join("\n")
      );
      return true;
    }

    if (data === "watch:live") {
      if (!target?.address) {
        await this.needContract(chatId);
        return true;
      }
      await this.armLive(chatId, target);
      return true;
    }

    return false;
  }

  /** Handle a follow-up message for the countdown-time prompt. Returns true if consumed. */
  async handleMessage(chatId: number, text: string): Promise<boolean> {
    const pending = this.session.get(chatId);
    if (pending?.kind !== "awaiting_watch_time") return false;

    const trimmed = text.trim();
    if (trimmed === "/cancel") {
      this.session.clear(chatId);
      await this.tg.sendMessage(chatId, "Cancelled.");
      return true;
    }

    const target = this.session.getTarget(chatId);
    if (!target?.address) {
      this.session.clear(chatId);
      await this.tg.sendMessage(chatId, "Lost the contract — tap 🔍 to check one first.");
      return true;
    }

    let at: Date;
    try {
      at = parseWhen(trimmed);
    } catch (err) {
      await this.tg.sendMessage(chatId, `❌ ${(err as Error).message}`);
      return true;
    }

    const ms = at.getTime() - Date.now();
    if (ms <= 0) {
      await this.tg.sendMessage(chatId, "That time is already past. Give me a moment in the future.");
      return true;
    }
    if (ms > COUNTDOWN_MAX_MS) {
      await this.tg.sendMessage(chatId, "That's more than 14 days out — too far for a live countdown. Pick something sooner.");
      return true;
    }

    this.session.clear(chatId);
    await this.armCountdown(chatId, target, at);
    return true;
  }

  // -------------------------------------------------------------------------
  // Countdown
  // -------------------------------------------------------------------------

  private async armCountdown(chatId: number, target: Target, at: Date): Promise<void> {
    this.cancel(chatId); // one watch per chat — replace any existing
    const w: ActiveWatch = {
      chatId,
      kind: "countdown",
      label: labelFor(target),
      stopped: false,
      failCount: 0,
    };
    this.watches.set(chatId, w);

    const remaining = at.getTime() - Date.now();
    const msg = await this.tg.sendMessage(chatId, this.countdownText(w.label, at, remaining, target), [
      [{ text: "🛑 Cancel countdown", callback_data: "watch:cancel" }],
    ]);
    w.statusMsgId = msg.message_id;
    this.scheduleCountdownTick(w, target, at);
  }

  private scheduleCountdownTick(w: ActiveWatch, target: Target, at: Date): void {
    const loop = async () => {
      if (w.stopped) return;
      const remaining = at.getTime() - Date.now();
      if (remaining <= 0) {
        await this.trigger(w, target, "⏰ Countdown hit zero.");
        return;
      }
      await this.setStatus(w, this.countdownText(w.label, at, remaining, target), [
        [{ text: "🛑 Cancel countdown", callback_data: "watch:cancel" }],
      ]);
      // Tick faster as we approach zero: 15s far out, 5s inside a minute, 1s inside 10s.
      const delay = remaining > 60_000 ? 15_000 : remaining > 10_000 ? 5_000 : 1_000;
      w.timer = setTimeout(loop, Math.min(delay, remaining));
    };
    const first = at.getTime() - Date.now();
    const delay = first > 60_000 ? 15_000 : first > 10_000 ? 5_000 : 1_000;
    w.timer = setTimeout(loop, Math.min(delay, Math.max(first, 0)));
  }

  private countdownText(label: string, at: Date, remaining: number, target: Target): string {
    const mode = target.snipe?.autoFire
      ? "🔥 <b>Auto-fire</b> at zero"
      : "🔔 <b>Alert</b> at zero (you tap GO)";
    return [
      `⏰ <b>Countdown</b> — ${label}`,
      `Fires at: <b>${at.toLocaleString()}</b>`,
      `Remaining: <b>${fmtRemaining(remaining)}</b>`,
      "",
      mode,
    ].join("\n");
  }

  // -------------------------------------------------------------------------
  // Live watch
  // -------------------------------------------------------------------------

  private async armLive(chatId: number, target: Target): Promise<void> {
    this.cancel(chatId);
    const w: ActiveWatch = {
      chatId,
      kind: "live",
      label: labelFor(target),
      stopped: false,
      failCount: 0,
    };
    this.watches.set(chatId, w);

    const mode = target.snipe?.autoFire ? "auto-fire" : "alert you";
    const msg = await this.tg.sendMessage(
      chatId,
      [
        `📡 <b>Watching</b> ${w.label}`,
        `I'll ${mode} the moment the mint looks open.`,
        `<i>Checking every ${Math.round(POLL_MS / 1000)}s.</i>`,
      ].join("\n"),
      [[{ text: "🛑 Stop watching", callback_data: "watch:cancel" }]]
    );
    w.statusMsgId = msg.message_id;
    this.scheduleLivePoll(w, target, Date.now());
  }

  private scheduleLivePoll(w: ActiveWatch, target: Target, startedAt: number): void {
    const loop = async () => {
      if (w.stopped) return;

      if (Date.now() - startedAt > LIVE_MAX_MS) {
        this.clear(w);
        await this.tg.sendMessage(w.chatId, "🛑 Stopped watching after 6 hours. Tap 📡 to start again.");
        return;
      }

      let state: SaleState | undefined;
      try {
        state = await probeSaleState(target.chain, target.address!);
        w.failCount = 0;
      } catch (err) {
        w.failCount += 1;
        if (w.failCount >= MAX_POLL_FAILS) {
          this.clear(w);
          await this.tg.sendMessage(
            w.chatId,
            `🛑 Stopped watching — ${MAX_POLL_FAILS} checks in a row failed (${(err as Error).message}). Check your connection / RPC and try again.`
          );
          return;
        }
      }

      if (w.stopped) return;

      if (state && isMintOpen(state)) {
        await this.trigger(w, target, "🟢 Mint looks OPEN.");
        return;
      }

      await this.setStatus(w, this.liveText(w, state), [
        [{ text: "🛑 Stop watching", callback_data: "watch:cancel" }],
      ]);
      w.timer = setTimeout(loop, POLL_MS);
    };
    w.timer = setTimeout(loop, 0);
  }

  private liveText(w: ActiveWatch, state: SaleState | undefined): string {
    const bits = [`📡 <b>Watching</b> ${w.label}`];
    if (state) {
      if (state.totalSupply !== undefined) {
        const max = state.maxSupply !== undefined ? ` / ${state.maxSupply}` : "";
        bits.push(`Minted: <b>${state.totalSupply}${max}</b>`);
      }
      const stateLine =
        state.paused === true
          ? "State: ⛔ paused"
          : state.saleActive === false
            ? "State: 🔴 not open yet"
            : "State: ⚪ waiting for the flip";
      bits.push(stateLine);
    } else {
      bits.push(`⚠️ last check failed (${w.failCount} in a row) — retrying…`);
    }
    bits.push(`<i>checked ${new Date().toLocaleTimeString()}</i>`);
    return bits.join("\n");
  }

  // -------------------------------------------------------------------------
  // Trigger (shared by countdown + live)
  // -------------------------------------------------------------------------

  private async trigger(w: ActiveWatch, target: Target, reason: string): Promise<void> {
    if (w.stopped) return;
    this.clear(w);

    const autoFire = target.snipe?.autoFire === true;
    const fireable = this.isFireable(target);

    if (autoFire && fireable) {
      await this.tg.sendMessage(w.chatId, `🚨 ${reason} Auto-firing now…`);
      await fireAndReport(this.tg, this.store, target, w.chatId);
      return;
    }

    // Alert (either confirm-mode, or auto-fire was on but the snipe isn't ready).
    const note =
      autoFire && !fireable
        ? "\n<i>(Auto-fire was on, but the snipe isn't fully set up — alerting instead of firing blind.)</i>"
        : "";
    await this.tg.sendMessage(
      w.chatId,
      `🚨 <b>${reason}</b>${note}\n${w.label}\nTap GO to fire.`,
      [
        [{ text: "🚀 GO — fire now", callback_data: "snipe:go" }],
        [{ text: "⚡ Snipe settings", callback_data: "snipe" }],
      ]
    );
  }

  /** Can we actually fire right now? Active wallet + a buildable mint call. */
  private isFireable(target: Target): boolean {
    const active = this.store.getActive();
    if (!active) return false;
    if (!target.snipe?.functionSig) return false;
    try {
      buildMintCall(target, active.address);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Edit the status message in place; fall back to a fresh send if editing fails. */
  private async setStatus(w: ActiveWatch, text: string, buttons?: InlineButton[][]): Promise<void> {
    try {
      if (w.statusMsgId !== undefined) {
        await this.tg.editMessageText(w.chatId, w.statusMsgId, text, buttons);
      } else {
        const m = await this.tg.sendMessage(w.chatId, text, buttons);
        w.statusMsgId = m.message_id;
      }
    } catch {
      // Editing can fail (message unchanged, too old, or deleted). Non-fatal —
      // the next tick will try again. We deliberately don't spam a new message.
    }
  }

  private async needContract(chatId: number): Promise<void> {
    await this.tg.sendMessage(
      chatId,
      "First check a contract so I know what to watch.",
      [[{ text: "🔍 Check a contract", callback_data: "recon" }], [{ text: "⬅️ Menu", callback_data: "menu" }]]
    );
  }
}

// ---------------------------------------------------------------------------
// Time parsing + formatting (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse a human "when" into an absolute Date.
 * Accepts: durations ("10m", "90s", "1h30m", bare seconds), a clock time
 * ("15:30", "3:30pm" → next occurrence in local time), or a unix timestamp
 * (10-digit seconds / 13-digit ms). Throws a friendly error otherwise.
 */
export function parseWhen(input: string, now: Date = new Date()): Date {
  const raw = input.trim().toLowerCase().replace(/^in\s+/, "").replace(/^at\s+/, "");
  if (!raw) throw new Error("Give me a time, e.g. 10m, 1h30m, 15:30, or a unix timestamp.");

  // Unix timestamp: 13-digit ms or 10-digit seconds.
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);

  // Clock time HH:MM (24h) or H:MM am/pm → next occurrence in local time.
  const clock = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (clock) {
    let hour = Number(clock[1]);
    const min = Number(clock[2]);
    const ap = clock[3];
    if (min > 59) throw new Error("Minutes must be 00–59.");
    if (ap) {
      if (hour < 1 || hour > 12) throw new Error("With am/pm the hour must be 1–12.");
      if (ap === "pm" && hour !== 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
    } else if (hour > 23) {
      throw new Error("Hour must be 00–23.");
    }
    const target = new Date(now);
    target.setHours(hour, min, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1); // roll to next day
    return target;
  }

  // Duration: sum of <number><unit> tokens (d/h/m/s and word forms).
  const durRe = /(\d+)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)/g;
  let ms = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = durRe.exec(raw)) !== null) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    if (unit.startsWith("d")) ms += n * 86_400_000;
    else if (unit.startsWith("h")) ms += n * 3_600_000;
    else if (unit.startsWith("m")) ms += n * 60_000; // m = minutes
    else ms += n * 1_000; // s = seconds
  }
  if (!matched) {
    if (/^\d+$/.test(raw)) ms = Number(raw) * 1000; // bare number = seconds
    else throw new Error(`I couldn't read "${input}" as a time. Try 10m, 1h30m, 90s, 15:30, or a unix timestamp.`);
  }
  if (ms <= 0) throw new Error("That comes out to zero — give me a moment in the future.");
  return new Date(now.getTime() + ms);
}

/** Format a millisecond remainder like "1h 04m 09s" (drops leading zero units). */
export function fmtRemaining(msIn: number): string {
  const ms = Math.max(0, msIn);
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const min = Math.floor((total % 3_600) / 60);
  const sec = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (min || h || d) parts.push(`${String(min).padStart(2, "0")}m`);
  parts.push(`${String(sec).padStart(2, "0")}s`);
  return parts.join(" ");
}

function labelFor(target: Target): string {
  const r = target.recon;
  const name = r?.name ? `${r.name}${r.symbol ? ` (${r.symbol})` : ""}` : shortAddr(target.address);
  return `${escapeHtml(name)} · ${escapeHtml(target.chain.name)}`;
}

function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "contract";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
