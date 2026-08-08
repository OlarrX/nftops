/**
 * Wallet UI for the bot.
 *
 * Renders the wallet menu and handles the wallet-related button taps and the
 * follow-up message (pasting a key to import). Balance is read live from the
 * chain via the existing RPC pool / chain presets.
 *
 * Safety UX baked in:
 *  - When a burner is created, the private key is shown ONCE with a loud
 *    "save this now, it won't be shown again" warning.
 *  - Import and reveal remind the user this must be a burner.
 *  - "Forget" explains the bot only drops its copy; the user keeps the key.
 */

import { ethers } from "ethers";
import { TelegramClient, type InlineButton } from "./telegram";
import { WalletStore } from "./walletStore";
import { SessionState } from "./session";

/** Build the wallet menu buttons based on current store state. */
export function walletMenuButtons(store: WalletStore): InlineButton[][] {
  const rows: InlineButton[][] = [
    [{ text: "🆕 Create burner", callback_data: "wallet:create" }],
    [{ text: "📥 Import wallet", callback_data: "wallet:import" }],
  ];
  if (store.list().length > 0) {
    rows.push([{ text: "💰 Show balance", callback_data: "wallet:balance" }]);
    rows.push([{ text: "🔁 Switch active", callback_data: "wallet:switch" }]);
    rows.push([{ text: "🗑️ Forget a wallet", callback_data: "wallet:forgetmenu" }]);
    const label = store.autoForget ? "on ✅" : "off";
    rows.push([{ text: `♻️ Auto-forget after mint: ${label}`, callback_data: "wallet:toggleautoforget" }]);
  }
  rows.push([{ text: "⬅️ Back to menu", callback_data: "menu" }]);
  return rows;
}

/** Text summary of the wallet state (which wallets exist, which is active). */
export function walletMenuText(store: WalletStore): string {
  const wallets = store.list();
  const active = store.getActive();
  if (wallets.length === 0) {
    return [
      "👛 <b>Wallet</b>",
      "",
      "No wallet yet. Create a fresh burner, or import one.",
      "",
      "⚠️ <b>Burner only.</b> Fund it with just what a mint needs.",
    ].join("\n");
  }
  const lines = ["👛 <b>Wallet</b>", ""];
  for (const w of wallets) {
    const star = active?.label === w.label ? "⭐ " : "   ";
    const kind = w.imported ? "imported" : "burner";
    lines.push(`${star}<b>${w.label}</b> (${kind})\n     <code>${w.address}</code>`);
  }
  lines.push("");
  lines.push("⭐ = active (the wallet that will mint)");
  return lines.join("\n");
}

/**
 * Handle a wallet:* button tap. Returns true if it consumed the callback.
 * chainRpcResolver lets the balance lookup pick an RPC without this module
 * needing to know about the chain layer directly.
 */
export async function handleWalletCallback(
  tg: TelegramClient,
  store: WalletStore,
  session: SessionState,
  chatId: number,
  data: string,
  balanceRpc: () => Promise<{ rpcUrl: string; currency: string } | null>
): Promise<boolean> {
  switch (data) {
    case "wallet":
    case "wallet:menu":
      await tg.sendMessage(chatId, walletMenuText(store), walletMenuButtons(store));
      return true;

    case "wallet:create": {
      const { wallet, privateKey } = store.createBurner();
      await tg.sendMessage(
        chatId,
        [
          "🆕 <b>New burner created</b> and set active.",
          "",
          `Label: <b>${wallet.label}</b>`,
          `Address:\n<code>${wallet.address}</code>`,
          "",
          "🔑 <b>Private key — SAVE THIS NOW. It will not be shown again:</b>",
          `<code>${privateKey}</code>`,
          "",
          "Store it somewhere safe and offline. Fund the address with a little gas,",
          "then you're ready to mint. ⚠️ Burner only — never keep large funds here.",
        ].join("\n"),
        [[{ text: "⬅️ Back to wallet", callback_data: "wallet" }]]
      );
      return true;
    }

    case "wallet:import":
      session.set(chatId, { kind: "awaiting_import_key" });
      await tg.sendMessage(
        chatId,
        [
          "📥 <b>Import wallet</b>",
          "",
          "Paste the private key in your next message (with or without 0x).",
          "It will be encrypted at rest.",
          "",
          "⚠️ <b>Burner only.</b> Never paste a key that holds real funds.",
          "",
          "Send /cancel to abort.",
        ].join("\n")
      );
      return true;

    case "wallet:balance": {
      const active = store.getActive();
      if (!active) {
        await tg.sendMessage(chatId, "No active wallet. Create or import one first.", walletMenuButtons(store));
        return true;
      }
      const info = await balanceRpc();
      if (!info) {
        await tg.sendMessage(chatId, "Pick a chain first (from a mint flow) so I know where to check balance.");
        return true;
      }
      try {
        const provider = new ethers.JsonRpcProvider(info.rpcUrl);
        const bal = await provider.getBalance(active.address);
        await tg.sendMessage(
          chatId,
          [
            `💰 <b>${active.label}</b>`,
            `<code>${active.address}</code>`,
            "",
            `Balance: <b>${ethers.formatEther(bal)} ${info.currency}</b>`,
          ].join("\n"),
          [[{ text: "⬅️ Back to wallet", callback_data: "wallet" }]]
        );
      } catch (err) {
        await tg.sendMessage(chatId, `Couldn't read balance: ${(err as Error).message}`);
      }
      return true;
    }

    case "wallet:switch": {
      const wallets = store.list();
      if (wallets.length === 0) {
        await tg.sendMessage(chatId, "No wallets to switch to.");
        return true;
      }
      const rows: InlineButton[][] = wallets.map((w) => [
        { text: `${store.getActive()?.label === w.label ? "⭐ " : ""}${w.label}`, callback_data: `wallet:setactive:${w.label}` },
      ]);
      rows.push([{ text: "⬅️ Back to wallet", callback_data: "wallet" }]);
      await tg.sendMessage(chatId, "Pick the wallet to make active:", rows);
      return true;
    }

    case "wallet:forgetmenu": {
      const wallets = store.list();
      if (wallets.length === 0) {
        await tg.sendMessage(chatId, "No wallets to forget.");
        return true;
      }
      const rows: InlineButton[][] = wallets.map((w) => [
        { text: `🗑️ ${w.label}`, callback_data: `wallet:forget:${w.label}` },
      ]);
      rows.push([{ text: "⬅️ Back to wallet", callback_data: "wallet" }]);
      await tg.sendMessage(
        chatId,
        "Forget which wallet? (The bot drops its copy; you keep the key yourself.)",
        rows
      );
      return true;
    }

    case "wallet:toggleautoforget":
      store.setAutoForget(!store.autoForget);
      await tg.sendMessage(chatId, walletMenuText(store), walletMenuButtons(store));
      return true;
  }

  // Parameterized actions: wallet:setactive:<label>, wallet:forget:<label>
  if (data.startsWith("wallet:setactive:")) {
    const label = data.slice("wallet:setactive:".length);
    store.setActive(label);
    await tg.sendMessage(chatId, `⭐ Active wallet is now <b>${label}</b>.`, walletMenuButtons(store));
    return true;
  }
  if (data.startsWith("wallet:forget:")) {
    const label = data.slice("wallet:forget:".length);
    const removed = store.forget(label);
    await tg.sendMessage(
      chatId,
      removed
        ? `🗑️ Forgot <b>${label}</b>. The bot no longer holds that key.`
        : `Nothing to forget for "${label}".`,
      walletMenuButtons(store)
    );
    return true;
  }

  return false;
}

/**
 * Handle a follow-up text message when the chat is mid-import.
 * Returns true if the message was consumed by a wallet flow.
 */
export async function handleWalletMessage(
  tg: TelegramClient,
  store: WalletStore,
  session: SessionState,
  chatId: number,
  text: string
): Promise<boolean> {
  const pending = session.get(chatId);
  if (!pending) return false;

  if (text.trim() === "/cancel") {
    session.clear(chatId);
    await tg.sendMessage(chatId, "Cancelled.", walletMenuButtons(store));
    return true;
  }

  if (pending.kind === "awaiting_import_key") {
    session.clear(chatId);
    try {
      const w = store.importKey(text.trim());
      await tg.sendMessage(
        chatId,
        [
          "✅ <b>Wallet imported</b> and set active.",
          `Label: <b>${w.label}</b>`,
          `Address:\n<code>${w.address}</code>`,
          "",
          "Tip: enable <b>auto-forget after mint</b> so the bot drops this key",
          "automatically once you're done.",
        ].join("\n"),
        walletMenuButtons(store)
      );
    } catch (err) {
      await tg.sendMessage(
        chatId,
        `❌ ${(err as Error).message}\n\nTap Import again to retry, or /cancel.`,
        walletMenuButtons(store)
      );
    }
    return true;
  }

  return false;
}
