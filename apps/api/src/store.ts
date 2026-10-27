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
      autobattle_json TEXT
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      leader_id TEXT UNIQUE NOT NULL REFERENCES leaders(id),
      active_version_id TEXT
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      policy_json TEXT NOT NULL,
      sha TEXT NOT NULL,
      created_at INTEGER NOT NULL
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
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_keys (
      wallet_id TEXT NOT NULL,
      key TEXT NOT NULL,
      PRIMARY KEY (wallet_id, key)
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
  `);
  return { db, close: () => db.close() };
}

let counter = 0;

// Test and route code mints ids without outside input.
export function mintId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
