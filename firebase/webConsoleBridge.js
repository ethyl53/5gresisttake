'use strict';

const db = require('../database/db');
const {
    getFirebaseServices
} = require('./admin');
const {
    claimWebCommand,
    completeWebCommand,
    consumeLinkCode,
    getWebUser,
    recordAudit,
    touchWebUser,
    unlinkByFirebaseUid
} = require('../database/webAccountService');
const {
    deleteIntervalById,
    pauseActivity,
    replaceIntervalById,
    replaceRange,
    startActivity,
    stopActivity
} = require('../database/intervalService');
const {
    getCurrentDateKey,
    getCurrentState,
    getTimelineForDay,
    validateEditableRange
} = require('../database/timelineService');
const {
    aggregate,
    intervals,
    jstCurrentMonthRange,
    jstCurrentWeekRange,
    jstRange
} = require('../utils/activityRead');

const ALLOWED_CATEGORIES = new Set([
    'math',
    'chemistry',
    'physics',
    'english',
    'social',
    'other'
]);
const PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

function getRankingManager(client) {
    return client.persistentRanking ||
        client.rankingSystem ||
        client.ranking;
}

function requestRankingUpdate(client, guildId) {
    const promise = getRankingManager(client)?.update?.(guildId);
    if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => {
            console.error('[Web Console Ranking Update Error]', { guildId, error });
        });
    }
}

function parseIsoDate(value, fieldName) {
    if (typeof value !== 'string' || value.length > 64) {
        throw new Error(`${fieldName}が正しくありません。`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldName}が正しくありません。`);
    }
    return date;
}

function normalizeTaskName(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    if (normalized.length > 100) {
        throw new Error('作業名は100文字以内にしてください。');
    }
    return normalized || null;
}

function normalizeCategory(value, allowNull = false) {
    if (allowNull && (value === null || value === undefined)) {
        return null;
    }
    if (!ALLOWED_CATEGORIES.has(value)) {
        throw new Error('科目が正しくありません。');
    }
    return value;
}

function commandError(error) {
    const messages = {
        GUILD_REQUIRED: '操作するサーバーを選択してください。',
        GUILD_ACCESS_DENIED: '選択したサーバーを利用する権限を確認できません。',
        NOT_LINKED: 'Discordアカウントが連携されていません。',
        STALE_INTERVAL: 'この記録はすでに変更されています。最新のタイムラインを確認してください。',
        INTERVAL_OVERLAP: '編集後の時間が別の学習記録と重なっています。',
        COMMAND_EXPIRED: '操作の有効期限が切れました。もう一度実行してください。'
    };
    return {
        code: error.code || 'WEB_COMMAND_ERROR',
        message: messages[error.code] || error.message || '処理に失敗しました。'
    };
}

function commandGuildId(command) {
    const guildId = typeof command.guildId === 'string'
        ? command.guildId.trim()
        : '';
    if (!guildId) {
        const error = new Error('操作するサーバーを選択してください。');
        error.code = 'GUILD_REQUIRED';
        throw error;
    }
    return guildId;
}

async function getAccessibleGuilds(discordClient, discordUserId) {
    const guilds = [...discordClient.guilds.cache.values()];
    const accessible = await Promise.all(guilds.map(async (guild) => {
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        return member
            ? {
                id: guild.id,
                name: guild.name,
                displayName: member.displayName
            }
            : null;
    }));
    return accessible.filter(Boolean);
}

async function requireAccessibleGuild(discordClient, discordUserId, guildId) {
    const guild = discordClient.guilds.cache.get(guildId) ||
        await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        const error = new Error('選択したサーバーを利用する権限を確認できません。');
        error.code = 'GUILD_ACCESS_DENIED';
        throw error;
    }
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) {
        const error = new Error('選択したサーバーを利用する権限を確認できません。');
        error.code = 'GUILD_ACCESS_DENIED';
        throw error;
    }
    return { guild, member };
}

async function buildSummary(guildId, userId, range, now) {
    const end = range.end < now ? range.end : now;
    if (end <= range.start) {
        return { total: 0, subjects: {}, tasks: {} };
    }
    const rows = await intervals(db, guildId, range.start, end);
    const data = aggregate(
        rows.filter((row) => row.user_id === userId),
        range.start,
        end
    )[0];
    return data
        ? { total: data.total, subjects: data.subjects, tasks: data.tasks }
        : { total: 0, subjects: {}, tasks: {} };
}

async function buildGuildSnapshot(discordClient, webUser, accessibleGuild, dateKey) {
    const now = new Date();
    const requestedDate = dateKey || getCurrentDateKey(now);
    const guildId = accessibleGuild.id;
    const userId = webUser.discord_user_id;
    const [current, day, today, week, month] = await Promise.all([
        getCurrentState(db, guildId, userId, now),
        getTimelineForDay(db, { guildId, userId, dateKey: requestedDate, now }),
        buildSummary(guildId, userId, jstRange(1, now), now),
        buildSummary(guildId, userId, jstCurrentWeekRange(now), now),
        buildSummary(guildId, userId, jstCurrentMonthRange(now), now)
    ]);

    return {
        guild: {
            id: guildId,
            name: accessibleGuild.name,
            displayName: accessibleGuild.displayName
        },
        current: {
            ...current,
            clientReceivedAt: Date.now()
        },
        summaries: { today, week, month },
        day,
        updatedAt: Date.now()
    };
}

async function buildUserSnapshot(discordClient, webUser, selectedGuildId = null, dateKey = null) {
    const accessibleGuilds = await getAccessibleGuilds(
        discordClient,
        webUser.discord_user_id
    );
    const guildSnapshots = await Promise.all(accessibleGuilds.map(async (guild) => {
        const selectedDate = guild.id === selectedGuildId ? dateKey : null;
        return buildGuildSnapshot(discordClient, webUser, guild, selectedDate);
    }));
    const guilds = Object.fromEntries(
        guildSnapshots.map((snapshot) => [snapshot.guild.id, snapshot])
    );

    return {
        account: {
            linked: true,
            discordUserId: webUser.discord_user_id,
            discordDisplayName: accessibleGuilds[0]?.displayName ||
                `ユーザー(${String(webUser.discord_user_id).slice(-4)})`,
            googleDisplayName: webUser.google_display_name || null,
            guilds: accessibleGuilds.map(({ id, name }) => ({ id, name }))
        },
        guilds,
        updatedAt: Date.now()
    };
}

async function syncUserData(discordClient, firebaseUid, options = {}) {
    const { database } = getFirebaseServices();
    const webUser = await getWebUser(db, firebaseUid);
    if (!webUser) {
        await database.ref(`userData/${firebaseUid}`).set({
            account: { linked: false, guilds: [] },
            guilds: {},
            updatedAt: Date.now()
        });
        return null;
    }

    await touchWebUser(db, firebaseUid);
    const snapshot = await buildUserSnapshot(
        discordClient,
        webUser,
        options.guildId || null,
        options.dateKey || null
    );
    await database.ref(`userData/${firebaseUid}`).set(snapshot);
    return snapshot;
}

async function requireLinkedUser(firebaseUid) {
    const webUser = await getWebUser(db, firebaseUid);
    if (!webUser) {
        const error = new Error('Discordアカウントが連携されていません。');
        error.code = 'NOT_LINKED';
        throw error;
    }
    return webUser;
}

async function processLinkedCommand(discordClient, firebaseUid, commandId, command) {
    const webUser = await requireLinkedUser(firebaseUid);
    const payload = command.payload && typeof command.payload === 'object'
        ? command.payload
        : {};
    const accountCommand = command.type === 'refresh' || command.type === 'unlink';
    const guildId = accountCommand ? null : commandGuildId(command);
    const userId = webUser.discord_user_id;
    let selectedDate = payload.dateKey || null;
    let result = { ok: true };
    let changedActivity = false;

    if (guildId) {
        await requireAccessibleGuild(discordClient, userId, guildId);
    }

    if (command.type === 'refresh') {
        result = { ok: true, refreshed: true };
    } else if (command.type === 'load_day') {
        selectedDate = String(payload.dateKey || '');
        // The timeline service performs the strict date and 30-day validation.
        await getTimelineForDay(db, {
            guildId,
            userId,
            dateKey: selectedDate
        });
        result = { ok: true, loaded: selectedDate };
    } else if (command.type === 'start') {
        result = await startActivity(db, {
            guildId,
            userId,
            categoryKey: normalizeCategory(payload.categoryKey, true),
            taskName: normalizeTaskName(payload.taskName)
        });
        changedActivity = true;
    } else if (command.type === 'pause') {
        result = await pauseActivity(db, { guildId, userId });
        changedActivity = true;
    } else if (command.type === 'stop') {
        result = await stopActivity(db, { guildId, userId });
        changedActivity = true;
    } else if (command.type === 'create_range') {
        const startAt = parseIsoDate(payload.startAt, '開始時刻');
        const endAt = parseIsoDate(payload.endAt, '終了時刻');
        validateEditableRange(startAt, endAt);
        result = await replaceRange(db, {
            guildId,
            userId,
            startAt,
            endAt,
            categoryKey: normalizeCategory(payload.categoryKey),
            taskName: normalizeTaskName(payload.taskName),
            actorUserId: userId,
            note: `web-create:${firebaseUid}:${commandId}`
        });
        changedActivity = true;
    } else if (command.type === 'update_interval') {
        const startAt = parseIsoDate(payload.startAt, '開始時刻');
        const endAt = parseIsoDate(payload.endAt, '終了時刻');
        validateEditableRange(startAt, endAt);
        result = await replaceIntervalById(db, {
            guildId,
            userId,
            intervalId: String(payload.intervalId || ''),
            startAt,
            endAt,
            categoryKey: normalizeCategory(payload.categoryKey),
            taskName: normalizeTaskName(payload.taskName),
            actorUserId: userId,
            note: `web-update:${firebaseUid}:${commandId}`
        });
        changedActivity = true;
    } else if (command.type === 'delete_interval') {
        result = await deleteIntervalById(db, {
            guildId,
            userId,
            intervalId: String(payload.intervalId || ''),
            actorUserId: userId,
            note: `web-delete:${firebaseUid}:${commandId}`
        });
        changedActivity = true;
    } else if (command.type === 'unlink') {
        const removed = await unlinkByFirebaseUid(db, firebaseUid);
        await recordAudit(db, {
            firebaseUid,
            discordUserId: removed?.discord_user_id || userId,
            actionType: 'unlink_from_web',
            details: { commandId }
        });
        const { database } = getFirebaseServices();
        await database.ref(`userData/${firebaseUid}`).set({
            account: { linked: false, guilds: [] },
            guilds: {},
            updatedAt: Date.now()
        });
        return { result: { ok: true, unlinked: true }, skipSync: true };
    } else {
        throw new Error('未対応の操作です。');
    }

    if (changedActivity) {
        requestRankingUpdate(discordClient, guildId);
    }

    await recordAudit(db, {
        firebaseUid,
        discordUserId: userId,
        actionType: command.type,
        targetId: payload.intervalId || result?.replacement?.id || result?.current?.id || null,
        details: {
            commandId,
            guildId,
            resultKind: result?.kind || null
        }
    });

    return {
        result: {
            ok: true,
            kind: result?.kind || null
        },
        skipSync: false,
        syncOptions: { guildId, dateKey: selectedDate }
    };
}

async function executeCommand(discordClient, firebaseUid, commandId, command) {
    const createdAt = Number(command.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > Date.now() + 60_000 ||
        Date.now() - createdAt > PROCESSING_TIMEOUT_MS) {
        const error = new Error('操作の有効期限が切れました。もう一度実行してください。');
        error.code = 'COMMAND_EXPIRED';
        throw error;
    }

    if (command.type === 'link') {
        const { auth } = getFirebaseServices();
        const authUser = await auth.getUser(firebaseUid);
        await consumeLinkCode(db, {
            firebaseUid,
            codeHash: command.payload?.codeHash,
            googleEmail: authUser.email || null,
            googleDisplayName: authUser.displayName || null
        });
        await syncUserData(discordClient, firebaseUid);
        return { linked: true };
    }

    const processed = await processLinkedCommand(
        discordClient,
        firebaseUid,
        commandId,
        command
    );
    if (!processed.skipSync) {
        await syncUserData(discordClient, firebaseUid, processed.syncOptions);
    }
    return processed.result;
}

function startWebConsoleBridge(discordClient) {
    const { database } = getFirebaseServices();
    const commandRoot = database.ref('commandQueue');
    const registeredUsers = new Map();
    const commandChains = new Map();

    const enqueue = (firebaseUid, snapshot) => {
        const preview = snapshot.val() || {};
        const chainKey = `${firebaseUid}:${preview.guildId || 'account'}`;
        const previous = commandChains.get(chainKey) || Promise.resolve();
        const next = previous.then(async () => {
            const commandRef = snapshot.ref;
            const transaction = await commandRef.transaction((current) => {
                if (!current || current.status !== 'pending') {
                    return;
                }
                return {
                    ...current,
                    status: 'processing',
                    processingAt: Date.now()
                };
            });
            if (!transaction.committed) {
                return;
            }

            const command = transaction.snapshot.val();
            const commandId = snapshot.key;
            const claim = await claimWebCommand(db, {
                firebaseUid,
                commandId,
                commandType: String(command.type || 'unknown'),
                guildId: command.guildId || null
            });

            if (!claim.claimed) {
                const receipt = claim.receipt;
                if (receipt?.status === 'done') {
                    await commandRef.update({
                        status: 'done',
                        finishedAt: Date.now(),
                        result: receipt.result || { ok: true, duplicate: true }
                    });
                } else {
                    await commandRef.update({
                        status: 'error',
                        finishedAt: Date.now(),
                        error: receipt?.error || {
                            code: 'COMMAND_ALREADY_PROCESSING',
                            message: '同じ操作はすでに処理中または処理済みです。'
                        }
                    });
                }
                return;
            }

            try {
                const result = await executeCommand(
                    discordClient,
                    firebaseUid,
                    commandId,
                    command
                );
                await completeWebCommand(db, {
                    firebaseUid,
                    commandId,
                    status: 'done',
                    result
                });
                await commandRef.update({
                    status: 'done',
                    finishedAt: Date.now(),
                    result
                });
            } catch (error) {
                const serialized = commandError(error);
                console.error('[Web Console Command Error]', {
                    firebaseUid,
                    commandId,
                    commandType: command.type,
                    error
                });
                await completeWebCommand(db, {
                    firebaseUid,
                    commandId,
                    status: 'error',
                    error: serialized
                }).catch((receiptError) => {
                    console.error('[Web Command Receipt Error]', receiptError);
                });
                await commandRef.update({
                    status: 'error',
                    finishedAt: Date.now(),
                    error: serialized
                });
            }
        }).catch((error) => {
            console.error('[Web Console Queue Error]', { firebaseUid, error });
        });
        commandChains.set(chainKey, next);
    };

    const registerUser = (firebaseUid) => {
        if (registeredUsers.has(firebaseUid)) {
            return;
        }
        const pendingQuery = commandRoot.child(firebaseUid)
            .orderByChild('status')
            .equalTo('pending');
        const handler = (snapshot) => enqueue(firebaseUid, snapshot);
        pendingQuery.on('child_added', handler);
        registeredUsers.set(firebaseUid, { pendingQuery, handler });
    };

    const rootAddedHandler = (snapshot) => registerUser(snapshot.key);
    const rootChangedHandler = (snapshot) => registerUser(snapshot.key);
    commandRoot.on('child_added', rootAddedHandler);
    commandRoot.on('child_changed', rootChangedHandler);

    const cleanupTimer = setInterval(async () => {
        try {
            const snapshot = await commandRoot.once('value');
            const updates = {};
            const now = Date.now();
            snapshot.forEach((userSnapshot) => {
                userSnapshot.forEach((commandSnapshot) => {
                    const command = commandSnapshot.val() || {};
                    const age = now - Number(command.createdAt || 0);
                    const path = `${userSnapshot.key}/${commandSnapshot.key}`;
                    if (command.status === 'processing' &&
                        now - Number(command.processingAt || 0) > STALE_PROCESSING_MS) {
                        updates[`${path}/status`] = 'error';
                        updates[`${path}/finishedAt`] = now;
                        updates[`${path}/error`] = {
                            code: 'COMMAND_TIMEOUT',
                            message: '処理が時間切れになりました。もう一度実行してください。'
                        };
                    } else if (age > CLEANUP_AGE_MS &&
                        (command.status === 'done' || command.status === 'error')) {
                        updates[path] = null;
                    }
                });
            });
            if (Object.keys(updates).length > 0) {
                await commandRoot.update(updates);
            }
        } catch (error) {
            console.error('[Web Console Cleanup Error]', error);
        }
    }, 10 * 60 * 1000);

    console.log('[Web Console] Firebase command bridge started');
    return {
        stop() {
            clearInterval(cleanupTimer);
            commandRoot.off('child_added', rootAddedHandler);
            commandRoot.off('child_changed', rootChangedHandler);
            for (const { pendingQuery, handler } of registeredUsers.values()) {
                pendingQuery.off('child_added', handler);
            }
            registeredUsers.clear();
        },
        syncUser(firebaseUid, options = {}) {
            return syncUserData(discordClient, firebaseUid, options);
        }
    };
}

module.exports = {
    getAccessibleGuilds,
    requireAccessibleGuild,
    startWebConsoleBridge,
    syncUserData
};
