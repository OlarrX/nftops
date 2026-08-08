/**
 * Bot entry point.
 *
 * Account-LOCKED front door.
 *  - It only responds to the single Telegram user id in TELEGRAM_ALLOWED_USER_ID.
 *    Every other user is silently ignored (logged, never answered). This is the
 *    bot equivalent of "burner wallet only" — a key-holding bot must never talk
 *    to strangers.
 *  - It shows a /start welcome, a /help, and a main menu of inline buttons.
 *
 * Live so far: wallet management (create/import/forget, encrypted at rest) and
 * contract recon (paste a contract → read supply/price/sale state + allowlist).
 * Firing the actual mint is wired in the next stage; the "snipe" button explains
 * that for now.
 *
 * Run it with:  npm run bot
 */

import { loadBotConfig } from "./config";
import {
  TelegramClient,
  type TgUpdate,
  type TgMessage,
  type TgCallbackQuery,
  type InlineButton,
} from "./telegram";
import { WalletStore } from "./walletStore";
import { SessionState } from "./session";
import { handleWalletCallback, handleWalletMessage } from "./wallet";
import { handleReconCallback, handleReconMessage } from "./recon";
import { handleSnipeCallback, handleSnipeMessage } from "./snipe";
import { WatchManager } from "./watch";
import { GuestStore } from "./guests";
import {
  handleInvitesCallback,
  handleOwnerGuestCommand,
  handleRedeemCommand,
} from "./guestCommands";

/** Long-poll timeout — how long Telegram holds each request open. */
const POLL_TIMEOUT_SEC = 30;

/** Shared runtime state, created once at startup. */
interface BotContext {
  tg: TelegramClient;
  ownerId: number;
  store: WalletStore;
  session: SessionState;
  watch: WatchManager;
  guests: GuestStore;
}

async function main(): Promise<void> {
  const config = loadBotConfig();
  const tg = new TelegramClient(config.token);
  const store = new WalletStore(config.encryptionPassword);
  const session = new SessionState();
  const watch = new WatchManager(tg, store, session);
  const guests = new GuestStore();

  // Confirm the token is valid before we start looping.
  const me = await tg.getMe();
  console.log(`✅ Bot online as @${me.username} (id ${me.id})`);
  console.log(`🔒 Locked to owner id: ${config.ownerId}`);
  const guestCount = guests.listGuests().length;
  if (guestCount > 0) console.log(`👥 Recon-only guests with access: ${guestCount}`);
  console.log("Press Ctrl+C to stop.\n");

  const ctx: BotContext = { tg, ownerId: config.ownerId, store, session, watch, guests };

  let offset = 0;
  // Main long-poll loop: ask for updates, handle them, repeat.
  while (true) {
    let updates: TgUpdate[] = [];
    try {
      updates = await tg.getUpdates(offset, POLL_TIMEOUT_SEC);
    } catch (err) {
      // Network blip or transient API error — log and back off briefly.
      console.error("getUpdates failed, retrying in 3s:", (err as Error).message);
      await sleep(3000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1; // acknowledge: never re-deliver this update
      try {
        await handleUpdate(ctx, update);
      } catch (err) {
        console.error("Error handling update:", (err as Error).message);
      }
    }
  }
}

/**
 * Route a single update. Enforces the owner lock FIRST — before any other
 * logic runs — so an unauthorized user can never reach a handler.
 */
async function handleUpdate(ctx: BotContext, update: TgUpdate): Promise<void> {
  const { tg, ownerId, guests } = ctx;

  if (update.message) {
    const m = update.message;
    const uid = m.from?.id;

    // Owner: full access, but only in their own private chat.
    if (uid === ownerId) {
      if (!isPrivateOwnerChat(m.chat, ownerId)) return; // never operate in a group
      await handleMessage(ctx, m);
      return;
    }

    // Non-owner: only ever engage in a 1:1 private chat (never a group).
    if (m.chat.type !== "private") {
      console.warn(`🚫 Ignored non-owner message in non-private chat id=${m.chat.id}`);
      return;
    }
    if (uid === undefined) return;
    await handleNonOwnerMessage(ctx, m, uid);
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const uid = cq.from.id;

    // Owner buttons: full access, private chat only.
    if (uid === ownerId) {
      await tg.answerCallbackQuery(cq.id);
      if (cq.message && !isPrivateOwnerChat(cq.message.chat, ownerId)) return;
      await handleCallback(ctx, cq);
      return;
    }

    // Non-owner button taps: acknowledge to stop the spinner, then only serve
    // redeemed guests, and only in their private chat.
    await tg.answerCallbackQuery(cq.id);
    if (!cq.message || cq.message.chat.type !== "private") return;
    if (!guests.isGuest(uid)) {
      console.warn(`🚫 Ignored button tap from non-guest id=${uid}`);
      return;
    }
    await handleGuestCallback(ctx, cq);
  }
}

/**
 * Handle a message from someone who is NOT the owner. They may:
 *  - redeem an invite code (/redeem <code>) — the only thing a stranger can do;
 *  - if already a redeemed guest, use recon-only features.
 * Anything else from a non-guest is silently ignored (logged), preserving the
 * "never talk to strangers" posture.
 */
async function handleNonOwnerMessage(ctx: BotContext, msg: TgMessage, uid: number): Promise<void> {
  const { tg, guests, session } = ctx;
  const text = (msg.text ?? "").trim();
  const chatId = msg.chat.id;

  // A /redeem attempt is allowed from anyone (that's how a friend gets in).
  if (await handleRedeemCommand(tg, guests, chatId, uid, text)) return;

  // Beyond redeeming, only redeemed guests get any response at all.
  if (!guests.isGuest(uid)) {
    console.warn(`🚫 Ignored message from non-guest id=${uid}`);
    return;
  }

  // Recon-only guest. Let an in-progress recon flow consume follow-ups first
  // (restricted=true → no snipe/watch buttons ever offered).
  if (await handleReconMessage(tg, session, chatId, text, true)) return;

  if (text === "/start" || text === "/menu") {
    await sendGuestMenu(tg, chatId);
    return;
  }
  if (text === "/help") {
    await tg.sendMessage(
      chatId,
      [
        "<b>Recon access</b>",
        "",
        "You can look up NFT contracts: tap 🔍 <b>Check a contract</b>, choose the chain,",
        "and paste an address to see supply, price, and whether the sale is live.",
        "",
        "This is <b>view-only</b> — you can't mint, spend, or use any wallet here.",
      ].join("\n"),
      [[{ text: "🔍 Check a contract", callback_data: "recon" }]]
    );
    return;
  }

  await tg.sendMessage(chatId, "This is view-only recon access. Tap /start to check a contract.");
}

/**
 * Handle a button tap from a redeemed guest. Only recon + menu are allowed;
 * every owner-only action (wallet/snipe/watch/invites) is refused here, so a
 * guest can never reach a firing or key path even by crafting a callback.
 */
async function handleGuestCallback(ctx: BotContext, cq: TgCallbackQuery): Promise<void> {
  const { tg, session } = ctx;
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;
  if (chatId === undefined) return;

  if (data === "menu") {
    await sendGuestMenu(tg, chatId);
    return;
  }
  // Guests may start recon and pick a chain, but not add allowlist proof (that's
  // a snipe prerequisite). recon / recon:chain:* only.
  if (data === "recon" || data.startsWith("recon:chain:")) {
    if (await handleReconCallback(tg, session, chatId, data)) return;
  }
  await tg.sendMessage(
    chatId,
    "That option isn't part of view-only recon access. Tap 🔍 Check a contract.",
    [[{ text: "🔍 Check a contract", callback_data: "recon" }]]
  );
}

/**
 * Second gate: the bot only ever operates in the owner's PRIVATE chat (where
 * chat.id === the owner's user id). This closes a subtle leak — in a group, the
 * owner could tap a button and a reply (e.g. a freshly created private key) would
 * be posted to chat.id, i.e. the whole group. A key-holding bot must never speak
 * anywhere but the owner's DM.
 */
function isPrivateOwnerChat(chat: { id: number; type: string }, ownerId: number): boolean {
  if (chat.type === "private" && chat.id === ownerId) return true;
  console.warn(`🚫 Ignored update from non-private/non-owner chat id=${chat.id} type=${chat.type}`);
  return false;
}

/** Handle a text message (commands like /start, /help). */
async function handleMessage(ctx: BotContext, msg: TgMessage): Promise<void> {
  const { tg, store, session, watch } = ctx;
  const text = (msg.text ?? "").trim();

  // First, let an in-progress flow (e.g. import: awaiting a pasted key, or recon:
  // awaiting a contract address / allowlist proof) consume it.
  if (await handleWalletMessage(tg, store, session, msg.chat.id, text)) return;
  if (await handleReconMessage(tg, session, msg.chat.id, text)) return;
  if (await handleSnipeMessage(tg, session, msg.chat.id, text)) return;
  if (await watch.handleMessage(msg.chat.id, text)) return;

  // Owner guest-access commands (/invite, /guests, /revoke).
  if (await handleOwnerGuestCommand(tg, ctx.guests, msg.chat.id, text)) return;

  if (text === "/start" || text === "/menu") {
    await sendMainMenu(tg, msg.chat.id);
    return;
  }

  if (text === "/help") {
    await tg.sendMessage(
      msg.chat.id,
      [
        "<b>NFTOps Mint Bot — help</b>",
        "",
        "This bot mints/snipes NFTs for you. It is locked to your account only.",
        "",
        "<b>Commands</b>",
        "/start — show the main menu",
        "/help — this message",
        "/cancel — abort the current step",
        "/invite — create a single-use, recon-only code for a friend",
        "/guests — see and revoke people you've invited",
        "",
        "⚠️ <b>Safety:</b> only ever load a <b>burner</b> wallet here, funded with just",
        "what a mint needs. Never your main wallet.",
      ].join("\n")
    );
    return;
  }

  // Unknown text — nudge back to the menu.
  await tg.sendMessage(msg.chat.id, "Not sure what that means. Try /start for the menu.");
}

/** Handle an inline-button tap. */
async function handleCallback(ctx: BotContext, cq: TgCallbackQuery): Promise<void> {
  const { tg, store, session, watch } = ctx;
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;

  // Always acknowledge the tap first so the button stops spinning.
  await tg.answerCallbackQuery(cq.id);
  if (chatId === undefined) return;

  // Wallet actions (wallet, wallet:*) are handled by the wallet module.
  // Balance needs a chain: if the user has started a recon flow, we already know
  // which chain they're on, so balance checks THERE. Otherwise it asks them to
  // pick a contract first (which is where a chain gets chosen).
  if (data === "wallet" || data.startsWith("wallet:")) {
    const handled = await handleWalletCallback(
      tg,
      store,
      session,
      chatId,
      data,
      async () => {
        const t = session.getTarget(chatId);
        return t ? { rpcUrl: t.chain.rpcUrl, currency: t.chain.currency } : null;
      }
    );
    if (handled) return;
  }

  // Recon actions (recon, recon:*) are handled by the recon module.
  if (data === "recon" || data.startsWith("recon:")) {
    if (await handleReconCallback(tg, session, chatId, data)) return;
  }

  // Snipe actions (snipe, snipe:*) are handled by the snipe module.
  if (data === "snipe" || data.startsWith("snipe:")) {
    if (await handleSnipeCallback(tg, store, session, chatId, data)) return;
  }

  // Watch actions (watch:*) — countdowns and mint-live alerts.
  if (data.startsWith("watch:")) {
    if (await watch.handleCallback(chatId, data)) return;
  }

  // Guest-access management (invites, invites:*) — owner only, gated by router.
  if (data === "invites" || data.startsWith("invites:")) {
    if (await handleInvitesCallback(tg, ctx.guests, chatId, data)) return;
  }

  switch (data) {
    case "menu":
      await sendMainMenu(tg, chatId);
      break;
    default:
      await tg.sendMessage(chatId, "Unknown action. Tap /start for the menu.");
  }
}

/** Send the main menu with inline buttons. */
async function sendMainMenu(tg: TelegramClient, chatId: number): Promise<void> {
  const buttons: InlineButton[][] = [
    [{ text: "👛 Wallet", callback_data: "wallet" }],
    [{ text: "🔍 Check a contract", callback_data: "recon" }],
    [{ text: "⚡ Snipe a mint", callback_data: "snipe" }],
    [{ text: "🎟️ Guest access", callback_data: "invites" }],
  ];
  await tg.sendMessage(
    chatId,
    [
      "⚡ <b>NFTOps Mint Bot</b>",
      "",
      "Your personal mint/snipe assistant. Pick an option below.",
      "",
      "🔒 This bot only responds to you.",
    ].join("\n"),
    buttons
  );
}

/** The trimmed menu a recon-only guest sees. No wallet, snipe, or invites. */
async function sendGuestMenu(tg: TelegramClient, chatId: number): Promise<void> {
  await tg.sendMessage(
    chatId,
    [
      "👀 <b>Recon access</b>",
      "",
      "You can look up any NFT contract's mint info — supply, price, and whether the",
      "sale is live. This is view-only: no wallet, no minting, no spending.",
    ].join("\n"),
    [[{ text: "🔍 Check a contract", callback_data: "recon" }]]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("\n❌ Bot failed to start:\n" + (err as Error).message + "\n");
  process.exit(1);
});
