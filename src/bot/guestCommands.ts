/**
 * Guest-access commands and UI.
 *
 * Two audiences:
 *
 *  OWNER (you): manage single-use, recon-only invite codes.
 *    - 🎟️ Guest access menu → see pending codes + active guests.
 *    - Create a new code, then send it to ONE friend.
 *    - Revoke any guest with a tap.
 *    Slash equivalents also work: /invite [note], /guests, /revoke <code>.
 *
 *  FRIEND (guest): redeem a code you were given.
 *    - /redeem <code>  → unlocks 🔍 Check a contract (recon) ONLY.
 *
 * Firing, wallets, and snipe settings are NEVER unlocked by a code — those gates
 * live in the router and stay owner-only no matter what. A code only ever grants
 * read-only recon of public on-chain data.
 */

import { TelegramClient, type InlineButton } from "./telegram";
import { GuestStore } from "./guests";

/** Owner's "🎟️ Guest access" overview: pending codes + active guests. */
export async function sendInvitesOverview(
  tg: TelegramClient,
  guests: GuestStore,
  chatId: number
): Promise<void> {
  const pending = guests.listPending();
  const active = guests.listGuests();

  const lines: string[] = ["🎟️ <b>Guest access</b>", ""];
  lines.push(
    "Invite codes are <b>single-use</b> and <b>recon-only</b>. A friend who redeems",
    "one can look up contracts (supply/price/sale state) — but can never touch your",
    "wallet, your snipe settings, or fire a mint. That stays yours alone.",
    ""
  );

  if (pending.length === 0) {
    lines.push("📭 No unused codes right now.");
  } else {
    lines.push(`📬 <b>Unused codes</b> (${pending.length}) — hand one to a friend:`);
    for (const inv of pending) {
      const note = inv.note ? ` — <i>${escapeHtml(inv.note)}</i>` : "";
      lines.push(`   • <code>${inv.code}</code>${note}`);
    }
  }

  lines.push("");
  if (active.length === 0) {
    lines.push("👥 No active guests.");
  } else {
    lines.push(`👥 <b>Active guests</b> (${active.length}):`);
    for (const inv of active) {
      const note = inv.note ? ` (${escapeHtml(inv.note)})` : "";
      lines.push(`   • id <code>${inv.redeemedBy}</code>${note}`);
    }
  }

  const rows: InlineButton[][] = [[{ text: "➕ Create an invite code", callback_data: "invites:new" }]];
  // One revoke button per active guest, so the owner never types a code.
  for (const inv of active) {
    const label = inv.note ? inv.note : `guest ${inv.redeemedBy}`;
    rows.push([{ text: `🚫 Revoke ${label}`, callback_data: `invites:revoke:${inv.code}` }]);
  }
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);

  await tg.sendMessage(chatId, lines.join("\n"), rows);
}

/** Create a fresh code and show the owner exactly what to send the friend. */
async function sendNewInvite(
  tg: TelegramClient,
  guests: GuestStore,
  chatId: number,
  note?: string
): Promise<void> {
  const invite = guests.createInvite(note);
  await tg.sendMessage(
    chatId,
    [
      "✅ <b>New invite code created</b>",
      "",
      `<code>${invite.code}</code>`,
      "",
      "Send your friend these two lines:",
      "",
      "<i>1. Start a chat with this bot and press Start.</i>",
      `<i>2. Send:</i> <code>/redeem ${invite.code}</code>`,
      "",
      "The <b>first</b> person to redeem it is locked in — after that the code is dead,",
      "so no one else (and no second person) can use it. It unlocks recon only.",
    ].join("\n"),
    [
      [{ text: "🎟️ Back to guest access", callback_data: "invites" }],
      [{ text: "⬅️ Menu", callback_data: "menu" }],
    ]
  );
}

/**
 * Handle an owner invites:* callback. Returns true if consumed.
 * (Only ever reached for the owner — the router gates this.)
 */
export async function handleInvitesCallback(
  tg: TelegramClient,
  guests: GuestStore,
  chatId: number,
  data: string
): Promise<boolean> {
  if (data === "invites") {
    await sendInvitesOverview(tg, guests, chatId);
    return true;
  }
  if (data === "invites:new") {
    await sendNewInvite(tg, guests, chatId);
    return true;
  }
  if (data.startsWith("invites:revoke:")) {
    const code = data.slice("invites:revoke:".length);
    const ok = guests.revokeByCode(code);
    await tg.sendMessage(
      chatId,
      ok
        ? "🚫 Guest revoked. That code is now dead and they've lost access."
        : "Couldn't find that code to revoke (already revoked?)."
    );
    await sendInvitesOverview(tg, guests, chatId);
    return true;
  }
  return false;
}

/**
 * Handle owner slash commands for guest management (/invite, /guests, /revoke).
 * Returns true if the text was one of them.
 */
export async function handleOwnerGuestCommand(
  tg: TelegramClient,
  guests: GuestStore,
  chatId: number,
  text: string
): Promise<boolean> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  if (cmd === "/invite") {
    await sendNewInvite(tg, guests, chatId, arg || undefined);
    return true;
  }
  if (cmd === "/guests") {
    await sendInvitesOverview(tg, guests, chatId);
    return true;
  }
  if (cmd === "/revoke") {
    if (!arg) {
      await tg.sendMessage(chatId, "Usage: <code>/revoke &lt;code&gt;</code>. Or use 🎟️ Guest access to tap-revoke.");
      return true;
    }
    const ok = guests.revokeByCode(arg);
    await tg.sendMessage(
      chatId,
      ok ? "🚫 Revoked. That code is dead and the guest has lost access." : "No matching active code to revoke."
    );
    return true;
  }
  return false;
}

/**
 * Handle a /redeem from anyone who is NOT the owner. Returns true if the text was
 * a /redeem attempt (so the router can stop processing it further).
 */
export async function handleRedeemCommand(
  tg: TelegramClient,
  guests: GuestStore,
  chatId: number,
  userId: number,
  text: string
): Promise<boolean> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  if (cmd !== "/redeem") return false;

  const code = rest.join(" ").trim();
  if (!code) {
    await tg.sendMessage(chatId, "Send it as <code>/redeem &lt;code&gt;</code> using the code you were given.");
    return true;
  }

  const result = guests.redeem(code, userId);
  if (result.ok) {
    await tg.sendMessage(
      chatId,
      [
        result.alreadyGuest ? "✅ You already have access." : "✅ <b>Access granted!</b>",
        "",
        "You can look up contracts: tap 🔍 <b>Check a contract</b>, pick the chain, and",
        "paste an address to see its supply, price, and whether the sale is live.",
        "",
        "This is <b>recon only</b> — you can't mint, spend, or touch any wallet here.",
      ].join("\n"),
      [[{ text: "🔍 Check a contract", callback_data: "recon" }]]
    );
  } else {
    const why =
      result.reason === "used"
        ? "That code has already been used by someone else. Ask for a fresh one."
        : result.reason === "revoked"
        ? "That code has been turned off. Ask for a fresh one."
        : "That code isn't valid. Check for typos, or ask for a new one.";
    await tg.sendMessage(chatId, `❌ ${why}`);
  }
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
