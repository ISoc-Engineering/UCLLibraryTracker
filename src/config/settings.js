// Central runtime configuration. On Cloudflare Workers, settings come from the
// `env` object (wrangler.jsonc "vars", secrets, and .env / .dev.vars locally),
// so this module exposes a function rather than reading process.env.

function intFrom(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build the settings object from a Worker `env`.
 * @param {Record<string, any>} env
 */
export function getSettings(env = {}) {
  // Which data source to use: 'scrape' (live UCL feed) or 'mock' (demo data).
  const dataSource = env.DATA_SOURCE || 'mock';

  return {
    dataSource,

    // Mapbox public access token (starts with "pk."), shipped to the browser.
    // Restrict it to your site's URLs in the Mapbox dashboard.
    mapboxToken: env.MAPBOX_TOKEN || '',

    // Mapbox map style, e.g. mapbox://styles/mapbox/light-v11.
    mapboxStyle: env.MAPBOX_STYLE || 'mapbox://styles/mapbox/streets-v12',

    // Seed demo history when the database is empty, so the busyness graph
    // works immediately. Only ever applies in mock mode, so demo data is never
    // mixed with real readings.
    seedDemoHistory: dataSource === 'mock' && env.SEED_DEMO_HISTORY !== 'false',
    seedDays: intFrom(env.SEED_DAYS, 3),

    // Cron cadence, reported by /api/status (the actual schedule lives in
    // wrangler.jsonc "triggers").
    pollIntervalMs: 5 * 60 * 1000,
  };
}

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
