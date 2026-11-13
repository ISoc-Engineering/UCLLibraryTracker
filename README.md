# UCLLibraryTracker

See how full each UCL library is, at a glance, on a map.

> ⚠️ Student project — **not** an official UCL service.

## What it does

- Shows every UCL library on a map, each marked by how busy it is right now:
  - 🟢 **Green** — plenty of space (under 60% full)
  - 🟠 **Amber** — filling up (60–85% full)
  - 🔴 **Red** — very busy (over 85% full)
- Find libraries **near you** — it can use your location to centre the map and
  sort libraries nearest-first.
- Click a library to see how many desks are free, get **directions** to it, and
  view a **busyness graph** showing how full it gets through the day.

## How to run it on your computer

Follow these steps to get it running locally. It works the same on macOS,
Windows, and Linux.

### 1. Install Node.js (one time)

You need Node.js version 20 or newer. Download the **LTS** installer from
[nodejs.org](https://nodejs.org/) and run it (on Windows, keep "Add to PATH"
ticked). Then **open a new terminal** and check it worked:

```bash
node --version
npm --version
```

Both should print a version number. (If `node` isn't recognised, close and
reopen your terminal, or restart your computer, then try again.)

### 2. Get the code

If you have Git, clone the repo and enter the folder:

```bash
git clone https://github.com/ssleepy00/ucl-tracker-workaround.git
cd ucl-tracker-workaround
```

(No Git? Click the green **Code** button on GitHub → **Download ZIP**, unzip it,
then `cd` into the unzipped folder.)

### 3. Install the dependencies (one time)

From **inside the project folder**, run:

```bash
npm install
```

This downloads everything the app needs. Wait for it to finish (a few
`npm notice` / funding messages are normal — just no red **error**).

### 4. Start it

```bash
npm start
```

You should see:

```
UCL Library Tracker listening on http://localhost:3000 (source: mock)
[seed] wrote ... demo snapshots ...
```

### 5. Open it in your browser

Go to **http://localhost:3000**

That's it. It runs on **demo data** right away, so the map, the R/A/G markers,
the "find libraries near me" button, and a pre-populated busyness graph all work
immediately. To stop the app, go back to the terminal and press **Ctrl + C**.

To run it again later, you only need steps 4–5 (`npm start`, then open the URL).

> **Windows PowerShell note:** if `npm install` fails with
> *"running scripts is disabled on this system"*, run this once in PowerShell,
> then try again:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

> **Want real live occupancy instead of demo data?** Copy `.env.example` to
> `.env` and follow the notes inside it (and see the sections below).

## Put it online (shareable link)

The repo includes a `render.yaml`, so you can deploy a public demo for free on
[Render](https://render.com): sign in with GitHub, choose **New → Blueprint**,
and pick this repo. Render builds it and gives you a public URL.

> The free tier runs on demo data and sleeps when idle (first visit after a nap
> takes ~30–60s to wake). The demo busyness graph is regenerated on each boot.

## Collecting real data (for free, via GitHub Actions)

Instead of running a server 24/7 to log occupancy, this repo collects data with
a **scheduled GitHub Action** (`.github/workflows/collect.yml`). On a schedule
it fetches one snapshot and commits it to `data/history.collected.jsonl`, so
real busyness history builds up **in the repo itself** — durable, free, and
available to anyone who clones it. The website reads this committed history, so
your graphs fill with real data even on a free (ephemeral) host.

## License

MIT
