# NFTOps Mint Bot — Plain-English Guide

This is your personal NFT mint/snipe assistant that you control from Telegram, on your phone or anywhere. It runs on **your own PC** and talks only to **you**. This guide walks you through every button, step by step, with honest notes about what's safe and what isn't.

No coding needed to use it — you tap buttons in a Telegram chat. You only touch a terminal once, to start it.

---

## Read this first — the 4 rules that keep you safe

1. **Burner wallet only.** Only ever load a throwaway wallet here, funded with just enough for the mint plus gas. Never your main wallet. If anything ever goes wrong, a burner limits the damage to the little bit inside it.

2. **Always set a max-spend ceiling.** This is your "a sneaky dev can't drain me" backstop. If the mint price secretly jumps above your ceiling, the bot refuses to fire. Set it every time.

3. **The bot answers only you.** It's locked to your single Telegram account. Anyone else who messages it is silently ignored. It also only works in your private chat with the bot — never in a group.

4. **Test on a testnet first.** Before you point this at a real mint with real money, run the whole thing once on a testnet (free play-money chain). The live-fire path has never been exercised end-to-end in a real environment, so you prove it works with fake funds before you trust it with real ones. This is the single most important habit.

---

## First run — start the bot (once, from your PC)

1. **Add the secrets to your `.env`** (the file in `C:\nftops`, already git-ignored so it never gets committed):

   ```
   TELEGRAM_BOT_TOKEN=1234567890:AAF...        # from @BotFather
   TELEGRAM_ALLOWED_USER_ID=123456789           # your numeric id, from @userinfobot
   WALLET_ENCRYPTION_PASSWORD=make-up-a-long-random-phrase
   ```

   The encryption password is what scrambles your stored wallet keys on disk. If you lose it, you can't decrypt them anymore (the bot will just say the key is invalid) — but you always keep the key yourself, so it's not a disaster. Make it long and random; store it somewhere safe alongside your keys.

2. **Open a terminal** in `C:\nftops` (or any Command Prompt and `cd C:\nftops`), then:

   ```
   npm run bot
   ```

3. **You'll see it come online**, locked to your account:

   ```
   ✅ Bot online as @yourbot (id 123456789)
   🔒 Locked to owner id: 123456789
   ```

   That `🔒 Locked to owner id` line is the security gate doing its job — it refuses to answer anyone else.

4. **On Telegram, open your bot's chat** and send `/start`. You'll get the main menu:

   - 👛 Wallet
   - 🔍 Check a contract
   - ⚡ Snipe a mint

Keep this terminal window open while you want the bot alive. Close it (Ctrl+C) to stop the bot. Everything it knows — active wallet, contract, settings — lives in memory and on disk under `.bot/` (encrypted).

---

## 👛 Wallet — your burner account

This is the wallet the bot will mint from. It's stored **encrypted on your PC** (AES-256-GCM), so a copied file is useless without your `.env`.

**🆕 Create burner** — the bot makes a brand-new random address and shows you the private key **exactly once**, with a loud "save this now" warning. Write that key down somewhere safe and offline, then fund the address with a little gas for the mint. This is the cleanest option: no history, no association with anything.

**📥 Import wallet** — paste a private key (with or without `0x`). It gets encrypted before it touches disk. Use this to reuse a burner you already funded.

**💰 Show balance** — reads the active wallet's balance live from the chain. (Do this after checking a contract, so the bot knows which chain you're on.)

**🔁 Switch active** — if you have several wallets, pick which one mints. The star ⭐ marks the active one.

**🗑️ Forget a wallet** — the bot drops its encrypted copy of the key. You still keep your own copy; this just removes it from the bot.

**♻️ Auto-forget after mint** — a nice safety habit. Turn it on and the bot deletes its copy of the key **automatically, right after a successful mint**. If the bot ever gets compromised later, there's nothing to steal. Recommended on, especially if you imported a funded burner.

**Honest notes:**

- The bot can't recover a forgotten or never-saved key. That's the point. If you lose the key, the funds in that wallet are gone — so always write burners down.
- You are responsible for funding the burner. The bot only holds the key and sends transactions.
- Balance display assumes the native 18-decimal token. On Arc (USDC, 6 decimals) the number will look wrong — treat it as approximate there.

---

## 🔍 Check a contract — recon before you commit

This reads a mint contract and tells you what you're dealing with, so you're not firing blind.

1. Tap **🔍 Check a contract**.
2. **Pick the chain** it's on. Available chains include Ethereum, Polygon, Base, Arbitrum, Robinhood Chain, and Arc — each with a **testnet** version (Sepolia, Amoy, etc.) for practice. Pick the testnet twin while you're learning.
3. **Paste the contract address** (`0x` + 40 hex characters). The bot reads it and reports back:
   - Name / symbol
   - Total minted and max supply
   - Price it reads on-chain
   - Sale flags (is the sale active, is it paused)
   - Whether there's an **allowlist gate** (a Merkle root on-chain)
   - Which **mint functions** it could detect (from the verified ABI, if the contract is verified)

After the read, you get buttons:

- **🔐 Add allowlist proof** — appears only if the contract has an allowlist. See below.
- **⚡ Set up snipe** — jump to snipe settings for this contract.
- **⏰ Countdown** / **📡 Watch until live** — arm a timer or a live watcher (covered later).
- **🔁 Check another** / **⬅️ Menu**.

### 🔐 Allowlist proof (only if you're on the allowlist)

On-chain, an allowlist is just a single fingerprint (a "Merkle root"). To mint an allowlist spot, you need your personal **proof** — a list of `bytes32` values the project gives you (from their mint page or Discord). Tap **🔐 Add allowlist proof** and paste it. The bot slots it into the mint call automatically. Without a valid proof for your wallet, an allowlist mint will just revert.

**Honest note:** recon reads whatever the contract exposes. Unverified contracts may hide functions or use odd names — if nothing is auto-detected, you can still type the mint function signature yourself in snipe settings.

---

## ⚡ Snipe settings — set up the shot

Tap **⚡ Snipe a mint** (or **⚡ Set up snipe** after recon). You get a settings screen you can tune before firing:

**🧮 Pick mint function** — which function on the contract actually mints. If recon found exactly one, it's pre-selected (⭐). Otherwise pick from the list, or tap **✍️ Type it manually** and enter a signature like `mint(uint256)` or `whitelistMint(uint256,bytes32[])`. The bot fills the arguments by type automatically: your quantity goes in the number slot, your wallet in the address slot, your allowlist proof in the `bytes32[]` slot.

**🔢 Quantity** — how many to mint. Whole number.

**⛽ Gas** — how hard you compete to get included:
- **⛽ Safe 1.5x** — cheap, relaxed. Fine for quiet mints / testnets.
- **⛽ Auto gas 3x** (competitive) — the sensible default for a contested mint.
- **⛽ Auto gas 5x** (max) — aggressive; you pay up to get in first.
- **✍️ Manual gas** — you type two numbers in gwei: `maxFee priorityFee`, e.g. `50 5`. Use when you want exact control.

  *(Multipliers scale the current network fee. Higher = more likely to land fast, more you might pay.)*

**💰 Set max spend** — your ceiling, in the chain's currency, as a **total** (price × quantity), e.g. `0.25`. The bot refuses to fire if the real cost exceeds it. **Set this every time.** You *can* send `none` to remove it, but that's the "pay whatever the dev asks" mode — not recommended, ever.

**Firing mode toggle:**
- **🟡 Firing: confirm first** — tapping GO shows you the exact plan and needs a second, deliberate tap. Safe default.
- **✅ Firing: AUTO-FIRE** — GO fires immediately, no second tap. Faster, but make sure your settings and ceiling are right first. The bot warns you when you switch it on.

**Safety-net toggle:**
- **🧪 Safety: simulate-then-fire** — the bot dry-runs the call first and catches reverts (wrong function, bad proof, sold out) **before** any money moves. Safe default.
- **🏃 Safety: fire raw** — skips the dry-run for maximum speed. A wrong call only shows up as a failed transaction (you still lose the gas). Use only when you're certain the call is right. *(Even in raw mode, a gas estimate still runs, so clear reverts are caught.)*

---

## 🚀 GO — firing the mint

Tap **🚀 GO — fire the mint**. What happens:

1. **In confirm mode**, you see the full plan (function, quantity, gas, ceiling, wallet) and tap **Confirm & FIRE**. In auto-fire mode it goes straight through.
2. The bot checks your **ceiling**, reads the wallet's **current nonce**, builds and (unless raw) **simulates** the call.
3. It **signs and sends**, then reports the transaction hash with an **🌐 Open tx** button to track it.
4. **Bump-on-the-fly:** if the transaction sits unconfirmed, the bot automatically **resends the same nonce with a higher tip** (about +12% each round, up to 4 times, ~5s apart) to push it through. If it still hasn't landed after the bumps, it hands you the hash to watch — it may still confirm, and you're warned not to resend that nonce yourself.
5. If **auto-forget** is on, the wallet key is dropped from the bot right after success.

**Double-fire protection:** every fire — whether you tap GO twice fast, or a countdown auto-fires at the same instant you tap GO — funnels through one guarded path. While a fire is in flight, a second one is refused with "⏳ Already firing" instead of sending a second, separate mint. So you can't accidentally pay twice.

---

## ⏰ Countdown and 📡 Watch until live — be ready the moment it drops

Both arm the bot to act at the right time. One watch per chat at a time.

### ⏰ Countdown — you know the time

Tap **⏰ Countdown** and send when to fire. It understands:
- `10m`, `90s`, `1h30m` — a duration from now
- `15:30` or `3:30pm` — the next time your PC's clock hits that
- a **unix timestamp** (10 digits) the project posts

The bot shows a **live-updating countdown** (ticking faster as it nears zero). At zero:
- if your firing mode is **AUTO-FIRE**, it fires automatically;
- if it's **confirm**, it sends a loud 🚨 alert with a **GO** button for you to tap.

Max 14 days out. Tap **🛑 Cancel countdown** any time.

### 📡 Watch until live — you don't know the time

Tap **📡 Watch until live**. The bot polls the contract every ~4 seconds, watching the sale flags / paused / sold-out state. The instant it looks **open**, it auto-fires (if firing mode is auto **and** the snipe is fully set up) or sends a 🚨 GO alert. This catches surprise "sale is live now" flips.

It stops itself after **6 hours**, or after 10 checks in a row fail (bad connection / RPC). Tap **🛑 Stop watching** to end it early.

**Honest notes on watches:**

- **Auto-fire only happens if the snipe is actually ready** (function chosen, active wallet, a buildable call). If auto-fire is on but something's missing, the bot **alerts instead of firing blind** — it never guesses.
- **Watches live in memory only.** If you stop the bot or the PC restarts, active watches are forgotten — deliberately, so a crash + restart hours later can't fire a stale order behind your back. Re-arm after any restart.
- Because it runs on your PC, your PC must stay on and online for a watch to keep working.

---

## Your first end-to-end run (do this on a testnet)

This is the dry-run that proves everything works before real money is ever involved.

1. **Start the bot** (`npm run bot`) and send `/start` in Telegram.
2. **👛 Wallet → 🆕 Create burner.** Save the key it shows you.
3. **Get free testnet funds** for that address from a faucet (e.g. a Sepolia faucet). Turn on **♻️ Auto-forget after mint** if you like.
4. **🔍 Check a contract → pick a testnet chain** (e.g. Ethereum Sepolia) → paste a testnet mint contract address. Read what comes back.
5. If it has an allowlist and you're on it, **🔐 Add allowlist proof**.
6. **⚡ Set up snipe:** pick the mint function, set quantity, choose **Safe 1.5x** gas (it's a testnet), and **💰 set a max spend** ceiling.
7. Leave firing mode on **confirm** and safety on **simulate** for your first shot.
8. **🚀 GO → Confirm & FIRE.** Watch the status messages and open the tx link.
9. Once you trust the flow with fake funds, repeat on mainnet — with a real burner, a real ceiling, and only the funds you're willing to spend.

---

## Troubleshooting

- **Bot won't start / complains about `.env`.** The error tells you exactly which line to fix. Token comes from @BotFather, your id from @userinfobot. No quotes or extra spaces.
- **Bot doesn't reply in Telegram.** Confirm the terminal shows `🔒 Locked to owner id:` with **your** id, and that you're messaging it in a **private** chat (not a group). Wrong id = silently ignored, by design.
- **"Already firing."** A fire is still resolving — wait for its result before tapping again.
- **Mint reverted / failed tx.** Usually: sale not open yet, sold out, wrong function, or a missing/invalid allowlist proof. Re-run 🔍 recon to recheck the sale state.
- **"Refused — exceeds ceiling."** The real cost went above your max spend. That's the guard working. Raise the ceiling only if you truly mean to.
- **Balance looks wrong on Arc.** Arc uses 6-decimal USDC for gas; the balance display assumes 18 decimals, so treat it as approximate there.
- **Watch stopped by itself.** It caps at 6 hours or after 10 failed checks in a row. Re-arm it.

---

## The honest limitations, in one place

- **Live fire and live watch have never been run end-to-end against a real chain** in this build's development environment. Treat the first testnet run as the real test. Prove it with fake money first.
- **Watches and session state are in-memory.** A restart forgets your active watch, active contract, and settings — you keep wallets (encrypted on disk). Re-arm after restart.
- **It runs on your PC.** No PC on and online = no bot, no watch, no fire. This is intentional — your keys never leave your machine, and nothing runs on a server you don't control.
- **Encryption protects the stored file, not everything.** Someone with **both** your `.env` and the `.bot/` folder could decrypt. The burner-only rule is what actually caps your risk. Keep it.

That's the whole bot. Start on a testnet, keep a ceiling, stay on a burner, and you're in control the entire way.






