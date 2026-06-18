const { Pool } = require('pg');

console.log('DATABASE_URL=', process.env.DATABASE_URL);

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

        console.log('[DB] PostgreSQL initialized');

    } catch (err) {

        console.error('[DB] initialization failed:', err);
        throw err;
    }
}

pool.ready = initialize();

module.exports = pool;