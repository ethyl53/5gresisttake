-- A durable idempotency receipt for Realtime Database commands.  A client may
-- retry or reconnect, but the same Firebase command ID is never executed twice.

CREATE TABLE IF NOT EXISTS web_command_receipts (
    firebase_uid TEXT NOT NULL,
    command_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    guild_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('processing', 'done', 'error')),
    result JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (firebase_uid, command_id)
);

CREATE INDEX IF NOT EXISTS web_command_receipts_finished_idx
    ON web_command_receipts (finished_at);

COMMENT ON TABLE web_command_receipts IS
    'Idempotency receipts for Firebase commandQueue entries; never contains authentication secrets.';
