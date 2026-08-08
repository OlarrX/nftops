/**
 * Bot configuration.
 *
 * Loads the Telegram bot token and the owner lock from the environment
 * (.env supported via dotenv, exactly like the rest of the CLI).
 *
 * Security rules mirrored from src/config/secrets.ts:
 *  - The bot token is a secret. It is only ever read from .env at runtime and
 *    is NEVER written to any file or committed to git (.env is git-ignored).
 *  - The bot MUST be locked to a single Telegram user id. A bot that can hold a
 *    wallet key and also answer strangers is a disaster; we refuse to run
 *    "open to everyone".
 */

import "dotenv/config";

export interface BotConfig {
  /** BotFather token, e.g. "1234567890:AAF...". */
  token: string;
  /** The only Telegram numeric user id allowed to talk to this bot. */
  ownerId: number;
  /** Secret used to encrypt stored wallet keys at rest. */
  encryptionPassword: string;
}

/**
 * Read and validate bot config from the environment.
 * Throws a friendly, actionable error if something is missing or malformed,
 * so a beginner sees exactly what to fix in their .env.
 */
export function loadBotConfig(): BotConfig {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const ownerRaw = (process.env.TELEGRAM_ALLOWED_USER_ID ?? "").trim();

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set.\n" +
        "  1. Message @BotFather on Telegram and run /newbot to get a token.\n" +
        '  2. Put it in your .env file:  TELEGRAM_BOT_TOKEN=1234567890:AAF...\n' +
        "  (.env is git-ignored, so it is never committed.)"
    );
  }

  // Sanity-check the shape: digits, a colon, then a run of token characters.
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN does not look like a BotFather token.\n" +
        'It should look like "1234567890:AAF..." (digits, a colon, then a long random string).\n' +
        "Copy it again from @BotFather, with no extra spaces or quotes."
    );
  }

  if (!ownerRaw) {
    throw new Error(
      "TELEGRAM_ALLOWED_USER_ID is not set.\n" +
        "This locks the bot to ONLY your Telegram account — required, because the bot\n" +
        "can hold a wallet key.\n" +
        "  1. Message @userinfobot on Telegram; it replies with your numeric id.\n" +
        "  2. Put it in your .env file:  TELEGRAM_ALLOWED_USER_ID=123456789"
    );
  }

  const ownerId = Number(ownerRaw);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error(
      `TELEGRAM_ALLOWED_USER_ID must be a positive whole number (got "${ownerRaw}").\n` +
        "Message @userinfobot on Telegram to get the correct numeric id."
    );
  }

  // Encryption password for wallet keys at rest. Prefer a dedicated secret; fall
  // back to deriving from the bot token so the bot still works out of the box.
  // Both live only in .env and are never committed.
  const encryptionPassword =
    (process.env.WALLET_ENCRYPTION_PASSWORD ?? "").trim() || `nftops:${token}`;

  return { token, ownerId, encryptionPassword };
}
