CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  leader_id TEXT NOT NULL REFERENCES leaders(id),
  version_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  foe_version TEXT,
  match_id TEXT,
  created_at INTEGER NOT NULL,
  settle_at INTEGER NOT NULL
);
