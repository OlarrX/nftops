# Running the Mint Bot on Your Phone (Termux)

This guide gets the NFTOps mint bot running **on your Android phone**, in the background, so you don't need your PC on. You already control the bot from Telegram; this moves the little "engine" that runs it onto your phone too.

---

## Honest expectations first (read this)

- **Great for:** recon, testnet practice, and relaxed/uncontested mints. Your keys stay on a device you own.
- **Not ideal for:** a hot, contested **mainnet** drop where milliseconds decide who gets in. A phone on mobile data, with Android throttling background apps, is the least reliable host for that. For those, run the bot on your PC or a small always-on box instead.
- **Android will try to kill it.** That's normal. The battery steps below are not optional — skip them and the bot dies when the screen turns off.
- **Same safety rules still apply:** burner wallet only, always set a max-spend ceiling, bot answers only you.

---

## Step 1 — Install Termux (the right version)

Install Termux from **F-Droid** or **GitHub**, **NOT** the Google Play version (the Play one is old and broken).

- F-Droid: https://f-droid.org/en/packages/com.termux/
- Also install **Termux:Boot** (same source) — this lets the bot auto-start when your phone reboots.

Open Termux, then update its packages:

```
pkg update && pkg upgrade -y
```

Install what we need:

```
pkg install nodejs git -y
```

Check Node is version 18 or higher (the bot uses built-in `fetch`, which needs 18+):

```
node -v
```

---

## Step 2 — Get the project onto your phone

You have two options. **Option A (git)** is best because you can pull updates later with one command.

### Option A — Clone from your GitHub (recommended)

Your repo is private, so you need a token to clone it:

1. On your phone browser, go to GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens → Generate new token**.
2. Give it **read-only access** to just the `nftops` repository (Contents: Read).
3. Copy the token (starts with `github_pat_...`).
4. In Termux:

   ```
   git clone https://YOUR_TOKEN@github.com/OlarrX/nftops.git
   cd nftops
   ```

   (Replace `YOUR_TOKEN` with the token you copied.)

Later, to get your newest code: `cd nftops && git pull`.

### Option B — Copy the folder manually

1. On your PC, copy the whole `C:\nftops` folder **except** the `node_modules` folder, to Google Drive / a cable transfer.
2. On the phone, run `termux-setup-storage` once (grant permission), then copy the folder into Termux's home. Then `cd nftops`.

---

## Step 3 — Install ONLY what the bot needs (skip Hardhat)

This is the key move that avoids the compiler that won't build on a phone. From inside the `nftops` folder:

```
npm install --omit=dev
```

That installs the bot's runtime pieces (ethers, dotenv, etc.) and **skips** Hardhat and the other heavy build-only tools.

Then add just the small TypeScript runner so we can start the bot from source:

```
npm install --no-save ts-node typescript
```

(Both are pure JavaScript, so they install fine on a phone. We're deliberately not installing Hardhat.)

---

## Step 4 — Create your `.env` on the phone

The bot reads its secrets from a `.env` file, exactly like on your PC. It is **not** copied from git (it's ignored on purpose), so you create it fresh here:

```
nano .env
```

Type these three lines (use your real values):

```
TELEGRAM_BOT_TOKEN=1234567890:AAF...        # from @BotFather
TELEGRAM_ALLOWED_USER_ID=123456789           # your numeric id, from @userinfobot
WALLET_ENCRYPTION_PASSWORD=your-long-random-phrase
```

**Important:** use the **same** `WALLET_ENCRYPTION_PASSWORD` you used on your PC only if you also copy your `.bot/` wallet files over. Otherwise just make a new one here and create a fresh burner on the phone. Save with `Ctrl+O`, Enter, then `Ctrl+X`.

> Only run **one** copy of the bot at a time (either PC or phone, not both), or they'll fight over Telegram's message queue. Stop the PC one before starting the phone one.

---

## Step 5 — Start the bot

```
termux-wake-lock
npm run bot
```

- `termux-wake-lock` tells Android to keep the CPU awake so the bot isn't frozen when the screen is off.
- You should see `✅ Bot online as @yourbot`. Now message your bot on Telegram — it works from the phone hosting it, or any other device.

To stop it: `Ctrl+C`, then `termux-wake-lock` can be released with `termux-wake-unlock`.

---

## Step 6 — Keep Android from killing it (do all of these)

Phones aggressively suspend background apps. Apply every one of these:

1. **Battery optimization off for Termux.** Android Settings → Apps → Termux → Battery → set to **Unrestricted** (wording varies by phone: "Don't optimize" / "No restrictions").
2. **Keep wake-lock on.** Always run `termux-wake-lock` before `npm run bot`. You'll also see a persistent Termux notification — that's good, it means it's protected.
3. **Lock Termux in recents.** Open the recent-apps switcher, find Termux, and "lock"/"pin" it so the system won't clear it (many phones support this).
4. **Keep it plugged in and on Wi-Fi** when you want it reliably alive. Battery-saver mode and mobile-data dozing are the usual culprits behind a bot going quiet.

---

## Step 7 — Auto-start after a reboot (optional but nice)

So you don't have to reopen Termux after every restart:

1. Make the boot script folder and file:

   ```
   mkdir -p ~/.termux/boot
   nano ~/.termux/boot/start-bot.sh
   ```

2. Paste this:

   ```
   #!/data/data/com.termux/files/usr/bin/sh
   termux-wake-lock
   cd ~/nftops
   npm run bot
   ```

3. Save (`Ctrl+O`, Enter, `Ctrl+X`) and make it runnable:

   ```
   chmod +x ~/.termux/boot/start-bot.sh
   ```

With **Termux:Boot** installed and opened once, this runs automatically after the phone restarts.

---

## Troubleshooting

- **`fetch is not defined` / crashes on start:** your Node is too old. `pkg upgrade nodejs`, confirm `node -v` shows 18+.
- **Bot goes silent after the screen locks:** a battery step got skipped. Re-check Step 6, especially battery optimization = Unrestricted and `termux-wake-lock`.
- **`npm install` errors mentioning `hardhat`, `node-gyp`, or a C compiler:** you didn't use `--omit=dev`. Delete `node_modules` (`rm -rf node_modules`) and redo Step 3 exactly.
- **Bot replies twice or acts confused:** you've got two copies running (PC and phone). Stop one.
- **Can't clone (auth failed):** the token is wrong, expired, or lacks access to the repo. Regenerate a fine-grained token with Contents: Read on `nftops`.

---

## If the phone proves too flaky

If Android keeps killing it and you want rock-solid uptime, the two most reliable upgrades are a **Raspberry Pi** (or spare old laptop) left on at home, or a **small cloud server (VPS, ~$4-6/month)**. Both run the exact same steps as a normal Linux machine. The only tradeoff with a VPS is that your burner key and bot token live on a rented server — which is why the burner-only rule matters even more there. Ask me and I'll write up whichever you want.
