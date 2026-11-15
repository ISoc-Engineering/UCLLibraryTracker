// Cloudflare Worker entry point.
//
//   fetch     — static frontend (public/, served by Workers static assets
//               before this code runs) and the JSON API under /api/*.
//   scheduled — Cron Trigger (every 5 min, see wrangler.jsonc): poll the data
//               source and store a snapshot in D1.

import { getSettings, RAG_THRESHOLDS } from './config/settings.js';
import { LIBRARIES } from './config/libraries.js';
import { readHistory, latestSnapshot, getMeta } from './store/history.js';
import { seedHistoryIfNeeded } from './store/seed.js';
import { pollOnce } from './poller.js';
import { FEED_URL } from './sources/scrapeSource.js';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function seedIfEnabled(env, settings) {
  if (!settings.seedDemoHistory) return null;
  const r = await seedHistoryIfNeeded(env.DB, { days: settings.seedDays });
  if (r.seeded) console.log(`[seed] wrote ${r.snapshots} demo snapshots (${r.reason})`);
  return r;
}

// ---- API handlers ----

function handleLibraries(settings) {
  return json({
    thresholds: RAG_THRESHOLDS,
    source: settings.dataSource,
    mapbox: { token: settings.mapboxToken, style: settings.mapboxStyle },
    libraries: LIBRARIES.map((l) => ({ id: l.id, name: l.name, coords: l.coords })),
  });
}

async function handleCurrent(env, settings) {
  let snapshot = await latestSnapshot(env.DB);
  if (snapshot) return json(snapshot);

  // Empty database. In mock mode, seed + poll so the first page load works
  // before the first cron tick. In live mode we never let page views trigger
  // requests to UCL; that's the cron's job (and it backs off on challenges).
  if (settings.dataSource === 'mock') {
    await seedIfEnabled(env, settings);
    const r = await pollOnce(env, { force: true });
    if (r.status === 'ok') return json(r.snapshot);
    return json({ error: r.error }, 502);
  }

  const meta = await getMeta(env.DB);
  return json(
    {
      error: meta.lastError || 'No occupancy data collected yet. The poller runs every 5 minutes.',
      errorKind: meta.lastErrorKind || null,
    },
    503,
  );
}

async function handleHistory(env, url) {
  const sinceHours = Number.parseFloat(url.searchParams.get('sinceHours'));
  const since = Number.isFinite(sinceHours)
    ? new Date(Date.now() - sinceHours * 3600 * 1000)
    : undefined;
  const libraryId = url.searchParams.get('libraryId') || undefined;

  const snapshots = await readHistory(env.DB, { since, libraryId });
  return json({ count: snapshots.length, snapshots });
}

async function handleStatus(env, settings) {
  const meta = await getMeta(env.DB);
  return json({
    ok: !meta.lastError,
    source: settings.dataSource,
    feedUrl: settings.dataSource === 'scrape' ? FEED_URL : null,
    pollIntervalMs: settings.pollIntervalMs,
    lastPoll: meta.lastPollAt || null,
    lastError: meta.lastError || null,
    lastErrorKind: meta.lastErrorKind || null,
    lastErrorAt: meta.lastErrorAt || null,
    consecutiveFailures: meta.consecutiveFailures || 0,
    nextAttemptAt: meta.nextAttemptAt || null,
  });
}

// ---- Worker ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const settings = getSettings(env);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405);
    }

    try {
      switch (url.pathname) {
        case '/api/libraries':
          return handleLibraries(settings);
        case '/api/current':
          return await handleCurrent(env, settings);
        case '/api/history':
          return await handleHistory(env, url);
        case '/api/status':
          return await handleStatus(env, settings);
        default:
          return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error(`[api] ${url.pathname} failed:`, err);
      return json({ error: err.message }, 500);
    }
  },

  async scheduled(controller, env) {
    const settings = getSettings(env);
    await seedIfEnabled(env, settings);
    const r = await pollOnce(env, { now: new Date(controller.scheduledTime) });
    if (r.status === 'ok') {
      console.log(`[poll] ${r.snapshot.ts} source=${r.snapshot.source} libraries=${r.snapshot.libraries.length}`);
    } else if (r.status === 'skipped') {
      console.log(`[poll] skipped (backing off until ${r.nextAttemptAt})`);
    } else {
      console.error(`[poll] failed: ${r.error}`);
    }
  },
};
