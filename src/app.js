// The app: JSON API + cron poller, independent of where occupancy comes from.
//
// createApp(source) returns a Worker handler ({ fetch, scheduled }). The data
// source is plugged in by the entry point:
//   src/worker.js       — production: live UCL data (the deployed app)
//   src/demo/worker.js  — demo: generated data + seeded history (`--env demo`)
//
// A source looks like:
//   {
//     name: 'ucl',                       // shown in the UI and /api/status
//     url?: 'https://…',                 // where the data comes from
//     fetchOccupancy: async () => [...] // [{ libraryId, name, occupied, total, free }]
//     prepare?: async (env) => {}       // optional, runs before each poll
//     pollWhenEmpty?: true              // optional: let a page view trigger the
//                                       // first poll on an empty database
//   }
//
// Static files in public/ are served by Workers static assets before this
// code runs, so only /api/* reaches fetch().

import { getSettings, RAG_THRESHOLDS } from './config/settings.js';
import { LIBRARIES } from './config/libraries.js';
import { readHistory, latestSnapshot, getMeta } from './store/history.js';
import { pollOnce } from './poller.js';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Run the source's optional prepare step without letting it block a poll. */
async function prepare(source, env) {
  if (!source.prepare) return;
  try {
    await source.prepare(env);
  } catch (err) {
    console.error(`[prepare] ${source.name} failed:`, err);
  }
}

export function createApp(source) {
  // ---- API handlers ----

  function handleLibraries(settings) {
    return json({
      thresholds: RAG_THRESHOLDS,
      source: source.name,
      mapbox: { token: settings.mapboxToken, style: settings.mapboxStyle },
      libraries: LIBRARIES.map((l) => ({ id: l.id, name: l.name, coords: l.coords })),
    });
  }

  async function handleCurrent(env) {
    const snapshot = await latestSnapshot(env.DB);
    if (snapshot) return json(snapshot);

    // Empty database. Only sources that opt in (the demo) may poll on a page
    // view; for live UCL data, polling is strictly the cron's job, so visitors
    // can never cause extra requests to UCL.
    if (source.pollWhenEmpty) {
      await prepare(source, env);
      const r = await pollOnce(env, source, { force: true });
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
      source: source.name,
      sourceUrl: source.url || null,
      pollIntervalMs: settings.pollIntervalMs,
      lastPoll: meta.lastPollAt || null,
      lastError: meta.lastError || null,
      lastErrorKind: meta.lastErrorKind || null,
      lastErrorAt: meta.lastErrorAt || null,
      consecutiveFailures: meta.consecutiveFailures || 0,
      nextAttemptAt: meta.nextAttemptAt || null,
    });
  }

  // ---- Worker handler ----

  return {
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
            return await handleCurrent(env);
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

    // Cron Trigger (every 5 min, see wrangler.jsonc).
    async scheduled(controller, env) {
      await prepare(source, env);
      const r = await pollOnce(env, source, { now: new Date(controller.scheduledTime) });
      if (r.status === 'ok') {
        console.log(`[poll] ${r.snapshot.ts} source=${source.name} libraries=${r.snapshot.libraries.length}`);
      } else if (r.status === 'skipped') {
        console.log(`[poll] skipped (backing off until ${r.nextAttemptAt})`);
      } else {
        console.error(`[poll] failed: ${r.error}`);
      }
    },
  };
}
