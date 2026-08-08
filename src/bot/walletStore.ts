/**
 * Wallet store for the bot.
 *
 * Responsibilities:
 *  - Create a fresh burner wallet (random key).
 *  - Import an existing wallet from a pasted private key.
 *  - Keep a small set of wallets, each stored ENCRYPTED at rest (see crypto.ts).
 *  - Track which wallet is "active" (the one that will sign/fire).
 *  - Forget (permanently delete) a wallet from the store.
 *  - Optional auto-forget: after a mint, drop the active wallet automatically.
 *
 * Security posture:
 *  - Keys are only ever decrypted into memory when needed to sign, then dropped.
 *  - The store file lives in .bot/ which is git-ignored.
 *  - Burner-wallet-only remains the governing rule; this store adds defense in
 *    depth, not a license to load a main wallet.
 */

import { ethers } from "ethers";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeEvmKey } from "../config/secrets";
import { encryptSecret, decryptSecret, type EncryptedBlob } from "./crypto";

/** A stored wallet: address in clear (not secret), key encrypted. */
export interface StoredWallet {
  label: string; // human name, e.g. "burner-1"
  address: string; // 0x... public address (safe to store plainly)
  encryptedKey: EncryptedBlob; // AES-GCM blob of the private key
  imported: boolean; // true if pasted in, false if bot-generated
  createdAt: string; // ISO timestamp
}

interface StoreFile {
  wallets: StoredWallet[];
  activeLabel: string | null;
  autoForgetAfterMint: boolean;
}

const STORE_DIR = ".bot";
const STORE_FILE = "wallets.json";

export class WalletStore {
  private readonly dir: string;
  private readonly path: string;
  private readonly password: string;
  private data: StoreFile;

  /**
   * @param encryptionPassword secret used to encrypt keys at rest (from .env).
   * @param baseDir project root (defaults to cwd).
   */
  constructor(encryptionPassword: string, baseDir: string = process.cwd()) {
    this.dir = join(baseDir, STORE_DIR);
    this.path = join(this.dir, STORE_FILE);
    this.password = encryptionPassword;
    this.data = this.load();
  }

  private load(): StoreFile {
    if (!existsSync(this.path)) {
      return { wallets: [], activeLabel: null, autoForgetAfterMint: false };
    }
    const raw = readFileSync(this.path, "utf8");
    return JSON.parse(raw) as StoreFile;
  }

  private save(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** All wallets (addresses + labels only; keys stay encrypted). */
  list(): StoredWallet[] {
    return this.data.wallets;
  }

  /** The currently active wallet, or null if none selected. */
  getActive(): StoredWallet | null {
    if (!this.data.activeLabel) return null;
    return this.data.wallets.find((w) => w.label === this.data.activeLabel) ?? null;
  }

  /** Set the active wallet by label. */
  setActive(label: string): void {
    if (!this.data.wallets.some((w) => w.label === label)) {
      throw new Error(`No wallet labelled "${label}".`);
    }
    this.data.activeLabel = label;
    this.save();
  }

  get autoForget(): boolean {
    return this.data.autoForgetAfterMint;
  }

  setAutoForget(on: boolean): void {
    this.data.autoForgetAfterMint = on;
    this.save();
  }

  /** Generate a fresh burner wallet. Returns the new wallet AND its plaintext
   *  key ONCE so the caller can show it to the user to back up. */
  createBurner(label?: string): { wallet: StoredWallet; privateKey: string } {
    const w = ethers.Wallet.createRandom();
    const finalLabel = label ?? this.nextLabel("burner");
    const stored: StoredWallet = {
      label: finalLabel,
      address: w.address,
      encryptedKey: encryptSecret(w.privateKey, this.password),
      imported: false,
      createdAt: new Date().toISOString(),
    };
    this.data.wallets.push(stored);
    this.data.activeLabel = finalLabel; // new wallet becomes active
    this.save();
    return { wallet: stored, privateKey: w.privateKey };
  }

  /** Import a wallet from a pasted private key. Validates via normalizeEvmKey. */
  importKey(rawKey: string, label?: string): StoredWallet {
    const key = normalizeEvmKey(rawKey); // throws if malformed
    const address = new ethers.Wallet(key).address;

    // Refuse duplicates so the user doesn't silently stack the same wallet.
    if (this.data.wallets.some((w) => w.address.toLowerCase() === address.toLowerCase())) {
      throw new Error(`That wallet (${address}) is already imported.`);
    }

    const finalLabel = label ?? this.nextLabel("imported");
    const stored: StoredWallet = {
      label: finalLabel,
      address,
      encryptedKey: encryptSecret(key, this.password),
      imported: true,
      createdAt: new Date().toISOString(),
    };
    this.data.wallets.push(stored);
    this.data.activeLabel = finalLabel;
    this.save();
    return stored;
  }

  /**
   * Decrypt and return the private key of a wallet, for signing.
   * Keep the result in memory only as long as needed.
   */
  revealKey(label: string): string {
    const w = this.data.wallets.find((x) => x.label === label);
    if (!w) throw new Error(`No wallet labelled "${label}".`);
    return decryptSecret(w.encryptedKey, this.password);
  }

  /**
   * Forget (permanently delete) a wallet from the store. The bot loses its copy;
   * the user still holds the key themselves (e.g. in MetaMask). Returns true if
   * a wallet was removed.
   */
  forget(label: string): boolean {
    const before = this.data.wallets.length;
    this.data.wallets = this.data.wallets.filter((w) => w.label !== label);
    if (this.data.activeLabel === label) {
      this.data.activeLabel = this.data.wallets[0]?.label ?? null;
    }
    const removed = this.data.wallets.length < before;
    if (removed) this.save();
    return removed;
  }

  /** Forget the active wallet — used by auto-forget-after-mint. */
  forgetActive(): boolean {
    if (!this.data.activeLabel) return false;
    return this.forget(this.data.activeLabel);
  }

  /** Pick a unique label like "burner-1", "burner-2". */
  private nextLabel(prefix: string): string {
    let n = 1;
    while (this.data.wallets.some((w) => w.label === `${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }
}
