const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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

        console.log('[DB] PostgreSQL initialized');

    } catch (err) {

        console.error('[DB] initialization failed:', err);
        throw err;
    }
}

pool.ready = initialize();

module.exports = pool;