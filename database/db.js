'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: 'discord-study-bot'
});

pool.on('error', (error) => {
    console.error('[DB] Unexpected idle client error', error);
});

async function relationExists(name) {
    const result = await pool.query(
        'SELECT to_regclass($1) AS relation',
        [`public.${name}`]
    );

    return result.rows[0].relation !== null;
}

async function applySqlFile(relativePath) {
    const absolutePath = path.join(
        __dirname,
        '..',
        relativePath
    );

    const sql = fs.readFileSync(absolutePath, 'utf8');
    await pool.query(sql);
}

async function initialize() {
    try {
        await pool.query('SELECT 1');

        if (!(await relationExists('activity_intervals'))) {
            console.log('[DB] Applying canonical activity schema');
            await applySqlFile(
                'migrations/001_activity_intervals.sql'
            );
        }

        await applySqlFile(
            'migrations/002_activity_monitor.sql'
        );

        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_tokens (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_schedules (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                event_time BIGINT NOT NULL,
                remind_time BIGINT NOT NULL
            )
        `);

        console.log('[DB] PostgreSQL initialized');
    } catch (error) {
        console.error('[DB] initialization failed:', error);
        throw error;
    }
}

pool.ready = initialize();

module.exports = pool;
