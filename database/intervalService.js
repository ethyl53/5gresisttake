'use strict';

async function replaceRange(db, {
    guildId = '',
    userId,
    startAt,
    endAt,
    categoryKey = null,
    taskName = null,
    deleteOnly = false,
    actorUserId = userId,
    note = null
}) {
    if (
        !userId ||
        !(startAt instanceof Date) ||
        Number.isNaN(startAt.getTime()) ||
        !(endAt instanceof Date) ||
        Number.isNaN(endAt.getTime()) ||
        endAt <= startAt
    ) {
        throw new Error(
            'A user and a non-empty [startAt, endAt) range are required'
        );
    }

    if (!deleteOnly && !categoryKey && !taskName) {
        throw new Error(
            'An edited interval requires a category or task name'
        );
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`${guildId}:${userId}`]
        );

        const live = await client.query(
            `
                SELECT id
                FROM activity_intervals
                WHERE guild_id = $1
                  AND user_id = $2
                  AND is_active = TRUE
                  AND end_at IS NULL
                  AND start_at < $3
                FOR UPDATE
            `,
            [guildId, userId, endAt]
        );

        if (live.rowCount > 0) {
            throw new Error(
                'Cannot edit a range that overlaps a running activity; stop it first.'
            );
        }

        const mutation = await client.query(
            `
                INSERT INTO activity_mutations (
                    mutation_type,
                    actor_user_id,
                    note
                )
                VALUES ($1, $2, $3)
                RETURNING id
            `,
            [
                deleteOnly ? 'delete' : 'edit',
                actorUserId,
                note
            ]
        );

        const mutationId = mutation.rows[0].id;

        const affected = await client.query(
            `
                SELECT
                    id,
                    guild_id,
                    user_id,
                    category_key,
                    task_name,
                    start_at,
                    end_at
                FROM activity_intervals
                WHERE guild_id = $1
                  AND user_id = $2
                  AND is_active = TRUE
                  AND end_at IS NOT NULL
                  AND start_at < $4
                  AND end_at > $3
                ORDER BY start_at ASC
                FOR UPDATE
            `,
            [guildId, userId, startAt, endAt]
        );

        if (affected.rowCount > 0) {
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
                    affected.rows.map((row) => row.id)
                ]
            );
        }

        const insertInterval = async (
            interval,
            parentId = null
        ) => {
            const inserted = await client.query(
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
                        $6,
                        $7,
                        $8
                    )
                    RETURNING *
                `,
                [
                    guildId,
                    userId,
                    interval.categoryKey,
                    interval.taskName,
                    interval.startAt,
                    interval.endAt,
                    parentId,
                    mutationId
                ]
            );

            return inserted.rows[0];
        };

        for (const row of affected.rows) {
            if (new Date(row.start_at) < startAt) {
                await insertInterval(
                    {
                        categoryKey: row.category_key,
                        taskName: row.task_name,
                        startAt: new Date(row.start_at),
                        endAt: startAt
                    },
                    row.id
                );
            }

            if (new Date(row.end_at) > endAt) {
                await insertInterval(
                    {
                        categoryKey: row.category_key,
                        taskName: row.task_name,
                        startAt: endAt,
                        endAt: new Date(row.end_at)
                    },
                    row.id
                );
            }
        }

        let replacement = null;

        if (!deleteOnly) {
            replacement = await insertInterval({
                categoryKey,
                taskName,
                startAt,
                endAt
            });
        }

        await client.query('COMMIT');

        return {
            mutationId,
            replaced: affected.rowCount,
            replacement
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function withUserLock(
    db,
    guildId,
    userId,
    operation
) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`${guildId}:${userId}`]
        );

        const result = await operation(client);

        await client.query('COMMIT');

        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function getStateForUpdate(
    client,
    guildId,
    userId
) {
    await client.query(
        `
            INSERT INTO activity_state (
                guild_id,
                user_id
            )
            VALUES ($1, $2)
            ON CONFLICT (guild_id, user_id)
            DO NOTHING
        `,
        [guildId, userId]
    );

    const result = await client.query(
        `
            SELECT *
            FROM activity_state
            WHERE guild_id = $1
              AND user_id = $2
            FOR UPDATE
        `,
        [guildId, userId]
    );

    return result.rows[0];
}

async function resetMonitorForOpenInterval(
    client,
    {
        guildId,
        userId,
        intervalId,
        confirmedAt
    }
) {
    await client.query(
        `
            INSERT INTO activity_monitor_state (
                active_interval_id,
                guild_id,
                user_id,
                last_confirmed_at,
                confirmation_sent_at,
                confirmation_deadline,
                updated_at
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                NULL,
                NULL,
                NOW()
            )
            ON CONFLICT (guild_id, user_id)
            DO UPDATE SET
                active_interval_id = EXCLUDED.active_interval_id,
                last_confirmed_at = EXCLUDED.last_confirmed_at,
                confirmation_sent_at = NULL,
                confirmation_deadline = NULL,
                updated_at = NOW()
        `,
        [
            intervalId,
            guildId,
            userId,
            confirmedAt
        ]
    );
}

async function clearMonitorForUser(
    client,
    guildId,
    userId
) {
    await client.query(
        `
            DELETE FROM activity_monitor_state
            WHERE guild_id = $1
              AND user_id = $2
        `,
        [guildId, userId]
    );
}

async function createOpenInterval(
    client,
    guildId,
    userId,
    categoryKey,
    taskName,
    now
) {
    const mutation = await client.query(
        `
            INSERT INTO activity_mutations (
                mutation_type,
                actor_user_id,
                note
            )
            VALUES (
                'create',
                $1,
                'start'
            )
            RETURNING id
        `,
        [userId]
    );

    const inserted = await client.query(
        `
            INSERT INTO activity_intervals (
                guild_id,
                user_id,
                category_key,
                task_name,
                start_at,
                created_by_mutation_id
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
            )
            RETURNING *
        `,
        [
            guildId,
            userId,
            categoryKey,
            taskName,
            now,
            mutation.rows[0].id
        ]
    );

    const interval = inserted.rows[0];

    await resetMonitorForOpenInterval(
        client,
        {
            guildId,
            userId,
            intervalId: interval.id,
            confirmedAt: now
        }
    );

    return interval;
}

async function startActivity(db, {
    guildId = '',
    userId,
    categoryKey = null,
    taskName = null,
    now = new Date()
}) {
    return withUserLock(
        db,
        guildId,
        userId,
        async (client) => {
            const state = await getStateForUpdate(
                client,
                guildId,
                userId
            );

            if (state.active_interval_id) {
                if (!categoryKey && !taskName) {
                    return {
                        kind: 'already_running'
                    };
                }

                const closed = await client.query(
                    `
                        UPDATE activity_intervals
                        SET end_at = $1
                        WHERE id = $2
                          AND guild_id = $3
                          AND user_id = $4
                          AND is_active = TRUE
                          AND end_at IS NULL
                        RETURNING *
                    `,
                    [
                        now,
                        state.active_interval_id,
                        guildId,
                        userId
                    ]
                );

                if (closed.rowCount === 0) {
                    throw new Error(
                        'Active interval was not found'
                    );
                }

                const previous = closed.rows[0];

                const nextCategory =
                    categoryKey ??
                    previous.category_key;

                const nextTask =
                    taskName ??
                    previous.task_name;

                const next = await createOpenInterval(
                    client,
                    guildId,
                    userId,
                    nextCategory,
                    nextTask,
                    now
                );

                await client.query(
                    `
                        UPDATE activity_state
                        SET
                            active_interval_id = $1,
                            paused_category_key = NULL,
                            paused_task_name = NULL,
                            paused_at = NULL,
                            updated_at = NOW()
                        WHERE guild_id = $2
                          AND user_id = $3
                    `,
                    [
                        next.id,
                        guildId,
                        userId
                    ]
                );

                return {
                    kind: 'switched',
                    previous,
                    current: next
                };
            }

            const hasExplicitInput =
                categoryKey !== null ||
                taskName !== null;

            const resumeCategory =
                hasExplicitInput
                    ? (
                        categoryKey ??
                        state.paused_category_key
                    )
                    : state.paused_category_key;

            const resumeTask =
                hasExplicitInput
                    ? (
                        taskName ??
                        state.paused_task_name
                    )
                    : state.paused_task_name;

            if (
                state.paused_at &&
                !resumeCategory &&
                !resumeTask
            ) {
                return {
                    kind: 'paused_data_missing'
                };
            }

            const current = await createOpenInterval(
                client,
                guildId,
                userId,
                resumeCategory,
                resumeTask,
                now
            );

            await client.query(
                `
                    UPDATE activity_state
                    SET
                        active_interval_id = $1,
                        paused_category_key = NULL,
                        paused_task_name = NULL,
                        paused_at = NULL,
                        updated_at = NOW()
                    WHERE guild_id = $2
                      AND user_id = $3
                `,
                [
                    current.id,
                    guildId,
                    userId
                ]
            );

            return {
                kind: state.paused_at
                    ? 'resumed'
                    : 'started',
                current
            };
        }
    );
}

async function pauseActivity(db, {
    guildId = '',
    userId,
    now = new Date()
}) {
    return withUserLock(
        db,
        guildId,
        userId,
        async (client) => {
            const state = await getStateForUpdate(
                client,
                guildId,
                userId
            );

            if (!state.active_interval_id) {
                return {
                    kind: state.paused_at
                        ? 'already_paused'
                        : 'none'
                };
            }

            const closed = await client.query(
                `
                    UPDATE activity_intervals
                    SET end_at = $1
                    WHERE id = $2
                      AND guild_id = $3
                      AND user_id = $4
                      AND is_active = TRUE
                      AND end_at IS NULL
                    RETURNING *
                `,
                [
                    now,
                    state.active_interval_id,
                    guildId,
                    userId
                ]
            );

            if (closed.rowCount === 0) {
                throw new Error(
                    'Active interval was not found'
                );
            }

            const interval = closed.rows[0];

            await clearMonitorForUser(
                client,
                guildId,
                userId
            );

            await client.query(
                `
                    UPDATE activity_state
                    SET
                        active_interval_id = NULL,
                        paused_category_key = $1,
                        paused_task_name = $2,
                        paused_at = $3,
                        updated_at = NOW()
                    WHERE guild_id = $4
                      AND user_id = $5
                `,
                [
                    interval.category_key,
                    interval.task_name,
                    now,
                    guildId,
                    userId
                ]
            );

            return {
                kind: 'paused',
                interval
            };
        }
    );
}

async function stopActivity(db, {
    guildId = '',
    userId,
    now = new Date(),
    expectedIntervalId = null
}) {
    return withUserLock(
        db,
        guildId,
        userId,
        async (client) => {
            const state = await getStateForUpdate(
                client,
                guildId,
                userId
            );

            if (
                expectedIntervalId &&
                String(state.active_interval_id || '') !==
                    String(expectedIntervalId)
            ) {
                return {
                    kind: 'stale'
                };
            }

            let interval = null;

            if (state.active_interval_id) {
                const closed = await client.query(
                    `
                        UPDATE activity_intervals
                        SET end_at = $1
                        WHERE id = $2
                          AND guild_id = $3
                          AND user_id = $4
                          AND is_active = TRUE
                          AND end_at IS NULL
                        RETURNING *
                    `,
                    [
                        now,
                        state.active_interval_id,
                        guildId,
                        userId
                    ]
                );

                interval =
                    closed.rows[0] || null;
            }

            await clearMonitorForUser(
                client,
                guildId,
                userId
            );

            await client.query(
                `
                    UPDATE activity_state
                    SET
                        active_interval_id = NULL,
                        paused_category_key = NULL,
                        paused_task_name = NULL,
                        paused_at = NULL,
                        updated_at = NOW()
                    WHERE guild_id = $1
                      AND user_id = $2
                `,
                [guildId, userId]
            );

            return {
                kind: interval
                    ? 'stopped'
                    : (
                        state.paused_at
                            ? 'stopped_paused'
                            : 'none'
                    ),
                interval
            };
        }
    );
}

async function replaceIntervalById(db, {
    guildId = '',
    userId,
    intervalId,
    startAt,
    endAt,
    categoryKey,
    taskName = null,
    actorUserId = userId,
    note = null
}) {
    if (
        !userId ||
        !intervalId ||
        !(startAt instanceof Date) ||
        Number.isNaN(startAt.getTime()) ||
        !(endAt instanceof Date) ||
        Number.isNaN(endAt.getTime()) ||
        endAt <= startAt ||
        !categoryKey
    ) {
        throw new Error('Invalid interval update');
    }

    return withUserLock(
        db,
        guildId,
        userId,
        async (client) => {
            const targetResult = await client.query(
                `
                    SELECT *
                    FROM activity_intervals
                    WHERE id = $1
                      AND guild_id = $2
                      AND user_id = $3
                      AND is_active = TRUE
                      AND end_at IS NOT NULL
                    FOR UPDATE
                `,
                [intervalId, guildId, userId]
            );

            if (targetResult.rowCount === 0) {
                const error = new Error(
                    'The interval no longer exists or has already been changed.'
                );
                error.code = 'STALE_INTERVAL';
                throw error;
            }

            const overlapResult = await client.query(
                `
                    SELECT id
                    FROM activity_intervals
                    WHERE guild_id = $1
                      AND user_id = $2
                      AND is_active = TRUE
                      AND id <> $3
                      AND start_at < $5
                      AND COALESCE(end_at, 'infinity'::timestamptz) > $4
                    LIMIT 1
                    FOR UPDATE
                `,
                [guildId, userId, intervalId, startAt, endAt]
            );

            if (overlapResult.rowCount > 0) {
                const error = new Error(
                    'The edited time overlaps another activity interval.'
                );
                error.code = 'INTERVAL_OVERLAP';
                throw error;
            }

            const mutation = await client.query(
                `
                    INSERT INTO activity_mutations (
                        mutation_type,
                        actor_user_id,
                        note
                    )
                    VALUES ('edit', $1, $2)
                    RETURNING id
                `,
                [actorUserId, note]
            );

            const mutationId = mutation.rows[0].id;
            const target = targetResult.rows[0];

            await client.query(
                `
                    UPDATE activity_intervals
                    SET
                        is_active = FALSE,
                        invalidated_at = NOW(),
                        invalidated_by_mutation_id = $1
                    WHERE id = $2
                `,
                [mutationId, intervalId]
            );

            const inserted = await client.query(
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
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *
                `,
                [
                    guildId,
                    userId,
                    categoryKey,
                    taskName,
                    startAt,
                    endAt,
                    target.id,
                    mutationId
                ]
            );

            return {
                mutationId,
                previous: target,
                current: inserted.rows[0]
            };
        }
    );
}

async function deleteIntervalById(db, {
    guildId = '',
    userId,
    intervalId,
    actorUserId = userId,
    note = null
}) {
    if (!userId || !intervalId) {
        throw new Error('Invalid interval deletion');
    }

    return withUserLock(
        db,
        guildId,
        userId,
        async (client) => {
            const targetResult = await client.query(
                `
                    SELECT *
                    FROM activity_intervals
                    WHERE id = $1
                      AND guild_id = $2
                      AND user_id = $3
                      AND is_active = TRUE
                      AND end_at IS NOT NULL
                    FOR UPDATE
                `,
                [intervalId, guildId, userId]
            );

            if (targetResult.rowCount === 0) {
                const error = new Error(
                    'The interval no longer exists or has already been changed.'
                );
                error.code = 'STALE_INTERVAL';
                throw error;
            }

            const mutation = await client.query(
                `
                    INSERT INTO activity_mutations (
                        mutation_type,
                        actor_user_id,
                        note
                    )
                    VALUES ('delete', $1, $2)
                    RETURNING id
                `,
                [actorUserId, note]
            );

            const mutationId = mutation.rows[0].id;
            const target = targetResult.rows[0];

            await client.query(
                `
                    UPDATE activity_intervals
                    SET
                        is_active = FALSE,
                        invalidated_at = NOW(),
                        invalidated_by_mutation_id = $1
                    WHERE id = $2
                `,
                [mutationId, intervalId]
            );

            return {
                mutationId,
                deleted: target
            };
        }
    );
}

module.exports = {
    replaceRange,
    replaceIntervalById,
    deleteIntervalById,
    startActivity,
    pauseActivity,
    stopActivity
};
