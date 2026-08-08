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

/** Long-poll timeout — how long Telegram holds each request open. */
const POLL_TIMEOUT_SEC = 30;

/** Shared runtime state, created once at startup. */
interface BotContext {
  tg: TelegramClient;
  ownerId: number;
  store: WalletStore;
  session: SessionState;
  watch: WatchManager;
}

async function main(): Promise<void> {
  const config = loadBotConfig();
  const tg = new TelegramClient(config.token);
  const store = new WalletStore(config.encryptionPassword);
  const session = new SessionState();
  const watch = new WatchManager(tg, store, session);

  // Confirm the token is valid before we start looping.
  const me = await tg.getMe();
  console.log(`✅ Bot online as @${me.username} (id ${me.id})`);
  console.log(`🔒 Locked to owner id: ${config.ownerId}`);
  console.log("Press Ctrl+C to stop.\n");

  const ctx: BotContext = { tg, ownerId: config.ownerId, store, session, watch };

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
  const { tg, ownerId } = ctx;
  if (update.message) {
    const m = update.message;
    if (!isOwner(m.from?.id, ownerId, m.from?.username)) return;
    if (!isPrivateOwnerChat(m.chat, ownerId)) return; // never operate in a group
    await handleMessage(ctx, m);
  } else if (update.callback_query) {
    const cq = update.callback_query;
    if (!isOwner(cq.from.id, ownerId, cq.from.username)) {
      // Acknowledge so their client stops spinning, but do nothing else.
      await tg.answerCallbackQuery(cq.id);
      return;
    }
    if (cq.message && !isPrivateOwnerChat(cq.message.chat, ownerId)) {
      await tg.answerCallbackQuery(cq.id);
      return;
    }
    await handleCallback(ctx, cq);
  }
}

/** The owner gate. Logs and rejects anyone who isn't the configured owner. */
function isOwner(userId: number | undefined, ownerId: number, username?: string): boolean {
  if (userId === ownerId) return true;
  console.warn(
    `🚫 Ignored message from unauthorized user id=${userId ?? "unknown"} (@${username ?? "?"})`
  );
  return false;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("\n❌ Bot failed to start:\n" + (err as Error).message + "\n");
  process.exit(1);
});
