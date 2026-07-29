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
    aggregate,
    format,
    intervals,
    jstPreviousDayRange,
    jstPreviousWeekRange
} = require('../utils/activityRead');
const {
    generateTimelineBuffer
} = require('../utils/timeline');

function isJstMonday(now = new Date()) {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.getUTCDay() === 1;
}

async function getUsername(client, guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
        return member.displayName;
    }
    const user = await client.users.fetch(userId).catch(() => null);
    return user?.username || `ユーザー(${String(userId).slice(-4)})`;
}

async function buildRankingAndTimeline(client, guild, start, end, title, color, includeTimeline) {
    const rows = aggregate(
        await intervals(db, guild.id, start, end),
        start,
        end
    );
    const names = await Promise.all(rows.map((row) =>
        getUsername(client, guild, row.userId)
    ));
    const lines = rows.map((row, index) =>
        `**${index + 1}位** ${names[index]}\n**${format(row.total)}**`
    );

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(lines.length > 0 ? lines.join('\n\n') : '学習記録はありません。')
        .setColor(color)
        .setTimestamp();

    if (!includeTimeline || rows.length === 0) {
        return { embed, attachment: null };
    }

    const fileName = `daily_summary_${guild.id}_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(
        await generateTimelineBuffer(
            rows.map((row, index) => ({
                username: names[index],
                sessions: row.sessions
            })),
            start.getTime()
        ),
        { name: fileName }
    );
    embed.setImage(`attachment://${fileName}`);
    return { embed, attachment };
}

async function getPostingChannel(client, guildId, settings) {
    const channelId = settings.ranking_channel_id ||
        settings.persistent_ranking_channel_id;
    if (!channelId) {
        console.warn(`[Ranking Scheduler] ${guildId}: 投稿先が未設定のためスキップします。`);
        return null;
    }
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.guildId !== guildId) {
        console.warn(`[Ranking Scheduler] ${guildId}: 投稿先を取得できないか権限がありません。`);
        return null;
    }
    return channel;
}

async function postForGuild(client, persistentRankingManager, guildId, now) {
    const settings = await getGuildSettings(db, guildId);
    if (!settings) {
        console.warn(`[Ranking Scheduler] ${guildId}: サーバー設定が未完了のためスキップします。`);
        return;
    }

    const dailyEnabled = settings.daily_ranking_enabled;
    const weeklyEnabled = settings.weekly_ranking_enabled && isJstMonday(now);
    if (!dailyEnabled && !weeklyEnabled) {
        await persistentRankingManager?.resend?.(guildId);
        return;
    }

    const guild = client.guilds.cache.get(guildId) ||
        await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        console.warn(`[Ranking Scheduler] ${guildId}: サーバーを取得できません。`);
        return;
    }

    const channel = await getPostingChannel(client, guildId, settings);
    if (!channel) {
        return;
    }

    if (dailyEnabled) {
        const range = jstPreviousDayRange(now);
        const daily = await buildRankingAndTimeline(
            client,
            guild,
            range.start,
            range.end,
            '前日の学習ランキング',
            0x00BFFF,
            true
        );
        await channel.send({
            embeds: [daily.embed],
            files: daily.attachment ? [daily.attachment] : []
        });
    }

    if (weeklyEnabled) {
        const range = jstPreviousWeekRange(now);
        const weekly = await buildRankingAndTimeline(
            client,
            guild,
            range.start,
            range.end,
            '先週の学習ランキング',
            0x00FF7F,
            false
        );
        await channel.send({ embeds: [weekly.embed] });
    }

    await persistentRankingManager?.resend?.(guildId);
}

module.exports = (client, persistentRankingManager) => {
    cron.schedule('0 2 * * *', async () => {
        const now = new Date();
        const guildIds = [...client.guilds.cache.keys()];
        await Promise.all(guildIds.map(async (guildId) => {
            try {
                await postForGuild(client, persistentRankingManager, guildId, now);
            } catch (error) {
                console.error('[Ranking Scheduler Guild Error]', { guildId, error });
            }
        }));
    }, { timezone: 'Asia/Tokyo' });

    console.log('[Ranking Scheduler] started (JST 02:00)');
};
