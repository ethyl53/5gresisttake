'use strict';

const cron = require('node-cron');
const {
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    getGuildSettings
} = require('../database/guildSettingsService');
const {
    activeIntervals,
    aggregate,
    format,
    intervals,
    jstCurrentWeekRange,
    jstRange,
    pausedStates
} = require('../utils/activityRead');
const {
    generateTimelineBuffer
} = require('../utils/timeline');

const STATE_KEY_PREFIX = 'persistent_ranking_message_id:';

async function getUsername(client, guildId, userId) {
    const guild = client.guilds.cache.get(guildId) ||
        await client.guilds.fetch(guildId).catch(() => null);

    const member = guild
        ? await guild.members.fetch(userId).catch(() => null)
        : null;

    if (member) {
        return member.displayName;
    }

    const user = await client.users.fetch(userId).catch(() => null);
    return user?.username || `ユーザー(${String(userId).slice(-4)})`;
}

async function buildStatusText(client, guildId) {
    const [workingRows, pausedRows] = await Promise.all([
        activeIntervals(db, guildId),
        pausedStates(db, guildId)
    ]);

    if (workingRows.length === 0 && pausedRows.length === 0) {
        return '現在、作業中または一時停止中のメンバーはいません。\n`/start` で作業を開始できます。';
    }

    const sections = [];

    if (workingRows.length > 0) {
        const lines = await Promise.all(workingRows.map(async (row) => {
            const username = await getUsername(client, guildId, row.user_id);
            const elapsed = Math.max(0, Date.now() - row.startMs);
            return `**${username}**\n作業名: \`${row.task_name || '未設定'}\`\n経過時間: **${format(elapsed)}**`;
        }));
        sections.push(`**作業中**\n${lines.join('\n\n')}`);
    }

    if (pausedRows.length > 0) {
        const lines = await Promise.all(pausedRows.map(async (row) => {
            const username = await getUsername(client, guildId, row.user_id);
            const elapsed = Math.max(0, Date.now() - row.pausedMs);
            return `**${username}**\n作業名: \`${row.paused_task_name || '未設定'}\`\n一時停止から: **${format(elapsed)}**`;
        }));
        sections.push(`**一時停止中**\n${lines.join('\n\n')}`);
    }

    return sections.join('\n\n');
}

async function rankingLines(client, guildId, rows) {
    return Promise.all(rows.map(async (row, index) => {
        const username = await getUsername(client, guildId, row.userId);
        return `**${index + 1}位** ${username}  **${format(row.total)}**`;
    }));
}

async function buildWeeklyEmbed(client, guildId, now) {
    const range = jstCurrentWeekRange(now);
    const rows = aggregate(
        await intervals(db, guildId, range.start, now),
        range.start,
        now
    );
    const lines = await rankingLines(client, guildId, rows);

    return new EmbedBuilder()
        .setTitle('今週の学習ランキング')
        .setDescription(lines.length > 0 ? lines.join('\n') : 'まだ今週の学習記録はありません。')
        .setColor(0x00FF7F);
}

async function buildDailyData(client, guildId, now) {
    const range = jstRange(1, now);
    const rows = aggregate(
        await intervals(db, guildId, range.start, now),
        range.start,
        now
    );
    const lines = await rankingLines(client, guildId, rows);
    const timelineData = await Promise.all(rows.map(async (row) => ({
        username: await getUsername(client, guildId, row.userId),
        sessions: row.sessions
    })));

    const embed = new EmbedBuilder()
        .setTitle('今日の学習ランキングとタイムライン')
        .setDescription(lines.length > 0 ? lines.join('\n') : '今日の学習記録はまだありません。')
        .setColor(0x00BFFF)
        .setFooter({
            text: '学習時間は開始・終了・一時停止時間をもとに計算されます。'
        })
        .setTimestamp();

    if (timelineData.length === 0) {
        return { embed, attachment: null };
    }

    const fileName = `timeline_${guildId}_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(
        await generateTimelineBuffer(timelineData, range.start.getTime()),
        { name: fileName }
    );
    embed.setImage(`attachment://${fileName}`);
    return { embed, attachment };
}

async function buildPayload(client, guildId) {
    const now = new Date();
    const [statusText, weeklyEmbed, dailyData] = await Promise.all([
        buildStatusText(client, guildId),
        buildWeeklyEmbed(client, guildId, now),
        buildDailyData(client, guildId, now)
    ]);

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('現在の作業状況')
                .setDescription(statusText)
                .setColor(0xFFA500),
            weeklyEmbed,
            dailyData.embed
        ],
        files: dailyData.attachment ? [dailyData.attachment] : []
    };
}

async function getStoredMessageId(guildId) {
    const result = await db.query(
        'SELECT value FROM bot_state WHERE key = $1 LIMIT 1',
        [`${STATE_KEY_PREFIX}${guildId}`]
    );
    return result.rows[0]?.value || null;
}

async function saveStoredMessageId(guildId, messageId) {
    await db.query(
        `
            INSERT INTO bot_state (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key)
            DO UPDATE SET value = EXCLUDED.value
        `,
        [`${STATE_KEY_PREFIX}${guildId}`, messageId]
    );
}

async function getRankingChannel(client, guildId, settings) {
    const channelId = settings.persistent_ranking_channel_id ||
        settings.ranking_channel_id;

    if (!channelId) {
        console.warn(`[Persistent Ranking] ${guildId}: 投稿先が未設定のためスキップします。`);
        return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.guildId !== guildId) {
        console.warn(`[Persistent Ranking] ${guildId}: 投稿先を取得できないか権限がありません。`);
        return null;
    }

    return channel;
}

async function updatePersistentRankingCore(client, guildId, forceResend) {
    const settings = await getGuildSettings(db, guildId);
    if (!settings) {
        console.warn(`[Persistent Ranking] ${guildId}: サーバー設定が未完了のためスキップします。`);
        return { updated: false, reason: 'not_configured' };
    }

    if (!settings.persistent_ranking_enabled) {
        return { updated: false, reason: 'disabled' };
    }

    const channel = await getRankingChannel(client, guildId, settings);
    if (!channel) {
        return { updated: false, reason: 'channel_unavailable' };
    }

    const payload = await buildPayload(client, guildId);
    const storedMessageId = await getStoredMessageId(guildId);
    let targetMessage = storedMessageId
        ? await channel.messages.fetch(storedMessageId).catch(() => null)
        : null;

    if (forceResend && targetMessage) {
        await targetMessage.delete().catch((error) => {
            console.error('[Persistent Ranking Delete Error]', { guildId, error });
        });
        targetMessage = null;
    }

    if (targetMessage) {
        await targetMessage.edit({ ...payload, attachments: [] });
        return { updated: true, messageId: targetMessage.id };
    }

    const message = await channel.send(payload);
    await saveStoredMessageId(guildId, message.id);
    console.log(`[Persistent Ranking] ${guildId}: 常設ランキングを投稿しました。`);
    return { updated: true, messageId: message.id };
}

function allGuildIds(client) {
    return [...client.guilds.cache.keys()];
}

function checkMemory() {
    const usedMb = process.memoryUsage().rss / 1024 / 1024;
    console.log(`[MEM] ${usedMb.toFixed(1)} MB`);
}

module.exports = (client) => {
    const queues = new Map();

    const enqueue = (guildId, forceResend = false) => {
        if (!guildId) {
            return Promise.resolve({ updated: false, reason: 'missing_guild' });
        }

        const state = queues.get(guildId) || {
            running: null,
            updatePending: false,
            resendPending: false
        };
        queues.set(guildId, state);
        state.updatePending = true;
        state.resendPending = state.resendPending || forceResend;

        if (state.running) {
            return state.running;
        }

        state.running = (async () => {
            let lastResult = null;
            while (state.updatePending || state.resendPending) {
                const resend = state.resendPending;
                state.updatePending = false;
                state.resendPending = false;
                try {
                    lastResult = await updatePersistentRankingCore(client, guildId, resend);
                    checkMemory();
                } catch (error) {
                    console.error('[Persistent Ranking Update Error]', { guildId, error });
                    lastResult = { updated: false, reason: 'error' };
                }
            }
            return lastResult;
        })().finally(() => {
            state.running = null;
        });

        return state.running;
    };

    const update = (guildId = null) => guildId
        ? enqueue(guildId, false)
        : Promise.all(allGuildIds(client).map((id) => enqueue(id, false)));

    const resend = (guildId = null) => guildId
        ? enqueue(guildId, true)
        : Promise.all(allGuildIds(client).map((id) => enqueue(id, true)));

    cron.schedule('*/10 * * * *', () => {
        update().catch((error) => {
            console.error('[Persistent Ranking Cron Error]', error);
        });
    }, { timezone: 'Asia/Tokyo' });

    return { update, resend };
};
