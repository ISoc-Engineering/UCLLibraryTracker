// Central runtime configuration, driven by environment variables so the same
// build runs in development (mock data) and production (live scraped data)
// without code changes.

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const settings = {
  // HTTP port for the web server.
  port: intFromEnv('PORT', 3000),

  // Which data source to use: 'scrape' (live) or 'mock' (demo data).
  // Defaults to 'scrape' when a scraper provider is configured, else 'mock'.
  dataSource:
    process.env.DATA_SOURCE ||
    (process.env.SCRAPER_URL_TEMPLATE ? 'scrape' : 'mock'),

  // Scraping-provider config for the live 'scrape' source. The UCL feed is
  // behind Cloudflare, so a managed scraping service is needed to fetch it.
  //   SCRAPER_URL_TEMPLATE — provider request URL; use {url} for the (encoded)
  //                          target feed URL and {key} for the API key.
  //   SCRAPER_API_KEY      — provider API key.
  // See .env.example / README for ready-made templates per provider.
  scraperUrlTemplate: process.env.SCRAPER_URL_TEMPLATE || '',
  scraperApiKey: process.env.SCRAPER_API_KEY || '',

  // How often to poll the data source and append a snapshot to history,
  // in milliseconds. Default: every 5 minutes.
  pollIntervalMs: intFromEnv('POLL_INTERVAL_MS', 5 * 60 * 1000),

  // Whether the background poller runs automatically on server start.
  pollEnabled: process.env.POLL_ENABLED !== 'false',

  // Whether to seed demo history on boot when the history file is empty/sparse,
  // so the busyness graph works immediately. Defaults on (great for demos and
  // for Render's ephemeral disk); set SEED_ON_START=false once you're
  // collecting real data you don't want mixed with demo data.
  seedOnStart: process.env.SEED_ON_START !== 'false',

  // How many days of demo history to generate when seeding.
  seedDays: intFromEnv('SEED_DAYS', 3),

  // Path to the append-only history file (JSON Lines).
  historyFile:
    process.env.HISTORY_FILE ||
    new URL('../../data/history.jsonl', import.meta.url).pathname,
};

// R/A/G classification thresholds, as occupancy fraction (0..1).
//   occupancy < amberAt            -> green
//   amberAt <= occupancy < redAt   -> amber
//   occupancy >= redAt             -> red
export const RAG_THRESHOLDS = {
  amberAt: 0.6, // 60% full
  redAt: 0.85, // 85% full
};

/**
 * Classify an occupancy fraction (0..1) into 'green' | 'amber' | 'red'.
 */
export function classifyRAG(occupancy) {
  if (occupancy == null || Number.isNaN(occupancy)) return 'unknown';
  if (occupancy >= RAG_THRESHOLDS.redAt) return 'red';
  if (occupancy >= RAG_THRESHOLDS.amberAt) return 'amber';
  return 'green';
}
