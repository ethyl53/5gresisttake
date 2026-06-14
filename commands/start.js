const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const db = require('../database/db');

const colorMap = {
    red: 0xFF0000,
    orange: 0xFFA500,
    yellow: 0xFFFF00,
    green: 0x00B000,
    blue: 0x0074FF,
    purple: 0x8A2BE2,
    gray: 0x808080
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('作業開始')

        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('作業色')
                .addChoices(
                    { name: '赤', value: 'red' },
                    { name: '橙', value: 'orange' },
                    { name: '黄', value: 'yellow' },
                    { name: '緑', value: 'green' },
                    { name: '青', value: 'blue' },
                    { name: '紫', value: 'purple' },
                    { name: '灰', value: 'gray' }
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

        const color =
            interaction.options.getString('color');

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

            // 前の作業がある場合は自動終了
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
                    color || null,
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
                            name: '色',
                            value: color || '未設定',
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