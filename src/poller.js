// Background poller: periodically fetches current occupancy from the active
// data source, classifies it, and appends a snapshot to the history file.
//
// It keeps the most recent snapshot in memory so the API can serve /api/current
// instantly without re-reading the file.

import { fetchCurrentOccupancy, activeSourceName } from './sources/index.js';
import { buildSnapshot, appendSnapshot } from './store/history.js';
import { settings } from './config/settings.js';

let timer = null;
let lastSnapshot = null;
let lastError = null;

/**
 * Perform a single poll: fetch -> classify -> append -> cache.
 * Returns the snapshot, or throws on failure.
 */
export async function pollOnce() {
  const records = await fetchCurrentOccupancy();
  const snapshot = buildSnapshot(records, { source: activeSourceName() });
  await appendSnapshot(snapshot);
  lastSnapshot = snapshot;
  lastError = null;
  return snapshot;
}

/**
 * Start the recurring poller. Runs one poll immediately, then on an interval.
 */
export function startPolling() {
  if (timer) return;

  const run = async () => {
    try {
      const snap = await pollOnce();
      console.log(
        `[poller] ${snap.ts} source=${snap.source} libraries=${snap.libraries.length}`,
      );
    } catch (err) {
      lastError = err;
      console.error('[poller] poll failed:', err.message);
    }
  };

  run(); // immediate first poll
  timer = setInterval(run, settings.pollIntervalMs);
  if (timer.unref) timer.unref();
  console.log(
    `[poller] started, interval=${settings.pollIntervalMs}ms source=${activeSourceName()}`,
  );
}

export function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getLastSnapshot() {
  return lastSnapshot;
}

export function getLastError() {
  return lastError ? lastError.message : null;
}
