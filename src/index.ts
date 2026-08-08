#!/usr/bin/env node

/**
 * nftops CLI entry point.
 *
 * Single-command interactive menu that guides users through:
 *  - Mint NFT (EVM or Solana)
 *  - Deploy EVM contracts
 *
 * No need to edit this file — just run `npm run dev` or `npm start` (after build).
 */

import { select } from "@inquirer/prompts";
import { runMintEvm } from "./flows/mintEvm";
import { runMintSolana } from "./flows/mintSolana";
import { runDeployEvm } from "./flows/deployEvm";
import { runMintSniper } from "./flows/mintSniper";
import { runManageTestDrop } from "./flows/manageTestDrop";

type MainAction = "mint" | "deploy" | "testdrop" | "exit";
type MintMode = "sniper" | "evm" | "solana";

async function main() {
  console.clear();
  console.log("╔═══════════════════════════════════════╗");
  console.log("║         NFTOps Interactive CLI        ║");
  console.log("║   Mint NFTs & Deploy Contracts        ║");
  console.log("╚═══════════════════════════════════════╝\n");

  try {
    while (true) {
      const action = await select<MainAction>({
        message: "What do you want to do?",
        choices: [
          { name: "🎨 Mint an NFT", value: "mint" },
          { name: "🚀 Deploy an EVM contract", value: "deploy" },
          { name: "🧪 Manage Test Drop (open/close test sale)", value: "testdrop" },
          { name: "🚪 Exit", value: "exit" },
        ],
      });

      if (action === "exit") {
        console.log("\n👋 Goodbye!\n");
        process.exit(0);
      }

      if (action === "mint") {
        await handleMint();
      } else if (action === "deploy") {
        await handleDeploy();
      } else if (action === "testdrop") {
        await runManageTestDrop();
      }

      // Prompt to continue or exit
      const continueChoice = await select<boolean>({
        message: "\nWhat next?",
        choices: [
          { name: "🔁 Do another operation", value: true },
          { name: "🚪 Exit", value: false },
        ],
      });

      if (!continueChoice) {
        console.log("\n👋 Goodbye!\n");
        process.exit(0);
      }

      console.log("\n" + "─".repeat(60) + "\n");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("User force closed")) {
      console.log("\n\n👋 Cancelled. Goodbye!\n");
      process.exit(0);
    }
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

/**
 * Handle the "Mint NFT" flow — ask for mode, then dispatch.
 */
async function handleMint() {
  const mode = await select<MintMode>({
    message: "Which mode?",
    choices: [
      { name: "⚡ SNIPER MODE (FCFS / competitive mints)", value: "sniper" },
      { name: "EVM (Ethereum, Polygon, Base, Arbitrum, ...)", value: "evm" },
      { name: "Solana", value: "solana" },
    ],
  });

  if (mode === "sniper") {
    await runMintSniper();
  } else if (mode === "evm") {
    await runMintEvm();
  } else {
    await runMintSolana();
  }
}

/**
 * Handle the "Deploy EVM contract" flow.
 */
async function handleDeploy() {
  await runDeployEvm();
}

// Run the CLI
main();
