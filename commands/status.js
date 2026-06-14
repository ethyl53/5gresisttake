const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

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
        .setName('status')
        .setDescription('現在の作業状況を確認'),

    async execute(interaction) {

        const userId =
            interaction.user.id;

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

            if (!row) {

                return interaction.reply({
                    content: '現在作業中ではありません。'
                });
            }

            const elapsed =
                Date.now() - Number(row.start_time);

            const startTime =
                new Date(Number(row.start_time))
                    .toLocaleTimeString(
                        'ja-JP',
                        {
                            hour: '2-digit',
                            minute: '2-digit'
                        }
                    );

            const embed =
                new EmbedBuilder()
                    .setTitle('現在の作業状況')
                    .addFields(
                        {
                            name: '作業名',
                            value: row.task_name || '未設定',
                            inline: true
                        },
                        {
                            name: '色',
                            value: row.color || '未設定',
                            inline: true
                        },
                        {
                            name: '開始時刻',
                            value: startTime,
                            inline: true
                        },
                        {
                            name: '経過時間',
                            value: format(elapsed),
                            inline: false
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