// SQLite store. Tables hold leaders, agents, versions, matches, keys, txns.

import { DatabaseSync } from "node:sqlite";

export type Store = {
  db: DatabaseSync;
  close: () => void;
};

// The opener creates tables on first run. File persists between restarts.
export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_cooldowns (leader_id TEXT PRIMARY KEY, next_allowed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS leaders (
      id TEXT PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      rating_milli INTEGER NOT NULL DEFAULT 1000000,
      ap INTEGER NOT NULL DEFAULT 500,
      placement INTEGER NOT NULL DEFAULT 0,
      placed INTEGER NOT NULL DEFAULT 0,
      ac INTEGER NOT NULL DEFAULT 0,
      rp INTEGER NOT NULL DEFAULT 100,
      autobattle_json TEXT,
      owned_json TEXT NOT NULL DEFAULT '[]',
      equipped_json TEXT NOT NULL DEFAULT '{"skin":null,"trail":null,"banner":null}'
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      leader_id TEXT UNIQUE NOT NULL REFERENCES leaders(id),
      active_version_id TEXT,
      name TEXT,
      concept TEXT,
      portrait_url TEXT,
      portrait_status TEXT NOT NULL DEFAULT 'faceless'
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      policy_json TEXT NOT NULL,
      sha TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'mock',
      is_mock INTEGER NOT NULL DEFAULT 1,
      tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      seed TEXT NOT NULL,
      a_version TEXT NOT NULL,
      b_version TEXT NOT NULL,
      winner TEXT NOT NULL,
      ticks INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      rated INTEGER NOT NULL,
      delta_a INTEGER NOT NULL DEFAULT 0,
      delta_b INTEGER NOT NULL DEFAULT 0,
      paid_a INTEGER NOT NULL DEFAULT 0,
      paid_b INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      chips_json TEXT,
      mode TEXT NOT NULL DEFAULT 'duel'
    );
    CREATE TABLE IF NOT EXISTS wallet_keys (
      wallet_id TEXT NOT NULL,
      key TEXT NOT NULL,
      PRIMARY KEY (wallet_id, key)
    );
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
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event_json TEXT NOT NULL,
      games_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS season_archives (
      season_id TEXT PRIMARY KEY,
      closed_at INTEGER NOT NULL,
      archive_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_txns (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      currency TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_nonces (
      nonce TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      domain TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      leader_id TEXT NOT NULL REFERENCES leaders(id),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Labels arrived late. Old files gain the column once, then never again.
  const cols = db.prepare("PRAGMA table_info(versions)").all() as Record<string, unknown>[];
  if (!cols.some((c) => c.name === "label")) {
    db.exec("ALTER TABLE versions ADD COLUMN label TEXT");
  }
  // Mode arrived with MOBA. Old files gain the column once, then never again.
  const matchCols = db.prepare("PRAGMA table_info(matches)").all() as Record<string, unknown>[];
  if (!matchCols.some((c) => c.name === "mode")) {
    db.exec("ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'duel'");
  }
  // Wallet login arrived late. Old files gain the column once, then never again.
  const leaderCols = db.prepare("PRAGMA table_info(leaders)").all() as Record<string, unknown>[];
  if (!leaderCols.some((c) => c.name === "wallet_address")) {
    db.exec("ALTER TABLE leaders ADD COLUMN wallet_address TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaders_wallet ON leaders(wallet_address)");
  }
  return { db, close: () => db.close() };
}

export { mintId, newToken } from "./ids.ts";
