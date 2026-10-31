ALTER TABLE leaders ADD COLUMN handle_set INTEGER NOT NULL DEFAULT 0;
UPDATE leaders SET handle_set = 1 WHERE NOT (wallet_address IS NOT NULL AND substr(handle, 1, length(wallet_address)) = wallet_address);
