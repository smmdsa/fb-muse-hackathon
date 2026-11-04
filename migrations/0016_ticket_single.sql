CREATE UNIQUE INDEX IF NOT EXISTS tickets_open_single ON tickets(leader_id, mode) WHERE status = 'queued';
