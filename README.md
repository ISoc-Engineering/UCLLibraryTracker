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

| Source   | Live? | Needs token? | Notes |
|----------|-------|--------------|-------|
| `uclapi` | ✅    | ✅ (free)    | The official [UCL API](https://uclapi.com) Workspaces endpoint (`/workspaces/sensors/summary`). This is the sanctioned route for the library sensor data and returns clean JSON. **Use this in production.** |
| `mock`   | ❌    | ❌           | Realistic simulated data seeded with real per-library desk totals and a daily busyness curve. Lets you run and demo the whole app with no token. |

### Why not scrape the public seat-availability page directly?

UCL's public Indigo feed (`indigo-seat-availability.php`) returns exactly the
right numbers, but it sits behind **Cloudflare bot protection**, so a deployed
server-side scraper gets blocked. The UCL API exposes the same underlying sensor
data as a proper JSON API and is the intended integration point — so the app is
built on that instead.

## Getting started

```bash
npm install
cp .env.example .env   # optional — defaults to mock data
npm start
```

Open http://localhost:3000.

With no token, it runs on **mock** data so you can see the full app immediately.

### Going live with real UCL data

1. Register at <https://uclapi.com> and create an app to get a free API token.
2. Put it in `.env`:
   ```
   UCLAPI_TOKEN=your-token-here
   DATA_SOURCE=uclapi
   ```
3. `npm start`. The app now polls the live UCL API.

## Configuration

All via environment variables (see `.env.example`):

| Var                | Default                         | Meaning |
|--------------------|---------------------------------|---------|
| `DATA_SOURCE`      | `uclapi` if token set, else `mock` | Active data source |
| `UCLAPI_TOKEN`     | —                               | UCL API token (live source only) |
| `PORT`             | `3000`                          | HTTP port |
| `POLL_INTERVAL_MS` | `300000` (5 min)                | How often to poll + log |
| `POLL_ENABLED`     | `true`                          | Run the background poller on boot |
| `HISTORY_FILE`     | `data/history.jsonl`            | Where snapshots are appended |

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
{"ts":"2026-11-10T14:05:00.000Z","source":"mock","libraries":[
  {"libraryId":"main","name":"Main Library","occupied":350,"total":624,"free":274,"occupancy":0.5609,"rag":"green"}
]}
```

## Project layout

```
src/
  config/      libraries (coords + name matching), settings + R/A/G thresholds
  sources/     data sources: uclapiSource, mockSource, dispatcher
  store/       history.js — append-only JSONL store
  poller.js    background interval poller
  server.js    Express app + JSON API
  scripts/     pollOnce.js — one-off poll (for cron etc.)
public/        Leaflet map UI + Chart.js busyness graph
data/          runtime history (gitignored)
```

## Scheduling

The server runs its own interval poller. If you'd rather drive it externally
(e.g. cron), disable the built-in poller with `POLL_ENABLED=false` and run:

```bash
npm run poll:once
```

## Roadmap ideas

- Per-floor / per-zone breakdown (the UCL API exposes per-map sensor data).
- Historical busyness heatmap by hour-of-day / day-of-week.
- Walking directions / travel time between your location and libraries.

## License

MIT
