CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_json TEXT NOT NULL,
  games_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
