// Demo history seeder.
//
// The busyness graph plots recent history (last 24h) from data/history.jsonl.
// On a fresh start — a new clone, or a Render deploy with an ephemeral disk —
// that file is empty, so the graph has nothing to show. This module generates
// a realistic stretch of history ENDING AT "now", so the graph is immediately
// populated for demos.
//
// Because timestamps are generated relative to the current time, the data is
// always "fresh" no matter when the app boots (important on Render, where the
// disk resets on every deploy/restart).

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { settings } from '../config/settings.js';
import { fetchOccupancy } from '../sources/mockSource.js';
import { buildSnapshot } from './history.js';

/**
 * Generate seed snapshots spanning `days` days up to `now`, one every
 * `stepMinutes`. Reuses the mock source's realistic daily busyness curve, so
 * each library follows a believable rise/peak/dip/empty pattern with weekend
 * dampening and per-library personality.
 *
 * @returns {Promise<string>} JSONL text (one snapshot per line), oldest first.
 */
export async function generateSeedJsonl({ days = 3, stepMinutes = 15, now = new Date() } = {}) {
  const stepMs = stepMinutes * 60 * 1000;
  const spanMs = days * 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - spanMs);

  const lines = [];
  for (let t = start.getTime(); t <= now.getTime(); t += stepMs) {
    const ts = new Date(t);
    // mockSource.fetchOccupancy is deterministic for a given timestamp, giving
    // a smooth, reproducible daily curve.
    const records = await fetchOccupancy(ts);
    const snap = buildSnapshot(records, { source: 'mock', ts });
    lines.push(JSON.stringify(snap));
  }
  return lines.join('\n') + '\n';
}

async function ensureDir(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

/**
 * How many non-empty lines does the history file currently have?
 */
async function countHistoryLines(file) {
  if (!existsSync(file)) return 0;
  const raw = await readFile(file, 'utf8');
  return raw.split('\n').filter((l) => l.trim()).length;
}

/**
 * Seed the history file with demo data IF it is empty or very sparse.
 * Safe to call on every boot: it won't overwrite a file that already has a
 * reasonable amount of accumulated history.
 *
 * @param {object} opts
 * @param {boolean} opts.force      overwrite even if history already exists
 * @param {number}  opts.days       days of history to generate
 * @param {number}  opts.stepMinutes spacing between snapshots
 * @param {number}  opts.minLines   below this line count, (re)seed
 * @returns {Promise<{seeded:boolean, lines:number, reason:string}>}
 */
export async function seedHistoryIfNeeded({
  force = false,
  days = 3,
  stepMinutes = 15,
  minLines = 20,
} = {}) {
  const file = settings.historyFile;
  const existing = await countHistoryLines(file);

  if (!force && existing >= minLines) {
    return { seeded: false, lines: existing, reason: `history already has ${existing} snapshots` };
  }

  const jsonl = await generateSeedJsonl({ days, stepMinutes });
  await ensureDir(file);
  await writeFile(file, jsonl, 'utf8');
  const lines = jsonl.split('\n').filter((l) => l.trim()).length;
  return { seeded: true, lines, reason: force ? 'forced' : `history had ${existing} (< ${minLines})` };
}
