// Demo history seeder.
//
// The busyness graph plots recent history (last 24h). On a fresh database that
// is empty, so this generates a realistic stretch of history ENDING AT "now"
// from the mock source's daily curve, so the graph is populated for demos.
//
// Only used in mock mode (see settings.seedDemoHistory), so demo data never
// mixes with real readings.

import { fetchOccupancy } from '../sources/mockSource.js';
import { buildSnapshot, insertSnapshots, countSnapshots } from './history.js';

/**
 * Generate seed snapshots spanning `days` days up to `now`, one every
 * `stepMinutes`. Timestamps are aligned to the step, so two seeds racing each
 * other write the same rows (INSERT OR REPLACE) instead of duplicating.
 */
export async function generateSeedSnapshots({ days = 3, stepMinutes = 15, now = new Date() } = {}) {
  const stepMs = stepMinutes * 60 * 1000;
  const end = Math.floor(now.getTime() / stepMs) * stepMs;
  const start = end - days * 24 * 60 * 60 * 1000;

  const snapshots = [];
  for (let t = start; t <= end; t += stepMs) {
    const ts = new Date(t);
    // fetchOccupancy is deterministic for a given timestamp.
    const records = await fetchOccupancy(ts);
    snapshots.push(buildSnapshot(records, { source: 'mock', ts }));
  }
  return snapshots;
}

/**
 * Seed demo history IF the database has fewer than `minSnapshots` snapshots.
 * Safe to call often: it's a single COUNT query once history exists.
 * @returns {Promise<{seeded:boolean, snapshots:number, reason:string}>}
 */
export async function seedHistoryIfNeeded(db, { days = 3, stepMinutes = 15, minSnapshots = 20 } = {}) {
  const existing = await countSnapshots(db);
  if (existing >= minSnapshots) {
    return { seeded: false, snapshots: existing, reason: `history already has ${existing} snapshots` };
  }
  const snapshots = await generateSeedSnapshots({ days, stepMinutes });
  await insertSnapshots(db, snapshots);
  return { seeded: true, snapshots: snapshots.length, reason: `history had ${existing} (< ${minSnapshots})` };
}
