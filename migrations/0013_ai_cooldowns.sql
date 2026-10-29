CREATE TABLE IF NOT EXISTS ai_cooldowns (
  leader_id TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);
