/**
 * Per-chat conversation state.
 *
 * Two kinds of state live here, keyed by chat id:
 *
 * 1. A "pending action" — some taps need a follow-up message. Example: you tap
 *    "Import wallet", and the bot must treat your NEXT text message as the
 *    private key. We record that pending step and clear it once handled.
 *
 * 2. A "target" — the contract you're currently working on: which chain it's on,
 *    its address, what recon found (supply/price/sale state/allowlist), and any
 *    allowlist proof you've pasted. The recon stage fills this in; the snipe
 *    stage (built next) reads it so you don't re-enter everything.
 *
 * Both are IN-MEMORY only (Maps). If the bot restarts, they're forgotten —
 * the safe default: no half-finished sensitive flow survives a restart, and no
 * target/proof is written to disk.
 */

/** A chain the bot is pointed at, resolved from a preset (+ native decimals). */
export interface ChainRef {
  key: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  currency: string;
  /** Decimals of the native/gas token: 18 for ETH-style, 6 for Arc's USDC. */
  nativeDecimals: number;
}

/** What we could read about a contract. Every field is best-effort/optional. */
export interface ReconResult {
  address: string;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  maxSupply?: string;
  /** Mint price as a raw integer string (wei-equivalent in native decimals). */
  priceRaw?: string;
  /** Human price, already formatted with the chain's currency, e.g. "0.08 ETH". */
  priceLabel?: string;
  /** True if a sale looked open (from whatever flag we could read). */
  saleActive?: boolean;
  paused?: boolean;
  /** True if the contract stores a non-zero allowlist merkle root. */
  hasAllowlist: boolean;
  merkleRoot?: string;
  maxPerWallet?: string;
  /** Candidate mint function signatures we detected or offer to pick from. */
  mintFunctions: string[];
  /** Any extra named readings we want to show but don't model explicitly. */
  extra: Record<string, string>;
}

/** The contract currently being worked on in this chat. */
export interface Target {
  chain: ChainRef;
  address?: string;
  recon?: ReconResult;
  /** Allowlist proof (array of 0x… hashes) the user pasted, if any. */
  allowlistProof?: string[];
  /** Snipe/fire settings for this contract, built in the snipe flow. */
  snipe?: SnipeConfig;
}

/** How gas is priced when firing. */
export type GasMode =
  | { kind: "auto"; aggression: "safe" | "competitive" | "max" }
  | { kind: "manual"; maxFeeGwei: number; priorityFeeGwei: number };

/** Everything needed to build + fire a mint. Filled step-by-step in snipe flow. */
export interface SnipeConfig {
  /** Chosen mint function signature, e.g. "mint(uint256)". */
  functionSig?: string;
  /** How many to mint. */
  quantity: number;
  /** Gas pricing. */
  gas: GasMode;
  /**
   * Hard ceiling on total native spend (price × qty), as a raw integer string in
   * the chain's native decimals. Undefined = no explicit ceiling set yet.
   * This is the "dev can't rug the price on me" guard — we refuse to send if the
   * required value exceeds it.
   */
  maxSpendRaw?: string;
  /** true = fire without a manual confirm tap (bot holds the key and sends). */
  autoFire: boolean;
  /** true = simulate-then-fire (safe default); false = fire raw (fastest). */
  simulate: boolean;
}

/** A sane default snipe config (auto-competitive gas, safe toggles). */
export function defaultSnipeConfig(): SnipeConfig {
  return {
    quantity: 1,
    gas: { kind: "auto", aggression: "competitive" },
    autoFire: false, // confirm-first by default; user opts into auto-fire
    simulate: true, // simulate-then-fire by default
  };
}

export type PendingAction =
  | { kind: "awaiting_import_key" }
  | { kind: "awaiting_wallet_label"; privateKey: string }
  | { kind: "awaiting_contract_address" }
  | { kind: "awaiting_allowlist_proof" }
  | { kind: "awaiting_mint_function" }
  | { kind: "awaiting_quantity" }
  | { kind: "awaiting_manual_gas" }
  | { kind: "awaiting_max_spend" }
  | { kind: "awaiting_watch_time" };

export class SessionState {
  private pending = new Map<number, PendingAction>();
  private targets = new Map<number, Target>();

  // --- pending actions ---
  get(chatId: number): PendingAction | undefined {
    return this.pending.get(chatId);
  }

  set(chatId: number, action: PendingAction): void {
    this.pending.set(chatId, action);
  }

  clear(chatId: number): void {
    this.pending.delete(chatId);
  }

  // --- target contract ---
  getTarget(chatId: number): Target | undefined {
    return this.targets.get(chatId);
  }

  setTarget(chatId: number, target: Target): void {
    this.targets.set(chatId, target);
  }

  clearTarget(chatId: number): void {
    this.targets.delete(chatId);
  }
}
