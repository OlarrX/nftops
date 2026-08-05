/**
 * mintEvm.ts
 *
 * Flow: Mint an NFT on an EVM chain.
 *
 * This module:
 *  1. Prompts the user to select ERC-721 or ERC-1155.
 *  2. Asks which chain to use (network preset).
 *  3. Asks for an RPC override (or uses the preset default).
 *  4. Asks for the deployed contract address to mint from.
 *  5. Collects mint parameters (recipient, metadata URI, supply/tokenId).
 *  6. Resolves the private key (raw paste or env).
 *  7. Executes the mint transaction using ethers.js + the contract ABI.
 *  8. Writes the result (tx hash + minted token info) to output/mintEvm_<timestamp>.json.
 */

import { ethers } from "ethers";
import { select } from "@inquirer/prompts";
import {
  selectChain,
  promptRpc,
  promptAddress,
  promptMetadataUri,
  promptUint,
} from "../utils/prompts";
import { resolveEvmPrivateKey } from "../config/secrets";
import {
  generateFilename,
  logError,
  logSuccess,
  writeOutput,
  type OutputRecord,
} from "../utils/output";

type TokenStandard = "ERC721" | "ERC1155";

export async function runMintEvm(): Promise<void> {
  console.log("\n🎨 Mint NFT on EVM\n");

  try {
    // 1. Token standard
    const standard = await select<TokenStandard>({
      message: "Which token standard?",
      choices: [
        { name: "ERC-721 (single NFT)", value: "ERC721" },
        { name: "ERC-1155 (multi-token)", value: "ERC1155" },
      ],
    });

    // 2. Select chain
    const chain = await selectChain();
    console.log(`\nSelected: ${chain.name} (chainId ${chain.chainId})`);

    // 3. RPC
    const rpc = await promptRpc(chain.rpcUrl, "RPC URL (or press Enter for default):");

    // 4. Contract address
    const contractAddress = await promptAddress(
      "Deployed contract address (the NFT contract to mint from):"
    );

    // 5. Collect mint params
    const params = await collectMintParams(standard);

    // 6. Private key
    const privateKey = await resolveEvmPrivateKey();

    // 7. Mint
    console.log("\n⏳ Minting NFT...");
    const result = await mintNft(rpc, privateKey, contractAddress, standard, params);

    // 8. Save output
    const output: OutputRecord = {
      timestamp: new Date().toISOString(),
      flow: "mintEvm",
      chain: chain.key,
      result: {
        standard,
        contractAddress,
        transactionHash: result.txHash,
        explorerUrl: `${chain.explorer}/tx/${result.txHash}`,
        ...result.details,
      },
    };

    const filename = generateFilename("mintEvm");
    writeOutput(filename, output);

    logSuccess("NFT minted successfully!", {
      "Standard": standard,
      "Contract": contractAddress,
      "Tx Hash": result.txHash,
      "Explorer": `${chain.explorer}/tx/${result.txHash}`,
    });
  } catch (error) {
    logError("Minting failed", error);
    throw error;
  }
}

interface MintParams {
  recipient: string;
  metadataUri?: string;
  tokenId?: bigint;
  amount?: bigint;
}

/**
 * Collect mint parameters based on the selected token standard.
 */
async function collectMintParams(standard: TokenStandard): Promise<MintParams> {
  console.log(`\n📝 Mint parameters for ${standard}:\n`);

  const recipient = await promptAddress("Recipient address (who receives the NFT):");

  if (standard === "ERC721") {
    // ERC-721: safeMint(address to, string memory uri)
    const metadataUri = await promptMetadataUri(
      "Metadata URI (full URI, e.g., 'ipfs://CID/1.json'):"
    );
    return { recipient, metadataUri };
  } else {
    // ERC-1155: mint(address to, uint256 id, uint256 amount)
    const tokenId = await promptUint("Token ID (e.g., 1):");
    const amount = await promptUint("Amount to mint (supply, e.g., 100):");
    return { recipient, tokenId, amount };
  }
}

/**
 * Execute the mint transaction using ethers.js.
 */
async function mintNft(
  rpc: string,
  privateKey: string,
  contractAddress: string,
  standard: TokenStandard,
  params: MintParams
): Promise<{ txHash: string; details: Record<string, unknown> }> {
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`   Minter address: ${wallet.address}`);

  // Define minimal ABIs for the mint functions
  const abi =
    standard === "ERC721"
      ? ["function safeMint(address to, string memory uri) public returns (uint256)"]
      : ["function mint(address to, uint256 id, uint256 amount) public"];

  const contract = new ethers.Contract(contractAddress, abi, wallet);

  let tx: ethers.ContractTransactionResponse;
  let details: Record<string, unknown> = {};

  if (standard === "ERC721") {
    // ERC-721 mint
    tx = await contract.safeMint(params.recipient, params.metadataUri);
    console.log(`   Mint tx sent: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);
    const receipt = await tx.wait();

    // Try to extract tokenId from logs (MyERC721 emits Transfer(address indexed from, address indexed to, uint256 indexed tokenId))
    // The third log topic is the tokenId for a Transfer from address(0)
    const transferLog = receipt?.logs?.find(
      (log) =>
        log.topics[0] === ethers.id("Transfer(address,address,uint256)") &&
        log.topics[1] === ethers.zeroPadValue("0x00", 32)
    );
    const tokenId = transferLog ? BigInt(transferLog.topics[3]) : undefined;

    details = {
      recipient: params.recipient,
      metadataUri: params.metadataUri,
      tokenId: tokenId?.toString(),
    };
  } else {
    // ERC-1155 mint
    tx = await contract.mint(params.recipient, params.tokenId, params.amount);
    console.log(`   Mint tx sent: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);
    await tx.wait();

    details = {
      recipient: params.recipient,
      tokenId: params.tokenId?.toString(),
      amount: params.amount?.toString(),
    };
  }

  return { txHash: tx.hash, details };
}
