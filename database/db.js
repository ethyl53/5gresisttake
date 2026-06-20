const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false
});

async function initialize() {

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS work_sessions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                task_name TEXT,
                color TEXT,
                start_time BIGINT NOT NULL,
                end_time BIGINT,
                duration BIGINT
            );
        `);

        // 👇 ここから追記：Railway再起動時の復元用テーブル
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        // 👆 ここまで追記

        await pool.query(`
         ALTER TABLE work_sessions
         ADD COLUMN IF NOT EXISTS pause_time BIGINT;
        `);

        await pool.query(`
          ALTER TABLE work_sessions
         ADD COLUMN IF NOT EXISTS paused_duration BIGINT DEFAULT 0;
    `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS session_pauses (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            pause_start BIGINT NOT NULL,
            pause_end BIGINT,
            FOREIGN KEY (session_id)
                REFERENCES work_sessions(id)
                ON DELETE CASCADE
        );
    `);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS web_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL
        );
        `);

        console.log('[DB] PostgreSQL initialized');

    } catch (err) {

        console.error('[DB] initialization failed:', err);
        throw err;
    }
}

pool.ready = initialize();

module.exports = pool;