ALTER TABLE leaders ADD COLUMN wallet_address TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaders_wallet ON leaders(wallet_address);
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
