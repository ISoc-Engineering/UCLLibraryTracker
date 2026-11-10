// Central runtime configuration, driven by environment variables so the same
// build runs in development (mock data) and production (live UCL API data)
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

  // Which data source to use: 'uclapi' (live) or 'mock' (demo data).
  // Defaults to 'uclapi' when a token is present, otherwise 'mock'.
  dataSource:
    process.env.DATA_SOURCE ||
    (process.env.UCLAPI_TOKEN ? 'uclapi' : 'mock'),

  // UCL API token (https://uclapi.com -> create an app). Only needed for the
  // 'uclapi' source.
  uclapiToken: process.env.UCLAPI_TOKEN || '',

  // How often to poll the data source and append a snapshot to history,
  // in milliseconds. Default: every 5 minutes.
  pollIntervalMs: intFromEnv('POLL_INTERVAL_MS', 5 * 60 * 1000),

  // Whether the background poller runs automatically on server start.
  pollEnabled: process.env.POLL_ENABLED !== 'false',

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
