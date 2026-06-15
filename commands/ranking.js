const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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

module.exports = {

    data: new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('作業時間ランキングを表示')

        .addStringOption(option =>
            option
                .setName('period')
                .setDescription('ランキング期間')
                .addChoices(
                    { name: '本日', value: 'today' },
                    { name: '今週', value: 'week' },
                    { name: '今月', value: 'month' }
                )
                .setRequired(false)
        ),

    async execute(interaction) {

        const period =
            interaction.options.getString('period')
            || 'today';

        let start;
        let end;
        let title;

        if (period === 'today') {

            start = new Date();
            start.setHours(0, 0, 0, 0);

            end = new Date();
            end.setHours(23, 59, 59, 999);

            title = '📊 本日の作業ランキング';

        } else if (period === 'week') {

            end = new Date();

            start =
                new Date(
                    end.getTime()
                    - 7 * 24 * 60 * 60 * 1000
                );

            title = '🏆 今週の作業ランキング';

        } else {

            end = new Date();

            start =
                new Date(
                    end.getTime()
                    - 30 * 24 * 60 * 60 * 1000
                );

            title = '🎯 今月の作業ランキング';
        }

        try {

            const result =
                await db.query(
                    `
                    SELECT *
                    FROM work_sessions
                    WHERE start_time BETWEEN $1 AND $2
                    `,
                    [
                        start.getTime(),
                        end.getTime()
                    ]
                );

            const rows = result.rows;

            if (!rows.length) {

                return interaction.reply({
                    content: 'ランキングデータがありません'
                });
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
                    .sort((a, b) => b[1] - a[1]);

            let description = '';

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
                        await interaction.client.users.fetch(
                            userId
                        );

                    const medal =
                        i < 3
                            ? medals[i]
                            : `${i + 1}位`;

                    description +=
                        `${medal} **${user.username}**\n`
                        + `${format(total)}\n\n`;

                } catch (err) {

                    console.error(
                        'Failed to fetch user:',
                        err
                    );

                    description +=
                        `${i + 1}位 (ユーザー取得失敗)\n`
                        + `${format(total)}\n\n`;
                }
            }

            const embed =
                new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor(0x00BFFF)
                    .setFooter({
                        text:
                            `更新: ${
                                new Date()
                                    .toLocaleString('ja-JP')
                            }`
                    })
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

        } catch (err) {

            console.error(err);

            await interaction.reply({
                content: 'DBエラー'
            });
        }
    }
};