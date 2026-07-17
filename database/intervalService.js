'use strict';

// The only writer for historical /edit operations. Commands and the future web
// console should call this service instead of issuing interval SQL directly.
async function replaceRange(db, {
    guildId = '', userId, startAt, endAt, categoryKey = null, taskName = null,
    deleteOnly = false, actorUserId = userId, note = null
}) {
    if (!userId || !(startAt instanceof Date) || !(endAt instanceof Date) || endAt <= startAt) {
        throw new Error('A user and a non-empty [startAt, endAt) range are required');
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // Serialises all mutations for this guild/user, including web requests.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${guildId}:${userId}`]);

        // A live interval is intentionally never altered by a historical edit.
        // The caller must /stop first, preventing an edit from silently ending
        // or replacing the user's current work.
        const live = await client.query(
            `SELECT id FROM activity_intervals
             WHERE guild_id = $1 AND user_id = $2 AND is_active AND end_at IS NULL
               AND start_at < $4
             FOR UPDATE`, [guildId, userId, startAt, endAt]
        );
        if (live.rowCount) throw new Error('Cannot edit a range that overlaps a running activity; stop it first.');

        const mutation = await client.query(
            `INSERT INTO activity_mutations (mutation_type, actor_user_id, note)
             VALUES ($1, $2, $3) RETURNING id`,
            [deleteOnly ? 'delete' : 'edit', actorUserId, note]
        );
        const mutationId = mutation.rows[0].id;
        const affected = await client.query(
            `SELECT id, category_key, task_name, start_at, end_at
             FROM activity_intervals
             WHERE guild_id = $1 AND user_id = $2 AND is_active AND end_at IS NOT NULL
               AND start_at < $4 AND end_at > $3
             FOR UPDATE`, [guildId, userId, startAt, endAt]
        );

        await client.query(
            `UPDATE activity_intervals
             SET is_active = FALSE, invalidated_at = now(), invalidated_by_mutation_id = $1
             WHERE id = ANY($2::uuid[])`,
            [mutationId, affected.rows.map((row) => row.id)]
        );

        const insert = async (interval, parentId = null) => client.query(
            `INSERT INTO activity_intervals
             (guild_id, user_id, category_key, task_name, start_at, end_at, parent_id, created_by_mutation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [guildId, userId, interval.categoryKey, interval.taskName, interval.startAt, interval.endAt, parentId, mutationId]
        );

        // Recreate left/right pieces as new rows. The old rows remain immutable.
        for (const row of affected.rows) {
            if (row.start_at < startAt) await insert({ categoryKey: row.category_key, taskName: row.task_name, startAt: row.start_at, endAt: startAt }, row.id);
            if (row.end_at > endAt) await insert({ categoryKey: row.category_key, taskName: row.task_name, startAt: endAt, endAt: row.end_at }, row.id);
        }
        if (!deleteOnly) await insert({ categoryKey, taskName, startAt, endAt });
        await client.query('COMMIT');
        return { mutationId, replaced: affected.rowCount };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function withUserLock(db, guildId, userId, fn) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${guildId}:${userId}`]);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally { client.release(); }
}

async function getStateForUpdate(client, guildId, userId) {
    await client.query(
        `INSERT INTO activity_state (guild_id, user_id) VALUES ($1, $2)
         ON CONFLICT (guild_id, user_id) DO NOTHING`, [guildId, userId]
    );
    const result = await client.query(
        `SELECT * FROM activity_state WHERE guild_id = $1 AND user_id = $2 FOR UPDATE`, [guildId, userId]
    );
    return result.rows[0];
}

async function createOpenInterval(client, guildId, userId, categoryKey, taskName, now) {
    const mutation = await client.query(
        `INSERT INTO activity_mutations (mutation_type, actor_user_id, note)
         VALUES ('create', $1, 'start') RETURNING id`, [userId]
    );
    const inserted = await client.query(
        `INSERT INTO activity_intervals
         (guild_id, user_id, category_key, task_name, start_at, created_by_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [guildId, userId, categoryKey, taskName, now, mutation.rows[0].id]
    );
    return inserted.rows[0];
}

async function startActivity(db, { guildId = '', userId, categoryKey = null, taskName = null, now = new Date() }) {
    return withUserLock(db, guildId, userId, async (client) => {
        const state = await getStateForUpdate(client, guildId, userId);
        if (state.active_interval_id) {
            if (!categoryKey && !taskName) return { kind: 'already_running' };
            const closed = await client.query(
                `UPDATE activity_intervals SET end_at = $1
                 WHERE id = $2 AND is_active AND end_at IS NULL RETURNING *`, [now, state.active_interval_id]
            );
            const next = await createOpenInterval(client, guildId, userId, categoryKey, taskName, now);
            await client.query(`UPDATE activity_state SET active_interval_id=$1, paused_category_key=NULL, paused_task_name=NULL, paused_at=NULL, updated_at=now() WHERE guild_id=$2 AND user_id=$3`, [next.id, guildId, userId]);
            return { kind: 'switched', previous: closed.rows[0], current: next };
        }
        const resumeCategory = !categoryKey && !taskName ? state.paused_category_key : categoryKey;
        const resumeTask = !categoryKey && !taskName ? state.paused_task_name : taskName;
        if (!resumeCategory && !resumeTask && state.paused_at) return { kind: 'paused_data_missing' };
        const current = await createOpenInterval(client, guildId, userId, resumeCategory, resumeTask, now);
        await client.query(`UPDATE activity_state SET active_interval_id=$1, paused_category_key=NULL, paused_task_name=NULL, paused_at=NULL, updated_at=now() WHERE guild_id=$2 AND user_id=$3`, [current.id, guildId, userId]);
        return { kind: state.paused_at ? 'resumed' : 'started', current };
    });
}

async function pauseActivity(db, { guildId = '', userId, now = new Date() }) {
    return withUserLock(db, guildId, userId, async (client) => {
        const state = await getStateForUpdate(client, guildId, userId);
        if (!state.active_interval_id) return { kind: state.paused_at ? 'already_paused' : 'none' };
        const closed = await client.query(`UPDATE activity_intervals SET end_at=$1 WHERE id=$2 AND is_active AND end_at IS NULL RETURNING *`, [now, state.active_interval_id]);
        if (!closed.rowCount) throw new Error('Active interval was not found');
        const row = closed.rows[0];
        await client.query(`UPDATE activity_state SET active_interval_id=NULL, paused_category_key=$1, paused_task_name=$2, paused_at=$3, updated_at=now() WHERE guild_id=$4 AND user_id=$5`, [row.category_key, row.task_name, now, guildId, userId]);
        return { kind: 'paused', interval: row };
    });
}

async function stopActivity(db, { guildId = '', userId, now = new Date() }) {
    return withUserLock(db, guildId, userId, async (client) => {
        const state = await getStateForUpdate(client, guildId, userId);
        let interval = null;
        if (state.active_interval_id) {
            const closed = await client.query(`UPDATE activity_intervals SET end_at=$1 WHERE id=$2 AND is_active AND end_at IS NULL RETURNING *`, [now, state.active_interval_id]);
            interval = closed.rows[0] || null;
        }
        await client.query(`UPDATE activity_state SET active_interval_id=NULL, paused_category_key=NULL, paused_task_name=NULL, paused_at=NULL, updated_at=now() WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
        return { kind: interval ? 'stopped' : (state.paused_at ? 'stopped_paused' : 'none'), interval };
    });
}

module.exports = { replaceRange, startActivity, pauseActivity, stopActivity };
