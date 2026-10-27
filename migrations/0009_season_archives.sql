CREATE TABLE IF NOT EXISTS season_archives (
  season_id TEXT PRIMARY KEY,
  closed_at INTEGER NOT NULL,
  archive_json TEXT NOT NULL
);
