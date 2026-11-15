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

You need Node.js version 22 or newer (the Cloudflare `wrangler` tool needs 22.12+). Download the **LTS** installer from
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

This downloads everything the app needs, including Cloudflare's `wrangler`
tool, which runs the app locally exactly as it runs on Cloudflare. Wait for it to finish (a few
`npm notice` / funding messages are normal — just no red **error**).

### 4. Add your Mapbox token (one time)

The map needs a free Mapbox public token. Copy `.env.example` to `.env`, then
paste your token (starts with `pk.`) from
[account.mapbox.com](https://account.mapbox.com) into it.

### 5. Start it

```bash
npm run dev
```

The first time, this creates a local database (if asked to confirm the
migration, press **y**). Then you should see something like:

```
Ready on http://localhost:8787
```

### 6. Open it in your browser

Go to **http://localhost:8787**

That's it. It runs on **demo data** right away, so the map, the R/A/G markers,
the "find libraries near me" button, and a pre-populated busyness graph all work
immediately. To stop the app, go back to the terminal and press **Ctrl + C**.

To run it again later, you only need steps 5–6.

> **Testing the 5-minute poller locally:** run `npm run dev -- --test-scheduled`
> and open http://localhost:8787/__scheduled to fire the cron once.

> **Windows PowerShell note:** if `npm install` fails with
> *"running scripts is disabled on this system"*, run this once in PowerShell,
> then try again:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

> **Want real live occupancy instead of demo data?** See
> [Live data from UCL](#live-data-from-ucl) below.

### Tests

```bash
npm test
```

This runs the parser/unit tests and then an end-to-end test that starts the
Worker under `wrangler dev` (with a throwaway database), calls every API route,
and fires the cron once.

## How it works

It's a single [Cloudflare Worker](https://developers.cloudflare.com/workers/):

- **Static site**: `public/` is served as Workers static assets.
- **API**: `src/worker.js` answers `/api/libraries`, `/api/current`,
  `/api/history?libraryId=&sinceHours=` and `/api/status`.
- **Poller**: a Cron Trigger runs every 5 minutes, fetches occupancy, classifies
  each library R/A/G, and stores the snapshot in a
  [D1](https://developers.cloudflare.com/d1/) database (`migrations/`).
- **Demo mode** (`DATA_SOURCE=mock`, the default): an empty database is seeded
  with a few days of realistic demo history, so the graph works straight away.

## Put it online (Cloudflare)

You need a free Cloudflare account. All commands run from the project folder.

1. **Log in** (opens your browser):

   ```bash
   npx wrangler login
   ```

2. **Create the database**, then copy the `database_id` it prints into
   `wrangler.jsonc` (replace the `00000000-…` placeholder under
   `d1_databases`):

   ```bash
   npx wrangler d1 create ucl-library-tracker
   ```

3. **Create the tables** in the new database:

   ```bash
   npm run db:migrate
   ```

4. **Add your Mapbox token** as a secret (it will ask you to paste it):

   ```bash
   npx wrangler secret put MAPBOX_TOKEN
   ```

   In the Mapbox dashboard, restrict the token to your `*.workers.dev` URL.

5. **Deploy**:

   ```bash
   npm run deploy
   ```

   Wrangler prints your public URL (`https://ucl-library-tracker.<you>.workers.dev`).
   Deploy again any time with `npm run deploy`. Watch logs with
   `npx wrangler tail`.

Unlike the old Render free tier, a Worker doesn't sleep, and history in D1
survives redeploys. The free plan easily covers polling every 5 minutes.

## Live data from UCL

The only source of occupancy is UCL's own seat-availability page:
<https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all>.
The app fetches it **directly from UCL**, with an honest `User-Agent`. It does
not use third-party scraping services or other students' APIs, and it does not
try to get round UCL's Cloudflare bot protection.

To switch to live data, set `"DATA_SOURCE": "scrape"` in `wrangler.jsonc`
(`"vars"`) and deploy. Demo seeding switches off automatically in live mode.

**If UCL's bot protection blocks the Worker**, the poller records a clear error
and backs off (it waits 5 min, then 10, 20, … up to 6 hours between attempts).
Visiting the site never triggers extra requests to UCL. Check:

```
https://<your-worker>.workers.dev/api/status
```

`"lastErrorKind": "cloudflare-challenge"` means UCL's firewall challenged the
request. The fix is to ask UCL (Library / ISD web team) to add a **WAF custom
rule with the Skip action** for requests from this Worker, for example matching
the `CF-Worker` request header (your `*.workers.dev` subdomain or custom domain)
on the path `/library/forms/indigo-seat-availability.php`.

## License

MIT
