#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
    Client
} = require('pg');

const args =
    new Set(
        process.argv.slice(2)
    );

const apply =
    args.has('--apply');

const guildArg =
    [...args].find(
        (arg) =>
            arg.startsWith(
                '--guild-id='
            )
    );

const guildId =
    guildArg
        ? guildArg.slice(
            '--guild-id='.length
        )
        : process.env.GUILD_ID;

if (!process.env.DATABASE_URL) {
    throw new Error(
        'DATABASE_URL is required'
    );
}

if (!guildId) {
    throw new Error(
        'GUILD_ID or --guild-id is required'
    );
}

async function main() {
    const client =
        new Client({
            connectionString:
                process.env.DATABASE_URL,
            ssl:
                process.env.NODE_ENV ===
                'production'
                    ? {
                        rejectUnauthorized:
                            false
                    }
                    : false
        });

    await client.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [
                `assign-legacy-guild:${guildId}`
            ]
        );

        const counts =
            await client.query(
                `
                    SELECT
                        (
                            SELECT COUNT(*)::int
                            FROM activity_intervals
                            WHERE guild_id = ''
                        ) AS interval_count,
                        (
                            SELECT COUNT(*)::int
                            FROM activity_state
                            WHERE guild_id = ''
                        ) AS state_count,
                        (
                            SELECT COUNT(*)::int
                            FROM activity_monitor_state
                            WHERE guild_id = ''
                        ) AS monitor_count
                `
            );

        const overlapConflicts =
            await client.query(
                `
                    SELECT
                        global_row.id
                            AS global_interval_id,
                        target_row.id
                            AS target_interval_id,
                        global_row.user_id,
                        global_row.start_at
                            AS global_start,
                        global_row.end_at
                            AS global_end,
                        target_row.start_at
                            AS target_start,
                        target_row.end_at
                            AS target_end
                    FROM activity_intervals
                        AS global_row
                    INNER JOIN activity_intervals
                        AS target_row
                        ON target_row.guild_id = $1
                       AND target_row.user_id =
                            global_row.user_id
                       AND target_row.is_active = TRUE
                       AND global_row.is_active = TRUE
                       AND tstzrange(
                            target_row.start_at,
                            COALESCE(
                                target_row.end_at,
                                'infinity'::timestamptz
                            ),
                            '[)'
                       ) &&
                       tstzrange(
                            global_row.start_at,
                            COALESCE(
                                global_row.end_at,
                                'infinity'::timestamptz
                            ),
                            '[)'
                       )
                    WHERE global_row.guild_id = ''
                    ORDER BY
                        global_row.user_id,
                        global_row.start_at
                    LIMIT 100
                `,
                [guildId]
            );

        const stateConflicts =
            await client.query(
                `
                    SELECT
                        global_state.user_id
                    FROM activity_state
                        AS global_state
                    INNER JOIN activity_state
                        AS target_state
                        ON target_state.guild_id = $1
                       AND target_state.user_id =
                            global_state.user_id
                    WHERE global_state.guild_id = ''
                    LIMIT 100
                `,
                [guildId]
            );

        const monitorConflicts =
            await client.query(
                `
                    SELECT
                        global_monitor.user_id
                    FROM activity_monitor_state
                        AS global_monitor
                    INNER JOIN activity_monitor_state
                        AS target_monitor
                        ON target_monitor.guild_id = $1
                       AND target_monitor.user_id =
                            global_monitor.user_id
                    WHERE global_monitor.guild_id = ''
                    LIMIT 100
                `,
                [guildId]
            );

        const report = {
            mode:
                apply
                    ? 'apply'
                    : 'dry-run',
            guildId,
            ...counts.rows[0],
            overlapConflicts:
                overlapConflicts.rows,
            stateConflicts:
                stateConflicts.rows,
            monitorConflicts:
                monitorConflicts.rows
        };

        console.log(
            JSON.stringify(
                report,
                null,
                2
            )
        );

        if (
            overlapConflicts.rowCount > 0 ||
            stateConflicts.rowCount > 0 ||
            monitorConflicts.rowCount > 0
        ) {
            throw new Error(
                'Conflicts were found. No rows were changed.'
            );
        }

        if (!apply) {
            await client.query('ROLLBACK');

            console.log(
                'Dry-run complete. Re-run with --apply after reviewing the report.'
            );

            return;
        }

        const intervalUpdate =
            await client.query(
                `
                    UPDATE activity_intervals
                    SET guild_id = $1
                    WHERE guild_id = ''
                `,
                [guildId]
            );

        const stateUpdate =
            await client.query(
                `
                    UPDATE activity_state
                    SET guild_id = $1
                    WHERE guild_id = ''
                `,
                [guildId]
            );

        const monitorUpdate =
            await client.query(
                `
                    UPDATE activity_monitor_state
                    SET guild_id = $1
                    WHERE guild_id = ''
                `,
                [guildId]
            );

        await client.query('COMMIT');

        console.log(
            JSON.stringify(
                {
                    applied: true,
                    guildId,
                    intervalsUpdated:
                        intervalUpdate.rowCount,
                    statesUpdated:
                        stateUpdate.rowCount,
                    monitorsUpdated:
                        monitorUpdate.rowCount
                },
                null,
                2
            )
        );
    } catch (error) {
        await client.query(
            'ROLLBACK'
        ).catch(() => null);

        throw error;
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(
        '[assign legacy guild failed]',
        error.message
    );

    process.exitCode = 1;
});
