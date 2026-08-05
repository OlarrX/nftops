/**
 * Shared prompt utilities.
 *
 * Wrappers around @inquirer/prompts for common patterns like
 * yes/no confirmations, chain selection, contract type menus, etc.
 */

import { confirm, input, select } from "@inquirer/prompts";
import type { ChainPreset } from "../config/chains";
import { listPresets } from "../config/chains";

/**
 * Yes/No confirmation.
 */
export async function confirmAction(message: string, defaultValue = false): Promise<boolean> {
  return confirm({ message, default: defaultValue });
}

/**
 * Present the chain presets menu and return the selected preset.
 * Grouped by mainnet/testnet for clarity.
 */
export async function selectChain(): Promise<ChainPreset> {
  const all = listPresets();
  const choices = all.map((c) => ({
    name: `${c.name} (chainId ${c.chainId})`,
    value: c.key,
    description: `${c.kind} · ${c.currency}`,
  }));

  const key = await select({
    message: "Select an EVM chain:",
    choices,
    pageSize: 12,
  });

  return all.find((c) => c.key === key)!;
}

/**
 * Ask for an RPC URL, optionally showing the preset default.
 */
export async function promptRpc(
  defaultRpc?: string,
  customMessage?: string
): Promise<string> {
  const msg = customMessage ?? "RPC URL (or press Enter to use the default):";
  const value = await input({ message: msg, default: defaultRpc });
  return value.trim();
}

/**
 * Ask for an Ethereum address (recipient, contract, etc.).
 */
export async function promptAddress(message: string, defaultValue?: string): Promise<string> {
  return input({ message, default: defaultValue }).then((v) => v.trim());
}

/**
 * Ask for a metadata URI (IPFS link, HTTP, etc.).
 */
export async function promptMetadataUri(message = "Metadata URI:"): Promise<string> {
  return input({ message }).then((v) => v.trim());
}

/**
 * Ask for a positive integer (token ID, supply, etc.).
 */
export async function promptUint(message: string, defaultValue?: string): Promise<bigint> {
  const raw = await input({ message, default: defaultValue });
  return BigInt(raw.trim());
}

/**
 * Ask for a plain text input (contract name, symbol, etc.).
 */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  return input({ message, default: defaultValue }).then((v) => v.trim());
}
