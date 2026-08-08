/**
 * manageTestDrop.ts
 *
 * Flow: Owner controls for a deployed TestDrop contract.
 *
 * TestDrop starts with its sale OFF on purpose. The snipe bot can only call the
 * public `mint(uint256)` function — it can NOT call owner-only functions like
 * `setSaleActive`. So to actually test firing (or to test "watch until live"),
 * you need a simple way to flip the sale on/off from the wallet that owns the
 * contract. That's what this flow is for.
 *
 * It:
 *  1. Asks for the chain + RPC.
 *  2. Asks for the deployed TestDrop address.
 *  3. Reads and shows the current state (sale on/off, price, supply).
 *  4. Lets you turn the sale ON or OFF, or change the mint price.
 *
 * TESTNET helper — this drives the practice target, it is not a production tool.
 */

import { ethers } from "ethers";
import { select } from "@inquirer/prompts";
import { selectChain, promptRpc, promptAddress, promptText } from "../utils/prompts";
import { resolveEvmPrivateKey } from "../config/secrets";
import { logError, logSuccess } from "../utils/output";

// Only the pieces of TestDrop this helper touches.
const TESTDROP_ABI = [
  "function saleIsActive() view returns (bool)",
  "function mintPrice() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function setSaleActive(bool active)",
  "function setMintPrice(uint256 newPrice)",
];

type TestDropAction = "open" | "close" | "price" | "refresh" | "exit";

export async function runManageTestDrop(): Promise<void> {
  console.log("\n🧪 Manage Test Drop (owner controls)\n");

  try {
    const chain = await selectChain();
    console.log(`\nSelected: ${chain.name} (chainId ${chain.chainId})`);

    const rpc = await promptRpc(chain.rpcUrl, "RPC URL (or press Enter for default):");
    const address = await promptAddress("Deployed TestDrop contract address:");

    const privateKey = await resolveEvmPrivateKey();
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(address, TESTDROP_ABI, wallet);

    console.log(`   Owner wallet: ${wallet.address}`);

    // Show current state up front.
    await printState(contract);

    while (true) {
      const action = await select<TestDropAction>({
        message: "What do you want to do?",
        choices: [
          { name: "🟢 Open the sale (setSaleActive true)", value: "open" },
          { name: "🔴 Close the sale (setSaleActive false)", value: "close" },
          { name: "💲 Change the mint price", value: "price" },
          { name: "🔄 Refresh state", value: "refresh" },
          { name: "⬅️  Done", value: "exit" },
        ],
      });

      if (action === "exit") return;

      if (action === "refresh") {
        await printState(contract);
        continue;
      }

      if (action === "price") {
        const priceEth = await promptText("New mint price in ETH per NFT (e.g. 0 for free):");
        const priceWei = ethers.parseEther((priceEth.trim() || "0")).toString();
        console.log("\n⏳ Sending setMintPrice...");
        const tx = await contract.setMintPrice(priceWei);
        console.log(`   Tx sent: ${tx.hash}`);
        await tx.wait();
        logSuccess("Mint price updated.", {
          "New price": `${priceEth.trim() || "0"} ${chain.currency}`,
          "Tx": `${chain.explorer}/tx/${tx.hash}`,
        });
        await printState(contract);
        continue;
      }

      // open / close
      const target = action === "open";
      console.log(`\n⏳ Sending setSaleActive(${target})...`);
      const tx = await contract.setSaleActive(target);
      console.log(`   Tx sent: ${tx.hash}`);
      await tx.wait();
      logSuccess(`Sale is now ${target ? "OPEN 🟢" : "CLOSED 🔴"}.`, {
        "Tx": `${chain.explorer}/tx/${tx.hash}`,
      });
      await printState(contract);
    }
  } catch (error) {
    logError("Manage Test Drop failed", error);
    throw error;
  }
}

/** Read and print the live state of the drop. */
async function printState(contract: ethers.Contract): Promise<void> {
  const [active, price, total, max] = await Promise.all([
    contract.saleIsActive() as Promise<boolean>,
    contract.mintPrice() as Promise<bigint>,
    contract.totalSupply() as Promise<bigint>,
    contract.maxSupply() as Promise<bigint>,
  ]);

  console.log("\n── Current state ──────────────────────────");
  console.log(`   Sale:       ${active ? "OPEN 🟢" : "CLOSED 🔴"}`);
  console.log(`   Mint price: ${ethers.formatEther(price)} (per NFT)`);
  console.log(`   Minted:     ${total.toString()} / ${max.toString()}`);
  console.log("───────────────────────────────────────────\n");
}
