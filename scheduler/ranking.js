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

async function sendDailyRanking(client) {

    const channel =
        await client.channels.fetch(
            process.env.RANKING_CHANNEL_ID
        );

    const start =
        new Date();

    start.setHours(0,0,0,0);

    const end =
        new Date();

    end.setHours(23,59,59,999);

    db.all(
        `
        SELECT
            user_id,
            SUM(duration) as total
        FROM work_sessions
        WHERE start_time BETWEEN ? AND ?
        GROUP BY user_id
        ORDER BY total DESC
        `,
        [
            start.getTime(),
            end.getTime()
        ],

        async (err, rows) => {

            if (err) {
                console.error(err);
                return;
            }

            let message =
                '📊 本日の作業ランキング\n\n';

            for (
                let i = 0;
                i < rows.length;
                i++
            ) {

                const user =
                    await client.users.fetch(
                        rows[i].user_id
                    );

                message +=
                    `${i+1}位 ${user.username}\n` +
                    `${format(rows[i].total)}\n\n`;
            }

            await channel.send(message);
        }
    );
}

async function sendWeeklyRanking(client) {

    const channel =
        await client.channels.fetch(
            process.env.RANKING_CHANNEL_ID
        );

    const now = new Date();

    const weekAgo =
        new Date(
            now.getTime()
            - 7 * 24 * 60 * 60 * 1000
        );

    db.all(
        `
        SELECT
            user_id,
            SUM(duration) as total
        FROM work_sessions
        WHERE start_time BETWEEN ? AND ?
        GROUP BY user_id
        ORDER BY total DESC
        `,
        [
            weekAgo.getTime(),
            now.getTime()
        ],

        async (err, rows) => {

            if (err) {
                console.error(err);
                return;
            }

            let message =
                '🏆 今週の作業ランキング\n\n';

            for (
                let i = 0;
                i < rows.length;
                i++
            ) {

                const user =
                    await client.users.fetch(
                        rows[i].user_id
                    );

                message +=
                    `${i+1}位 ${user.username}\n` +
                    `${format(rows[i].total)}\n\n`;
            }

            await channel.send(message);
        }
    );
}

function startRankingJobs(client) {

    // 毎日2:00

    cron.schedule(
        '0 2 * * *',
        () => sendDailyRanking(client)
    );

    // 月曜2:00

    cron.schedule(
        '0 2 * * 1',
        () => sendWeeklyRanking(client)
    );
}

module.exports = {
    startRankingJobs
};