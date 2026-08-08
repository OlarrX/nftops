/**
 * mintSniper.ts
 *
 * Sniper mode for competitive FCFS mints.
 *
 * Strategy:
 *  - Pre-build the entire mint transaction with all parameters
 *  - Health-check RPCs and pick the fastest
 *  - Apply aggressive gas pricing
 *  - Optionally wait for a target timestamp, then fire instantly
 *
 * This removes ALL interactive prompts from the hot path. When the clock hits zero,
 * the only network action is broadcasting the signed transaction.
 */

import { ethers } from "ethers";
import { select, input, confirm } from "@inquirer/prompts";
import { selectChain, promptAddress, promptText, promptUint } from "../utils/prompts";
import { resolveEvmPrivateKey } from "../config/secrets";
import { createRpcPoolForChain } from "../utils/rpcPool";
import {
  estimateAggressiveGas,
  manualGas,
  type AggressionLevel,
  type GasEstimate,
} from "../utils/gasStrategy";
import {
  generateFilename,
  logError,
  logSuccess,
  writeOutput,
  type OutputRecord,
} from "../utils/output";

export async function runMintSniper(): Promise<void> {
  console.log("\n⚡ SNIPER MODE — FCFS Mint\n");
  console.log("This mode pre-builds your transaction for instant execution.");
  console.log("Use it when milliseconds matter.\n");

  try {
    // 1. Select chain
    const chain = await selectChain();
    console.log(`\nChain: ${chain.name} (chainId ${chain.chainId})`);

    // 2. RPC pool setup
    const additionalRpcs = await promptAdditionalRpcs();
    const rpcPool = createRpcPoolForChain(chain.key, chain.rpcUrl, additionalRpcs);

    console.log("\n🔍 Testing RPC endpoints...");
    await rpcPool.refreshAll();
    const fastestRpc = await rpcPool.getFastestHealthyRpc();

    // 3. Contract details
    const contractAddress = await promptAddress("Target contract address:");
    const mintFunctionSig = await promptText(
      "Mint function signature (e.g., 'mint(uint256)' or 'publicMint(address,uint256)'):",
      "mint(uint256)"
    );

    // 4. Mint arguments
    console.log("\n📝 Mint arguments (in order):");
    const args = await collectMintArgs(mintFunctionSig);

    // 5. Gas strategy
    const gasStrategy = await selectGasStrategy();
    const gasParams = await resolveGas(fastestRpc, gasStrategy);

    // 6. Private key
    const privateKey = await resolveEvmPrivateKey();
    const provider = new ethers.JsonRpcProvider(fastestRpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`\n💼 Wallet: ${wallet.address}`);

    // 7. Build transaction
    console.log("\n🔧 Pre-building transaction...");
    const tx = await buildMintTransaction(
      provider,
      wallet,
      contractAddress,
      mintFunctionSig,
      args,
      gasParams
    );

    console.log(`   Nonce: ${tx.nonce}`);
    console.log(`   Gas limit: ${tx.gasLimit?.toString()}`);
    console.log(`   Max fee: ${ethers.formatUnits(gasParams.maxFeePerGas, "gwei")} gwei`);

    // 8. Trigger mode
    const triggerMode = await select<"now" | "scheduled">({
      message: "When do you want to send this transaction?",
      choices: [
        { name: "⚡ Send NOW (instant)", value: "now" },
        { name: "⏰ Wait for a target time (scheduled snipe)", value: "scheduled" },
      ],
    });

    let targetTime: Date | null = null;
    if (triggerMode === "scheduled") {
      const targetInput = await input({
        message: "Target time (ISO format, e.g., '2026-08-06T15:00:00'):",
      });
      targetTime = new Date(targetInput);
      if (isNaN(targetTime.getTime())) {
        throw new Error("Invalid date format");
      }
      const msUntil = targetTime.getTime() - Date.now();
      if (msUntil < 0) {
        throw new Error("Target time is in the past");
      }
      console.log(`\n⏳ Waiting until ${targetTime.toISOString()} (${Math.round(msUntil / 1000)}s)...`);
      await sleep(msUntil);
    }

    // 9. FIRE
    console.log("\n🚀 SENDING TRANSACTION...");
    const sentTx = await wallet.sendTransaction(tx);
    console.log(`   Tx hash: ${sentTx.hash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await sentTx.wait();
    const status = receipt?.status === 1 ? "✅ SUCCESS" : "❌ FAILED";
    console.log(`   ${status}`);

    // 10. Save output
    const output: OutputRecord = {
      timestamp: new Date().toISOString(),
      flow: "mintEvm",
      chain: chain.key,
      result: {
        mode: "sniper",
        contractAddress,
        transactionHash: sentTx.hash,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed?.toString(),
        status: receipt?.status === 1 ? "success" : "failed",
        explorerUrl: `${chain.explorer}/tx/${sentTx.hash}`,
      },
    };

    const filename = generateFilename("mintSniper");
    writeOutput(filename, output);

    logSuccess("Sniper mint completed!", {
      "Status": status,
      "Tx Hash": sentTx.hash,
      "Gas Used": receipt?.gasUsed?.toString() ?? "unknown",
      "Explorer": `${chain.explorer}/tx/${sentTx.hash}`,
    });
  } catch (error) {
    logError("Sniper mint failed", error);
    throw error;
  }
}

/**
 * Prompt for additional RPC URLs to add to the pool.
 */
async function promptAdditionalRpcs(): Promise<string[]> {
  const wantsMore = await confirm({
    message: "Add extra RPC endpoints for failover?",
    default: false,
  });

  if (!wantsMore) return [];

  const rpcs: string[] = [];
  while (true) {
    const rpc = await input({
      message: `RPC URL #${rpcs.length + 1} (or press Enter to finish):`,
    });
    if (!rpc.trim()) break;
    rpcs.push(rpc.trim());
  }
  return rpcs;
}

/**
 * Parse function signature and collect arguments.
 * Example: "mint(uint256)" → prompts for one uint256.
 */
async function collectMintArgs(sig: string): Promise<unknown[]> {
  const match = sig.match(/\((.*)\)/);
  if (!match) {
    console.warn("Could not parse function signature, assuming no args");
    return [];
  }

  const paramStr = match[1].trim();
  if (!paramStr) return [];

  const params = paramStr.split(",").map((p) => p.trim());
  const args: unknown[] = [];

  for (let i = 0; i < params.length; i++) {
    const paramType = params[i];
    console.log(`   Arg ${i + 1}: ${paramType}`);

    if (paramType.startsWith("uint") || paramType.startsWith("int")) {
      const val = await promptUint(`Value (${paramType}):`);
      args.push(val);
    } else if (paramType === "address") {
      const val = await promptAddress(`Address (${paramType}):`);
      args.push(val);
    } else if (paramType === "string") {
      const val = await promptText(`String (${paramType}):`);
      args.push(val);
    } else {
      const val = await promptText(`Value (${paramType}):`);
      args.push(val);
    }
  }

  return args;
}

/**
 * Select gas strategy.
 */
async function selectGasStrategy(): Promise<"auto" | "manual"> {
  return select({
    message: "Gas strategy:",
    choices: [
      { name: "🤖 Auto-aggressive (recommended)", value: "auto" },
      { name: "✍️  Manual (specify exact gwei)", value: "manual" },
    ],
  });
}

/**
 * Resolve gas parameters based on strategy.
 */
async function resolveGas(rpc: string, strategy: "auto" | "manual"): Promise<GasEstimate> {
  if (strategy === "manual") {
    const maxFee = parseFloat(await input({ message: "Max fee per gas (gwei):" }));
    const priorityFee = parseFloat(await input({ message: "Priority fee (gwei):" }));
    return manualGas(maxFee, priorityFee);
  }

  // Auto mode
  const aggression = await select<AggressionLevel>({
    message: "Aggression level:",
    choices: [
      { name: "Safe (1.5x current)", value: "safe" },
      { name: "Competitive (3x, recommended)", value: "competitive" },
      { name: "Max (5x, for whale wars)", value: "max" },
    ],
  });

  const provider = new ethers.JsonRpcProvider(rpc);
  return estimateAggressiveGas(provider, aggression);
}

/**
 * Build the mint transaction with all parameters.
 */
async function buildMintTransaction(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  contractAddress: string,
  functionSig: string,
  args: unknown[],
  gas: GasEstimate
): Promise<ethers.TransactionRequest> {
  const contract = new ethers.Contract(
    contractAddress,
    [`function ${functionSig}`],
    wallet
  );

  // Get current nonce
  const nonce = await provider.getTransactionCount(wallet.address, "pending");

  // Estimate gas limit
  const functionName = functionSig.split("(")[0];
  const gasLimit = await contract[functionName].estimateGas(...args);

  // Add 20% buffer to gas limit
  const bufferedGasLimit = (gasLimit * 120n) / 100n;

  // Build the transaction
  const tx: ethers.TransactionRequest = {
    to: contractAddress,
    data: contract.interface.encodeFunctionData(functionName, args),
    nonce,
    gasLimit: bufferedGasLimit,
    maxFeePerGas: gas.maxFeePerGas,
    maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    chainId: (await provider.getNetwork()).chainId,
  };

  return tx;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
