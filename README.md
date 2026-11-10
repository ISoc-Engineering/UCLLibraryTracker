# UCLLibraryTracker

A small web app that tracks how full each UCL library is, classifies each one
**R / A / G** (red / amber / green), logs the data over time, and shows it on a
map with directions to every library.

> ⚠️ Student project — **not** an official UCL service.

---

## What it does

- **Fetches occupancy** per library from a pluggable data source.
- **Classifies** each library by how full it is:
  - 🟢 **Green** — under 60% full
  - 🟠 **Amber** — 60–85% full
  - 🔴 **Red** — over 85% full
- **Logs history** to an append-only file (`data/history.jsonl`) on a frequent
  interval, so you can do data analysis / graph busyness over time later.
- **Map overlay** (Leaflet + OpenStreetMap) with a colour-coded marker per
  library. Each marker shows free/total desks, a **Directions** link, and a
  **busyness graph** (Chart.js) built from the logged history.

## Data sources

The app reads occupancy through a pluggable source layer (`src/sources/`):

| Source   | Live? | Needs account?        | Notes |
|----------|-------|-----------------------|-------|
| `scrape` | ✅    | ✅ (free scraping tier) | Fetches UCL's public study-space feed (`indigo-seat-availability.php`) via a managed scraping provider. **Use this in production.** |
| `mock`   | ❌    | ❌                    | Realistic simulated data seeded with real per-library desk totals and a daily busyness curve. Lets you run and demo the whole app with no setup. |

### Why a scraping provider? (and what happened to the UCL API)

UCL's public Indigo feed is the only source of this data:

```
https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all
```

It returns exactly the right numbers (`N free seats out of M` per library), but
it sits behind **Cloudflare bot protection**. A plain server-side request — or
even a self-hosted headless browser from a datacenter/cloud IP — gets served a
"Just a moment..." challenge instead of the data, and the feed sends no CORS
headers, so the browser can't fetch it client-side either.

The community **[UCL API](https://github.com/uclapi/uclapi)** used to wrap this
feed in a clean JSON Workspaces endpoint, but **that service is now defunct**
(the domain resolves but the server no longer responds). So it is not an option.

The reliable way to read the feed is through a **managed scraping/browser
service** that renders JS and uses residential (premium) proxies to clear
Cloudflare. The `scrape` source is **provider-agnostic** — you point it at any
such service via env vars, so you're not locked in. Services with free tiers
include [ScraperAPI](https://www.scraperapi.com), [ScrapingBee](https://www.scrapingbee.com),
and [ZenRows](https://www.zenrows.com).

> ℹ️ The cleanest long-term source would be **official data access from UCL
> Library Services**. If you obtain a stable endpoint, adding it is just one new
> file in `src/sources/` — the rest of the app is unchanged.

## Getting started

```bash
npm install
cp .env.example .env   # optional — defaults to mock data
npm start
```

Open http://localhost:3000.

With no configuration, it runs on **mock** data so you can see the full app
immediately.

### Going live with real UCL data

1. Sign up for a scraping provider (free tier is fine) and get an API key.
2. In `.env`, set `DATA_SOURCE=scrape`, pick the matching
   `SCRAPER_URL_TEMPLATE` for your provider (templates are in `.env.example`),
   and set `SCRAPER_API_KEY`. For example, with ScraperAPI:
   ```
   DATA_SOURCE=scrape
   SCRAPER_URL_TEMPLATE=https://api.scraperapi.com/?api_key={key}&render=true&premium=true&url={url}
   SCRAPER_API_KEY=your-key-here
   ```
   (`{url}` and `{key}` are filled in automatically by the app.)
3. `npm start`. The app now polls the live UCL feed.

> **Quota tip:** UCL's sensors only update every 5 minutes, so there's no point
> polling faster. On a free scraping tier (~1000 requests/month), set
> `POLL_INTERVAL_MS=1800000` (30 min) to stay within quota.

## Configuration

All via environment variables (see `.env.example`):

| Var                   | Default                               | Meaning |
|-----------------------|---------------------------------------|---------|
| `DATA_SOURCE`         | `scrape` if `SCRAPER_URL_TEMPLATE` set, else `mock` | Active data source |
| `SCRAPER_URL_TEMPLATE`| —                                     | Scraping provider request URL (`{url}`, `{key}` placeholders) |
| `SCRAPER_API_KEY`     | —                                     | Scraping provider API key |
| `PORT`                | `3000`                                | HTTP port |
| `POLL_INTERVAL_MS`    | `300000` (5 min)                      | How often to poll + log |
| `POLL_ENABLED`        | `true`                                | Run the background poller on boot |
| `HISTORY_FILE`        | `data/history.jsonl`                  | Where snapshots are appended |

R/A/G thresholds live in `src/config/settings.js` (`RAG_THRESHOLDS`).

## API

| Endpoint                        | Description |
|---------------------------------|-------------|
| `GET /api/libraries`            | Static metadata (coordinates, thresholds, active source) |
| `GET /api/current`              | Latest occupancy snapshot with R/A/G per library |
| `GET /api/history?sinceHours=24&libraryId=main` | Logged snapshots for graphing |
| `GET /api/status`               | Poller health / last poll / last error |

## Data format

`data/history.jsonl` is [JSON Lines](https://jsonlines.org/) — one snapshot per
line, so it grows cheaply and streams well for analysis:

```json
{"ts":"2026-11-10T14:05:00.000Z","source":"scrape","libraries":[
  {"libraryId":"main","name":"Main Library","occupied":340,"total":624,"free":284,"occupancy":0.5449,"rag":"green"}
]}
```

## Project layout

```
src/
  config/      libraries (coords + name matching), settings + R/A/G thresholds
  sources/     data sources: scrapeSource, mockSource, dispatcher
  store/       history.js — append-only JSONL store
  poller.js    background interval poller
  server.js    Express app + JSON API
  scripts/     pollOnce.js (one-off poll), selftest.js, testParse.js
public/        Leaflet map UI + Chart.js busyness graph
data/          runtime history (gitignored)
```

## Scheduling

The server runs its own interval poller. If you'd rather drive it externally
(e.g. cron), disable the built-in poller with `POLL_ENABLED=false` and run:

```bash
npm run poll:once
```

## Testing

```bash
node src/scripts/testParse.js   # feed parser vs. real captured data
node src/scripts/selftest.js    # boots the app and hits every API route
```

## Roadmap ideas

- Official UCL Library Services data feed (the ideal, stable source).
- Historical busyness heatmap by hour-of-day / day-of-week.
- Walking directions / travel time between your location and libraries.

## License

MIT
