const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

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
        .setName('today')
        .setDescription('今日の作業時間を表示'),

    async execute(interaction) {

        const userId =
            interaction.user.id;

        const start =
            new Date();

        start.setHours(0, 0, 0, 0);

        const end =
            new Date();

        end.setHours(23, 59, 59, 999);

        db.all(
            `
            SELECT *
            FROM work_sessions
            WHERE user_id = ?
            AND start_time BETWEEN ? AND ?
            `,
            [
                userId,
                start.getTime(),
                end.getTime()
            ],

            (err, rows) => {

                if (err) {

                    console.error(err);

                    return interaction.reply({
                        content: 'DBエラー',
                        ephemeral: true
                    });
                }

                if (!rows.length) {

                    return interaction.reply({
                        content: '今日の作業記録はありません',
                        ephemeral: true
                    });
                }

                let total = 0;

                const taskTotals = {};

                for (const row of rows) {

    const duration =
        row.duration ??
        (Date.now() - row.start_time);

    total += duration;

    const task =
        row.task_name || '未設定';

    taskTotals[task] =
        (taskTotals[task] || 0)
        + duration;
}

                let details = '';

                for (const [task, time] of Object.entries(taskTotals)) {

                    details +=
                        `${task} : ${format(time)}\n`;
                }

                const embed =
                    new EmbedBuilder()
                        .setTitle('今日の作業実績')
                        .addFields(
                            {
                                name: '合計',
                                value: format(total)
                            },
                            {
                                name: '内訳',
                                value: details
                            }
                        )
                        .setColor(0x00BFFF)
                        .setTimestamp();

                interaction.reply({
                    embeds: [embed]
                });
            }
        );
    }
};