'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const {
    connectionOptions
} = require('../database/connectionOptions');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
}

const pool = new Pool({
    ...connectionOptions(
        process.env.DATABASE_URL,
        { rejectUnauthorized: false }
    ),
    connectionTimeoutMillis: 15_000
});

(async () => {
    try {
        const result = await pool.query(`
            SELECT
                to_regclass('public.activity_intervals') AS activity_intervals,
                to_regclass('public.activity_state') AS activity_state,
                to_regclass('public.activity_monitor_state') AS activity_monitor_state,
                to_regclass('public.guild_settings') AS guild_settings,
                to_regclass('public.web_users') AS web_users,
                to_regclass('public.web_command_receipts') AS web_command_receipts,
                to_regclass('public.record_scopes') AS record_scopes,
                to_regclass('public.record_scope_members') AS record_scope_members,
                to_regclass('public.record_scope_link_codes') AS record_scope_link_codes,
                to_regclass('public.planned_intervals') AS planned_intervals,
                to_regclass('public.planned_mutations') AS planned_mutations
        `);
        console.log(JSON.stringify(result.rows[0], null, 2));
    } finally {
        await pool.end();
    }
})().catch((error) => {
    console.error('[Schema Check Error]', error.message);
    process.exitCode = 1;
});
