CREATE TABLE IF NOT EXISTS activity_monitor_state (
    active_interval_id UUID PRIMARY KEY
        REFERENCES activity_intervals(id)
        ON DELETE CASCADE,
    guild_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmation_sent_at TIMESTAMPTZ,
    confirmation_deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, user_id),
    CHECK (
        (confirmation_sent_at IS NULL AND confirmation_deadline IS NULL)
        OR
        (
            confirmation_sent_at IS NOT NULL
            AND confirmation_deadline IS NOT NULL
            AND confirmation_deadline > confirmation_sent_at
        )
    )
);

CREATE INDEX IF NOT EXISTS activity_monitor_deadline_idx
    ON activity_monitor_state (confirmation_deadline)
    WHERE confirmation_deadline IS NOT NULL;

COMMENT ON TABLE activity_monitor_state IS
    'Persistent confirmation state used to prevent forgotten open work intervals.';
