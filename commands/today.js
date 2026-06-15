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

const subjectNameMap = {
blue: '数学',
lightblue: '化学',
orange: '物理',
yellow: '英語',
red: '国語',
green: '社会',
purple: 'その他'
};

module.exports = {

data: new SlashCommandBuilder()
    .setName('today')
    .setDescription('今日の作業時間を表示'),

async execute(interaction) {

    const userId =
        interaction.user.id;

    try {

        const start =
            new Date();

        start.setHours(0, 0, 0, 0);

        const end =
            new Date();

        end.setHours(23, 59, 59, 999);

        const result = await db.query(
            `
            SELECT *
            FROM work_sessions
            WHERE user_id = $1
            AND start_time BETWEEN $2 AND $3
            ORDER BY start_time ASC
            `,
            [
                userId,
                start.getTime(),
                end.getTime()
            ]
        );

        const rows = result.rows;

        if (!rows.length) {

            return interaction.reply({
                content: '今日の作業記録はありません'
            });
        }

        let total = 0;

        const subjectTotals = {};

        for (const row of rows) {

    const duration =
        row.duration
        ?? (Date.now() - Number(row.start_time));

    total += duration;

    const task =
        row.task_name || '未設定';

    taskTotals[task] =
        (taskTotals[task] || 0)
        + duration;

    const subject =
        row.color || '未設定';

    subjectTotals[subject] =
        (subjectTotals[subject] || 0)
        + duration;
}

        let details = '';
        let subjectDetails = '';

        const sortedSubjects =
            Object.entries(subjectTotals)
                .sort((a, b) => b[1] - a[1]);

        for (const [subject, time] of sortedSubjects) {

            details +=
                `${subject} : ${format(time)}\n`;
        }
        for (const [subject, time] of Object.entries(subjectTotals)) {

            subjectDetails +=
                `${subject} : ${format(time)}\n`;
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
                name: '科目別',
                value:
                    subjectDetails
                    || 'データなし'
            },
            {
                name: '作業別',
                value:
                    details
                    || 'データなし'
            }
        )
        .setColor(0x00BFFF)
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