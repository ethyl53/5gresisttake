CREATE TABLE IF NOT EXISTS web_users (
    firebase_uid TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL UNIQUE,
    google_email TEXT,
    google_display_name TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS account_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS account_link_codes_discord_active_idx
    ON account_link_codes (discord_user_id, expires_at)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS account_link_codes_expiry_idx
    ON account_link_codes (expires_at)
    WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS web_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    discord_user_id TEXT,
    action_type TEXT NOT NULL,
    target_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_audit_logs_uid_time_idx
    ON web_audit_logs (firebase_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS web_audit_logs_discord_time_idx
    ON web_audit_logs (discord_user_id, created_at DESC);

COMMENT ON TABLE web_users IS
    'Links a Firebase Google login to exactly one Discord user.';

COMMENT ON TABLE account_link_codes IS
    'One-time Discord-issued hashes used to link Firebase users.';

COMMENT ON TABLE web_audit_logs IS
    'Audit trail for web console account and activity operations.';
