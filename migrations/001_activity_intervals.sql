-- New canonical store for credited work intervals.
-- Existing work_sessions / study_intervals tables are intentionally untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS activity_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mutation_type TEXT NOT NULL CHECK (mutation_type IN ('import', 'create', 'edit', 'delete', 'undo')),
    actor_user_id TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_intervals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL is used for records imported from the old schema, which had no guild id.
    -- Empty string denotes the legacy/global scope. New Discord writes must use
    -- the real guild id; this avoids PostgreSQL NULL-uniqueness edge cases.
    guild_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    category_key TEXT,
    task_name TEXT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    parent_id UUID REFERENCES activity_intervals(id) ON DELETE RESTRICT,
    created_by_mutation_id UUID REFERENCES activity_mutations(id) ON DELETE RESTRICT,
    invalidated_by_mutation_id UUID REFERENCES activity_mutations(id) ON DELETE RESTRICT,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at IS NULL OR end_at > start_at),
    CHECK ((is_active AND invalidated_at IS NULL AND invalidated_by_mutation_id IS NULL)
        OR (NOT is_active AND invalidated_at IS NOT NULL AND invalidated_by_mutation_id IS NOT NULL))
);

-- A running interval is the only allowed open interval. Pausing closes it, so
-- timeline/aggregation queries never need to subtract a pause from an interval.
CREATE TABLE IF NOT EXISTS activity_state (
    guild_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    active_interval_id UUID REFERENCES activity_intervals(id) ON DELETE RESTRICT,
    paused_category_key TEXT,
    paused_task_name TEXT,
    paused_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id),
    CHECK (
        (active_interval_id IS NOT NULL AND paused_at IS NULL)
        OR (active_interval_id IS NULL AND paused_at IS NOT NULL)
        OR (active_interval_id IS NULL AND paused_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS activity_intervals_user_range_idx
    ON activity_intervals (guild_id, user_id, start_at, end_at)
    WHERE is_active;

-- This is the database-level guarantee behind "one user, one task at a time".
ALTER TABLE activity_intervals
    DROP CONSTRAINT IF EXISTS activity_intervals_no_active_overlap;
ALTER TABLE activity_intervals
    ADD CONSTRAINT activity_intervals_no_active_overlap
    EXCLUDE USING gist (
        guild_id WITH =,
        user_id WITH =,
        tstzrange(start_at, COALESCE(end_at, 'infinity'::timestamptz), '[)') WITH &&
    ) WHERE (is_active);

COMMENT ON TABLE activity_intervals IS
    'Canonical non-overlapping work intervals. Old values are never overwritten by edit/delete.';

CREATE TABLE IF NOT EXISTS legacy_import_issues (
    id BIGSERIAL PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_table, source_id, reason)
);
