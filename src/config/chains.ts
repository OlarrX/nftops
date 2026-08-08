/**
 * Chain presets for EVM networks.
 *
 * Each preset carries a human name, chainId, and a DEFAULT public RPC.
 * These public RPCs work for light use but can be rate-limited. Users can
 * override any RPC at the prompt (raw paste) or via the EVM_RPC_URL env var,
 * so nothing here needs editing to get started.
 */

export type ChainKind = "mainnet" | "testnet";

export interface ChainPreset {
  key: string; // stable id used in menus, e.g. "ethereum-sepolia"
  name: string; // display name
  chainId: number;
  kind: ChainKind;
  rpcUrl: string; // default RPC (overridable)
  explorer: string; // block explorer base URL
  currency: string; // native token symbol
}

export const CHAIN_PRESETS: Record<string, ChainPreset> = {
  "ethereum-mainnet": {
    key: "ethereum-mainnet",
    name: "Ethereum Mainnet",
    chainId: 1,
    kind: "mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    currency: "ETH",
  },
  "ethereum-sepolia": {
    key: "ethereum-sepolia",
    name: "Ethereum Sepolia (testnet)",
    chainId: 11155111,
    kind: "testnet",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    currency: "ETH",
  },
  "polygon-mainnet": {
    key: "polygon-mainnet",
    name: "Polygon Mainnet",
    chainId: 137,
    kind: "mainnet",
    rpcUrl: "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    currency: "POL",
  },
  "polygon-amoy": {
    key: "polygon-amoy",
    name: "Polygon Amoy (testnet)",
    chainId: 80002,
    kind: "testnet",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    explorer: "https://amoy.polygonscan.com",
    currency: "POL",
  },
  "base-mainnet": {
    key: "base-mainnet",
    name: "Base Mainnet",
    chainId: 8453,
    kind: "mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    currency: "ETH",
  },
  "base-sepolia": {
    key: "base-sepolia",
    name: "Base Sepolia (testnet)",
    chainId: 84532,
    kind: "testnet",
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    currency: "ETH",
  },
  "arbitrum-mainnet": {
    key: "arbitrum-mainnet",
    name: "Arbitrum One",
    chainId: 42161,
    kind: "mainnet",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    currency: "ETH",
  },
  "arbitrum-sepolia": {
    key: "arbitrum-sepolia",
    name: "Arbitrum Sepolia (testnet)",
    chainId: 421614,
    kind: "testnet",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    currency: "ETH",
  },
  // Robinhood Chain — Ethereum L2 on the Arbitrum Orbit stack, ETH as gas.
  // Mainnet went live 2026-07-01. Values verified against public network listings
  // (Aug 2026); cross-check docs.robinhood.com/chain before a high-value mint.
  "robinhood-mainnet": {
    key: "robinhood-mainnet",
    name: "Robinhood Chain",
    chainId: 4663,
    kind: "mainnet",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    currency: "ETH",
  },
  "robinhood-testnet": {
    key: "robinhood-testnet",
    name: "Robinhood Testnet",
    chainId: 46630,
    // NOTE: testnet chainId (46630) is confirmed; the exact testnet RPC host
    // follows Robinhood's mainnet pattern but was not independently verified.
    // Confirm at docs.robinhood.com/chain/connecting before relying on it.
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    kind: "testnet",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    currency: "ETH",
  },
  // Arc by Circle — Layer-1 for stablecoin finance. IMPORTANT: Arc uses USDC as
  // its native gas token with 6 DECIMALS (not 18 like ETH chains). The tool's
  // auto-aggressive gas math assumes 18-decimal wei, so on Arc prefer MANUAL gas
  // and double-check the numbers. Mainnet is NOT live yet (public testnet only as
  // of Aug 2026) — only the testnet preset is shipped until Circle launches mainnet.
  "arc-testnet": {
    key: "arc-testnet",
    name: "Arc Testnet (Circle)",
    chainId: 5042002, // 0x4cef52 — verified via Chainlist / Circle docs
    kind: "testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    currency: "USDC",
  },
};

/** Menu-friendly list, testnets grouped after their mainnet. */
export function listPresets(): ChainPreset[] {
  return Object.values(CHAIN_PRESETS);
}

export function getPreset(key: string): ChainPreset {
  const p = CHAIN_PRESETS[key];
  if (!p) throw new Error(`Unknown chain preset: ${key}`);
  return p;
}

/** Solana clusters kept separate since they aren't EVM chains. */
export const SOLANA_CLUSTERS = {
  "solana-devnet": {
    key: "solana-devnet",
    name: "Solana Devnet",
    rpcUrl: "https://api.devnet.solana.com",
    explorerCluster: "devnet",
  },
  "solana-mainnet": {
    key: "solana-mainnet",
    name: "Solana Mainnet-Beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    explorerCluster: "mainnet-beta",
  },
} as const;

export type SolanaClusterKey = keyof typeof SOLANA_CLUSTERS;
