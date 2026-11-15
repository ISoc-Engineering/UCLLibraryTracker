// One poll: fetch -> parse/classify -> store in D1, plus the bookkeeping that
// /api/status reports. Runs from the Cron Trigger (every 5 min); Workers keep
// no memory between invocations, so all state lives in the D1 `meta` table.
//
// Backoff: after a failure (e.g. a Cloudflare challenge from UCL) we don't
// retry on every cron tick. The wait doubles per consecutive failure, from
// 5 minutes up to MAX_BACKOFF_MS, and resets on the first success.

import { getSettings } from './config/settings.js';
import { fetchCurrentOccupancy } from './sources/index.js';
import { buildSnapshot, insertSnapshots, getMeta, setMeta } from './store/history.js';

const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
// Cron ticks jitter by a few seconds; don't skip a tick for being 1s early.
const TICK_TOLERANCE_MS = 30 * 1000;

export function backoffMs(consecutiveFailures) {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
}

/**
 * Perform a single poll.
 * @param {object} env  Worker env (needs env.DB)
 * @param {{now?: Date, force?: boolean}} opts  force ignores the backoff window
 * @returns {Promise<{status:'ok', snapshot:object} | {status:'skipped', nextAttemptAt:string} | {status:'error', error:string}>}
 */
export async function pollOnce(env, { now = new Date(), force = false } = {}) {
  const settings = getSettings(env);
  const meta = await getMeta(env.DB);

  if (!force && meta.nextAttemptAt && Date.parse(meta.nextAttemptAt) - TICK_TOLERANCE_MS > now.getTime()) {
    return { status: 'skipped', nextAttemptAt: meta.nextAttemptAt };
  }

  try {
    const records = await fetchCurrentOccupancy(settings);
    const snapshot = buildSnapshot(records, { source: settings.dataSource, ts: now });
    await insertSnapshots(env.DB, [snapshot]);
    await setMeta(env.DB, {
      lastPollAt: snapshot.ts,
      lastError: null,
      lastErrorKind: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      nextAttemptAt: null,
    });
    return { status: 'ok', snapshot };
  } catch (err) {
    const failures = (meta.consecutiveFailures || 0) + 1;
    const wait = backoffMs(failures);
    await setMeta(env.DB, {
      lastError: err.message,
      lastErrorKind: err.isChallenge ? 'cloudflare-challenge' : 'error',
      lastErrorAt: now.toISOString(),
      consecutiveFailures: failures,
      nextAttemptAt: new Date(now.getTime() + wait).toISOString(),
    });
    return { status: 'error', error: err.message };
  }
}
