# 🚀 NFTOps — Quick Start Guide (Cold Start)

This is your "I just turned on my PC and want to mint an NFT" walkthrough.
Follow it top to bottom. No coding needed.

> **This guide assumes your project folder is at `C:\nftops`.**
> If you put it somewhere else, just use that path instead wherever you see `C:\nftops`.

---

## ⚡ FAST PATH — Mint an NFT (once everything is set up)

If you've already done the one-time setup below at least once, this is all you do:

1. Press the **Windows key**, type `cmd`, press **Enter**. (Command Prompt opens.)
2. Type this and press Enter:
   ```
   cd C:\nftops
   ```
3. Type this and press Enter:
   ```
   npm run dev
   ```
4. The menu appears. Use **arrow keys** ↑ ↓ and **Enter** to choose.
5. To mint: **Mint an NFT → EVM → ERC-721 → pick your network → paste contract address → recipient → metadata URI → paste private key.**
6. Done. Your result is saved in the `C:\nftops\output` folder as a JSON file.

That's the whole thing. Everything below is the one-time prep you only do once.

---

## 🧰 ONE-TIME SETUP (only needed the first time on a new PC)

### Step 1 — Check Node.js is installed
1. Press **Windows key**, type `cmd`, press **Enter**.
2. Type `node -v` and press Enter.
   - If you see a version like `v18.20.8` → you're good, skip to Step 2.
   - If it says "not recognized" → download Node.js from https://nodejs.org (get the **LTS** button), install it, then restart cmd.

### Step 2 — Go into the project and install it
In the same cmd window:
```
cd C:\nftops
npm install
npm run compile
```
- `npm install` downloads the libraries (takes 1–3 minutes, lots of scrolling text is normal).
- `npm run compile` prepares the contracts. You want to see: `Compiled 2 Solidity files successfully`.
- If it asks "Help us improve Hardhat?" just type `n` and press Enter.

You only ever run `npm install` and `npm run compile` **once** per PC. After that, `npm run dev` is all you need.

---

## 🔑 BEFORE YOU CAN MINT — you need two things

### 1. A wallet + its private key
- Install **MetaMask** (browser extension) from https://metamask.io.
- Create a wallet. **Save the Secret Recovery Phrase somewhere safe & offline.**
- To get your private key: MetaMask → three dots → **Account details → Show private key**.
- ⚠️ Use a **separate wallet for testing** — never one holding real money while learning.

### 2. Some gas (tiny amount of the network's coin)
Even test networks need a tiny fee to process transactions. Get free test coins from a faucet:
| Network            | Faucet |
|--------------------|--------|
| Base Sepolia       | https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet |
| Ethereum Sepolia   | https://sepoliafaucet.com |
| Polygon Amoy       | https://faucet.polygon.technology |
| Arbitrum Sepolia   | https://faucet.arbitrum.io |
- Copy your wallet address from MetaMask, paste it into the faucet, request funds.

---

## 🎯 FIRST FULL RUN (deploy your own collection, then mint into it)

You need a contract to mint from. If you don't have one yet, deploy one first:

### A) Deploy a contract (creates your NFT collection)
1. `npm run dev` → **Deploy an EVM contract**
2. Choose a **testnet** (e.g. Base Sepolia).
3. Press Enter to accept the default RPC.
4. Choose **MyERC721**.
5. Collection name: anything (e.g. `My First NFT`).
6. Symbol: anything short (e.g. `MFN`).
7. Owner address: **paste your own wallet address**.
8. Paste your private key (hidden as you type — that's normal).
9. Wait. You get a **contract address** back. **Copy and save it!**

### B) Mint an NFT into that collection
1. From the "What next?" menu → **Do another operation** → **Mint an NFT**.
2. **EVM → ERC-721 →** same testnet.
3. Paste the **contract address** you saved in step A.
4. Recipient: your own wallet address (or anyone's).
5. Metadata URI: a link to your NFT's JSON (for a quick test you can paste any link;
   for a real NFT with an image, see "Metadata" below).
6. Paste your private key.
7. Done! Check the `output` folder or click the explorer link it prints.

---

## ⏱️ FCFS TIP (for time-sensitive mints)

If you're racing the clock, pasting your key every time is slow. Instead:
1. In `C:\nftops`, find the file `.env.example`.
2. Make a copy of it named exactly `.env`.
3. Open `.env` in Notepad and fill in:
   ```
   EVM_PRIVATE_KEY=0xYOURKEYHERE
   ```
4. Save. Now when the CLI asks for your key, choose **"Read from env var"** — no pasting needed.

> The `.env` file is already ignored by git (see `.gitignore`), so it will **never** be uploaded to GitHub. Still, keep it private and never share it.

---

## 🖼️ Metadata (making your NFT show an image)

A "metadata URI" is a link to a small JSON file describing your NFT (name, image, etc.).
- For a quick test: any link works, the mint still succeeds.
- For a real NFT with an image: upload your image + a JSON file to IPFS (e.g. via https://nft.storage or https://pinata.cloud), then use that `ipfs://...` link as your metadata URI.

Ask and I'll walk you through the IPFS part step by step.

---

## 🆘 Common issues
| Problem | Fix |
|--------|-----|
| `cd: no such file` | You're in the wrong place. Run `cd C:\nftops` first. |
| `package.json not found` | Same — you must be inside `C:\nftops`. |
| `Compilation failed` | Run `npm run compile` again; check your internet. |
| `insufficient funds` | Your wallet has no gas. Use a faucet (see above). |
| Menu doesn't appear | Run `npm run dev` while inside `C:\nftops`. |
```
```
