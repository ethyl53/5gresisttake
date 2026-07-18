'use strict';

const cron = require('node-cron');
const {
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    intervals,
    aggregate,
    jstPreviousDayRange,
    jstPreviousWeekRange,
    format
} = require('../utils/activityRead');

const {
    generateTimelineBuffer
} = require('../utils/timeline');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isJstMonday(now = new Date()) {
    const jstDate = new Date(
        now.getTime() + JST_OFFSET_MS
    );

    return jstDate.getUTCDay() === 1;
}

async function getUsername(client, userId) {
    const cachedUser = client.users.cache.get(userId);

    if (cachedUser) {
        return cachedUser.displayName || cachedUser.username;
    }

    try {
        const fetchedUser = await client.users.fetch(userId);
        return fetchedUser.displayName || fetchedUser.username;
    } catch (error) {
        return `ユーザー(${String(userId).slice(-4)})`;
    }
}

async function buildRankingAndTimeline(
    client,
    guildId,
    start,
    end,
    title,
    color,
    includeTimeline = false
) {
    const rows = aggregate(
        await intervals(
            db,
            guildId || '',
            start,
            end
        ),
        start,
        end
    );

    const lines = [];
    const timelineData = [];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const username = await getUsername(
            client,
            row.userId
        );

        lines.push(
            `**${index + 1}位** ${username}\n` +
            `**${format(row.total)}**`
        );

        if (includeTimeline) {
            timelineData.push({
                username,
                sessions: row.sessions
            });
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(
            lines.length > 0
                ? lines.join('\n\n')
                : '作業記録がありませんでした。'
        )
        .setColor(color)
        .setTimestamp();

    let attachment = null;

    if (
        includeTimeline &&
        timelineData.length > 0
    ) {
        const buffer = await generateTimelineBuffer(
            timelineData,
            start.getTime()
        );

        const fileName =
            `daily_summary_${Date.now()}.png`;

        attachment = new AttachmentBuilder(
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

module.exports = (
    client,
    persistentRankingManager
) => {
    cron.schedule(
        '0 2 * * *',
        async () => {
            const channelId =
                process.env.RANKING_CHANNEL_ID;

            if (!channelId) {
                console.error(
                    '[Ranking Scheduler] RANKING_CHANNEL_IDが設定されていません。'
                );
                return;
            }

            try {
                const channel = await client.channels
                    .fetch(channelId)
                    .catch(() => null);

                if (!channel || !channel.isTextBased()) {
                    console.error(
                        '[Ranking Scheduler] ランキングチャンネルを取得できませんでした。'
                    );
                    return;
                }

                const now = new Date();

                const dailyRange =
                    jstPreviousDayRange(now);

                const dailyData =
                    await buildRankingAndTimeline(
                        client,
                        channel.guildId || '',
                        dailyRange.start,
                        dailyRange.end,
                        '昨日の作業ランキング',
                        0x00BFFF,
                        true
                    );

                const dailyPayload = {
                    embeds: [
                        dailyData.embed
                    ]
                };

                if (dailyData.attachment) {
                    dailyPayload.files = [
                        dailyData.attachment
                    ];
                }

                await channel.send(dailyPayload);

                if (isJstMonday(now)) {
                    const weeklyRange =
                        jstPreviousWeekRange(now);

                    const weeklyData =
                        await buildRankingAndTimeline(
                            client,
                            channel.guildId || '',
                            weeklyRange.start,
                            weeklyRange.end,
                            '先週の作業ランキング',
                            0x00FF7F,
                            false
                        );

                    await channel.send({
                        embeds: [
                            weeklyData.embed
                        ]
                    });
                }

                if (
                    persistentRankingManager &&
                    typeof persistentRankingManager.resend ===
                        'function'
                ) {
                    await persistentRankingManager.resend();
                } else {
                    console.error(
                        '[Ranking Scheduler] 常設ランキング管理機能が渡されていません。'
                    );
                }
            } catch (error) {
                console.error(
                    '[Ranking Scheduler Error]',
                    error
                );
            }
        },
        {
            timezone: 'Asia/Tokyo'
        }
    );
};