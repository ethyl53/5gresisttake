#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
    Client
} = require('pg');

const args =
    new Set(
        process.argv.slice(2)
    );

const dryRun =
    args.has('--dry-run');

const applySchema =
    args.has('--apply-schema');

const reportOnly =
    args.has('--report');

const sourceArg =
    [...args].find(
        (arg) =>
            arg.startsWith(
                '--source='
            )
    );

const requestedSource =
    sourceArg
        ? sourceArg.slice(
            '--source='.length
        )
        : null;

const resolveArg =
    [...args].find(
        (arg) =>
            arg.startsWith(
                '--resolve-overlaps='
            )
    );

const resolveOverlaps =
    resolveArg
        ? resolveArg.slice(
            '--resolve-overlaps='.length
        )
        : null;

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

if (
    requestedSource &&
    ![
        'study_intervals',
        'work_sessions'
    ].includes(
        requestedSource
    )
) {
    throw new Error(
        '--source must be study_intervals or work_sessions'
    );
}

if (
    resolveOverlaps &&
    resolveOverlaps !==
        'latest-id'
) {
    throw new Error(
        '--resolve-overlaps only accepts latest-id'
    );
}

if (!guildId) {
    throw new Error(
        'GUILD_ID or --guild-id is required'
    );
}

function categoryFromLegacy(
    row,
    source
) {
    if (
        source ===
        'study_intervals'
    ) {
        return (
            row.subject ||
            null
        );
    }

    return row.color
        ? `legacy-color:${row.color}`
        : null;
}

function taskFromLegacy(
    row
) {
    return (
        row.task_name ||
        null
    );
}

async function tableExists(
    client,
    name
) {
    const result =
        await client.query(
            `
                SELECT to_regclass($1)
                    AS relation
            `,
            [
                `public.${name}`
            ]
        );

    return (
        result.rows[0]
            .relation !==
        null
    );
}

async function main() {
    if (
        !process.env
            .DATABASE_URL
    ) {
        throw new Error(
            'DATABASE_URL is required'
        );
    }

    const client =
        new Client({
            connectionString:
                process.env
                    .DATABASE_URL,
            ssl:
                process.env
                    .NODE_ENV ===
                'production'
                    ? {
                        rejectUnauthorized:
                            false
                    }
                    : false
        });

    await client.connect();

    try {
        if (reportOnly) {
            const report =
                await client.query(
                    `
                        SELECT
                            COUNT(*) FILTER (
                                WHERE is_active
                                  AND guild_id = $1
                            )::int
                                AS active_intervals,
                            COUNT(*) FILTER (
                                WHERE NOT is_active
                                  AND guild_id = $1
                            )::int
                                AS inactive_intervals
                        FROM activity_intervals
                    `,
                    [guildId]
                );

            const issues =
                await client.query(
                    `
                        SELECT
                            reason,
                            COUNT(*)::int
                                AS count
                        FROM legacy_import_issues
                        GROUP BY reason
                        ORDER BY reason
                    `
                );

            console.log(
                JSON.stringify(
                    {
                        guildId,
                        ...report.rows[0],
                        issues:
                            issues.rows
                    },
                    null,
                    2
                )
            );

            return;
        }

        if (applySchema) {
            const sql =
                fs.readFileSync(
                    path.join(
                        __dirname,
                        '..',
                        'migrations',
                        '001_activity_intervals.sql'
                    ),
                    'utf8'
                );

            if (dryRun) {
                console.log(
                    '[dry-run] would apply migrations/001_activity_intervals.sql'
                );
            } else {
                await client.query(
                    sql
                );
            }
        }

        const candidates =
            requestedSource
                ? [
                    requestedSource
                ]
                : [
                    'study_intervals',
                    'work_sessions'
                ];

        const sources = [];

        for (
            const source
            of candidates
        ) {
            if (
                await tableExists(
                    client,
                    source
                )
            ) {
                sources.push(
                    source
                );
            }
        }

        if (
            sources.length === 0
        ) {
            throw new Error(
                'No legacy source table found'
            );
        }

        if (
            sources.length > 1 &&
            !requestedSource
        ) {
            throw new Error(
                'Both legacy tables exist. Re-run with --source=study_intervals or --source=work_sessions to avoid duplicate imports.'
            );
        }

        const source =
            sources[0];

        const columns =
            source ===
            'study_intervals'
                ? (
                    'id, user_id, task_name, subject, ' +
                    'start_time, end_time, status, total_paused_time'
                )
                : (
                    'id, user_id, task_name, color, ' +
                    'start_time, end_time'
                );

        const legacy =
            await client.query(
                `
                    SELECT ${columns}
                    FROM ${source}
                    ORDER BY id
                `
            );

        const targetCount =
            await client.query(
                `
                    SELECT
                        COUNT(*)::int
                            AS count
                    FROM activity_intervals
                    WHERE guild_id = $1
                `,
                [guildId]
            );

        console.log(
            JSON.stringify(
                {
                    guildId,
                    source,
                    legacyRows:
                        legacy.rows.length,
                    existingTargetRows:
                        targetCount.rows[0]
                            .count
                },
                null,
                2
            )
        );

        let imported = 0;
        let skippedOpen = 0;
        let skippedInvalid = 0;
        let needsReconciliation = 0;
        let normalizedOverlaps = 0;

        if (!dryRun) {
            await client.query(
                'BEGIN'
            );

            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [
                    `legacy-import:${guildId}:${source}`
                ]
            );
        }

        for (
            const row
            of legacy.rows
        ) {
            if (
                row.end_time ===
                null
            ) {
                skippedOpen += 1;
                continue;
            }

            const startMs =
                Number(
                    row.start_time
                );

            const endMs =
                Number(
                    row.end_time
                );

            if (
                !Number.isSafeInteger(
                    startMs
                ) ||
                !Number.isSafeInteger(
                    endMs
                ) ||
                endMs <=
                    startMs
            ) {
                skippedInvalid += 1;
                continue;
            }

            if (
                source ===
                'study_intervals' &&
                Number(
                    row.total_paused_time ||
                    0
                ) > 0
            ) {
                needsReconciliation += 1;

                if (!dryRun) {
                    await client.query(
                        `
                            INSERT INTO legacy_import_issues (
                                source_table,
                                source_id,
                                reason,
                                details
                            )
                            VALUES (
                                $1,
                                $2,
                                'pause_positions_unavailable',
                                jsonb_build_object(
                                    'total_paused_time',
                                    $3::bigint
                                )
                            )
                            ON CONFLICT (
                                source_table,
                                source_id,
                                reason
                            )
                            DO NOTHING
                        `,
                        [
                            source,
                            String(
                                row.id
                            ),
                            Number(
                                row.total_paused_time
                            )
                        ]
                    );
                }

                continue;
            }

            const note =
                `legacy:${guildId}:` +
                `${source}:${row.id}`;

            if (dryRun) {
                imported += 1;
                continue;
            }

            const mutation =
                await client.query(
                    `
                        INSERT INTO activity_mutations (
                            mutation_type,
                            actor_user_id,
                            note
                        )
                        SELECT
                            'import',
                            $1,
                            $2
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM activity_mutations
                            WHERE note = $2
                        )
                        RETURNING id
                    `,
                    [
                        row.user_id,
                        note
                    ]
                );

            if (
                mutation.rowCount ===
                0
            ) {
                continue;
            }

            const mutationId =
                mutation.rows[0].id;

            let spans = [
                [
                    startMs,
                    endMs
                ]
            ];

            if (
                source ===
                    'work_sessions' &&
                await tableExists(
                    client,
                    'session_pauses'
                )
            ) {
                const pauses =
                    await client.query(
                        `
                            SELECT
                                pause_start,
                                pause_end
                            FROM session_pauses
                            WHERE session_id = $1
                              AND pause_end IS NOT NULL
                            ORDER BY pause_start
                        `,
                        [row.id]
                    );

                let cursor =
                    startMs;

                spans = [];

                for (
                    const pause
                    of pauses.rows
                ) {
                    const pauseStart =
                        Math.max(
                            startMs,
                            Number(
                                pause.pause_start
                            )
                        );

                    const pauseEnd =
                        Math.min(
                            endMs,
                            Number(
                                pause.pause_end
                            )
                        );

                    if (
                        pauseEnd <=
                            cursor ||
                        pauseEnd <=
                            pauseStart
                    ) {
                        continue;
                    }

                    if (
                        pauseStart >
                        cursor
                    ) {
                        spans.push([
                            cursor,
                            pauseStart
                        ]);
                    }

                    cursor =
                        Math.max(
                            cursor,
                            pauseEnd
                        );
                }

                if (
                    cursor <
                    endMs
                ) {
                    spans.push([
                        cursor,
                        endMs
                    ]);
                }
            }

            for (
                const [
                    spanStart,
                    spanEnd
                ]
                of spans
            ) {
                if (
                    resolveOverlaps
                ) {
                    const overlaps =
                        await client.query(
                            `
                                SELECT
                                    id,
                                    category_key,
                                    task_name,
                                    start_at,
                                    end_at
                                FROM activity_intervals
                                WHERE guild_id = $1
                                  AND user_id = $2
                                  AND is_active = TRUE
                                  AND start_at <
                                      to_timestamp(
                                          $4 / 1000.0
                                      )
                                  AND end_at >
                                      to_timestamp(
                                          $3 / 1000.0
                                      )
                                FOR UPDATE
                            `,
                            [
                                guildId,
                                row.user_id,
                                spanStart,
                                spanEnd
                            ]
                        );

                    if (
                        overlaps.rowCount
                    ) {
                        normalizedOverlaps +=
                            overlaps.rowCount;

                        await client.query(
                            `
                                UPDATE activity_intervals
                                SET
                                    is_active = FALSE,
                                    invalidated_at = NOW(),
                                    invalidated_by_mutation_id = $1
                                WHERE id = ANY($2::uuid[])
                            `,
                            [
                                mutationId,
                                overlaps.rows.map(
                                    (item) =>
                                        item.id
                                )
                            ]
                        );

                        for (
                            const old
                            of overlaps.rows
                        ) {
                            if (
                                new Date(
                                    old.start_at
                                ) <
                                new Date(
                                    spanStart
                                )
                            ) {
                                await client.query(
                                    `
                                        INSERT INTO activity_intervals (
                                            guild_id,
                                            user_id,
                                            category_key,
                                            task_name,
                                            start_at,
                                            end_at,
                                            parent_id,
                                            created_by_mutation_id
                                        )
                                        VALUES (
                                            $1,
                                            $2,
                                            $3,
                                            $4,
                                            $5,
                                            to_timestamp(
                                                $6 / 1000.0
                                            ),
                                            $7,
                                            $8
                                        )
                                    `,
                                    [
                                        guildId,
                                        row.user_id,
                                        old.category_key,
                                        old.task_name,
                                        old.start_at,
                                        spanStart,
                                        old.id,
                                        mutationId
                                    ]
                                );
                            }

                            if (
                                new Date(
                                    old.end_at
                                ) >
                                new Date(
                                    spanEnd
                                )
                            ) {
                                await client.query(
                                    `
                                        INSERT INTO activity_intervals (
                                            guild_id,
                                            user_id,
                                            category_key,
                                            task_name,
                                            start_at,
                                            end_at,
                                            parent_id,
                                            created_by_mutation_id
                                        )
                                        VALUES (
                                            $1,
                                            $2,
                                            $3,
                                            $4,
                                            to_timestamp(
                                                $5 / 1000.0
                                            ),
                                            $6,
                                            $7,
                                            $8
                                        )
                                    `,
                                    [
                                        guildId,
                                        row.user_id,
                                        old.category_key,
                                        old.task_name,
                                        spanEnd,
                                        old.end_at,
                                        old.id,
                                        mutationId
                                    ]
                                );
                            }
                        }
                    }
                }

                await client.query(
                    `
                        INSERT INTO activity_intervals (
                            guild_id,
                            user_id,
                            category_key,
                            task_name,
                            start_at,
                            end_at,
                            created_by_mutation_id
                        )
                        VALUES (
                            $1,
                            $2,
                            $3,
                            $4,
                            to_timestamp(
                                $5 / 1000.0
                            ),
                            to_timestamp(
                                $6 / 1000.0
                            ),
                            $7
                        )
                    `,
                    [
                        guildId,
                        row.user_id,
                        categoryFromLegacy(
                            row,
                            source
                        ),
                        taskFromLegacy(
                            row
                        ),
                        spanStart,
                        spanEnd,
                        mutationId
                    ]
                );
            }

            imported += 1;
        }

        if (!dryRun) {
            await client.query(
                'COMMIT'
            );
        }

        console.log(
            JSON.stringify(
                {
                    guildId,
                    source,
                    dryRun,
                    imported,
                    skippedOpen,
                    skippedInvalid,
                    needsReconciliation,
                    normalizedOverlaps
                },
                null,
                2
            )
        );

        if (skippedOpen) {
            console.log(
                'Open legacy rows were deliberately not imported; stop or reconcile them manually before cutover.'
            );
        }
    } catch (error) {
        if (!dryRun) {
            await client.query(
                'ROLLBACK'
            ).catch(
                () => null
            );
        }

        throw error;
    } finally {
        await client.end();
    }
}

main().catch(
    (error) => {
        console.error(
            '[legacy migration failed]',
            error.message
        );

        if (error.detail) {
            console.error(
                error.detail
            );
        }

        process.exitCode = 1;
    }
);
