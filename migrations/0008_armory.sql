ALTER TABLE leaders ADD COLUMN owned_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE leaders ADD COLUMN equipped_json TEXT NOT NULL DEFAULT '{"skin":null,"trail":null,"banner":null}';
