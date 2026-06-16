const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const db = require('../database/db');

const colorMap = {
orange: 0xFFA500,
yellow: 0xFFFF00,
green: 0x00B000,
blue: 0x0074FF,
lightblue: 0x66CCFF,
gray: 0x808080
};

const subjectColorMap = {
math: 'blue',
chemistry: 'lightblue',
physics: 'orange',
english: 'yellow',
social: 'green',
other: 'gray'
};

const subjectNameMap = {
math: '数学',
chemistry: '化学',
physics: '物理',
english: '英語',
social: '社会',
other: 'その他'
};

module.exports = {
data: new SlashCommandBuilder()
.setName('start')
.setDescription('作業開始')

    .addStringOption(option =>
        option
            .setName('subject')
            .setDescription('科目')
            .addChoices(
                { name: '数学', value: 'math' },
                { name: '化学', value: 'chemistry' },
                { name: '物理', value: 'physics' },
                { name: '英語', value: 'english' },
                { name: '社会', value: 'social' },
                { name: 'その他', value: 'other' }
            )
            .setRequired(false)
    )

    .addStringOption(option =>
        option
            .setName('task')
            .setDescription('作業名')
            .setRequired(false)
    ),

async execute(interaction) {

    const userId = interaction.user.id;

    const subject =
        interaction.options.getString('subject');

    const color =
        subjectColorMap[subject] || null;

    const task =
        interaction.options.getString('task');

    try {

        const result = await db.query(
            `
            SELECT *
            FROM work_sessions
            WHERE user_id = $1
            AND end_time IS NULL
            LIMIT 1
            `,
            [userId]
        );

        const row = result.rows[0];

        if (row) {

            const endTime = Date.now();
            const duration = endTime - Number(row.start_time);

            await db.query(
                `
                UPDATE work_sessions
                SET
                    end_time = $1,
                    duration = $2
                WHERE id = $3
                `,
                [
                    endTime,
                    duration,
                    row.id
                ]
            );

            const totalMinutes =
                Math.floor(duration / 1000 / 60);

            const hours =
                Math.floor(totalMinutes / 60);

            const minutes =
                totalMinutes % 60;

            const previousEmbed =
                new EmbedBuilder()
                    .setTitle('◆作業終了（自動）')
                    .setDescription(
                        '新しい作業開始のため、前の作業を終了しました。'
                    )
                    .addFields(
                        {
                            name: '作業名',
                            value: row.task_name || '未設定',
                            inline: true
                        },
                        {
                            name: '時間',
                            value: `${hours}時間 ${minutes}分`,
                            inline: true
                        }
                    )
                    .setColor(
                        colorMap[row.color] || 0x00BFFF
                    )
                    .setFooter({
                        text: `ユーザー: ${interaction.user.tag}`
                    })
                    .setTimestamp();

            await interaction.reply({
                embeds: [previousEmbed]
            });

            await new Promise(resolve =>
                setTimeout(resolve, 500)
            );
        }

        const startTime = Date.now();

        await db.query(
            `
            INSERT INTO work_sessions
            (
                user_id,
                task_name,
                color,
                start_time
            )
            VALUES ($1, $2, $3, $4)
            `,
            [
                userId,
                task || null,
                color,
                startTime
            ]
        );

        const embed =
            new EmbedBuilder()
                .setTitle('◇作業開始')
                .setDescription('作業を開始しました。')
                .addFields(
                    {
                        name: '作業名',
                        value: task || '未設定',
                        inline: true
                    },
                    {
                        name: '科目',
                        value: subjectNameMap[subject] || '未設定',
                        inline: true
                    }
                )
                .setColor(
                    colorMap[color] || 0x00BFFF
                )
                .setFooter({
                    text: `ユーザー: ${interaction.user.tag}`
                })
                .setTimestamp();

        if (row) {

            await interaction.followUp({
                embeds: [embed]
            });

        } else {

            await interaction.reply({
                embeds: [embed]
            });
        }

    } catch (err) {

        console.error(err);

        if (!interaction.replied) {

            await interaction.reply({
                content: 'DBエラー'
            });

        } else {

            await interaction.followUp({
                content: 'DBエラー'
            });
        }
    }
}
};