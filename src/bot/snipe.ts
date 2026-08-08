/**
 * Snipe / fire the mint — the bot's "trigger" module.
 *
 * This is the money-touching part: it takes a contract the recon stage already
 * checked, builds the mint transaction with YOUR gas + price settings, and —
 * once you're happy — broadcasts it from the ACTIVE wallet.
 *
 * Four controls you asked for are all here:
 *
 *  - Gas: auto-aggressive (safe 1.5x / competitive 3x / max 5x) or manual gwei,
 *    re-read live right before firing, plus automatic bump-on-the-fly if the
 *    tx stalls in the mempool.
 *  - Max-price ceiling: a hard cap on total native spend (price × qty). If the
 *    live price × qty exceeds the cap, we REFUSE to fire. This is the "dev can't
 *    rug the price on me" guard.
 *  - Simulate-then-fire vs fire raw: simulation does one eth_estimateGas round-
 *    trip (a few tens of ms) and catches a wrong function/args/price BEFORE any
 *    value moves. Fire raw skips it for max speed.
 *  - Confirm-mode vs auto-fire: confirm shows you the exact transaction and
 *    waits for your tap; auto-fire sends the moment you hit "GO" (and lets the
 *    scheduled-fire stage fire at a target time without you in the loop).
 *
 * SAFETY POSTURE (load-bearing, don't weaken):
 *  - We only ever fire from the store's ACTIVE wallet, key decrypted in memory
 *    for the instant of signing, then dropped.
 *  - The max-spend ceiling is ALWAYS enforced when set; a price above the cap
 *    aborts with a clear message. A project changing its price mid-mint cannot
 *    silently cost you more than you approved.
 *  - Firing stays owner-gated at the routing layer (index.ts).
 *  - Slippage on a "value" tx (payable mint): we send value = price × qty, so a
 *    price-bump means the tx would fail rather than overpay. Good.
 */

import { ethers } from "ethers";
import { TelegramClient, type InlineButton } from "./telegram";
import { WalletStore } from "./walletStore";
import {
  SessionState,
  type Target,
  type SnipeConfig,
  defaultSnipeConfig,
} from "./session";
import { estimateAggressiveGas, manualGas, type GasEstimate } from "../utils/gasStrategy";

// ---------------------------------------------------------------------------
// Settings UI
// ---------------------------------------------------------------------------

/** Human summary of the current snipe config. `target` lets us show human units. */
export function snipeConfigText(cfg: SnipeConfig, target?: Target): string {
  const lines: string[] = ["⚡ <b>Snipe settings</b>", ""];

  lines.push(`🧮 Function: ${cfg.functionSig ? `<code>${cfg.functionSig}</code>` : "<i>not set — tap to pick</i>"}`);
  lines.push(`🔢 Quantity: <b>${cfg.quantity}</b>`);

  const gasLabel =
    cfg.gas.kind === "auto"
      ? `auto · ${cfg.gas.aggression} (${aggressionMultLabel(cfg.gas.aggression)})`
      : `manual · max ${cfg.gas.maxFeeGwei} gwei / tip ${cfg.gas.priorityFeeGwei} gwei`;
  lines.push(`⛽ Gas: <b>${gasLabel}</b>`);

  let spendLabel: string;
  if (cfg.maxSpendRaw === undefined) {
    spendLabel = "💰 Max spend: <i>not set — set it so a price-change can't rug you</i>";
  } else if (target) {
    const human = trimDecimals(ethers.formatUnits(cfg.maxSpendRaw, target.chain.nativeDecimals));
    spendLabel = `💰 Max spend: <b>${human} ${target.chain.currency}</b> (price × qty ceiling)`;
  } else {
    spendLabel = `💰 Max spend: <b>${cfg.maxSpendRaw}</b> (raw)`;
  }
  lines.push(spendLabel);
  lines.push(`✅ Firing mode: <b>${cfg.autoFire ? "AUTO-FIRE (no confirm)" : "confirm each time"}</b>`);
  lines.push(`🧪 Safety net: <b>${cfg.simulate ? "simulate-then-fire" : "fire raw (fastest)"}</b>`);

  return lines.join("\n");
}

/** Drop trailing zeros from a decimal string ("0.250000" → "0.25"). */
function trimDecimals(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

function aggressionMultLabel(a: "safe" | "competitive" | "max"): string {
  return a === "safe" ? "1.5x" : a === "competitive" ? "3x" : "5x";
}

/** Buttons under the snipe settings. */
export function snipeConfigButtons(cfg: SnipeConfig): InlineButton[][] {
  const rows: InlineButton[][] = [
    [{ text: "🧮 Pick mint function", callback_data: "snipe:function" }],
    [{ text: "🔢 Quantity", callback_data: "snipe:qty" }],
    [
      { text: "⛽ Auto gas 3x", callback_data: "snipe:gas:auto:competitive" },
      { text: "⛽ Auto gas 5x", callback_data: "snipe:gas:auto:max" },
    ],
    [
      { text: "⛽ Safe 1.5x", callback_data: "snipe:gas:auto:safe" },
      { text: "✍️ Manual gas", callback_data: "snipe:gas:manual" },
    ],
    [
      {
        text: cfg.autoFire ? "✅ Firing: AUTO-FIRE" : "🟡 Firing: confirm first",
        callback_data: "snipe:toggle:autofire",
      },
    ],
    [
      {
        text: cfg.simulate ? "🧪 Safety: simulate-then-fire" : "🏃 Safety: fire raw",
        callback_data: "snipe:toggle:simulate",
      },
    ],
    [{ text: "💰 Set max spend", callback_data: "snipe:maxspend" }],
    [
      { text: "⏰ Countdown", callback_data: "watch:countdown" },
      { text: "📡 Watch until live", callback_data: "watch:live" },
    ],
    [{ text: "🚀 GO — fire the mint", callback_data: "snipe:go" }],
    [{ text: "⬅️ Back", callback_data: "snipe:back" }],
  ];
  return rows;
}

// ---------------------------------------------------------------------------
// Transaction building
// ---------------------------------------------------------------------------
//
// Mint functions vary wildly in their arguments. Rather than force you to hand-
// encode calldata, we parse the chosen signature's parameter TYPES and fill each
// slot by role:
//   - bytes32[]        → your pasted allowlist proof
//   - address (first)  → the recipient = your active wallet
//   - uint* (first)    → the quantity you chose
//   - bool             → false (rare; e.g. some "isAllowlist" flags — overrideable later)
// Anything we can't map (bytes, tuple, string, extra numerics) makes us stop and
// say so honestly, rather than guess and waste gas on a revert.

interface BuiltCall {
  /** ABI-encoded calldata for the mint. */
  data: string;
  /** Native value to send (price × qty), raw bigint. */
  value: bigint;
  /** Human description of exactly what will be called. */
  describe: string;
}

/** Split "mint(uint256,bytes32[])" into name + ordered param types. */
function parseSig(sig: string): { name: string; params: string[] } {
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  if (open < 0 || close < 0 || close < open) {
    throw new Error(`"${sig}" isn't a valid function signature.`);
  }
  const name = sig.slice(0, open).trim();
  const inner = sig.slice(open + 1, close).trim();
  const params = inner === "" ? [] : inner.split(",").map((p) => p.trim());
  return { name, params };
}

/**
 * Build the mint calldata + value from the target + config.
 * Throws with a clear message if a required piece is missing or unmappable.
 */
export function buildMintCall(target: Target, activeAddress: string): BuiltCall {
  const cfg = target.snipe;
  if (!cfg?.functionSig) throw new Error("Pick a mint function first.");
  const { name, params } = parseSig(cfg.functionSig);

  const qty = BigInt(cfg.quantity);
  const args: unknown[] = [];
  let usedQty = false;
  let usedAddr = false;
  let usedProof = false;

  for (const type of params) {
    if (type === "bytes32[]") {
      if (!target.allowlistProof || target.allowlistProof.length === 0) {
        throw new Error(
          "This function needs an allowlist proof (bytes32[]), but none is saved. " +
            "Go back and add your proof, or pick the public mint function."
        );
      }
      args.push(target.allowlistProof);
      usedProof = true;
    } else if (type === "address" && !usedAddr) {
      args.push(activeAddress);
      usedAddr = true;
    } else if (/^uint\d*$/.test(type) && !usedQty) {
      args.push(qty);
      usedQty = true;
    } else if (type === "bool") {
      args.push(false);
    } else {
      throw new Error(
        `The function ${cfg.functionSig} has an argument of type "${type}" I can't ` +
          `auto-fill. Supported shapes are quantity/recipient/proof-style mints. ` +
          `Pick another function, or mint via the project site for this one.`
      );
    }
  }

  const iface = new ethers.Interface([`function ${cfg.functionSig}`]);
  const data = iface.encodeFunctionData(name, args);

  // Value = price × qty when a price was read. If price is unknown we send 0 and
  // let simulation/receipt tell the truth (many free mints are value 0 anyway).
  const priceRaw = target.recon?.priceRaw;
  const value = priceRaw ? BigInt(priceRaw) * qty : 0n;

  const parts: string[] = [];
  if (usedQty) parts.push(`qty=${cfg.quantity}`);
  if (usedAddr) parts.push(`to=${activeAddress}`);
  if (usedProof) parts.push(`proof=[${target.allowlistProof!.length} hashes]`);
  const describe = `${name}(${parts.join(", ")})`;

  return { data, value, describe };
}

/** Resolve the gas estimate from config (auto reads live; manual is fixed). */
export async function resolveGas(
  provider: ethers.Provider,
  cfg: SnipeConfig
): Promise<GasEstimate> {
  if (cfg.gas.kind === "manual") {
    return manualGas(cfg.gas.maxFeeGwei, cfg.gas.priorityFeeGwei);
  }
  return estimateAggressiveGas(provider, cfg.gas.aggression);
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

/** Ceiling check: refuse to send if the required value exceeds the cap. */
function enforceCeiling(cfg: SnipeConfig, value: bigint, target: Target): void {
  if (cfg.maxSpendRaw === undefined) return;
  const cap = BigInt(cfg.maxSpendRaw);
  if (value > cap) {
    const cur = target.recon?.priceLabel ?? `${value.toString()}`;
    throw new Error(
      `Price × qty exceeds your max-spend ceiling.\n` +
        `Ceiling: ${cfg.maxSpendRaw}\n` +
        `Required: ${cur} (${value.toString()})\n` +
        `The project's price may have changed. Tap 💰 to raise the ceiling, or /cancel.`
    );
  }
}

/**
 * Build + (optionally simulate) + broadcast the mint.
 * Steps: guardrails → build call → gas → simulate (unless fire-raw) → send →
 * bump-on-the-fly if it stalls. Returns the tx hash.
 */
export async function fireMint(
  store: WalletStore,
  target: Target,
  activeAddress: string,
  onStatus: (text: string) => Promise<void>
): Promise<string> {
  const cfg = target.snipe ?? defaultSnipeConfig();
  const chain = target.chain;

  if (!target.address) throw new Error("No contract address loaded — run 🔍 Check a contract first.");
  const active = store.getActive();
  if (!active) throw new Error("No active wallet. Create or import one in 👛 Wallet first.");

  // Build the call (this also validates proof/function presence).
  const { data, value, describe } = buildMintCall(target, activeAddress);

  // Guardrail: the ceiling is the "can't rug the price" backstop.
  enforceCeiling(cfg, value, target);

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
  const gas = await resolveGas(provider, cfg);
  const key = store.revealKey(active.label);
  const wallet = new ethers.Wallet(key, provider);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const chainId = (await provider.getNetwork()).chainId;

  // Gas limit: estimate the actual call (not a 21k default), then add a buffer.
  let gasLimit: bigint;
  try {
    const est = await provider.estimateGas({
      from: wallet.address,
      to: target.address,
      data,
      value,
    });
    gasLimit = (est * 120n) / 100n; // +20% buffer
  } catch (err) {
    throw new Error(
      `Gas estimate failed — the call would revert:\n${(err as Error).message}` +
        `\nCheck the mint function, proof, and whether the sale is open.`
    );
  }

  const tx: ethers.TransactionRequest = {
    to: target.address,
    data,
    value,
    nonce,
    gasLimit,
    maxFeePerGas: gas.maxFeePerGas,
    maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    chainId,
  };

  // Simulate-then-fire: a read-only eth_call against the same params catches
  // wrong args/function/proof BEFORE any value moves. A few tens of ms.
  if (cfg.simulate) {
    await onStatus("🧪 Simulating… (one RPC round-trip)");
    try {
      await provider.call({ ...tx, from: wallet.address });
    } catch (err) {
      throw new Error(
        `Simulation failed — this transaction would REVERT:\n${(err as Error).message}\n` +
          `Nothing was sent. Check the function, proof, price, and sale state.`
      );
    }
  }

  await onStatus(`🚀 Firing ${describe}…`);
  let current = await wallet.sendTransaction(tx);

  // Bump-on-the-fly: if the tx hasn't confirmed within a short window, raise the
  // tip and resend the SAME nonce (classic mempool replacement). Each replacement
  // must beat the prior fee, so we bump ~12% per round.
  const BUMP_PCT = 12n;
  const MAX_BUMPS = 4;
  const WAIT_MS = 5000;
  let lastMaxFee = gas.maxFeePerGas;
  let lastTip = gas.maxPriorityFeePerGas;

  for (let bump = 0; bump <= MAX_BUMPS; bump++) {
    const receipt = await current.wait(1, WAIT_MS).catch(() => null);
    if (receipt) {
      const ok = receipt.status === 1;
      await onStatus(
        ok
          ? `✅ Confirmed in block ${receipt.blockNumber}.`
          : `⚠️ Mined but FAILED (reverted) in block ${receipt.blockNumber}. No NFT; gas was spent.`
      );
      return current.hash;
    }
    if (bump === MAX_BUMPS) break;
    lastMaxFee = lastMaxFee + (lastMaxFee * BUMP_PCT) / 100n;
    lastTip = lastTip + (lastTip * BUMP_PCT) / 100n;
    await onStatus(`⏫ Tx slow — bumping tip (${bump + 1}/${MAX_BUMPS})…`);
    current = await wallet.sendTransaction({
      ...tx,
      nonce,
      maxFeePerGas: lastMaxFee,
      maxPriorityFeePerGas: lastTip,
    });
  }

  // Took all bumps and never confirmed. The user keeps the hash to track it.
  await onStatus(
    `🕰️ Tx still pending after bumps. Track it:\n${chain.explorer}/tx/${current.hash}\n` +
      `It may still land; do NOT resend the same nonce manually unless you know it failed.`
  );
  return current.hash;
}

// ---------------------------------------------------------------------------
// Flow handlers
// ---------------------------------------------------------------------------

/** Ensure the target has a snipe config, seeding the function if recon found one. */
function ensureConfig(target: Target): SnipeConfig {
  if (!target.snipe) {
    const cfg = defaultSnipeConfig();
    const fns = target.recon?.mintFunctions ?? [];
    if (fns.length === 1) cfg.functionSig = fns[0]; // obvious single choice
    target.snipe = cfg;
  }
  return target.snipe;
}

/** Re-render the settings screen. */
async function showSettings(tg: TelegramClient, target: Target, chatId: number): Promise<void> {
  const cfg = ensureConfig(target);
  await tg.sendMessage(chatId, snipeConfigText(cfg, target), snipeConfigButtons(cfg));
}

/**
 * Handle a snipe:* tap (and the bare "snipe"). Returns true if consumed.
 * `fire` is injected so this module doesn't reach back into the bot loop.
 */
export async function handleSnipeCallback(
  tg: TelegramClient,
  store: WalletStore,
  session: SessionState,
  chatId: number,
  data: string
): Promise<boolean> {
  const target = session.getTarget(chatId);

  if (data === "snipe" || data === "snipe:back") {
    if (!target?.recon || !target.address) {
      await tg.sendMessage(
        chatId,
        "First check a contract so I know what to snipe.",
        [[{ text: "🔍 Check a contract", callback_data: "recon" }], [{ text: "⬅️ Menu", callback_data: "menu" }]]
      );
      return true;
    }
    await showSettings(tg, target, chatId);
    return true;
  }

  // Everything past here needs a loaded target.
  if (!target?.recon || !target.address) {
    if (data.startsWith("snipe:")) {
      await tg.sendMessage(chatId, "Lost the contract — tap 🔍 to check one first.");
      return true;
    }
    return false;
  }
  const cfg = ensureConfig(target);

  if (data === "snipe:function") {
    const fns = target.recon.mintFunctions;
    const rows: InlineButton[][] = fns.map((f, i) => [
      { text: (cfg.functionSig === f ? "⭐ " : "") + f, callback_data: `snipe:setfn:${i}` },
    ]);
    rows.push([{ text: "✍️ Type it manually", callback_data: "snipe:fnmanual" }]);
    rows.push([{ text: "⬅️ Back", callback_data: "snipe:back" }]);
    await tg.sendMessage(
      chatId,
      fns.length
        ? "Pick the mint function to call:"
        : "No functions auto-detected (unverified contract). Type the signature manually, e.g. <code>mint(uint256)</code>.",
      rows
    );
    return true;
  }

  if (data.startsWith("snipe:setfn:")) {
    const i = Number(data.slice("snipe:setfn:".length));
    const fns = target.recon.mintFunctions;
    if (Number.isInteger(i) && fns[i]) {
      cfg.functionSig = fns[i];
      session.setTarget(chatId, target);
    }
    await showSettings(tg, target, chatId);
    return true;
  }

  if (data === "snipe:fnmanual") {
    session.set(chatId, { kind: "awaiting_mint_function" });
    await tg.sendMessage(
      chatId,
      "Type the mint function signature, e.g.\n<code>mint(uint256)</code>\n<code>whitelistMint(uint256,bytes32[])</code>\n\nSend /cancel to abort."
    );
    return true;
  }

  if (data === "snipe:qty") {
    session.set(chatId, { kind: "awaiting_quantity" });
    await tg.sendMessage(chatId, "How many to mint? Send a whole number (e.g. 1). /cancel to abort.");
    return true;
  }

  if (data.startsWith("snipe:gas:auto:")) {
    const level = data.slice("snipe:gas:auto:".length) as "safe" | "competitive" | "max";
    if (["safe", "competitive", "max"].includes(level)) {
      cfg.gas = { kind: "auto", aggression: level };
      session.setTarget(chatId, target);
    }
    await showSettings(tg, target, chatId);
    return true;
  }

  if (data === "snipe:gas:manual") {
    session.set(chatId, { kind: "awaiting_manual_gas" });
    await tg.sendMessage(
      chatId,
      "Send manual gas as two numbers in gwei: <b>maxFee priorityFee</b>\ne.g. <code>50 5</code> (max 50 gwei, 5 gwei tip). /cancel to abort."
    );
    return true;
  }

  if (data === "snipe:toggle:autofire") {
    cfg.autoFire = !cfg.autoFire;
    session.setTarget(chatId, target);
    if (cfg.autoFire) {
      await tg.sendMessage(
        chatId,
        "⚠️ <b>Auto-fire ON.</b> When you tap 🚀 GO, the bot signs and sends immediately, " +
          "no second confirm. Make sure your settings and ceiling are right."
      );
    }
    await showSettings(tg, target, chatId);
    return true;
  }

  if (data === "snipe:toggle:simulate") {
    cfg.simulate = !cfg.simulate;
    session.setTarget(chatId, target);
    if (!cfg.simulate) {
      await tg.sendMessage(
        chatId,
        "🏃 <b>Fire-raw ON.</b> No pre-flight simulation — fastest, but a wrong function/proof/price " +
          "will only surface as a failed tx (gas spent). Use only when you know the call is right."
      );
    }
    await showSettings(tg, target, chatId);
    return true;
  }

  if (data === "snipe:maxspend") {
    session.set(chatId, { kind: "awaiting_max_spend" });
    const cur = target.recon.priceLabel ?? "unknown";
    await tg.sendMessage(
      chatId,
      [
        "💰 <b>Set max spend ceiling</b>",
        `Current read price: <b>${cur}</b> × qty ${cfg.quantity}.`,
        "",
        `Send the ceiling as a number in <b>${target.chain.currency}</b> (total, not per-NFT),`,
        "e.g. <code>0.25</code>. I'll refuse to fire if price × qty exceeds it.",
        "Send <code>none</code> to remove the ceiling (not recommended). /cancel to abort.",
      ].join("\n")
    );
    return true;
  }

  if (data === "snipe:go") {
    return handleGo(tg, store, session, chatId, target, cfg, false);
  }
  if (data === "snipe:confirmfire") {
    return handleGo(tg, store, session, chatId, target, cfg, true);
  }

  return false;
}

/**
 * Per-chat "a fire is already in flight" lock. Keyed by chatId.
 *
 * Why this exists: every real fire funnels through fireAndReport — the GO/confirm
 * button AND the watch engine's auto-fire. Without a lock, two things can each
 * send a SEPARATE mint from the same wallet:
 *   1. double-tapping "Confirm & FIRE" before the first send returns, or
 *   2. a manual GO racing a watch countdown that auto-fires at the same moment.
 * The second send reads the pending nonce (N+1) and goes out as a real, extra
 * transaction — a second mint the user never meant to pay for. The lock makes
 * fireAndReport a no-op while a fire for that chat is still resolving.
 */
const firing = new Set<number>();

/**
 * Fire the mint from the active wallet and report the result to the chat.
 * Shared by the GO button (confirmed/auto) and the watch engine (countdown /
 * mint-live auto-snipe) so both fire through exactly one code path.
 *
 * Never throws — a failed fire is reported to the user, not bubbled up (important
 * for the watch engine, which fires from a background timer with no caller to
 * catch it).
 */
export async function fireAndReport(
  tg: TelegramClient,
  store: WalletStore,
  target: Target,
  chatId: number
): Promise<void> {
  // Double-fire guard: refuse to start a second fire while one is still in flight
  // for this chat. Prevents a double-tap or a GO-vs-watch race sending two mints.
  if (firing.has(chatId)) {
    await tg.sendMessage(chatId, "⏳ Already firing — hold on. I'll report the result here.");
    return;
  }
  const active = store.getActive();
  if (!active) {
    await tg.sendMessage(chatId, "No active wallet. Set one up in 👛 Wallet first.");
    return;
  }
  firing.add(chatId);
  const status = async (t: string) => {
    await tg.sendMessage(chatId, t);
  };
  try {
    const hash = await fireMint(store, target, active.address, status);
    const url = `${target.chain.explorer.replace(/\/+$/, "")}/tx/${hash}`;
    await tg.sendMessage(
      chatId,
      `🎯 Sent. Track it here:\n${url}`,
      [[{ text: "🌐 Open tx", url }], [{ text: "⬅️ Menu", callback_data: "menu" }]]
    );
    // Auto-forget after mint, if the user turned it on.
    if (store.autoForget) {
      const label = active.label; // capture before we drop it
      if (store.forgetActive()) {
        await tg.sendMessage(
          chatId,
          `♻️ Auto-forget: dropped <b>${label}</b> from the bot. Your key is no longer stored here.`
        );
      }
    }
  } catch (err) {
    await tg.sendMessage(chatId, `❌ ${(err as Error).message}`, [
      [{ text: "⬅️ Back to settings", callback_data: "snipe:back" }],
    ]);
  } finally {
    // Always release the lock, whether the fire succeeded, failed, or the wallet
    // was auto-forgotten above — otherwise this chat could never fire again.
    firing.delete(chatId);
  }
}

/** Shared GO path: confirm screen (confirm-mode) or straight to fire. */
async function handleGo(
  tg: TelegramClient,
  store: WalletStore,
  session: SessionState,
  chatId: number,
  target: Target,
  cfg: SnipeConfig,
  confirmed: boolean
): Promise<boolean> {
  const active = store.getActive();
  if (!active) {
    await tg.sendMessage(chatId, "No active wallet. Set one up in 👛 Wallet first.");
    return true;
  }
  if (!cfg.functionSig) {
    await tg.sendMessage(chatId, "Pick a mint function first.");
    return true;
  }

  // Confirm-mode: show the exact plan and require a second, deliberate tap.
  if (!cfg.autoFire && !confirmed) {
    let preview: string;
    try {
      const { describe, value } = buildMintCall(target, active.address);
      const valLabel =
        value === 0n ? "0" : `${ethers.formatUnits(value, target.chain.nativeDecimals)} ${target.chain.currency}`;
      preview = `Call: <code>${describe}</code>\nValue: <b>${valLabel}</b>`;
    } catch (err) {
      await tg.sendMessage(chatId, `❌ ${(err as Error).message}`);
      return true;
    }
    await tg.sendMessage(
      chatId,
      [
        "🧾 <b>Confirm the mint</b>",
        `Wallet: <b>${active.label}</b>`,
        `<code>${active.address}</code>`,
        preview,
        `Gas: ${cfg.gas.kind === "auto" ? `auto ${cfg.gas.aggression}` : `manual ${cfg.gas.maxFeeGwei}/${cfg.gas.priorityFeeGwei}`}`,
        `Safety: ${cfg.simulate ? "simulate-then-fire" : "fire raw"}`,
        "",
        "This spends real funds. Fire it?",
      ].join("\n"),
      [
        [{ text: "✅ Confirm & FIRE", callback_data: "snipe:confirmfire" }],
        [{ text: "⬅️ Back to settings", callback_data: "snipe:back" }],
      ]
    );
    return true;
  }

  // Fire (auto-fire GO, or confirmed tap).
  await fireAndReport(tg, store, target, chatId);
  return true;
}

/**
 * Handle a follow-up text message for a snipe flow (function/qty/gas/max-spend
 * pastes). Returns true if the message was consumed.
 */
export async function handleSnipeMessage(
  tg: TelegramClient,
  session: SessionState,
  chatId: number,
  text: string
): Promise<boolean> {
  const pending = session.get(chatId);
  if (!pending) return false;

  const kinds = ["awaiting_mint_function", "awaiting_quantity", "awaiting_manual_gas", "awaiting_max_spend"];
  if (!kinds.includes(pending.kind)) return false;

  const trimmed = text.trim();
  if (trimmed === "/cancel") {
    session.clear(chatId);
    await tg.sendMessage(chatId, "Cancelled.");
    return true;
  }

  const target = session.getTarget(chatId);
  if (!target?.recon) {
    session.clear(chatId);
    await tg.sendMessage(chatId, "Lost the contract — tap 🔍 to check one first.");
    return true;
  }
  const cfg = ensureConfig(target);

  if (pending.kind === "awaiting_mint_function") {
    try {
      parseSig(trimmed); // validate shape (throws on garbage)
    } catch (err) {
      await tg.sendMessage(chatId, `❌ ${(err as Error).message}\nTry again, e.g. <code>mint(uint256)</code>, or /cancel.`);
      return true;
    }
    cfg.functionSig = trimmed;
    session.setTarget(chatId, target);
    session.clear(chatId);
    await showSettings(tg, target, chatId);
    return true;
  }

  if (pending.kind === "awaiting_quantity") {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      await tg.sendMessage(chatId, "Send a whole number between 1 and 100, or /cancel.");
      return true;
    }
    cfg.quantity = n;
    session.setTarget(chatId, target);
    session.clear(chatId);
    await showSettings(tg, target, chatId);
    return true;
  }

  if (pending.kind === "awaiting_manual_gas") {
    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    const maxFee = Number(parts[0]);
    const tip = Number(parts[1]);
    if (parts.length !== 2 || !isFinite(maxFee) || !isFinite(tip) || maxFee <= 0 || tip < 0 || tip > maxFee) {
      await tg.sendMessage(
        chatId,
        "Send two numbers: <b>maxFee priorityFee</b> in gwei, e.g. <code>50 5</code> " +
          "(tip must be ≥ 0 and ≤ maxFee). Or /cancel."
      );
      return true;
    }
    cfg.gas = { kind: "manual", maxFeeGwei: maxFee, priorityFeeGwei: tip };
    session.setTarget(chatId, target);
    session.clear(chatId);
    await showSettings(tg, target, chatId);
    return true;
  }

  if (pending.kind === "awaiting_max_spend") {
    if (trimmed.toLowerCase() === "none") {
      cfg.maxSpendRaw = undefined;
      session.setTarget(chatId, target);
      session.clear(chatId);
      await tg.sendMessage(chatId, "⚠️ Ceiling removed. The bot will pay whatever price × qty the contract asks. Not recommended.");
      await showSettings(tg, target, chatId);
      return true;
    }
    let raw: bigint;
    try {
      raw = ethers.parseUnits(trimmed, target.chain.nativeDecimals);
    } catch {
      await tg.sendMessage(chatId, `Send a number in ${target.chain.currency}, e.g. <code>0.25</code>, or <code>none</code>. /cancel to abort.`);
      return true;
    }
    if (raw <= 0n) {
      await tg.sendMessage(chatId, "Ceiling must be greater than 0. Try again, or /cancel.");
      return true;
    }
    cfg.maxSpendRaw = raw.toString();
    session.setTarget(chatId, target);
    session.clear(chatId);
    await tg.sendMessage(
      chatId,
      `✅ Ceiling set to <b>${trimmed} ${target.chain.currency}</b>. I'll refuse to fire if price × qty exceeds it.`
    );
    await showSettings(tg, target, chatId);
    return true;
  }

  return false;
}



