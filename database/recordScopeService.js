'use strict';

const crypto = require('crypto');

const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function requireGuildId(guildId) {
    const value = String(guildId || '').trim();

    if (!value) {
        throw new Error('guildId is required for record scope operations');
    }

    return value;
}

function requireUserId(userId) {
    const value = String(userId || '').trim();

    if (!value) {
        throw new Error('userId is required for record scope operations');
    }

    return value;
}

function scopeError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function hashCode(code) {
    return crypto
        .createHash('sha256')
        .update(String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())
        .digest('hex');
}

function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let compact = '';

    for (let index = 0; index < 8; index += 1) {
        compact += alphabet[crypto.randomInt(alphabet.length)];
    }

    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

async function acquireMemberLock(client, guildId, userId) {
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`record-member:${guildId}:${userId}`]
    );
}

async function acquireScopeLock(client, scopeId) {
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`record-scope:${scopeId}`]
    );
}

async function acquireOwnerCodeLock(client, userId) {
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`record-link-owner:${userId}`]
    );
}

async function findScopeForMember(client, guildId, userId, forUpdate = false) {
    const result = await client.query(
        `
            SELECT
                scopes.id,
                scopes.owner_user_id,
                scopes.created_at,
                scopes.updated_at
            FROM record_scope_members AS members
            JOIN record_scopes AS scopes
              ON scopes.id = members.scope_id
            WHERE members.guild_id = $1
              AND members.user_id = $2
            ${forUpdate ? 'FOR UPDATE OF members, scopes' : ''}
        `,
        [guildId, userId]
    );

    return result.rows[0] || null;
}

async function getOrCreateScopeForMember(client, { guildId, userId }) {
    const safeGuildId = requireGuildId(guildId);
    const safeUserId = requireUserId(userId);

    await acquireMemberLock(client, safeGuildId, safeUserId);

    const existing = await findScopeForMember(
        client,
        safeGuildId,
        safeUserId,
        true
    );

    if (existing) {
        return existing;
    }

    const created = await client.query(
        `
            INSERT INTO record_scopes (owner_user_id)
            VALUES ($1)
            RETURNING *
        `,
        [safeUserId]
    );

    const scope = created.rows[0];

    await client.query(
        `
            INSERT INTO record_scope_members (
                scope_id,
                guild_id,
                user_id
            )
            VALUES ($1, $2, $3)
        `,
        [scope.id, safeGuildId, safeUserId]
    );

    return scope;
}

async function listScopeMembers(client, scopeId, userId = null) {
    const result = await client.query(
        `
            SELECT guild_id, user_id, linked_at
            FROM record_scope_members
            WHERE scope_id = $1
              ${userId ? 'AND user_id = $2' : ''}
            ORDER BY linked_at ASC, guild_id ASC
        `,
        userId ? [scopeId, userId] : [scopeId]
    );

    return result.rows;
}

async function resolveRecordScope(db, { guildId, userId }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const scope = await getOrCreateScopeForMember(client, {
            guildId,
            userId
        });
        const members = await listScopeMembers(
            client,
            scope.id,
            scope.owner_user_id
        );
        await client.query('COMMIT');

        return { scope, members };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function withRecordScopeTransaction(
    db,
    { guildId, userId },
    operation
) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const scope = await getOrCreateScopeForMember(client, {
            guildId,
            userId
        });
        await acquireScopeLock(client, scope.id);
        const members = await listScopeMembers(
            client,
            scope.id,
            scope.owner_user_id
        );
        const result = await operation(client, { scope, members });
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

function memberGuildIds(members) {
    return [...new Set(members.map((member) => member.guild_id))];
}

async function createLinkCode(db, { guildId, userId, now = new Date() }) {
    return withRecordScopeTransaction(
        db,
        { guildId, userId },
        async (client, { scope }) => {
            await acquireOwnerCodeLock(client, userId);
            const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);

            await client.query(
                `
                    UPDATE record_scope_link_codes
                    SET used_at = NOW()
                    WHERE owner_user_id = $1
                      AND used_at IS NULL
                `,
                [userId]
            );

            let code = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const candidate = generateCode();
                try {
                    await client.query(
                        `
                            INSERT INTO record_scope_link_codes (
                                source_scope_id,
                                owner_user_id,
                                code_hash,
                                expires_at
                            )
                            VALUES ($1, $2, $3, $4)
                        `,
                        [scope.id, userId, hashCode(candidate), expiresAt]
                    );
                    code = candidate;
                    break;
                } catch (error) {
                    if (error.code !== '23505') throw error;
                }
            }

            if (!code) {
                throw new Error('連携コードの発行に失敗しました。');
            }

            return { code, expiresAt, scopeId: scope.id };
        }
    );
}

async function getScopeConflictSummary(client, sourceScopeId, targetScopeId, userId) {
    const sourceMembers = await listScopeMembers(client, sourceScopeId, userId);
    const targetMembers = await listScopeMembers(client, targetScopeId, userId);
    const sourceGuildIds = memberGuildIds(sourceMembers);
    const targetGuildIds = memberGuildIds(targetMembers);

    const states = await client.query(
        `
            SELECT guild_id, active_interval_id, paused_at
            FROM activity_state
            WHERE user_id = $1
              AND guild_id = ANY($2::text[])
              AND (active_interval_id IS NOT NULL OR paused_at IS NOT NULL)
        `,
        [userId, [...sourceGuildIds, ...targetGuildIds]]
    );

    if (states.rowCount > 0) {
        return {
            type: 'state',
            count: states.rowCount,
            examples: states.rows.slice(0, 3)
        };
    }

    const queryOverlaps = async (table) => {
        const result = await client.query(
            `
                SELECT
                    left_row.guild_id AS left_guild_id,
                    right_row.guild_id AS right_guild_id,
                    left_row.start_at AS left_start_at,
                    left_row.end_at AS left_end_at,
                    right_row.start_at AS right_start_at,
                    right_row.end_at AS right_end_at
                FROM ${table} AS left_row
                JOIN ${table} AS right_row
                  ON left_row.user_id = right_row.user_id
                 AND left_row.start_at < right_row.end_at
                 AND left_row.end_at > right_row.start_at
                WHERE left_row.user_id = $1
                  AND left_row.guild_id = ANY($2::text[])
                  AND right_row.guild_id = ANY($3::text[])
                  AND left_row.is_active = TRUE
                  AND right_row.is_active = TRUE
                ORDER BY left_row.start_at ASC
            `,
            [userId, sourceGuildIds, targetGuildIds]
        );

        return {
            count: result.rowCount,
            examples: result.rows.slice(0, 3)
        };
    };

    const actual = await queryOverlaps('activity_intervals');

    if (actual.count > 0) {
        return { type: 'activity_overlap', ...actual };
    }

    const planned = await queryOverlaps('planned_intervals');

    if (planned.count > 0) {
        return { type: 'plan_overlap', ...planned };
    }

    return null;
}

async function joinLinkCode(db, { guildId, userId, code }) {
    const safeGuildId = requireGuildId(guildId);
    const safeUserId = requireUserId(userId);
    const codeHash = hashCode(code);
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`record-link:${codeHash}`]
        );

        const codeResult = await client.query(
            `
                SELECT *
                FROM record_scope_link_codes
                WHERE code_hash = $1
                FOR UPDATE
            `,
            [codeHash]
        );
        const link = codeResult.rows[0];

        if (!link) {
            throw scopeError('INVALID_LINK_CODE', '連携コードが無効です。');
        }

        if (link.used_at) {
            throw scopeError('USED_LINK_CODE', 'この連携コードはすでに使用済みです。');
        }

        if (new Date(link.expires_at) <= new Date()) {
            await client.query(
                'UPDATE record_scope_link_codes SET used_at = NOW() WHERE id = $1',
                [link.id]
            );
            throw scopeError('EXPIRED_LINK_CODE', '連携コードの有効期限が切れています。');
        }

        if (link.owner_user_id !== safeUserId) {
            throw scopeError('LINK_CODE_OWNER_MISMATCH', 'この連携コードは別のDiscordアカウント用です。');
        }

        const currentScope = await getOrCreateScopeForMember(client, {
            guildId: safeGuildId,
            userId: safeUserId
        });
        const targetScopeResult = await client.query(
            'SELECT * FROM record_scopes WHERE id = $1 FOR UPDATE',
            [link.source_scope_id]
        );
        const targetScope = targetScopeResult.rows[0];

        if (!targetScope || targetScope.owner_user_id !== safeUserId) {
            throw scopeError('LINK_CODE_OWNER_MISMATCH', 'この連携コードは使用できません。');
        }

        await acquireScopeLock(client, currentScope.id);
        await acquireScopeLock(client, targetScope.id);

        if (currentScope.id === targetScope.id) {
            throw scopeError('ALREADY_LINKED', 'このサーバーはすでに同じ記録共有グループにあります。');
        }

        const conflict = await getScopeConflictSummary(
            client,
            currentScope.id,
            targetScope.id,
            safeUserId
        );

        if (conflict) {
            console.warn('[Record Scope Link Conflict]', {
                userId: safeUserId,
                sourceScopeId: currentScope.id,
                targetScopeId: targetScope.id,
                conflict
            });
            const labels = {
                state: '実行中または一時停止中の作業',
                activity_overlap: '重なる実績記録',
                plan_overlap: '重なる予定'
            };
            throw scopeError(
                'SCOPE_CONFLICT',
                `${labels[conflict.type] || '競合'}が${conflict.count}件あるため連携できません。先に重複を解消してください。`,
                conflict
            );
        }

        await client.query(
            `
                UPDATE record_scope_members
                SET scope_id = $1,
                    linked_at = NOW()
                WHERE scope_id = $2
                  AND user_id = $3
            `,
            [targetScope.id, currentScope.id, safeUserId]
        );
        await client.query(
            'UPDATE record_scopes SET updated_at = NOW() WHERE id = $1',
            [targetScope.id]
        );
        await client.query(
            'UPDATE record_scope_link_codes SET used_at = NOW() WHERE id = $1',
            [link.id]
        );

        const members = await listScopeMembers(
            client,
            targetScope.id,
            safeUserId
        );
        await client.query('COMMIT');
        return { scope: targetScope, members };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function leaveScope(db, { guildId, userId }) {
    return withRecordScopeTransaction(
        db,
        { guildId, userId },
        async (client, { scope, members }) => {
            if (members.length <= 1) {
                return { kind: 'already_independent', scope, members };
            }

            const created = await client.query(
                `
                    INSERT INTO record_scopes (owner_user_id)
                    VALUES ($1)
                    RETURNING *
                `,
                [userId]
            );
            const independentScope = created.rows[0];

            await acquireScopeLock(client, independentScope.id);
            await client.query(
                `
                    UPDATE record_scope_members
                    SET scope_id = $1,
                        linked_at = NOW()
                    WHERE guild_id = $2
                      AND user_id = $3
                `,
                [independentScope.id, guildId, userId]
            );
            await client.query(
                'UPDATE record_scopes SET updated_at = NOW() WHERE id = $1',
                [scope.id]
            );

            return {
                kind: 'left',
                scope: independentScope,
                remainingMembers: members.filter(
                    (member) => member.guild_id !== guildId
                )
            };
        }
    );
}

async function getScopeStatus(db, { guildId, userId }) {
    const resolved = await resolveRecordScope(db, { guildId, userId });

    return {
        scope: resolved.scope,
        members: resolved.members
    };
}

module.exports = {
    LINK_CODE_TTL_MS,
    acquireScopeLock,
    createLinkCode,
    createRecordLinkCode: createLinkCode,
    getOrCreateScopeForMember,
    getScopeStatus,
    getRecordScope: getScopeStatus,
    hashCode,
    joinLinkCode,
    joinRecordScope: joinLinkCode,
    leaveScope,
    leaveRecordScope: leaveScope,
    listScopeMembers,
    memberGuildIds,
    requireGuildId,
    resolveRecordScope,
    withRecordScopeTransaction
};
