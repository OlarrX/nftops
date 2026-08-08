/**
 * Minimal Telegram Bot API client.
 *
 * Built on Node's built-in `fetch` (Node 18+) so the bot needs NO third-party
 * dependency. We implement only the handful of methods the bot actually uses:
 *  - getMe            (sanity check the token on startup)
 *  - getUpdates       (long-polling: how the bot receives your messages/taps)
 *  - sendMessage      (send text, optionally with inline buttons)
 *  - editMessageText  (update a message in place — used for live countdowns)
 *  - answerCallbackQuery (acknowledge a button tap so Telegram stops spinning)
 *
 * Long-polling model: we repeatedly ask Telegram "any updates since id X?" with
 * a long server-side timeout. This needs no public URL or webhook, so it runs
 * fine from a home PC behind a router.
 */

const API_ROOT = "https://api.telegram.org/bot";

/** A Telegram user. */
export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** A chat (for a private bot, chat.id === the user's id). */
export interface TgChat {
  id: number;
  type: string;
}

/** An incoming text message. */
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  date: number;
}

/** An inline-button tap. */
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

/** One update from getUpdates. */
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/**
 * A single inline keyboard button. A button is EITHER a tap-action (carries
 * callback_data, handled by the bot) OR a link (opens a url). Exactly one of the
 * two is set.
 */
export type InlineButton =
  | { text: string; callback_data: string; url?: never }
  | { text: string; url: string; callback_data?: never };

/** Envelope returned by every Bot API method. */
interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramClient {
  private readonly base: string;

  constructor(token: string) {
    this.base = `${API_ROOT}${token}/`;
  }

  /** Low-level call to a Bot API method. Throws on API-level errors. */
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
    } catch (err) {
      // Network-level failure (couldn't even reach Telegram). Node's fetch reports
      // this as a bare "fetch failed"; the real reason hides in err.cause. Surface
      // it with a beginner-friendly hint so it isn't a mystery.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.code || cause?.message || (err as Error).message;
      throw new Error(
        `Could not reach Telegram (${reason}).\n` +
          "  This is a network problem on this PC, not a bug in the bot.\n" +
          "  • Check this PC is online (open api.telegram.org in a browser).\n" +
          "  • If Telegram is blocked on your network/region, turn on a VPN and retry.\n" +
          "  • A firewall or antivirus may be blocking Node — allow it, then retry."
      );
    }

    const json = (await res.json()) as ApiResponse<T>;
    if (!json.ok) {
      throw new Error(
        `Telegram API error on ${method}: ${json.description ?? "unknown"} (code ${json.error_code ?? "?"})`
      );
    }
    return json.result as T;
  }

  /** Confirm the token works and return the bot's own identity. */
  async getMe(): Promise<TgUser> {
    return this.call<TgUser>("getMe", {});
  }

  /**
   * Long-poll for updates. `offset` should be (last update_id + 1) so each
   * update is delivered exactly once. `timeoutSec` is how long Telegram holds
   * the connection open waiting for something to happen.
   */
  async getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    });
  }

  /** Send a message, optionally with rows of inline buttons. */
  async sendMessage(
    chatId: number,
    text: string,
    buttons?: InlineButton[][]
  ): Promise<TgMessage> {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (buttons) params.reply_markup = { inline_keyboard: buttons };
    return this.call<TgMessage>("sendMessage", params);
  }

  /** Edit an existing message's text/buttons in place (for live countdowns). */
  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    buttons?: InlineButton[][]
  ): Promise<void> {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (buttons) params.reply_markup = { inline_keyboard: buttons };
    // editMessageText returns the edited Message (or true); we don't need it.
    await this.call<unknown>("editMessageText", params);
  }

  /** Acknowledge a button tap so Telegram stops showing the loading spinner. */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const params: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) params.text = text;
    await this.call<unknown>("answerCallbackQuery", params);
  }
}
