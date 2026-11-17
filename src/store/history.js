// Occupancy history stored in Cloudflare D1 (see migrations/0001_init.sql).
//
// The API still speaks in "snapshots", the same shape the JSONL file used:
// {
//   "ts": "2026-11-10T14:05:00.000Z",
//   "source": "mock",
//   "libraries": [
//     { "libraryId": "main", "name": "Main Library",
//       "occupied": 350, "total": 624, "free": 274,
//       "occupancy": 0.561, "rag": "green" },
//     { "libraryId": "bartlett", "name": "Bartlett Library",
//       "occupied": null, "total": null, "free": null,
//       "occupancy": null, "rag": "closed" },
//     ...
//   ]
// }
// In D1 each library reading is its own row, keyed by (ts, library_id), which
// makes per-library history queries cheap.

import { classifyRAG } from '../config/settings.js';

/**
 * Build a normalised snapshot (adds occupancy fraction + RAG) from raw records.
 * A closed library ({ closed: true }) gets null counts and rag 'closed'.
 */
export function buildSnapshot(records, { source, ts = new Date() } = {}) {
  const libraries = records.map((r) => {
    if (r.closed) {
      // Closed: no seat counts, and 'closed' instead of an R/A/G colour.
      return {
        libraryId: r.libraryId,
        name: r.name,
        occupied: null,
        total: null,
        free: null,
        occupancy: null,
        rag: 'closed',
      };
    }
    const occupancy = r.total > 0 ? r.occupied / r.total : null;
    return {
      libraryId: r.libraryId,
      name: r.name,
      occupied: r.occupied,
      total: r.total,
      free: r.free,
      occupancy: occupancy == null ? null : Number(occupancy.toFixed(4)),
      rag: classifyRAG(occupancy),
    };
  });
  return { ts: ts.toISOString(), source, libraries };
}

// Rows per INSERT statement. Rows are passed as ONE JSON parameter and
// unpacked with json_each(), so a big seed costs a handful of queries instead
// of one per row (D1 limits queries per invocation and bound params per query).
const ROWS_PER_INSERT = 1000;

const INSERT_SQL = `
  INSERT OR REPLACE INTO readings
    (ts, source, library_id, name, occupied, total, free, occupancy, rag)
  SELECT
    json_extract(value, '$.ts'),
    json_extract(value, '$.source'),
    json_extract(value, '$.libraryId'),
    json_extract(value, '$.name'),
    json_extract(value, '$.occupied'),
    json_extract(value, '$.total'),
    json_extract(value, '$.free'),
    json_extract(value, '$.occupancy'),
    json_extract(value, '$.rag')
  FROM json_each(?)`;

/**
 * Store one or more snapshots.
 * @param {D1Database} db
 * @param {Array<object>} snapshots
 */
export async function insertSnapshots(db, snapshots) {
  const rows = snapshots.flatMap((s) =>
    s.libraries.map((l) => ({ ts: s.ts, source: s.source, ...l })),
  );
  if (rows.length === 0) return 0;

  const stmt = db.prepare(INSERT_SQL);
  const batch = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    batch.push(stmt.bind(JSON.stringify(rows.slice(i, i + ROWS_PER_INSERT))));
  }
  await db.batch(batch);
  return rows.length;
}

/** Group flat reading rows (ordered by ts) back into snapshots. */
function toSnapshots(rows) {
  const out = [];
  let current = null;
  for (const r of rows) {
    if (!current || current.ts !== r.ts) {
      current = { ts: r.ts, source: r.source, libraries: [] };
      out.push(current);
    }
    current.libraries.push({
      libraryId: r.library_id,
      name: r.name,
      occupied: r.occupied,
      total: r.total,
      free: r.free,
      occupancy: r.occupancy,
      rag: r.rag,
    });
  }
  return out;
}

const COLUMNS = 'ts, source, library_id, name, occupied, total, free, occupancy, rag';

/**
 * Read history snapshots (oldest first), optionally only those on/after
 * `since` (a Date) and only for one library.
 */
export async function readHistory(db, { since, libraryId } = {}) {
  const where = [];
  const params = [];
  if (since) {
    where.push('ts >= ?');
    params.push(since.toISOString());
  }
  if (libraryId) {
    where.push('library_id = ?');
    params.push(libraryId);
  }
  const sql =
    `SELECT ${COLUMNS} FROM readings` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY ts, rowid';
  const { results } = await db.prepare(sql).bind(...params).all();
  return toSnapshots(results);
}

/** Return the most recent snapshot, or null if history is empty. */
export async function latestSnapshot(db) {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM readings
       WHERE ts = (SELECT MAX(ts) FROM readings) ORDER BY rowid`,
    )
    .all();
  return toSnapshots(results)[0] || null;
}

/**
 * True if at least `n` snapshots (distinct timestamps) are stored. Bounded
 * cost: D1 bills rows *scanned*, and the LIMIT stops the scan after `n`
 * distinct timestamps instead of walking the whole table.
 */
export async function hasAtLeastSnapshots(db, n) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM (SELECT DISTINCT ts FROM readings LIMIT ?)')
    .bind(n)
    .first();
  return (row ? row.n : 0) >= n;
}

// ---- Poller state (key/value) ----

/** Read all meta keys into a plain object (values are JSON-decoded). */
export async function getMeta(db) {
  const { results } = await db.prepare('SELECT key, value FROM meta').all();
  const out = {};
  for (const { key, value } of results) {
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** Upsert several meta keys at once. */
export async function setMeta(db, entries) {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  await db.batch(
    Object.entries(entries).map(([k, v]) => stmt.bind(k, JSON.stringify(v ?? null))),
  );
}
