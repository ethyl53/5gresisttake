-- Planned work and opt-in record-sharing scopes.
-- This migration never rewrites or deletes existing activity history.  A
-- (guild_id, user_id) receives its own scope lazily when it is first used.

BEGIN;

CREATE TABLE IF NOT EXISTS record_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS record_scope_members (
    scope_id UUID NOT NULL REFERENCES record_scopes(id) ON DELETE RESTRICT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS record_scope_members_scope_idx
    ON record_scope_members (scope_id, user_id, guild_id);

CREATE OR REPLACE FUNCTION enforce_record_scope_member_owner()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM record_scopes
        WHERE id = NEW.scope_id
          AND owner_user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'A record scope can only contain its owner''s guild memberships.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS record_scope_member_owner_trigger
    ON record_scope_members;
CREATE TRIGGER record_scope_member_owner_trigger
    BEFORE INSERT OR UPDATE OF scope_id, user_id
    ON record_scope_members
    FOR EACH ROW
    EXECUTE FUNCTION enforce_record_scope_member_owner();

CREATE TABLE IF NOT EXISTS record_scope_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_scope_id UUID NOT NULL REFERENCES record_scopes(id) ON DELETE RESTRICT,
    owner_user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS record_scope_link_codes_owner_idx
    ON record_scope_link_codes (owner_user_id, expires_at DESC)
    WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS planned_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT NOT NULL,
    mutation_type TEXT NOT NULL CHECK (mutation_type IN ('create', 'edit', 'delete')),
    actor_user_id TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planned_mutations_guild_created_idx
    ON planned_mutations (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS planned_intervals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category_key TEXT NOT NULL,
    task_name TEXT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    parent_id UUID REFERENCES planned_intervals(id) ON DELETE RESTRICT,
    created_by_mutation_id UUID REFERENCES planned_mutations(id) ON DELETE RESTRICT,
    invalidated_by_mutation_id UUID REFERENCES planned_mutations(id) ON DELETE RESTRICT,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),
    CHECK ((is_active AND invalidated_at IS NULL AND invalidated_by_mutation_id IS NULL)
        OR (NOT is_active AND invalidated_at IS NOT NULL AND invalidated_by_mutation_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS planned_intervals_active_range_idx
    ON planned_intervals (guild_id, user_id, start_at, end_at)
    WHERE is_active;

ALTER TABLE planned_intervals
    DROP CONSTRAINT IF EXISTS planned_intervals_no_active_overlap;
ALTER TABLE planned_intervals
    ADD CONSTRAINT planned_intervals_no_active_overlap
    EXCLUDE USING gist (
        guild_id WITH =,
        user_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    ) WHERE (is_active);

COMMENT ON TABLE record_scopes IS
    'Explicit, same-user-only opt-in grouping of guild record views.';
COMMENT ON TABLE planned_intervals IS
    'Canonical planned intervals. Replacements retain historical rows.';

COMMIT;
