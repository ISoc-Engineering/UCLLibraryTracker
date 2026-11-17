-- One row per library per poll. A "snapshot" is all rows sharing a ts.
CREATE TABLE IF NOT EXISTS readings (
  ts         TEXT    NOT NULL,          -- ISO-8601 UTC, e.g. 2026-11-15T14:05:00.000Z
  source     TEXT    NOT NULL,          -- 'mock' | 'scrape'
  library_id TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  occupied   INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  free       INTEGER NOT NULL,
  occupancy  REAL,                      -- 0..1, NULL if unknown
  rag        TEXT    NOT NULL,          -- green | amber | red | unknown
  PRIMARY KEY (ts, library_id)
);

CREATE INDEX IF NOT EXISTS idx_readings_library_ts ON readings (library_id, ts);

-- Small key/value table for poller state (last success, last error, backoff),
-- since Workers keep no memory between requests.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
