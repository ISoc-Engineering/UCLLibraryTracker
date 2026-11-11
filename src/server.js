// Express server: serves the map UI and a small JSON API over the occupancy
// data. The background poller is started on boot (unless disabled).

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { settings, RAG_THRESHOLDS } from './config/settings.js';
import { LIBRARIES } from './config/libraries.js';
import { readHistory, latestSnapshot } from './store/history.js';
import { seedHistoryIfNeeded } from './store/seed.js';
import {
  startPolling,
  pollOnce,
  getLastSnapshot,
  getLastError,
} from './poller.js';
import { activeSourceName } from './sources/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ---- Static frontend ----
app.use(express.static(join(__dirname, '..', 'public')));

// ---- API ----

// Library metadata (coordinates etc.) — static, used by the map.
app.get('/api/libraries', (_req, res) => {
  res.json({
    thresholds: RAG_THRESHOLDS,
    source: activeSourceName(),
    libraries: LIBRARIES.map((l) => ({
      id: l.id,
      name: l.name,
      coords: l.coords,
    })),
  });
});

// Current occupancy snapshot (latest poll). Falls back to the file if the
// in-memory cache is empty (e.g. right after a restart before the first poll).
app.get('/api/current', async (_req, res) => {
  try {
    let snapshot = getLastSnapshot();
    if (!snapshot) snapshot = await latestSnapshot();
    if (!snapshot) {
      // Nothing logged yet — do a live poll so the first page load isn't empty.
      snapshot = await pollOnce();
    }
    res.json(snapshot);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// History for graphing. Optional query params:
//   ?sinceHours=24   -> only snapshots within the last N hours
//   ?libraryId=main  -> only include that library in each snapshot
app.get('/api/history', async (req, res) => {
  try {
    const sinceHours = Number.parseFloat(req.query.sinceHours);
    const since = Number.isFinite(sinceHours)
      ? new Date(Date.now() - sinceHours * 3600 * 1000)
      : undefined;

    let history = await readHistory({ since });

    const libraryId = req.query.libraryId;
    if (libraryId) {
      history = history.map((snap) => ({
        ts: snap.ts,
        source: snap.source,
        libraries: snap.libraries.filter((l) => l.libraryId === libraryId),
      }));
    }

    res.json({ count: history.length, snapshots: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health / status.
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    source: activeSourceName(),
    pollIntervalMs: settings.pollIntervalMs,
    pollEnabled: settings.pollEnabled,
    lastPoll: getLastSnapshot() ? getLastSnapshot().ts : null,
    lastError: getLastError(),
  });
});

// ---- Boot ----
export function createServer() {
  return app;
}

// Only start listening when run directly (not when imported by tests/scripts).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  app.listen(settings.port, async () => {
    console.log(
      `UCL Library Tracker listening on http://localhost:${settings.port} (source: ${activeSourceName()})`,
    );

    // Populate demo history on boot so the busyness graph works immediately.
    // On Render the disk is ephemeral, so this runs on every deploy/restart.
    // Disable with SEED_ON_START=false (e.g. once you're collecting real data).
    if (settings.seedOnStart) {
      try {
        const r = await seedHistoryIfNeeded({ days: settings.seedDays });
        console.log(
          r.seeded
            ? `[seed] wrote ${r.lines} demo snapshots (${r.reason})`
            : `[seed] skipped (${r.reason})`,
        );
      } catch (err) {
        console.error('[seed] failed:', err.message);
      }
    }

    if (settings.pollEnabled) startPolling();
    else console.log('[poller] disabled (POLL_ENABLED=false)');
  });
}

export default app;
