-- Keep mutation/audit history attributable to its Discord server without
-- modifying unassigned legacy rows.

ALTER TABLE activity_mutations
    ADD COLUMN IF NOT EXISTS guild_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS activity_mutations_guild_created_idx
    ON activity_mutations (guild_id, created_at DESC);
