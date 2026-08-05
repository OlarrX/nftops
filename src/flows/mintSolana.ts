/**
 * mintSolana.ts
 *
 * Flow: Mint a simple NFT on Solana.
 *
 * Strategy (kept intentionally simple for non-dev users):
 *  - Use Metaplex Umi + mpl-token-metadata's `createNft` helper.
 *  - This creates the mint, token account, and metadata in a single call.
 *  - The user only supplies: cluster (devnet/mainnet), RPC, private key,
 *    recipient, a name, and a metadata URI (a link to an off-chain JSON file).
 *
 * We do NOT build a full Metaplex Candy Machine / collection platform here —
 * just a one-shot single NFT mint, which is the easiest path that actually works.
 */

import { select } from "@inquirer/prompts";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createNft,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  generateSigner,
  percentAmount,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { promptRpc, promptAddress, promptMetadataUri, promptText } from "../utils/prompts";
import { resolveSolanaKeypair } from "../config/secrets";
import { SOLANA_CLUSTERS, type SolanaClusterKey } from "../config/chains";
import {
  generateFilename,
  logError,
  logSuccess,
  writeOutput,
  type OutputRecord,
} from "../utils/output";

export async function runMintSolana(): Promise<void> {
  console.log("\n🎨 Mint NFT on Solana\n");

  try {
    // 1. Select cluster
    const clusterKey = await select<SolanaClusterKey>({
      message: "Which Solana cluster?",
      choices: [
        { name: "Devnet (free test SOL, recommended for first try)", value: "solana-devnet" },
        { name: "Mainnet-Beta (real SOL)", value: "solana-mainnet" },
      ],
    });
    const cluster = SOLANA_CLUSTERS[clusterKey];

    // 2. RPC
    const rpc = await promptRpc(cluster.rpcUrl, "RPC URL (or press Enter for default):");

    // 3. Private key (payer)
    const payerKeypair = await resolveSolanaKeypair();

    // 4. Recipient (defaults to payer if left blank)
    const recipient = await promptAddress(
      "Recipient address (press Enter to send to yourself):",
      payerKeypair.publicKey.toBase58()
    );

    // 5. Metadata
    const name = await promptText("NFT name (e.g., 'My First NFT'):");
    const metadataUri = await promptMetadataUri(
      "Metadata URI (link to JSON, e.g., 'https://.../metadata.json'):"
    );

    // 6. Mint
    console.log("\n⏳ Minting NFT on Solana...");
    const result = await mintSolanaNft(rpc, payerKeypair, recipient, name, metadataUri);

    // 7. Save output
    const explorerUrl = `https://explorer.solana.com/address/${result.mintAddress}?cluster=${cluster.explorerCluster}`;
    const output: OutputRecord = {
      timestamp: new Date().toISOString(),
      flow: "mintSolana",
      chain: cluster.key,
      result: {
        mintAddress: result.mintAddress,
        signature: result.signature,
        recipient,
        name,
        metadataUri,
        explorerUrl,
      },
    };

    const filename = generateFilename("mintSolana");
    writeOutput(filename, output);

    logSuccess("NFT minted successfully on Solana!", {
      "Mint Address": result.mintAddress,
      "Signature": result.signature,
      "Explorer": explorerUrl,
    });
  } catch (error) {
    logError("Solana minting failed", error);
    throw error;
  }
}

/**
 * Mint a single NFT using Metaplex Umi + createNft.
 */
async function mintSolanaNft(
  rpc: string,
  payerKeypair: Keypair,
  recipient: string,
  name: string,
  metadataUri: string
): Promise<{ mintAddress: string; signature: string }> {
  // Setup Umi
  const umi = createUmi(rpc).use(mplTokenMetadata());

  // Convert web3.js Keypair -> Umi signer and set as identity/payer
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(payerKeypair.secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  console.log(`   Payer address: ${payerKeypair.publicKey.toBase58()}`);

  // Generate a new mint signer
  const mint = generateSigner(umi);

  // Build + send the createNft transaction
  const builder = createNft(umi, {
    mint,
    name,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0), // 0% royalty for simplicity
    tokenOwner: publicKey(recipient),
  });

  console.log(`   Sending transaction...`);
  const { signature } = await builder.sendAndConfirm(umi);

  // Convert the signature bytes to a base58 string for the explorer
  const sigString = require("bs58").default.encode(signature);

  return {
    mintAddress: mint.publicKey.toString(),
    signature: sigString,
  };
}
