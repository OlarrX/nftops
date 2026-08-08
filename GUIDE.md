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

---

## ⚡ SNIPER MODE — Competitive FCFS Minting

When milliseconds matter and you're racing others to mint, use **Sniper Mode**. This is not the regular mint flow — this pre-builds your transaction, tests your RPCs, applies aggressive gas, and fires instantly on command or at a scheduled time.

### Why Sniper Mode?

In a hyped FCFS (first-come-first-serve) mint, the regular CLI is too slow. Every second you spend answering prompts is a second someone else's bot gets ahead. Sniper mode moves ALL setup to before the mint opens. When the clock hits zero, your transaction is already built — you just broadcast it.

### What makes you win (in order of importance)

1. **Gas**: Pay more than everyone else. Validators order transactions by tip. Underpay = lose, always.
2. **Latency**: Fast RPC close to validators. Public RPCs are slow. Premium/private RPCs (Alchemy, QuickNode) win.
3. **Preparation**: Everything done before mint opens. Zero setup at go-time.

### How to use Sniper Mode

**Step 1 — Start the CLI in sniper mode**

```cmd
cd C:\nftops
npm run dev
```

When the menu appears, choose **"Mint an NFT"** → **"⚡ SNIPER MODE (FCFS / competitive mints)"**. It's the first option in the mode list.

**Step 2 — The CLI asks you everything UP FRONT**

- **Chain**: Pick your network (Ethereum, Polygon, Base, Arbitrum, Robinhood Chain, Arc testnet)
- **Extra RPCs**: Add backup RPC endpoints (Alchemy, QuickNode, Infura). The tool pings them all and picks the fastest.
- **Contract address**: The NFT contract you're minting from
- **Mint function**: The exact function name, e.g. `mint(uint256)` or `publicMint(address,uint256)`. Check the contract on the block explorer.
- **Arguments**: Values for that function (quantity, recipient, etc.)
- **Gas strategy**:
  - **Auto-aggressive** (recommended): tool calculates 3x or 5x current gas automatically
  - **Manual**: you specify exact gwei (use this if you know the mint's gas meta)
- **Private key**: Paste or read from `.env`
- **Trigger**: "Send NOW" or "Wait for target time"

If you choose "Wait for target time," give it an ISO timestamp like `2026-08-06T15:00:00` and the tool sits there armed, then fires at that exact second.

**Step 3 — The tool pre-builds everything**

RPC health checks run. Transaction is built with nonce, gas limit, aggressive gas price. Everything is ready. Zero network calls remain except the final broadcast.

**Step 4 — FIRE**

Either it sends immediately (if you chose NOW), or it waits until your target time and auto-fires. Done. Your result is saved to `output/mintSniper_....json`.

### Advanced: Multiple RPCs for failover

The tool lets you add multiple RPC endpoints. It pings them all, measures latency, and routes to the fastest healthy one. If your primary RPC goes down mid-mint, the next one is already tested and ready.

**Getting premium RPCs** (this is what serious minters use):
- **Alchemy**: alchemy.com (free tier: 300M compute units/month)
- **QuickNode**: quicknode.com (free tier exists)
- **Infura**: infura.io
- **Chainstack**, **Ankr**, **LlamaNodes** — all have free tiers

Sign up, grab your RPC URL (looks like `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`), and paste it when the tool asks for extra RPCs.

### Gas strategy guide

| Scenario | Recommended setting |
|----------|---------------------|
| Light hype, not many bots | **Safe** (1.5x current) |
| Moderate hype, some competition | **Competitive** (3x, default) |
| Extreme hype, whale wars, everyone has bots | **Max** (5x) |
| You have inside info on exact gas needed | **Manual** (specify gwei) |

**Real talk**: If you're sniping a project everyone wants and you use "Safe," you will lose. In a hot mint, dozens of bots pay 5-10x gas. The tool's "Max" setting gets you into that range. If gas spikes and you still lose, you can manually set an even higher number next time (check what the winning txs paid on the explorer).

### Scheduled snipes (target time)

If a mint opens at a known time (e.g., "Aug 6, 3pm UTC"), convert that to your local time in ISO format: `2026-08-06T15:00:00`. Give it to the tool. It pre-builds everything, then sits armed and fires the instant that second arrives.

**Protip**: Set your target time 1-2 seconds BEFORE the announced time if you're confident the contract will accept early txs. Many contracts don't enforce the exact second, and the first tx in the first viable block wins.

### What the tool does NOT do (and why)

This is a **single-shot sniper**, not a sustained bot. It fires one transaction, fast and aggressive. It does NOT:
- Retry if your tx fails (you'd need to re-run it manually)
- Monitor the mempool and dynamically reprice (that's advanced bot territory)
- Run on a cloud server 24/7 (it runs on your PC when you call it)

For 90% of FCFS mints, a well-configured single shot is enough. For the top 1% of hype (where every millisecond and every $100 of gas matters), people run bots on dedicated servers in validator data centers. That's outside the scope of this tool.

---

## 🆕 Robinhood Chain & Arc — read before you use them

I added presets for two newer chains you mentioned. Here's the honest status of each so you don't get surprised:

**Robinhood Chain** (mainnet, chainId `4663`) — this is live (mainnet launched July 2026). It's an Ethereum Layer-2 and uses **ETH** for gas, so it behaves like Base or Arbitrum and the tool's auto-gas works normally. The testnet preset (chainId `46630`) is included too, but I could not independently confirm the exact testnet RPC address, so if the testnet ever refuses to connect, grab the current RPC from the official docs and paste it as a custom RPC at the prompt.

**Arc by Circle** (testnet, chainId `5042002`) — **testnet only**; Arc's mainnet had not launched as of when this was written, so there's no mainnet preset on purpose. Arc is unusual: its gas token is **USDC with 6 decimals**, not 18-decimal ETH. Because of that, the tool will **refuse "Auto-aggressive" gas on Arc** and ask you to use **Manual** gas instead — this is deliberate, to stop it from mis-pricing your bid by a huge factor. On Arc, choose Manual and enter sensible values.

For any high-value mint on either chain, double-check the live RPC URL and chainId against the official docs first. Network details do change.

---

## 🔧 Under the hood (for the curious)

Sniper mode is already wired into the main menu — you don't need to edit any code to use it. It lives in `src/flows/mintSniper.ts`, the RPC failover logic is in `src/utils/rpcPool.ts`, and the gas math is in `src/utils/gasStrategy.ts`. If you ever want to change default behavior (like the aggression multipliers), those are the files to look at — but for normal use, just run `npm run dev` and pick Sniper Mode.

---
