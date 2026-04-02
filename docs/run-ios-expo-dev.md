# Beginner Guide: Run Expo on iOS (Mac)

This is a very beginner-friendly guide for someone who only has a Mac and wants to run the app.

## What you need first

1. A Mac
2. Internet connection
3. Xcode (free in the App Store)
4. Terminal app (already on Mac)

That is enough to start.

## Step 1: Install Xcode

1. Open the **App Store**
2. Search for **Xcode**
3. Click **Get / Install**
4. After install, open Xcode once and accept everything it asks

Important: first Xcode launch can take a few minutes.

## Step 2: Install Homebrew (package manager)

Open **Terminal** and run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After installation, close and reopen Terminal.

## Step 3: Install Node.js and Bun

In Terminal:

```bash
brew install node
brew install oven-sh/bun/bun
```

Check if installed:

```bash
node -v
bun -v
```

If both commands show version numbers, you are ready.

## Step 4: Open the project folder

In Terminal, go to the mobile app folder:

```bash
cd ~/Documents/Work/eluency-mobile
```

If your folder is in a different location, use that path instead.

## Step 5: Install project packages

```bash
bun install
```

Wait until it finishes.

## Step 6: Start Expo

```bash
bun start
```

You will now see the Expo developer screen in Terminal.

## Step 7: Run on iOS Simulator (easiest on Mac)

While Expo is running:

- press **`i`** in Terminal

Expo opens the iOS Simulator and runs the app.

## Step 8: Run on your real iPhone (optional)

1. Install **Expo Go** from the App Store on iPhone
2. Keep Mac + iPhone on the same Wi-Fi
3. In Expo Terminal, scan the QR code using Expo Go

## If something does not work

### Problem: Simulator does not open

- Open Xcode manually once
- Then try pressing `i` again in Expo Terminal

### Problem: Project is stuck / weird errors

Stop Expo (`Ctrl + C`) and run:

```bash
bunx expo start -c
```

Then try again.

### Problem: Command not found

- Close Terminal
- Open Terminal again
- Re-run the install command (Node or Bun)

## Daily usage (next time)

Every time you want to run the app again:

```bash
cd ~/Documents/Work/eluency-mobile
bun start
```

Then press **`i`** for iOS Simulator.
