/**
 * At-rest encryption for stored wallet keys.
 *
 * Wallet private keys are NEVER written to disk in plaintext. They are encrypted
 * with AES-256-GCM using a key derived (scrypt) from a secret that lives only in
 * your .env (WALLET_ENCRYPTION_PASSWORD, or the bot token as a fallback).
 *
 * What this protects against: if the wallet store file (.bot/wallets.json) is
 * ever copied, backed up, or leaked ON ITS OWN, it is useless without the secret
 * from your .env. It is NOT a substitute for the burner-wallet rule — someone
 * with BOTH your .env and the store can still decrypt. Defense in depth, not magic.
 *
 * Uses Node's built-in `crypto` — no third-party dependency.
 */

import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "crypto";

export interface EncryptedBlob {
  salt: string; // hex — per-secret KDF salt
  iv: string; // hex — AES-GCM nonce
  tag: string; // hex — GCM authentication tag
  data: string; // hex — ciphertext
}

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // standard GCM nonce length
const SALT_LEN = 16;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

/** Encrypt a plaintext secret (e.g. a private key) with a password. */
export function encryptSecret(plaintext: string, password: string): EncryptedBlob {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: enc.toString("hex"),
  };
}

/**
 * Decrypt a blob produced by encryptSecret. Throws if the password is wrong or
 * the data was tampered with (GCM auth tag fails) — a useful integrity guarantee.
 */
export function decryptSecret(blob: EncryptedBlob, password: string): string {
  const salt = Buffer.from(blob.salt, "hex");
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(Buffer.from(blob.data, "hex")), decipher.final()]);
  return dec.toString("utf8");
}
