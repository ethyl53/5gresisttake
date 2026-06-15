const cron = require('node-cron');

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

async function buildRankingMessage(
    title,
    startTime,
    endTime,
    client
) {

    const result =
        await db.query(
            `
            SELECT *
            FROM work_sessions
            WHERE start_time BETWEEN $1 AND $2
            `,
            [
                startTime,
                endTime
            ]
        );

    const rows = result.rows;

    if (!rows.length) {

        return `${title}\n\nデータなし`;
    }

    const totals = {};

    for (const row of rows) {

        const duration =
            row.duration
                ? Number(row.duration)
                : Date.now()
                    - Number(row.start_time);

        totals[row.user_id] =
            (totals[row.user_id] || 0)
            + duration;
    }

    const ranking =
        Object.entries(totals)
            .sort(
                (a, b) =>
                    b[1] - a[1]
            );

    let message =
        `${title}\n\n`;

    const medals = [
        '🥇',
        '🥈',
        '🥉'
    ];

    for (
        let i = 0;
        i < ranking.length;
        i++
    ) {

        const [
            userId,
            total
        ] = ranking[i];

        try {

            const user =
                await client.users.fetch(
                    userId
                );

            const rank =
                i < 3
                    ? medals[i]
                    : `${i + 1}位`;

            message +=
                `${rank} ${user.username}\n`
                + `${format(total)}\n\n`;

        } catch (err) {

            console.error(
                'Failed to fetch user:',
                err
            );
        }
    }

    return message;
}

async function sendDailyRanking(client) {

    try {

        const channel =
            await client.channels.fetch(
                process.env.RANKING_CHANNEL_ID
            );

        const start =
            new Date();

        start.setHours(
            0, 0, 0, 0
        );

        const end =
            new Date();

        end.setHours(
            23, 59, 59, 999
        );

        const message =
            await buildRankingMessage(
                '📊 本日の作業ランキング',
                start.getTime(),
                end.getTime(),
                client
            );

        await channel.send(message);

    } catch (err) {

        console.error(
            'Daily ranking error:',
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

        const now =
            new Date();

        const weekAgo =
            new Date(
                now.getTime()
                - 7 * 24 * 60 * 60 * 1000
            );

        const message =
            await buildRankingMessage(
                '🏆 今週の作業ランキング',
                weekAgo.getTime(),
                now.getTime(),
                client
            );

        await channel.send(message);

    } catch (err) {

        console.error(
            'Weekly ranking error:',
            err
        );
    }
}

function startRankingJobs(client) {

    console.log(
        '[Scheduler] Ranking jobs started'
    );

    // 毎日 AM2:00

    cron.schedule(
        '0 2 * * *',
        () => {
            console.log(
                '[Scheduler] Daily ranking'
            );

            sendDailyRanking(client);
        }
    );

    // 毎週 月曜 AM2:00

    cron.schedule(
        '0 2 * * 1',
        () => {
            console.log(
                '[Scheduler] Weekly ranking'
            );

            sendWeeklyRanking(client);
        }
    );
}

module.exports = {
    startRankingJobs
};