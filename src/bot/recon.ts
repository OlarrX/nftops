/**
 * Contract recon for the bot.
 *
 * The feature you asked for: paste a contract, and the bot tells you what it is
 * and where the mint stands — supply/minted/max, price, whether a sale is open,
 * and (crucially) whether there's an allowlist gate.
 *
 * Two honest realities are baked into this module:
 *
 *  1. Every NFT project names its functions differently. There's no single
 *     "read the mint info" call. So we PROBE a set of common read-only functions
 *     (totalSupply, maxSupply/MAX_SUPPLY, price/mintPrice/cost, saleIsActive, …)
 *     and report whatever answers. Nothing found ≠ nothing there — it may just
 *     use an unusual name.
 *
 *  2. An allowlist on-chain is just a single merkle ROOT — a fingerprint of the
 *     eligible list, not the list itself. The chain cannot tell you "wallet X is
 *     eligible". The project's site/API knows that, off-chain. To actually mint
 *     an allowlist (GTD/FCFS) spot, the bot needs the PROOF (a few hashes) that
 *     the site hands you. We detect the gate and guide you to paste that proof.
 *
 * We also make a best-effort call to the block explorer's verified-ABI endpoint
 * to auto-list the real mint function names. If that fails (unverified contract,
 * or explorer needs a key), we degrade gracefully — you pick the function later.
 */

import { ethers } from "ethers";
import { TelegramClient, type InlineButton } from "./telegram";
import { SessionState, type ChainRef, type ReconResult } from "./session";
import { listPresets, getPreset, type ChainPreset } from "../config/chains";

/** Native token decimals for a chain. Arc's gas/native token is 6-decimal USDC. */
function nativeDecimalsFor(preset: ChainPreset): number {
  return preset.currency.toUpperCase() === "USDC" ? 6 : 18;
}

/** Resolve a preset key into the richer ChainRef the session stores. */
export function chainRefFromKey(key: string): ChainRef {
  const p = getPreset(key);
  return {
    key: p.key,
    name: p.name,
    chainId: p.chainId,
    rpcUrl: p.rpcUrl,
    explorer: p.explorer,
    currency: p.currency,
    nativeDecimals: nativeDecimalsFor(p),
  };
}

/** Buttons to pick which chain the contract is on. Two per row. */
export function chainSelectButtons(): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const presets = listPresets();
  for (let i = 0; i < presets.length; i += 2) {
    const row: InlineButton[] = [
      { text: presets[i].name, callback_data: `recon:chain:${presets[i].key}` },
    ];
    if (presets[i + 1]) {
      row.push({ text: presets[i + 1].name, callback_data: `recon:chain:${presets[i + 1].key}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "⬅️ Back to menu", callback_data: "menu" }]);
  return rows;
}

// ---------------------------------------------------------------------------
// On-chain probing
// ---------------------------------------------------------------------------
//
// Different collections name the same thing differently, so for each piece of
// info we try a list of common function names and take the first that answers.

const NAME_SIG = "name() view returns (string)";
const SYMBOL_SIG = "symbol() view returns (string)";
const TOTAL_SUPPLY_SIG = "totalSupply() view returns (uint256)";
const PAUSED_SIG = "paused() view returns (bool)";

const MAX_SUPPLY_NAMES = ["maxSupply", "MAX_SUPPLY", "collectionSize", "maxTotalSupply", "MAX_TOKENS"];
const PRICE_NAMES = ["mintPrice", "price", "cost", "publicPrice", "PRICE", "salePrice", "publicSalePrice", "MINT_PRICE"];
const SALE_BOOL_NAMES = [
  "saleIsActive", "publicSaleActive", "isPublicSaleActive", "saleActive",
  "mintActive", "publicMintActive", "isMintActive", "mintingActive", "isPublicMintEnabled",
];
const MERKLE_NAMES = ["merkleRoot", "allowlistMerkleRoot", "whitelistMerkleRoot", "presaleMerkleRoot", "root"];
const MAX_WALLET_NAMES = ["maxPerWallet", "maxMintPerWallet", "maxPerAddress", "walletLimit", "maxMintsPerWallet", "maxMintAmount"];

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Read one nullary view function. Returns undefined if it doesn't exist/reverts. */
async function readValue<T>(
  provider: ethers.Provider,
  address: string,
  fullSig: string
): Promise<T | undefined> {
  try {
    const fnName = fullSig.slice(0, fullSig.indexOf("("));
    const c = new ethers.Contract(address, [`function ${fullSig}`], provider);
    return (await c[fnName]()) as T;
  } catch {
    return undefined;
  }
}

/** Try a list of candidate names (same return type); return first that answers. */
async function firstReadable<T>(
  provider: ethers.Provider,
  address: string,
  names: string[],
  returns: string
): Promise<{ name: string; value: T } | undefined> {
  const results = await Promise.all(
    names.map(async (n) => ({ name: n, value: await readValue<T>(provider, address, `${n}() view returns (${returns})`) }))
  );
  for (const r of results) {
    if (r.value !== undefined && r.value !== null) return { name: r.name, value: r.value as T };
  }
  return undefined;
}

/**
 * Read everything we can about a contract. Never throws for a "missing" field —
 * only throws if the address is unreachable (bad RPC / not a contract at all).
 */
export async function runRecon(chain: ChainRef, address: string): Promise<ReconResult> {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);

  // Sanity: is there even bytecode here? (Catches EOAs and wrong-chain pastes.)
  const code = await provider.getCode(address);
  if (code === "0x") {
    throw new Error(
      "No contract found at that address on this chain. Double-check the address " +
        "and that you picked the right network."
    );
  }

  const extra: Record<string, string> = {};

  // Fire the independent reads together for speed.
  const [
    name,
    symbol,
    totalSupply,
    paused,
    maxSupply,
    price,
    merkle,
    maxWallet,
    abiFns,
  ] = await Promise.all([
    readValue<string>(provider, address, NAME_SIG),
    readValue<string>(provider, address, SYMBOL_SIG),
    readValue<bigint>(provider, address, TOTAL_SUPPLY_SIG),
    readValue<boolean>(provider, address, PAUSED_SIG),
    firstReadable<bigint>(provider, address, MAX_SUPPLY_NAMES, "uint256"),
    firstReadable<bigint>(provider, address, PRICE_NAMES, "uint256"),
    firstReadable<string>(provider, address, MERKLE_NAMES, "bytes32"),
    firstReadable<bigint>(provider, address, MAX_WALLET_NAMES, "uint256"),
    fetchMintFunctions(chain.explorer, address),
  ]);

  // Sale flags: collect every boolean flag we could read, note which are ON.
  const saleFlags = await Promise.all(
    SALE_BOOL_NAMES.map(async (n) => ({
      name: n,
      value: await readValue<boolean>(provider, address, `${n}() view returns (bool)`),
    }))
  );
  let saleActive: boolean | undefined = undefined;
  for (const f of saleFlags) {
    if (f.value === undefined) continue;
    extra[f.name] = f.value ? "true" : "false";
    if (f.value === true) saleActive = true;
    else if (saleActive === undefined) saleActive = false; // at least one flag exists but off
  }

  const hasAllowlist = !!merkle && merkle.value !== ZERO_BYTES32;

  const priceRaw = price ? price.value.toString() : undefined;
  const priceLabel = price
    ? `${trimNum(ethers.formatUnits(price.value, chain.nativeDecimals))} ${chain.currency}`
    : undefined;

  if (maxSupply) extra[`maxSupply(${maxSupply.name})`] = maxSupply.value.toString();
  if (price) extra[`price(${price.name})`] = priceLabel!;

  return {
    address,
    name,
    symbol,
    totalSupply: totalSupply?.toString(),
    maxSupply: maxSupply?.value.toString(),
    priceRaw,
    priceLabel,
    saleActive,
    paused,
    hasAllowlist,
    merkleRoot: merkle?.value,
    maxPerWallet: maxWallet?.value.toString(),
    mintFunctions: abiFns,
    extra,
  };
}

/** Drop trailing zeros from a decimal string ("0.080000" → "0.08", "1.0" → "1"). */
function trimNum(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

/** A cheap, repeatable read of just the "is the mint open?" signals. */
export interface SaleState {
  /** True if any sale flag reads active. undefined = no flag found. */
  saleActive?: boolean;
  /** True if the contract reports paused. */
  paused?: boolean;
  /** Current minted count, if totalSupply is readable. */
  totalSupply?: bigint;
  /** Max supply, if known — lets us also treat sold-out as "closed". */
  maxSupply?: bigint;
}

/**
 * Poll the live mint signals only — far cheaper than a full runRecon, safe to
 * call every few seconds from the watch engine. Reuses the same candidate-name
 * probing as recon so it works across differently-named contracts.
 */
export async function probeSaleState(chain: ChainRef, address: string): Promise<SaleState> {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);

  const [paused, totalSupply, maxSupply] = await Promise.all([
    readValue<boolean>(provider, address, PAUSED_SIG),
    readValue<bigint>(provider, address, TOTAL_SUPPLY_SIG),
    firstReadable<bigint>(provider, address, MAX_SUPPLY_NAMES, "uint256"),
  ]);

  const saleFlags = await Promise.all(
    SALE_BOOL_NAMES.map(async (n) => readValue<boolean>(provider, address, `${n}() view returns (bool)`))
  );
  let saleActive: boolean | undefined = undefined;
  for (const v of saleFlags) {
    if (v === undefined) continue;
    if (v === true) {
      saleActive = true;
      break;
    }
    if (saleActive === undefined) saleActive = false; // a flag exists but is off
  }

  return { saleActive, paused, totalSupply, maxSupply: maxSupply?.value };
}

/**
 * Decide, from a SaleState, whether the mint looks OPEN right now.
 * "Open" = a sale flag is on (or none exists to say otherwise), not paused, and
 * not sold out. Conservative: an explicit paused/sold-out/flag-off reads closed.
 */
export function isMintOpen(s: SaleState): boolean {
  if (s.paused === true) return false;
  if (s.maxSupply !== undefined && s.totalSupply !== undefined && s.totalSupply >= s.maxSupply) {
    return false; // sold out
  }
  if (s.saleActive === false) return false;
  // saleActive true → open; undefined → no flag to gate on, treat as open.
  return true;
}

// ---------------------------------------------------------------------------
// Explorer ABI → auto-detect mint function signatures
// ---------------------------------------------------------------------------
//
// Blockscout-family explorers (Robinhood, and many L2s) expose a verified ABI at
//   {explorer}/api?module=contract&action=getabi&address=0x...
// Etherscan-family explorers use the same shape but usually require an API key
// for that endpoint. We try it best-effort; on any failure we return [] and the
// user picks/types the mint function later. This never blocks recon.

/** Words that mark a function as a likely mint entrypoint. */
const MINT_HINTS = ["mint", "claim", "purchase", "presale", "allowlist", "whitelist", "publicsale"];
/** Words that mark a function as clearly NOT a user mint (admin/owner-only). */
const MINT_ANTI_HINTS = ["set", "owner", "admin", "withdraw", "reserve", "airdrop", "devmint", "teammint", "adminmint"];

interface AbiEntry {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: { type: string; name?: string }[];
}

async function fetchMintFunctions(explorer: string, address: string): Promise<string[]> {
  try {
    const base = explorer.replace(/\/+$/, "");
    const url = `${base}/api?module=contract&action=getabi&address=${address}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; result?: string };
    if (!body.result || body.result === "Contract source code not verified") return [];

    let abi: AbiEntry[];
    try {
      abi = JSON.parse(body.result) as AbiEntry[];
    } catch {
      return [];
    }

    const sigs: string[] = [];
    for (const item of abi) {
      if (item.type !== "function") continue;
      const mut = (item.stateMutability ?? "").toLowerCase();
      if (mut === "view" || mut === "pure") continue; // reads can't mint
      const nm = (item.name ?? "").toLowerCase();
      if (!MINT_HINTS.some((h) => nm.includes(h))) continue;
      if (MINT_ANTI_HINTS.some((h) => nm.includes(h))) continue;
      const params = (item.inputs ?? []).map((i) => i.type).join(",");
      sigs.push(`${item.name}(${params})`);
    }
    // De-dupe, keep order.
    return [...new Set(sigs)];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Human-readable summary of a recon result. */
export function reconText(chain: ChainRef, r: ReconResult): string {
  const lines: string[] = [];
  const title = r.name ? `${r.name}${r.symbol ? ` (${r.symbol})` : ""}` : "Contract";
  lines.push(`🔍 <b>${escapeHtml(title)}</b>`);
  lines.push(`<code>${r.address}</code>`);
  lines.push(`on <b>${chain.name}</b>`);
  lines.push("");

  // Supply
  if (r.totalSupply !== undefined || r.maxSupply !== undefined) {
    const minted = r.totalSupply ?? "?";
    const max = r.maxSupply ?? "?";
    lines.push(`📦 Minted: <b>${minted}</b> / ${max}`);
  }

  // Price
  if (r.priceLabel) lines.push(`💵 Price: <b>${r.priceLabel}</b>`);
  else lines.push("💵 Price: <i>not found via common names — verify on the mint page</i>");

  // Sale state
  if (r.paused === true) lines.push("⛔ Contract reports <b>paused</b>.");
  if (r.saleActive === true) lines.push("🟢 A sale flag reads <b>ACTIVE</b>.");
  else if (r.saleActive === false) lines.push("🔴 Sale flags read <b>not active yet</b>.");
  else lines.push("⚪ No standard sale flag found (may use an unusual name).");

  // Allowlist
  lines.push("");
  if (r.hasAllowlist) {
    lines.push("🔐 <b>Allowlist gate detected</b> (a merkle root is set).");
    lines.push(
      "To mint an allowlist (GTD/FCFS) spot you'll need the <b>proof</b> from the " +
        "project's mint page — the chain only stores a fingerprint, not who's eligible."
    );
  } else {
    lines.push("🔓 No allowlist root set (or it's zero) — looks like an open/public mint.");
  }

  // Mint functions
  lines.push("");
  if (r.mintFunctions.length > 0) {
    lines.push("🛠️ Detected mint function(s):");
    for (const f of r.mintFunctions) lines.push(`   • <code>${escapeHtml(f)}</code>`);
  } else {
    lines.push(
      "🛠️ Couldn't auto-detect the mint function (contract may be unverified). " +
        "You'll pick/enter it when you set up the snipe."
    );
  }

  if (r.maxPerWallet) {
    lines.push("");
    lines.push(`👛 Max per wallet: <b>${r.maxPerWallet}</b>`);
  }

  return lines.join("\n");
}

/** Buttons shown under a recon result. */
export function reconButtons(chain: ChainRef, r: ReconResult): InlineButton[][] {
  const rows: InlineButton[][] = [];
  if (r.hasAllowlist) {
    rows.push([{ text: "🔐 Add allowlist proof", callback_data: "recon:proof" }]);
  }
  rows.push([{ text: "⚡ Set up snipe", callback_data: "snipe" }]);
  rows.push([
    { text: "⏰ Countdown", callback_data: "watch:countdown" },
    { text: "📡 Watch until live", callback_data: "watch:live" },
  ]);
  rows.push([
    { text: "🌐 Open in explorer", url: `${chain.explorer.replace(/\/+$/, "")}/address/${r.address}` },
  ]);
  rows.push([
    { text: "🔁 Check another", callback_data: "recon" },
    { text: "⬅️ Menu", callback_data: "menu" },
  ]);
  return rows;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Flow handlers
// ---------------------------------------------------------------------------

/**
 * Handle a recon:* button tap. Returns true if it consumed the callback.
 */
export async function handleReconCallback(
  tg: TelegramClient,
  session: SessionState,
  chatId: number,
  data: string
): Promise<boolean> {
  if (data === "recon") {
    await tg.sendMessage(
      chatId,
      "🔍 <b>Check a contract</b>\n\nFirst, which chain is it on?",
      chainSelectButtons()
    );
    return true;
  }

  if (data.startsWith("recon:chain:")) {
    const key = data.slice("recon:chain:".length);
    let chain: ChainRef;
    try {
      chain = chainRefFromKey(key);
    } catch {
      await tg.sendMessage(chatId, "Unknown chain. Tap 🔍 again.");
      return true;
    }
    // Start (or reset) the target for this chain, then await the address.
    session.setTarget(chatId, { chain });
    session.set(chatId, { kind: "awaiting_contract_address" });
    await tg.sendMessage(
      chatId,
      [
        `Chain set to <b>${chain.name}</b>.`,
        "",
        "Now paste the <b>contract address</b> (0x…) in your next message.",
        "",
        "Send /cancel to abort.",
      ].join("\n")
    );
    return true;
  }

  if (data === "recon:proof") {
    const target = session.getTarget(chatId);
    if (!target?.recon?.hasAllowlist) {
      await tg.sendMessage(chatId, "No allowlist gate on the current contract. Check a contract first.");
      return true;
    }
    session.set(chatId, { kind: "awaiting_allowlist_proof" });
    await tg.sendMessage(
      chatId,
      [
        "🔐 <b>Paste your allowlist proof</b>",
        "",
        "This comes from the project's mint page/API — it's the list of hashes that",
        "proves your wallet is on the list. Paste it as a JSON array, e.g.:",
        '<code>["0xabc…","0xdef…"]</code>',
        "",
        "You can also paste the hashes separated by spaces or new lines.",
        "Each must be a 32-byte hex value (0x + 64 hex chars).",
        "",
        "Send /cancel to abort.",
      ].join("\n")
    );
    return true;
  }

  return false;
}

/**
 * Handle a follow-up text message for a recon flow (address or proof paste).
 * Returns true if the message was consumed.
 */
export async function handleReconMessage(
  tg: TelegramClient,
  session: SessionState,
  chatId: number,
  text: string
): Promise<boolean> {
  const pending = session.get(chatId);
  if (!pending) return false;

  if (pending.kind === "awaiting_contract_address") {
    if (text.trim() === "/cancel") {
      session.clear(chatId);
      await tg.sendMessage(chatId, "Cancelled.");
      return true;
    }
    const address = text.trim();
    if (!ethers.isAddress(address)) {
      await tg.sendMessage(chatId, "That doesn't look like a contract address (0x + 40 hex). Try again, or /cancel.");
      return true;
    }
    const target = session.getTarget(chatId);
    if (!target) {
      session.clear(chatId);
      await tg.sendMessage(chatId, "Lost the chain selection — tap 🔍 to start over.");
      return true;
    }
    session.clear(chatId);
    await tg.sendMessage(chatId, `🔍 Reading <code>${address}</code> on ${target.chain.name}…`);
    try {
      const recon = await runRecon(target.chain, address);
      target.address = address;
      target.recon = recon;
      target.allowlistProof = undefined; // fresh contract, drop any old proof
      session.setTarget(chatId, target);
      await tg.sendMessage(chatId, reconText(target.chain, recon), reconButtons(target.chain, recon));
    } catch (err) {
      await tg.sendMessage(
        chatId,
        `❌ ${(err as Error).message}\n\nTap 🔍 to try another contract.`,
        [[{ text: "🔍 Check a contract", callback_data: "recon" }], [{ text: "⬅️ Menu", callback_data: "menu" }]]
      );
    }
    return true;
  }

  if (pending.kind === "awaiting_allowlist_proof") {
    if (text.trim() === "/cancel") {
      session.clear(chatId);
      await tg.sendMessage(chatId, "Cancelled.");
      return true;
    }
    const target = session.getTarget(chatId);
    if (!target?.recon) {
      session.clear(chatId);
      await tg.sendMessage(chatId, "No contract loaded. Tap 🔍 to start over.");
      return true;
    }
    try {
      const proof = parseProof(text);
      target.allowlistProof = proof;
      session.setTarget(chatId, target);
      session.clear(chatId);
      await tg.sendMessage(
        chatId,
        `✅ Proof saved (${proof.length} hash${proof.length === 1 ? "" : "es"}). It'll be used when you snipe this contract's allowlist stage.`,
        reconButtons(target.chain, target.recon)
      );
    } catch (err) {
      await tg.sendMessage(chatId, `❌ ${(err as Error).message}\n\nPaste it again, or /cancel.`);
    }
    return true;
  }

  return false;
}

/**
 * Parse a pasted merkle proof into an array of 0x-prefixed 32-byte hashes.
 * Accepts a JSON array, or hashes separated by whitespace/commas.
 */
export function parseProof(text: string): string[] {
  const trimmed = text.trim();
  let items: string[];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("Expected a JSON array of hashes.");
    items = arr.map((x) => String(x).trim());
  } else {
    items = trimmed.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  }
  if (items.length === 0) throw new Error("No proof hashes found.");
  for (const h of items) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`"${h.slice(0, 12)}…" isn't a valid 32-byte hash (need 0x + 64 hex chars).`);
    }
  }
  return items;
}
