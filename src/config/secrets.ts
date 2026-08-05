/**
 * Secrets handling.
 *
 * Rules enforced here:
 *  - Private keys are NEVER written to any file by the CLI.
 *  - The user can RAW-PASTE a key at the prompt (masked input), OR
 *  - reuse a key from an environment variable (.env supported via dotenv).
 *
 * We only keep keys in memory for the duration of a single command.
 */

import { password, select } from "@inquirer/prompts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import "dotenv/config";

export type SecretSource = "paste" | "env";

/**
 * Resolve an EVM private key (hex) either from raw paste or an env var.
 * Returns a 0x-prefixed hex string suitable for `new ethers.Wallet(key)`.
 */
export async function resolveEvmPrivateKey(): Promise<string> {
  const source = await select<SecretSource>({
    message: "How do you want to provide your EVM private key?",
    choices: [
      { name: "Paste it now (hidden input)", value: "paste" },
      { name: "Read from EVM_PRIVATE_KEY env var / .env", value: "env" },
    ],
  });

  let raw: string;
  if (source === "env") {
    raw = (process.env.EVM_PRIVATE_KEY ?? "").trim();
    if (!raw) throw new Error("EVM_PRIVATE_KEY is not set. Add it to .env or choose paste.");
  } else {
    raw = (
      await password({
        message: "Paste your EVM private key (input hidden):",
        mask: "*",
      })
    ).trim();
  }

  return normalizeEvmKey(raw);
}

/** Accepts a hex key with or without 0x, validates length, returns 0x-prefixed. */
export function normalizeEvmKey(raw: string): string {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("EVM private key must be 32 bytes of hex (64 hex chars).");
  }
  return "0x" + hex;
}

/**
 * Resolve a Solana keypair from raw paste or env var.
 * Accepts either a base58 secret key OR a JSON array of bytes (Solana CLI format).
 */
export async function resolveSolanaKeypair(): Promise<Keypair> {
  const source = await select<SecretSource>({
    message: "How do you want to provide your Solana private key?",
    choices: [
      { name: "Paste it now (hidden input)", value: "paste" },
      { name: "Read from SOLANA_PRIVATE_KEY env var / .env", value: "env" },
    ],
  });

  let raw: string;
  if (source === "env") {
    raw = (process.env.SOLANA_PRIVATE_KEY ?? "").trim();
    if (!raw) throw new Error("SOLANA_PRIVATE_KEY is not set. Add it to .env or choose paste.");
  } else {
    raw = (
      await password({
        message: "Paste your Solana private key (base58 or JSON array; input hidden):",
        mask: "*",
      })
    ).trim();
  }

  return parseSolanaKey(raw);
}

/** Parse a Solana secret key from base58 or JSON-array form into a Keypair. */
export function parseSolanaKey(raw: string): Keypair {
  if (raw.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    return Keypair.fromSecretKey(bytes);
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}
