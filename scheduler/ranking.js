const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');

const db = require('../database/db');

function format(ms) {

const totalMinutes =
    Math.floor(ms / 1000 / 60);

const hours =
    Math.floor(totalMinutes / 60);

const minutes =
    totalMinutes % 60;

return `${hours}時間${minutes}分`;

}

async function sendDailyRanking(client) {

try {

    const channel =
        await client.channels.fetch(
            process.env.RANKING_CHANNEL_ID
        );

    const end = new Date();

    end.setHours(1);
    end.setMinutes(59);
    end.setSeconds(59);
    end.setMilliseconds(999);

    const start =
        new Date(
            end.getTime()
            - (24 * 60 * 60 * 1000)
            \+ 1
        );

    const result =
        await db.query(
            `
            SELECT
                user_id,
                SUM(duration) AS total
            FROM work_sessions
            WHERE start_time BETWEEN $1 AND $2
            GROUP BY user_id
            ORDER BY total DESC
            `,
            [
                start.getTime(),
                end.getTime()
            ]
        );

    const rows =
        result.rows;

    if (!rows.length) {

        return channel.send({
            content:
                '📊 本日の作業ランキング\nデータなし'
        });
    }

    let description = '';

    let grandTotal = 0;

    const medals =
        ['🥇', '🥈', '🥉'];

    for (
        let i = 0;
        i < rows.length;
        i++
    ) {

        const row =
            rows[i];

        grandTotal +=
            Number(row.total);

        let username =
            '不明ユーザー';

        try {

            const user =
                await client.users.fetch(
                    row.user_id
                );

            username =
                user.username;

        } catch {}

        const rank =
            i < 3
            ? medals[i]
            : `${i + 1}位`;

        description +=
            `${rank} **${username}**\n` +
            `${format(Number(row.total))}\n\n`;
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                '📊 本日の作業ランキング'
            )
            .setDescription(
                description
            )
            .addFields(
                {
                    name: '参加人数',
                    value: `${rows.length}人`,
                    inline: true
                },
                {
                    name: '総学習時間',
                    value: format(grandTotal),
                    inline: true
                }
            )
            .setColor(0x00BFFF)
            .setFooter({
                text:
                    `${start.toLocaleString('ja-JP')} ～ ${end.toLocaleString('ja-JP')}`
            })
            .setTimestamp();

    await channel.send({
        embeds: [embed]
    });

} catch (err) {

    console.error(
        '[Daily Ranking Error]',
        err
    );
}
}

async function sendWeeklyRanking(client) {

try {

    const channel =
        await client.channels.fetch(
            process.env.RANKING_CHANNEL_ID
        );

    const end =
        new Date();

    end.setHours(1);
    end.setMinutes(59);
    end.setSeconds(59);
    end.setMilliseconds(999);

    const start =
        new Date(
            end.getTime()
            - (7 * 24 * 60 * 60 * 1000)
            \+ 1
        );

    const result =
        await db.query(
            `
            SELECT
                user_id,
                SUM(duration) AS total
            FROM work_sessions
            WHERE start_time BETWEEN $1 AND $2
            GROUP BY user_id
            ORDER BY total DESC
            `,
            [
                start.getTime(),
                end.getTime()
            ]
        );

    const rows =
        result.rows;

    if (!rows.length) {

        return channel.send({
            content:
                '🏆 今週の作業ランキング\nデータなし'
        });
    }

    let description = '';

    let grandTotal = 0;

    const medals =
        ['🥇', '🥈', '🥉'];

    for (
        let i = 0;
        i < rows.length;
        i++
    ) {

        const row =
            rows[i];

        grandTotal +=
            Number(row.total);

        let username =
            '不明ユーザー';

        try {

            const user =
                await client.users.fetch(
                    row.user_id
                );

            username =
                user.username;

        } catch {}

        const rank =
            i < 3
            ? medals[i]
            : `${i + 1}位`;

        description +=
            `${rank} **${username}**\n` +
            `${format(Number(row.total))}\n\n`;
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                '🏆 今週の作業ランキング'
            )
            .setDescription(
                description
            )
            .addFields(
                {
                    name: '参加人数',
                    value: `${rows.length}人`,
                    inline: true
                },
                {
                    name: '総学習時間',
                    value: format(grandTotal),
                    inline: true
                }
            )
            .setColor(0xFFD700)
            .setFooter({
                text:
                    `${start.toLocaleString('ja-JP')} ～ ${end.toLocaleString('ja-JP')}`
            })
            .setTimestamp();

    await channel.send({
        embeds: [embed]
    });

} catch (err) {

    console.error(
        '[Weekly Ranking Error]',
        err
    );
}
}

function startRankingJobs(client) {

console.log(
    '[Scheduler] Ranking jobs started'
);

// 毎日 02:00

cron.schedule(
    '0 2 * * *',
    () => sendDailyRanking(client),
    {
        timezone: 'Asia/Tokyo'
    }
);

// 毎週 月曜 02:00

cron.schedule(
    '0 2 * * 1',
    () => sendWeeklyRanking(client),
    {
        timezone: 'Asia/Tokyo'
    }
);

}

module.exports = {
startRankingJobs
};