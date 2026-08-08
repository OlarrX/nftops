/**
 * Guest access store — single-use, recon-only invite codes.
 *
 * The problem this solves: you (the owner) want to let a friend use the bot's
 * "🔍 Check a contract" recon — looking up a mint's supply/price/sale state —
 * WITHOUT ever giving them access to your wallet, your snipe settings, or the
 * ability to fire a transaction. Firing always stays owner-only.
 *
 * How it works (coupon-style):
 *  - You create an invite CODE (a long random string).
 *  - You send that code to one friend.
 *  - They message the bot and send:  /redeem <code>
 *  - The FIRST person to redeem a code is bound to it. After that the code is
 *    dead — nobody else can use it (not even a second time by a different
 *    person). That's the "single-use" guarantee.
 *  - You can revoke a guest at any time.
 *
 * Redeeming grants RECON ONLY. It never unlocks wallet/snipe/fire — those gates
 * live in the router (index.ts) and are enforced regardless of what's stored here.
 *
 * Persistence: .bot/guests.json (the .bot/ folder is git-ignored). Codes gate
 * only read-only public data, so they aren't treated as high-value secrets like
 * private keys — but the file still stays out of git.
 */

import { randomBytes } from "crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/** One invite code and its lifecycle. */
export interface Invite {
  /** The secret code the friend types after /redeem. */
  code: string;
  /** ISO timestamp the owner created it. */
  createdAt: string;
  /** Optional label the owner set, e.g. "for Ade", so guests are recognizable. */
  note?: string;
  /** Telegram user id that redeemed it (undefined = still unused). */
  redeemedBy?: number;
  /** ISO timestamp of redemption. */
  redeemedAt?: string;
  /** True if the owner turned it off. Revoked codes can't be used or re-used. */
  revoked?: boolean;
}

interface GuestFile {
  invites: Invite[];
}

/** Result of a /redeem attempt. */
export type RedeemResult =
  | { ok: true; alreadyGuest: boolean }
  | { ok: false; reason: "invalid" | "used" | "revoked" };

const STORE_DIR = ".bot";
const STORE_FILE = "guests.json";

export class GuestStore {
  private readonly dir: string;
  private readonly path: string;
  private data: GuestFile;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, STORE_DIR);
    this.path = join(this.dir, STORE_FILE);
    this.data = this.load();
  }

  private load(): GuestFile {
    if (!existsSync(this.path)) return { invites: [] };
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as GuestFile;
    } catch {
      // Corrupt/empty file — start clean rather than crash the bot.
      return { invites: [] };
    }
  }

  private save(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** Create a new single-use invite code. Returns the created invite. */
  createInvite(note?: string): Invite {
    // 80 bits of randomness → not guessable. Hex keeps it copy/paste-safe.
    const code = randomBytes(10).toString("hex");
    const invite: Invite = {
      code,
      createdAt: new Date().toISOString(),
      note: note && note.trim() ? note.trim() : undefined,
    };
    this.data.invites.push(invite);
    this.save();
    return invite;
  }

  /**
   * Attempt to redeem a code for a given user id.
   * Enforces single-use: once redeemed by someone, no one else can use it.
   */
  redeem(rawCode: string, userId: number): RedeemResult {
    const code = rawCode.trim().toLowerCase();
    const invite = this.data.invites.find((i) => i.code.toLowerCase() === code);
    if (!invite) return { ok: false, reason: "invalid" };
    if (invite.revoked) return { ok: false, reason: "revoked" };
    if (invite.redeemedBy !== undefined) {
      // Already used — only the SAME user re-sending it is treated as fine
      // (idempotent). A different user is rejected: the code is spent.
      if (invite.redeemedBy === userId) return { ok: true, alreadyGuest: true };
      return { ok: false, reason: "used" };
    }
    invite.redeemedBy = userId;
    invite.redeemedAt = new Date().toISOString();
    this.save();
    return { ok: true, alreadyGuest: false };
  }

  /** True if this user id currently has active (non-revoked) guest access. */
  isGuest(userId: number): boolean {
    return this.data.invites.some((i) => i.redeemedBy === userId && !i.revoked);
  }

  /** Active guests (redeemed and not revoked). */
  listGuests(): Invite[] {
    return this.data.invites.filter((i) => i.redeemedBy !== undefined && !i.revoked);
  }

  /** Codes created but not yet redeemed (and not revoked) — still handable out. */
  listPending(): Invite[] {
    return this.data.invites.filter((i) => i.redeemedBy === undefined && !i.revoked);
  }

  /** Revoke a single invite by its code. Returns true if one was revoked. */
  revokeByCode(rawCode: string): boolean {
    const code = rawCode.trim().toLowerCase();
    const invite = this.data.invites.find(
      (i) => i.code.toLowerCase() === code && !i.revoked
    );
    if (!invite) return false;
    invite.revoked = true;
    this.save();
    return true;
  }
}
