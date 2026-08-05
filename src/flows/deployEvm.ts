/**
 * deployEvm.ts
 *
 * Flow: Deploy an EVM contract.
 *
 * This module:
 *  1. Prompts the user to select a chain preset (network).
 *  2. Asks for an RPC override (or uses the preset default).
 *  3. Asks which compiled contract to deploy (MyERC721 or MyERC1155).
 *  4. Collects constructor arguments interactively.
 *  5. Resolves the private key (raw paste or env).
 *  6. Deploys the contract using ethers.js + the compiled artifacts.
 *  7. Writes the result (contract address + tx hash) to output/deployEvm_<timestamp>.json.
 */

import { ethers } from "ethers";
import { select } from "@inquirer/prompts";
import { selectChain, promptRpc, promptText } from "../utils/prompts";
import { resolveEvmPrivateKey } from "../config/secrets";
import {
  generateFilename,
  logError,
  logSuccess,
  writeOutput,
  type OutputRecord,
} from "../utils/output";
import * as fs from "fs";
import * as path from "path";

type ContractChoice = "MyERC721" | "MyERC1155";

export async function runDeployEvm(): Promise<void> {
  console.log("\n🚀 Deploy EVM Contract\n");

  try {
    // 1. Select chain
    const chain = await selectChain();
    console.log(`\nSelected: ${chain.name} (chainId ${chain.chainId})`);

    // 2. RPC
    const rpc = await promptRpc(chain.rpcUrl, "RPC URL (or press Enter for default):");

    // 3. Contract choice
    const contractName = await select<ContractChoice>({
      message: "Which contract do you want to deploy?",
      choices: [
        { name: "MyERC721 (ERC-721 NFT)", value: "MyERC721" },
        { name: "MyERC1155 (ERC-1155 multi-token)", value: "MyERC1155" },
      ],
    });

    // 4. Constructor args
    const args = await collectConstructorArgs(contractName);

    // 5. Private key
    const privateKey = await resolveEvmPrivateKey();

    // 6. Deploy
    console.log("\n⏳ Deploying contract...");
    const result = await deployContract(rpc, privateKey, contractName, args);

    // 7. Save output
    const output: OutputRecord = {
      timestamp: new Date().toISOString(),
      flow: "deployEvm",
      chain: chain.key,
      result: {
        contractName,
        contractAddress: result.address,
        transactionHash: result.txHash,
        explorerUrl: `${chain.explorer}/address/${result.address}`,
        constructorArgs: args,
      },
    };

    const filename = generateFilename("deployEvm");
    writeOutput(filename, output);

    logSuccess("Contract deployed successfully!", {
      "Contract": contractName,
      "Address": result.address,
      "Tx Hash": result.txHash,
      "Explorer": `${chain.explorer}/tx/${result.txHash}`,
    });
  } catch (error) {
    logError("Deployment failed", error);
    throw error;
  }
}

/**
 * Collect constructor arguments based on the selected contract template.
 */
async function collectConstructorArgs(contractName: ContractChoice): Promise<string[]> {
  console.log(`\n📝 Constructor arguments for ${contractName}:\n`);

  if (contractName === "MyERC721") {
    // MyERC721(string name, string symbol, address initialOwner)
    const name = await promptText("Collection name (e.g., 'My NFT'):");
    const symbol = await promptText("Collection symbol (e.g., 'MNFT'):");
    const owner = await promptText("Initial owner address (will have minting rights):");
    return [name, symbol, owner];
  } else {
    // MyERC1155(string baseUri, address initialOwner)
    const baseUri = await promptText(
      "Base metadata URI (with {id} placeholder, e.g., 'ipfs://CID/{id}.json'):"
    );
    const owner = await promptText("Initial owner address (will have minting rights):");
    return [baseUri, owner];
  }
}

/**
 * Deploy a compiled contract using ethers ContractFactory.
 */
async function deployContract(
  rpc: string,
  privateKey: string,
  contractName: ContractChoice,
  args: string[]
): Promise<{ address: string; txHash: string }> {
  // Load compiled artifacts
  const artifactPath = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Contract artifact not found: ${artifactPath}\nRun "npm run compile" first.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));

  // Setup provider + wallet
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`   Deployer address: ${wallet.address}`);

  // Create factory and deploy
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);

  console.log(`   Deployment tx sent: ${contract.deploymentTransaction()?.hash}`);
  console.log(`   Waiting for confirmation...`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash ?? "";

  return { address, txHash };
}
