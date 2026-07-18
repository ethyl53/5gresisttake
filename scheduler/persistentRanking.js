'use strict';

const cron = require('node-cron');

const {
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    activeIntervals,
    pausedStates,
    intervals,
    aggregate,
    jstRange,
    jstCurrentWeekRange,
    format
} = require('../utils/activityRead');

const {
    generateTimelineBuffer
} = require('../utils/timeline');

const STATE_KEY = 'ranking_message_id';

async function getUsername(
    client,
    userId,
    allowFetch = false
) {
    const cachedUser =
        client.users.cache.get(userId);

    if (cachedUser) {
        return (
            cachedUser.displayName ||
            cachedUser.username
        );
    }

    if (allowFetch) {
        try {
            const fetchedUser =
                await client.users.fetch(
                    userId
                );

            return (
                fetchedUser.displayName ||
                fetchedUser.username
            );
        } catch (error) {
            // 取得できない場合は代替名を使います。
        }
    }

    return (
        `ユーザー(` +
        `${String(userId).slice(-4)}` +
        `)`
    );
}

async function buildStatusText(
    client,
    guildId
) {
    const [
        workingRows,
        pausedRows
    ] = await Promise.all([
        activeIntervals(
            db,
            guildId
        ),
        pausedStates(
            db,
            guildId
        )
    ]);

    if (
        workingRows.length === 0 &&
        pausedRows.length === 0
    ) {
        return (
            '現在、作業中または一時停止中のメンバーはいません。\n' +
            '`/start` で作業を開始できます。'
        );
    }

    const sections = [];

    if (workingRows.length > 0) {
        const lines = [];

        for (const row of workingRows) {
            const username =
                await getUsername(
                    client,
                    row.user_id
                );

            const elapsedMs = Math.max(
                0,
                Date.now() - row.startMs
            );

            lines.push(
                `**${username}**\n` +
                `作業名: \`${row.task_name || '未設定'}\`\n` +
                `経過時間: **${format(elapsedMs)}**`
            );
        }

        sections.push(
            '**作業中**\n' +
            lines.join('\n\n')
        );
    }

    if (pausedRows.length > 0) {
        const lines = [];

        for (const row of pausedRows) {
            const username =
                await getUsername(
                    client,
                    row.user_id
                );

            const pausedMs = Math.max(
                0,
                Date.now() - row.pausedMs
            );

            lines.push(
                `**${username}**\n` +
                `作業名: \`${row.paused_task_name || '未設定'}\`\n` +
                `一時停止から: **${format(pausedMs)}**`
            );
        }

        sections.push(
            '**一時停止中**\n' +
            lines.join('\n\n')
        );
    }

    return sections.join('\n\n');
}

async function buildWeeklyEmbed(
    client,
    guildId
) {
    const range =
        jstCurrentWeekRange();

    const now = new Date();

    const rows = aggregate(
        await intervals(
            db,
            guildId,
            range.start,
            now
        ),
        range.start,
        now
    );

    const lines = [];

    for (
        let index = 0;
        index < rows.length;
        index += 1
    ) {
        const row = rows[index];

        const username =
            await getUsername(
                client,
                row.userId
            );

        lines.push(
            `**${index + 1}位** ` +
            `${username}  ` +
            `**${format(row.total)}**`
        );
    }

    return new EmbedBuilder()
        .setTitle(
            '今週の作業ランキング'
        )
        .setDescription(
            lines.length > 0
                ? lines.join('\n')
                : 'まだ今週の作業記録がありません。'
        )
        .setColor(0x00FF7F);
}

async function buildDailyData(
    client,
    guildId
) {
    const range = jstRange();
    const now = new Date();

    const rows = aggregate(
        await intervals(
            db,
            guildId,
            range.start,
            now
        ),
        range.start,
        now
    );

    const lines = [];
    const timelineData = [];

    for (
        let index = 0;
        index < rows.length;
        index += 1
    ) {
        const row = rows[index];

        const username =
            await getUsername(
                client,
                row.userId
            );

        lines.push(
            `**${index + 1}位** ` +
            `${username}  ` +
            `**${format(row.total)}**`
        );

        timelineData.push({
            username,
            sessions: row.sessions
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(
            '今日の作業ランキングとタイムライン'
        )
        .setDescription(
            lines.length > 0
                ? lines.join('\n')
                : '今日の作業記録はまだありません。'
        )
        .setColor(0x00BFFF)
        .setFooter({
            text:
                '作業開始・終了・一時停止・再開時に更新されます'
        })
        .setTimestamp();

    let attachment = null;

    if (timelineData.length > 0) {
        const buffer =
            await generateTimelineBuffer(
                timelineData,
                range.start.getTime()
            );

        const fileName =
            `timeline_${Date.now()}.png`;

        attachment =
            new AttachmentBuilder(
                buffer,
                {
                    name: fileName
                }
            );

        embed.setImage(
            `attachment://${fileName}`
        );
    }

    return {
        embed,
        attachment
    };
}

async function getStoredMessageId() {
    const result = await db.query(
        `
            SELECT value
            FROM bot_state
            WHERE key = $1
            LIMIT 1
        `,
        [STATE_KEY]
    );

    return result.rows[0]?.value || null;
}

async function saveStoredMessageId(
    messageId
) {
    await db.query(
        `
            INSERT INTO bot_state (
                key,
                value
            )
            VALUES ($1, $2)
            ON CONFLICT (key)
            DO UPDATE SET
                value = EXCLUDED.value
        `,
        [
            STATE_KEY,
            messageId
        ]
    );
}

async function getRankingChannel(
    client
) {
    const channelId =
        process.env.RANKING_CHANNEL_ID;

    if (!channelId) {
        throw new Error(
            'RANKING_CHANNEL_ID is not configured'
        );
    }

    const channel =
        await client.channels
            .fetch(channelId)
            .catch(() => null);

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        throw new Error(
            'Ranking channel was not found'
        );
    }

    return channel;
}

async function buildPayload(
    client,
    guildId
) {
    const statusText =
        await buildStatusText(
            client,
            guildId
        );

    const statusEmbed =
        new EmbedBuilder()
            .setTitle(
                '現在の作業状態'
            )
            .setDescription(
                statusText
            )
            .setColor(
                0xFFA500
            );

    const weeklyEmbed =
        await buildWeeklyEmbed(
            client,
            guildId
        );

    const dailyData =
        await buildDailyData(
            client,
            guildId
        );

    return {
        embeds: [
            statusEmbed,
            weeklyEmbed,
            dailyData.embed
        ],
        files:
            dailyData.attachment
                ? [
                    dailyData.attachment
                ]
                : []
    };
}

async function updatePersistentRankingCore(
    client,
    forceResend = false
) {
    const channel =
        await getRankingChannel(
            client
        );

    const guildId =
        channel.guildId || '';

    const payload =
        await buildPayload(
            client,
            guildId
        );

    const storedMessageId =
        await getStoredMessageId();

    let targetMessage = null;

    if (storedMessageId) {
        targetMessage =
            await channel.messages
                .fetch(storedMessageId)
                .catch(() => null);
    }

    if (
        forceResend &&
        targetMessage
    ) {
        try {
            await targetMessage.delete();

            targetMessage = null;

            console.log(
                '[Persistent Ranking] 旧常設メッセージを削除しました。'
            );
        } catch (error) {
            console.error(
                '[Persistent Ranking Delete Error]',
                error
            );
        }
    }

    if (targetMessage) {
        await targetMessage.edit({
            ...payload,
            attachments: []
        });

        return;
    }

    const newMessage =
        await channel.send(payload);

    await saveStoredMessageId(
        newMessage.id
    );

    console.log(
        '[Persistent Ranking] 新しい常設メッセージを送信しました。'
    );
}

function checkMemory() {
    const usedMb =
        process.memoryUsage().rss /
        1024 /
        1024;

    console.log(
        `[MEM] ${usedMb.toFixed(1)} MB`
    );

    if (usedMb > 450) {
        console.error(
            '[MEM] limit exceeded. exiting.'
        );

        process.exit(1);
    }
}

let runningPromise = null;
let updatePending = false;
let resendPending = false;

function safeUpdate(
    client,
    forceResend = false
) {
    updatePending = true;

    if (forceResend) {
        resendPending = true;
    }

    if (runningPromise) {
        return runningPromise;
    }

    runningPromise =
        (async () => {
            while (
                updatePending ||
                resendPending
            ) {
                const shouldResend =
                    resendPending;

                updatePending = false;
                resendPending = false;

                try {
                    await updatePersistentRankingCore(
                        client,
                        shouldResend
                    );

                    checkMemory();
                } catch (error) {
                    console.error(
                        '[Persistent Ranking Update Error]',
                        error
                    );
                }
            }
        })().finally(() => {
            runningPromise = null;
        });

    return runningPromise;
}

let lastCronExecutionTime = 0;

module.exports = (client) => {
    cron.schedule(
        '*/10 * * * *',
        async () => {
            try {
                const channel =
                    await getRankingChannel(
                        client
                    );

                const guildId =
                    channel.guildId || '';

                const result =
                    await db.query(
                        `
                            SELECT COUNT(*)::int AS count
                            FROM activity_intervals
                            WHERE guild_id = $1
                              AND is_active = TRUE
                              AND end_at IS NULL
                        `,
                        [guildId]
                    );

                const activeCount =
                    result.rows[0]?.count || 0;

                const now = Date.now();

                if (activeCount === 0) {
                    const idleIntervalMs =
                        60 * 60 * 1000;

                    if (
                        now -
                        lastCronExecutionTime <
                        idleIntervalMs
                    ) {
                        return;
                    }
                }

                lastCronExecutionTime = now;

                await safeUpdate(
                    client,
                    false
                );
            } catch (error) {
                console.error(
                    '[Persistent Ranking Cron Error]',
                    error
                );

                await safeUpdate(
                    client,
                    false
                );
            }
        },
        {
            timezone: 'Asia/Tokyo'
        }
    );

    return {
        update:
            () =>
                safeUpdate(
                    client,
                    false
                ),

        resend:
            () =>
                safeUpdate(
                    client,
                    true
                )
    };
};
