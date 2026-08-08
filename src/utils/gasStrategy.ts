/**
 * Gas Strategy
 *
 * Aggressive gas pricing for competitive FCFS mints.
 *
 * Key insight: In a hyped mint, validators order transactions by who pays the most.
 * Public gas estimators are always too conservative. This module calculates a
 * competitive bid based on:
 *  - Current base fee (from latest block)
 *  - Recent priority fees (from pending mempool or past blocks)
 *  - A user-controlled aggression multiplier
 *
 * Usage:
 *   const gas = await estimateAggressiveGas(provider, aggression);
 *   tx = await contract.mint(..., { ...gas });
 */

import { ethers } from "ethers";

export interface GasEstimate {
  maxFeePerGas: bigint; // total gas price ceiling
  maxPriorityFeePerGas: bigint; // tip to validators
}

export type AggressionLevel = "safe" | "competitive" | "max";

/**
 * Estimate aggressive gas for a competitive mint.
 *
 * @param provider Connected ethers provider
 * @param aggression How much to overbid:
 *   - "safe": 1.5x current priority fee (for light congestion)
 *   - "competitive": 3x (for moderate hype)
 *   - "max": 5x (for extreme hype, whale wars)
 * @returns Gas parameters ready for a transaction
 */
export async function estimateAggressiveGas(
  provider: ethers.Provider,
  aggression: AggressionLevel = "competitive"
): Promise<GasEstimate> {
  // Guard: this math assumes an 18-decimal native gas token (ETH-style wei).
  // Some chains use a different gas token — notably Arc by Circle, whose native
  // gas is USDC with 6 decimals. On such chains the gwei-based reasoning below
  // is off by ~1e12, so we refuse to auto-price and tell the user to go manual.
  const net = await provider.getNetwork();
  const NON_18_DECIMAL_GAS_CHAINS: Record<string, string> = {
    "5042002": "Arc (USDC gas, 6 decimals)",
  };
  const flagged = NON_18_DECIMAL_GAS_CHAINS[net.chainId.toString()];
  if (flagged) {
    throw new Error(
      `Auto-aggressive gas is not supported on ${flagged}. ` +
        `Its gas token does not use 18 decimals, so automatic gwei pricing would be wrong. ` +
        `Re-run and choose "Manual" gas, entering values that suit this chain.`
    );
  }

  // Fetch current base fee from the latest block
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock || !latestBlock.baseFeePerGas) {
    throw new Error("Cannot fetch base fee (EIP-1559 not supported or node unavailable)");
  }

  const baseFee = latestBlock.baseFeePerGas;

  // Estimate current priority fee (tip)
  // ethers' getFeeData gives a reasonable baseline, but it's conservative
  const feeData = await provider.getFeeData();
  const baselinePriorityFee = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");

  // Apply aggression multiplier
  const multipliers: Record<AggressionLevel, number> = {
    safe: 1.5,
    competitive: 3,
    max: 5,
  };
  const mult = multipliers[aggression];

  const aggressivePriorityFee = (baselinePriorityFee * BigInt(Math.floor(mult * 100))) / 100n;

  // maxFeePerGas = baseFee + priorityFee
  // Add a 20% buffer to baseFee in case it spikes in the next block
  const bufferedBaseFee = (baseFee * 120n) / 100n;
  const maxFeePerGas = bufferedBaseFee + aggressivePriorityFee;

  console.log(`[GasStrategy] Aggression: ${aggression}`);
  console.log(`   Base fee: ${ethers.formatUnits(baseFee, "gwei")} gwei`);
  console.log(
    `   Priority fee: ${ethers.formatUnits(aggressivePriorityFee, "gwei")} gwei (${mult}x)`
  );
  console.log(`   Max total: ${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);

  return {
    maxFeePerGas,
    maxPriorityFeePerGas: aggressivePriorityFee,
  };
}

/**
 * Calculate gas from a fixed gwei amount (for manual override).
 * Useful when you know the exact gas you want to pay.
 */
export function manualGas(maxFeeGwei: number, priorityFeeGwei: number): GasEstimate {
  return {
    maxFeePerGas: ethers.parseUnits(maxFeeGwei.toString(), "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits(priorityFeeGwei.toString(), "gwei"),
  };
}
