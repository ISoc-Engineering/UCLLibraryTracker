-- Closed libraries have no seat counts, so occupied/total/free become
-- nullable, and rag may now be 'closed'. SQLite can't drop NOT NULL in place,
-- so rebuild the table and copy the rows across.
CREATE TABLE readings_new (
  ts         TEXT    NOT NULL,          -- ISO-8601 UTC
  source     TEXT    NOT NULL,          -- 'ucl' | 'demo'
  library_id TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  occupied   INTEGER,                   -- NULL when closed
  total      INTEGER,                   -- NULL when closed
  free       INTEGER,                   -- NULL when closed
  occupancy  REAL,                      -- 0..1, NULL when closed/unknown
  rag        TEXT    NOT NULL,          -- green | amber | red | closed | unknown
  PRIMARY KEY (ts, library_id)
);

INSERT INTO readings_new (ts, source, library_id, name, occupied, total, free, occupancy, rag)
  SELECT ts, source, library_id, name, occupied, total, free, occupancy, rag FROM readings;

DROP TABLE readings;
ALTER TABLE readings_new RENAME TO readings;

CREATE INDEX IF NOT EXISTS idx_readings_library_ts ON readings (library_id, ts);
