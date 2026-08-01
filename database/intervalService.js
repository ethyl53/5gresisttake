'use strict';

const {
    memberGuildIds,
    requireGuildId,
    withRecordScopeTransaction
} = require('./recordScopeService');

function assertRange({ userId, startAt, endAt }) {
    if (
        !userId ||
        !(startAt instanceof Date) ||
        Number.isNaN(startAt.getTime()) ||
        !(endAt instanceof Date) ||
        Number.isNaN(endAt.getTime()) ||
        endAt <= startAt
    ) {
        throw new Error('A user and a non-empty [startAt, endAt) range are required');
    }
}

async function getScopeStatesForUpdate(client, userId, guildIds) {
    const result = await client.query(
        `
            SELECT *
            FROM activity_state
            WHERE user_id = $1
              AND guild_id = ANY($2::text[])
            ORDER BY guild_id ASC
            FOR UPDATE
        `,
        [userId, guildIds]
    );

    const active = result.rows.filter((row) => row.active_interval_id);
    const paused = result.rows.filter((row) => row.paused_at);

    if (active.length > 1 || paused.length > 1 || (active.length && paused.length)) {
        throw new Error('Record scope has inconsistent active activity states');
    }

    return {
        active: active[0] || null,
        paused: paused[0] || null
    };
}

async function ensureStateForUpdate(client, guildId, userId) {
    await client.query(
        `
            INSERT INTO activity_state (guild_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (guild_id, user_id) DO NOTHING
        `,
        [guildId, userId]
    );

    const result = await client.query(
        `
            SELECT *
            FROM activity_state
            WHERE guild_id = $1 AND user_id = $2
            FOR UPDATE
        `,
        [guildId, userId]
    );

    return result.rows[0];
}

async function clearMonitorForScope(client, userId, guildIds) {
    await client.query(
        `
            DELETE FROM activity_monitor_state
            WHERE user_id = $1
              AND guild_id = ANY($2::text[])
        `,
        [userId, guildIds]
    );
}

async function resetMonitorForOpenInterval(client, {
    guildId,
    userId,
    intervalId,
    confirmedAt
}) {
    await client.query(
        `
            INSERT INTO activity_monitor_state (
                active_interval_id, guild_id, user_id, last_confirmed_at,
                confirmation_sent_at, confirmation_deadline, updated_at
            )
            VALUES ($1, $2, $3, $4, NULL, NULL, NOW())
            ON CONFLICT (guild_id, user_id) DO UPDATE SET
                active_interval_id = EXCLUDED.active_interval_id,
                last_confirmed_at = EXCLUDED.last_confirmed_at,
                confirmation_sent_at = NULL,
                confirmation_deadline = NULL,
                updated_at = NOW()
        `,
        [intervalId, guildId, userId, confirmedAt]
    );
}

async function setStateIdle(client, state) {
    await client.query(
        `
            UPDATE activity_state
            SET active_interval_id = NULL,
                paused_category_key = NULL,
                paused_task_name = NULL,
                paused_at = NULL,
                updated_at = NOW()
            WHERE guild_id = $1 AND user_id = $2
        `,
        [state.guild_id, state.user_id]
    );
}

async function activateState(client, guildId, userId, intervalId) {
    await ensureStateForUpdate(client, guildId, userId);
    await client.query(
        `
            UPDATE activity_state
            SET active_interval_id = $1,
                paused_category_key = NULL,
                paused_task_name = NULL,
                paused_at = NULL,
                updated_at = NOW()
            WHERE guild_id = $2 AND user_id = $3
        `,
        [intervalId, guildId, userId]
    );
}

async function closeOpenInterval(client, state, now) {
    const result = await client.query(
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
        [now, state.active_interval_id, state.guild_id, state.user_id]
    );

    if (result.rowCount === 0) {
        throw new Error('Active interval was not found');
    }

    return result.rows[0];
}

async function createOpenInterval(client, guildId, userId, categoryKey, taskName, now) {
    const mutation = await client.query(
        `
            INSERT INTO activity_mutations (guild_id, mutation_type, actor_user_id, note)
            VALUES ($1, 'create', $2, 'start')
            RETURNING id
        `,
        [guildId, userId]
    );
    const inserted = await client.query(
        `
            INSERT INTO activity_intervals (
                guild_id, user_id, category_key, task_name, start_at,
                created_by_mutation_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `,
        [guildId, userId, categoryKey, taskName, now, mutation.rows[0].id]
    );

    return inserted.rows[0];
}

async function replaceRange(db, {
    guildId,
    userId,
    startAt,
    endAt,
    categoryKey = null,
    taskName = null,
    deleteOnly = false,
    actorUserId = userId,
    note = null
}) {
    assertRange({ userId, startAt, endAt });
    const sourceGuildId = requireGuildId(guildId);

    if (!deleteOnly && !categoryKey && !taskName) {
        throw new Error('An edited interval requires a category or task name');
    }

    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const live = await client.query(
                `
                    SELECT id
                    FROM activity_intervals
                    WHERE user_id = $1
                      AND guild_id = ANY($2::text[])
                      AND is_active = TRUE
                      AND end_at IS NULL
                      AND start_at < $3
                    FOR UPDATE
                `,
                [userId, guildIds, endAt]
            );

            if (live.rowCount > 0) {
                throw new Error('Cannot edit a range that overlaps a running activity; stop it first.');
            }

            const mutation = await client.query(
                `
                    INSERT INTO activity_mutations (guild_id, mutation_type, actor_user_id, note)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id
                `,
                [sourceGuildId, deleteOnly ? 'delete' : 'edit', actorUserId, note]
            );
            const mutationId = mutation.rows[0].id;
            const affected = await client.query(
                `
                    SELECT id, guild_id, user_id, category_key, task_name, start_at, end_at
                    FROM activity_intervals
                    WHERE user_id = $1
                      AND guild_id = ANY($2::text[])
                      AND is_active = TRUE
                      AND end_at IS NOT NULL
                      AND start_at < $4
                      AND end_at > $3
                    ORDER BY start_at ASC
                    FOR UPDATE
                `,
                [userId, guildIds, startAt, endAt]
            );

            if (affected.rowCount) {
                await client.query(
                    `
                        UPDATE activity_intervals
                        SET is_active = FALSE,
                            invalidated_at = NOW(),
                            invalidated_by_mutation_id = $1
                        WHERE id = ANY($2::uuid[])
                    `,
                    [mutationId, affected.rows.map((row) => row.id)]
                );
            }

            const insertInterval = async (interval, parentId = null, originGuildId = sourceGuildId) => {
                const inserted = await client.query(
                    `
                        INSERT INTO activity_intervals (
                            guild_id, user_id, category_key, task_name, start_at, end_at,
                            parent_id, created_by_mutation_id
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        RETURNING *
                    `,
                    [
                        originGuildId, userId, interval.categoryKey, interval.taskName,
                        interval.startAt, interval.endAt, parentId, mutationId
                    ]
                );
                return inserted.rows[0];
            };

            for (const row of affected.rows) {
                if (new Date(row.start_at) < startAt) {
                    await insertInterval({
                        categoryKey: row.category_key,
                        taskName: row.task_name,
                        startAt: new Date(row.start_at),
                        endAt: startAt
                    }, row.id, row.guild_id);
                }
                if (new Date(row.end_at) > endAt) {
                    await insertInterval({
                        categoryKey: row.category_key,
                        taskName: row.task_name,
                        startAt: endAt,
                        endAt: new Date(row.end_at)
                    }, row.id, row.guild_id);
                }
            }

            const replacement = deleteOnly
                ? null
                : await insertInterval({ categoryKey, taskName, startAt, endAt });

            return { mutationId, replaced: affected.rowCount, replacement };
        }
    );
}

async function startActivity(db, {
    guildId,
    userId,
    categoryKey = null,
    taskName = null,
    now = new Date()
}) {
    const sourceGuildId = requireGuildId(guildId);

    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const states = await getScopeStatesForUpdate(client, userId, guildIds);

            if (states.active) {
                if (!categoryKey && !taskName) {
                    return { kind: 'already_running', sourceGuildId: states.active.guild_id };
                }

                const previous = await closeOpenInterval(client, states.active, now);
                await clearMonitorForScope(client, userId, guildIds);
                await setStateIdle(client, states.active);
                const next = await createOpenInterval(
                    client,
                    sourceGuildId,
                    userId,
                    categoryKey ?? previous.category_key,
                    taskName ?? previous.task_name,
                    now
                );
                await activateState(client, sourceGuildId, userId, next.id);
                await resetMonitorForOpenInterval(client, {
                    guildId: sourceGuildId,
                    userId,
                    intervalId: next.id,
                    confirmedAt: now
                });
                return { kind: 'switched', previous, current: next };
            }

            const hasExplicitInput = categoryKey !== null || taskName !== null;
            const resumeCategory = states.paused
                ? (hasExplicitInput ? categoryKey ?? states.paused.paused_category_key : states.paused.paused_category_key)
                : categoryKey;
            const resumeTask = states.paused
                ? (hasExplicitInput ? taskName ?? states.paused.paused_task_name : states.paused.paused_task_name)
                : taskName;

            if (states.paused && !resumeCategory && !resumeTask) {
                return { kind: 'paused_data_missing' };
            }

            if (states.paused) {
                await setStateIdle(client, states.paused);
            }
            await clearMonitorForScope(client, userId, guildIds);
            const current = await createOpenInterval(
                client, sourceGuildId, userId, resumeCategory, resumeTask, now
            );
            await activateState(client, sourceGuildId, userId, current.id);
            await resetMonitorForOpenInterval(client, {
                guildId: sourceGuildId,
                userId,
                intervalId: current.id,
                confirmedAt: now
            });
            return { kind: states.paused ? 'resumed' : 'started', current };
        }
    );
}

async function pauseActivity(db, { guildId, userId, now = new Date() }) {
    const sourceGuildId = requireGuildId(guildId);
    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const states = await getScopeStatesForUpdate(client, userId, guildIds);

            if (!states.active) {
                return { kind: states.paused ? 'already_paused' : 'none' };
            }

            const interval = await closeOpenInterval(client, states.active, now);
            await clearMonitorForScope(client, userId, guildIds);
            await client.query(
                `
                    UPDATE activity_state
                    SET active_interval_id = NULL,
                        paused_category_key = $1,
                        paused_task_name = $2,
                        paused_at = $3,
                        updated_at = NOW()
                    WHERE guild_id = $4 AND user_id = $5
                `,
                [
                    interval.category_key, interval.task_name, now,
                    states.active.guild_id, userId
                ]
            );
            return { kind: 'paused', interval };
        }
    );
}

async function stopActivity(db, {
    guildId,
    userId,
    now = new Date(),
    expectedIntervalId = null,
    restrictOriginGuildId = null
}) {
    const requestedGuildId = requireGuildId(guildId);
    return withRecordScopeTransaction(
        db,
        { guildId: requestedGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const states = await getScopeStatesForUpdate(client, userId, guildIds);
            const state = states.active || states.paused;

            if (expectedIntervalId && String(states.active?.active_interval_id || '') !== String(expectedIntervalId)) {
                return { kind: 'stale' };
            }
            if (state && restrictOriginGuildId && state.guild_id !== restrictOriginGuildId) {
                return { kind: 'foreign_scope_activity', sourceGuildId: state.guild_id };
            }
            if (!state) {
                return { kind: 'none' };
            }

            const interval = states.active
                ? await closeOpenInterval(client, states.active, now)
                : null;
            await clearMonitorForScope(client, userId, guildIds);
            await setStateIdle(client, state);
            return {
                kind: interval ? 'stopped' : 'stopped_paused',
                interval
            };
        }
    );
}

async function replaceIntervalById(db, {
    guildId,
    userId,
    intervalId,
    startAt,
    endAt,
    categoryKey,
    taskName = null,
    actorUserId = userId,
    note = null
}) {
    assertRange({ userId, startAt, endAt });
    if (!intervalId || !categoryKey) {
        throw new Error('Invalid interval update');
    }
    const sourceGuildId = requireGuildId(guildId);

    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const targetResult = await client.query(
                `
                    SELECT * FROM activity_intervals
                    WHERE id = $1 AND user_id = $2 AND guild_id = ANY($3::text[])
                      AND is_active = TRUE AND end_at IS NOT NULL
                    FOR UPDATE
                `,
                [intervalId, userId, guildIds]
            );
            if (!targetResult.rowCount) {
                const error = new Error('The interval no longer exists or has already been changed.');
                error.code = 'STALE_INTERVAL';
                throw error;
            }
            const overlap = await client.query(
                `
                    SELECT id FROM activity_intervals
                    WHERE user_id = $1 AND guild_id = ANY($2::text[])
                      AND is_active = TRUE AND id <> $3
                      AND start_at < $5
                      AND COALESCE(end_at, 'infinity'::timestamptz) > $4
                    LIMIT 1 FOR UPDATE
                `,
                [userId, guildIds, intervalId, startAt, endAt]
            );
            if (overlap.rowCount) {
                const error = new Error('The edited time overlaps another activity interval.');
                error.code = 'INTERVAL_OVERLAP';
                throw error;
            }
            const mutation = await client.query(
                `INSERT INTO activity_mutations (guild_id, mutation_type, actor_user_id, note)
                 VALUES ($1, 'edit', $2, $3) RETURNING id`,
                [sourceGuildId, actorUserId, note]
            );
            const target = targetResult.rows[0];
            await client.query(
                `UPDATE activity_intervals SET is_active = FALSE, invalidated_at = NOW(),
                 invalidated_by_mutation_id = $1 WHERE id = $2`,
                [mutation.rows[0].id, intervalId]
            );
            const inserted = await client.query(
                `
                    INSERT INTO activity_intervals (
                        guild_id, user_id, category_key, task_name, start_at, end_at,
                        parent_id, created_by_mutation_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
                `,
                [
                    target.guild_id, userId, categoryKey, taskName, startAt, endAt,
                    target.id, mutation.rows[0].id
                ]
            );
            return { mutationId: mutation.rows[0].id, previous: target, current: inserted.rows[0] };
        }
    );
}

async function deleteIntervalById(db, {
    guildId,
    userId,
    intervalId,
    actorUserId = userId,
    note = null
}) {
    if (!userId || !intervalId) {
        throw new Error('Invalid interval deletion');
    }
    const sourceGuildId = requireGuildId(guildId);
    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const target = await client.query(
                `
                    SELECT * FROM activity_intervals
                    WHERE id = $1 AND user_id = $2 AND guild_id = ANY($3::text[])
                      AND is_active = TRUE AND end_at IS NOT NULL
                    FOR UPDATE
                `,
                [intervalId, userId, memberGuildIds(members)]
            );
            if (!target.rowCount) {
                const error = new Error('The interval no longer exists or has already been changed.');
                error.code = 'STALE_INTERVAL';
                throw error;
            }
            const mutation = await client.query(
                `INSERT INTO activity_mutations (guild_id, mutation_type, actor_user_id, note)
                 VALUES ($1, 'delete', $2, $3) RETURNING id`,
                [sourceGuildId, actorUserId, note]
            );
            await client.query(
                `UPDATE activity_intervals SET is_active = FALSE, invalidated_at = NOW(),
                 invalidated_by_mutation_id = $1 WHERE id = $2`,
                [mutation.rows[0].id, intervalId]
            );
            return { mutationId: mutation.rows[0].id, deleted: target.rows[0] };
        }
    );
}

module.exports = {
    deleteIntervalById,
    pauseActivity,
    replaceIntervalById,
    replaceRange,
    startActivity,
    stopActivity
};
