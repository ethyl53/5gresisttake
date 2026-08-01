'use strict';

const {
    memberGuildIds,
    requireGuildId,
    resolveRecordScope,
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
        throw new Error('A user and a non-empty planned range are required');
    }
}

async function replacePlannedRange(db, {
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

    if (!deleteOnly && !categoryKey) {
        throw new Error('A planned interval requires a category');
    }

    return withRecordScopeTransaction(
        db,
        { guildId: sourceGuildId, userId },
        async (client, { members }) => {
            const guildIds = memberGuildIds(members);
            const mutation = await client.query(
                `
                    INSERT INTO planned_mutations (
                        guild_id, mutation_type, actor_user_id, note
                    ) VALUES ($1, $2, $3, $4)
                    RETURNING id
                `,
                [sourceGuildId, deleteOnly ? 'delete' : 'edit', actorUserId, note]
            );
            const mutationId = mutation.rows[0].id;
            const affected = await client.query(
                `
                    SELECT id, guild_id, user_id, category_key, task_name, start_at, end_at
                    FROM planned_intervals
                    WHERE user_id = $1
                      AND guild_id = ANY($2::text[])
                      AND is_active = TRUE
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
                        UPDATE planned_intervals
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
                        INSERT INTO planned_intervals (
                            guild_id, user_id, category_key, task_name, start_at, end_at,
                            parent_id, created_by_mutation_id
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

async function getPlannedIntervalsForRange(db, {
    guildId,
    userId,
    startAt,
    endAt
}) {
    assertRange({ userId, startAt, endAt });
    const resolved = await resolveRecordScope(db, { guildId, userId });
    const guildIds = memberGuildIds(resolved.members);
    const result = await db.query(
        `
            SELECT id, guild_id, user_id, category_key, task_name, start_at, end_at
            FROM planned_intervals
            WHERE user_id = $1
              AND guild_id = ANY($2::text[])
              AND is_active = TRUE
              AND start_at < $4
              AND end_at > $3
            ORDER BY start_at ASC
        `,
        [userId, guildIds, startAt, endAt]
    );

    return result.rows.map((row) => ({
        ...row,
        startMs: new Date(row.start_at).getTime(),
        endMs: new Date(row.end_at).getTime()
    }));
}

module.exports = {
    getPlannedIntervalsForRange,
    replacePlannedRange
};
