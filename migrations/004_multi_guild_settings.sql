-- Per-guild settings.  This migration is intentionally additive and safe to
-- run more than once; it never assigns legacy activity rows to a guild.

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    ranking_channel_id TEXT,
    persistent_ranking_channel_id TEXT,
    daily_ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    weekly_ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    persistent_ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (timezone = 'Asia/Tokyo')
);

CREATE INDEX IF NOT EXISTS guild_settings_ranking_channel_idx
    ON guild_settings (ranking_channel_id)
    WHERE ranking_channel_id IS NOT NULL;

-- Schedules used to be keyed only by a Discord user.  Keep old rows in their
-- legacy scope until an administrator explicitly assigns them; all new writes
-- include the interaction guild.
DO $$
BEGIN
    IF to_regclass('public.user_schedules') IS NOT NULL THEN
        ALTER TABLE user_schedules
            ADD COLUMN IF NOT EXISTS guild_id TEXT NOT NULL DEFAULT '';

        CREATE INDEX IF NOT EXISTS user_schedules_guild_remind_idx
            ON user_schedules (guild_id, remind_time);
    END IF;
END $$;

COMMENT ON TABLE guild_settings IS
    'Per-Discord-guild ranking configuration. Empty/legacy activity rows are never migrated here automatically.';
