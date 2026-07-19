'use strict';

const db = require('../database/db');

const {
    getFirebaseServices
} = require('./admin');

const {
    consumeLinkCode,
    getWebUser,
    recordAudit,
    touchWebUser,
    unlinkByFirebaseUid
} = require('../database/webAccountService');

const {
    replaceRange,
    replaceIntervalById,
    deleteIntervalById,
    startActivity,
    pauseActivity,
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
const CLEANUP_AGE_MS = 15 * 60 * 1000;

function getGuildId() {
    const guildId = process.env.GUILD_ID;

    if (!guildId) {
        throw new Error(
            'GUILD_ID is not configured'
        );
    }

    return guildId;
}

function getRankingManager(client) {
    return (
        client.persistentRanking ||
        client.rankingSystem ||
        client.ranking
    );
}

function requestRankingUpdate(client) {
    const promise =
        getRankingManager(client)
            ?.update?.();

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Web Console Ranking Update Error]',
                error
            );
        });
    }
}

function parseIsoDate(value, fieldName) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(
            `${fieldName}が正しくありません。`
        );
    }

    return date;
}

function normalizeTaskName(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).trim();

    if (normalized.length > 100) {
        throw new Error(
            '作業名は100文字以内にしてください。'
        );
    }

    return normalized || null;
}

function normalizeCategory(value, allowNull = false) {
    if (
        allowNull &&
        (value === null || value === undefined)
    ) {
        return null;
    }

    if (!ALLOWED_CATEGORIES.has(value)) {
        throw new Error(
            '科目が正しくありません。'
        );
    }

    return value;
}

function commandError(error) {
    const knownMessages = {
        STALE_INTERVAL:
            'この記録は別の操作ですでに変更されています。最新のタイムラインを読み直してください。',
        INTERVAL_OVERLAP:
            '変更後の時間が別の学習記録と重なっています。'
    };

    return {
        code: error.code || 'WEB_COMMAND_ERROR',
        message:
            knownMessages[error.code] ||
            error.message ||
            '処理に失敗しました。'
    };
}

async function buildSummary(
    guildId,
    userId,
    range,
    now
) {
    const effectiveEnd =
        range.end < now
            ? range.end
            : now;

    if (effectiveEnd <= range.start) {
        return {
            total: 0,
            subjects: {},
            tasks: {}
        };
    }

    const rows = await intervals(
        db,
        guildId,
        range.start,
        effectiveEnd
    );

    const userData = aggregate(
        rows.filter(
            (row) =>
                row.user_id === userId
        ),
        range.start,
        effectiveEnd
    )[0];

    return userData
        ? {
            total: userData.total,
            subjects: userData.subjects,
            tasks: userData.tasks
        }
        : {
            total: 0,
            subjects: {},
            tasks: {}
        };
}

async function buildUserSnapshot(
    discordClient,
    firebaseUid,
    webUser,
    dateKey = null
) {
    const guildId = getGuildId();
    const now = new Date();
    const requestedDate =
        dateKey ||
        getCurrentDateKey(now);

    const [
        discordUser,
        current,
        day,
        today,
        week,
        month
    ] = await Promise.all([
        discordClient.users
            .fetch(webUser.discord_user_id)
            .catch(() => null),
        getCurrentState(
            db,
            guildId,
            webUser.discord_user_id,
            now
        ),
        getTimelineForDay(
            db,
            {
                guildId,
                userId:
                    webUser.discord_user_id,
                dateKey: requestedDate,
                now
            }
        ),
        buildSummary(
            guildId,
            webUser.discord_user_id,
            jstRange(1, now),
            now
        ),
        buildSummary(
            guildId,
            webUser.discord_user_id,
            jstCurrentWeekRange(now),
            now
        ),
        buildSummary(
            guildId,
            webUser.discord_user_id,
            jstCurrentMonthRange(now),
            now
        )
    ]);

    current.clientReceivedAt = Date.now();

    return {
        account: {
            linked: true,
            discordUserId:
                webUser.discord_user_id,
            discordDisplayName:
                discordUser?.displayName ||
                discordUser?.username ||
                `ユーザー(${String(webUser.discord_user_id).slice(-4)})`,
            googleDisplayName:
                webUser.google_display_name ||
                null
        },
        current,
        summaries: {
            today,
            week,
            month
        },
        day,
        updatedAt: Date.now()
    };
}

async function syncUserData(
    discordClient,
    firebaseUid,
    dateKey = null
) {
    const {
        database
    } = getFirebaseServices();

    const webUser = await getWebUser(
        db,
        firebaseUid
    );

    if (!webUser) {
        await database
            .ref(`userData/${firebaseUid}`)
            .set({
                account: {
                    linked: false
                },
                updatedAt: Date.now()
            });

        return null;
    }

    await touchWebUser(
        db,
        firebaseUid
    );

    const snapshot =
        await buildUserSnapshot(
            discordClient,
            firebaseUid,
            webUser,
            dateKey
        );

    await database
        .ref(`userData/${firebaseUid}`)
        .set(snapshot);

    return snapshot;
}

async function requireLinkedUser(firebaseUid) {
    const webUser = await getWebUser(
        db,
        firebaseUid
    );

    if (!webUser) {
        const error = new Error(
            'Discordアカウントの連携が必要です。'
        );
        error.code = 'NOT_LINKED';
        throw error;
    }

    return webUser;
}

async function processLinkedCommand(
    discordClient,
    firebaseUid,
    command
) {
    const webUser = await requireLinkedUser(
        firebaseUid
    );

    const guildId = getGuildId();
    const userId = webUser.discord_user_id;
    const payload = command.payload || {};
    let selectedDate =
        payload.dateKey ||
        null;
    let result = {};
    let changedActivity = false;

    if (command.type === 'refresh') {
        result = {
            refreshed: true
        };
    } else if (command.type === 'load_day') {
        selectedDate = payload.dateKey;
        result = {
            loaded: selectedDate
        };
    } else if (command.type === 'start') {
        const categoryKey = normalizeCategory(
            payload.categoryKey,
            true
        );

        const taskName = normalizeTaskName(
            payload.taskName
        );

        result = await startActivity(
            db,
            {
                guildId,
                userId,
                categoryKey,
                taskName
            }
        );

        changedActivity = true;
    } else if (command.type === 'pause') {
        result = await pauseActivity(
            db,
            {
                guildId,
                userId
            }
        );

        changedActivity = true;
    } else if (command.type === 'stop') {
        result = await stopActivity(
            db,
            {
                guildId,
                userId
            }
        );

        changedActivity = true;
    } else if (command.type === 'create_range') {
        const startAt = parseIsoDate(
            payload.startAt,
            '開始時刻'
        );

        const endAt = parseIsoDate(
            payload.endAt,
            '終了時刻'
        );

        validateEditableRange(
            startAt,
            endAt
        );

        result = await replaceRange(
            db,
            {
                guildId,
                userId,
                startAt,
                endAt,
                categoryKey:
                    normalizeCategory(
                        payload.categoryKey
                    ),
                taskName:
                    normalizeTaskName(
                        payload.taskName
                    ),
                deleteOnly: false,
                actorUserId: userId,
                note:
                    `web-create:${firebaseUid}`
            }
        );

        changedActivity = true;
    } else if (command.type === 'update_interval') {
        const startAt = parseIsoDate(
            payload.startAt,
            '開始時刻'
        );

        const endAt = parseIsoDate(
            payload.endAt,
            '終了時刻'
        );

        validateEditableRange(
            startAt,
            endAt
        );

        result = await replaceIntervalById(
            db,
            {
                guildId,
                userId,
                intervalId:
                    payload.intervalId,
                startAt,
                endAt,
                categoryKey:
                    normalizeCategory(
                        payload.categoryKey
                    ),
                taskName:
                    normalizeTaskName(
                        payload.taskName
                    ),
                actorUserId: userId,
                note:
                    `web-update:${firebaseUid}`
            }
        );

        changedActivity = true;
    } else if (command.type === 'delete_interval') {
        result = await deleteIntervalById(
            db,
            {
                guildId,
                userId,
                intervalId:
                    payload.intervalId,
                actorUserId: userId,
                note:
                    `web-delete:${firebaseUid}`
            }
        );

        changedActivity = true;
    } else if (command.type === 'unlink') {
        const removed =
            await unlinkByFirebaseUid(
                db,
                firebaseUid
            );

        await recordAudit(
            db,
            {
                firebaseUid,
                discordUserId:
                    removed?.discord_user_id ||
                    userId,
                actionType:
                    'unlink_from_web'
            }
        );

        const {
            database
        } = getFirebaseServices();

        await database
            .ref(`userData/${firebaseUid}`)
            .set({
                account: {
                    linked: false
                },
                updatedAt: Date.now()
            });

        return {
            result: {
                unlinked: true
            },
            selectedDate,
            skipSync: true
        };
    } else {
        throw new Error(
            '未対応の操作です。'
        );
    }

    if (changedActivity) {
        requestRankingUpdate(
            discordClient
        );

        await recordAudit(
            db,
            {
                firebaseUid,
                discordUserId: userId,
                actionType: command.type,
                targetId:
                    payload.intervalId ||
                    result?.replacement?.id ||
                    result?.current?.id ||
                    null,
                details: {
                    resultKind:
                        result?.kind || null
                }
            }
        );
    }

    return {
        result: {
            ok: true,
            kind: result?.kind || null
        },
        selectedDate,
        skipSync: false
    };
}

async function executeCommand(
    discordClient,
    firebaseUid,
    command
) {
    if (
        Date.now() -
        Number(command.createdAt || 0) >
        PROCESSING_TIMEOUT_MS
    ) {
        throw new Error(
            '操作の有効期限が切れました。再度実行してください。'
        );
    }

    if (command.type === 'link') {
        const {
            auth
        } = getFirebaseServices();

        const authUser = await auth.getUser(
            firebaseUid
        );

        await consumeLinkCode(
            db,
            {
                firebaseUid,
                codeHash:
                    command.payload?.codeHash,
                googleEmail:
                    authUser.email || null,
                googleDisplayName:
                    authUser.displayName || null
            }
        );

        await syncUserData(
            discordClient,
            firebaseUid
        );

        return {
            linked: true
        };
    }

    if (command.type === 'refresh') {
        const webUser = await getWebUser(
            db,
            firebaseUid
        );

        if (!webUser) {
            await syncUserData(
                discordClient,
                firebaseUid
            );

            return {
                linked: false
            };
        }
    }

    const processed =
        await processLinkedCommand(
            discordClient,
            firebaseUid,
            command
        );

    if (!processed.skipSync) {
        await syncUserData(
            discordClient,
            firebaseUid,
            processed.selectedDate
        );
    }

    return processed.result;
}

function startWebConsoleBridge(
    discordClient
) {
    const {
        database
    } = getFirebaseServices();

    const commandRoot =
        database.ref('commandQueue');

    const registeredUsers = new Set();
    const userChains = new Map();

    const registerUser = (firebaseUid) => {
        if (registeredUsers.has(firebaseUid)) {
            return;
        }

        registeredUsers.add(firebaseUid);

        const pendingQuery = commandRoot
            .child(firebaseUid)
            .orderByChild('status')
            .equalTo('pending');

        pendingQuery.on(
            'child_added',
            (snapshot) => {
                const previous =
                    userChains.get(firebaseUid) ||
                    Promise.resolve();

                const next = previous
                    .then(async () => {
                        const commandRef =
                            snapshot.ref;

                        const transaction =
                            await commandRef.transaction(
                                (current) => {
                                    if (
                                        !current ||
                                        current.status !==
                                            'pending'
                                    ) {
                                        return;
                                    }

                                    return {
                                        ...current,
                                        status:
                                            'processing',
                                        processingAt:
                                            Date.now()
                                    };
                                }
                            );

                        if (!transaction.committed) {
                            return;
                        }

                        const command =
                            transaction.snapshot.val();

                        try {
                            const result =
                                await executeCommand(
                                    discordClient,
                                    firebaseUid,
                                    command
                                );

                            await commandRef.update({
                                status: 'done',
                                finishedAt: Date.now(),
                                result
                            });
                        } catch (error) {
                            console.error(
                                '[Web Console Command Error]',
                                {
                                    firebaseUid,
                                    commandType:
                                        command.type,
                                    error
                                }
                            );

                            await commandRef.update({
                                status: 'error',
                                finishedAt: Date.now(),
                                error: commandError(
                                    error
                                )
                            });
                        }
                    })
                    .catch((error) => {
                        console.error(
                            '[Web Console Queue Error]',
                            error
                        );
                    });

                userChains.set(
                    firebaseUid,
                    next
                );
            }
        );
    };

    commandRoot.on(
        'child_added',
        (snapshot) => {
            registerUser(snapshot.key);
        }
    );

    commandRoot.on(
        'child_changed',
        (snapshot) => {
            registerUser(snapshot.key);
        }
    );

    const cleanupTimer = setInterval(
        async () => {
            try {
                const snapshot =
                    await commandRoot.once(
                        'value'
                    );

                const updates = {};
                const cutoff =
                    Date.now() - CLEANUP_AGE_MS;

                snapshot.forEach(
                    (userSnapshot) => {
                        userSnapshot.forEach(
                            (commandSnapshot) => {
                                const command =
                                    commandSnapshot.val();

                                if (
                                    Number(
                                        command?.createdAt ||
                                        0
                                    ) < cutoff
                                ) {
                                    updates[
                                        `${userSnapshot.key}/${commandSnapshot.key}`
                                    ] = null;
                                }
                            }
                        );
                    }
                );

                if (
                    Object.keys(updates).length > 0
                ) {
                    await commandRoot.update(
                        updates
                    );
                }
            } catch (error) {
                console.error(
                    '[Web Console Cleanup Error]',
                    error
                );
            }
        },
        10 * 60 * 1000
    );

    console.log(
        '[Web Console] Firebase command bridge started'
    );

    return {
        stop() {
            clearInterval(cleanupTimer);
            commandRoot.off();
        },
        syncUser(firebaseUid, dateKey = null) {
            return syncUserData(
                discordClient,
                firebaseUid,
                dateKey
            );
        }
    };
}

module.exports = {
    startWebConsoleBridge,
    syncUserData
};
