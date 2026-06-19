const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('作業を一時停止します'),

    async execute(interaction) {
        const userId = interaction.user.id;

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

            if (row.pause_time) {
                return interaction.reply({
                    content: '既に一時停止中です。引数を指定せずに `/start` を実行すると再開できます。'
                });
            }

            const now = Date.now();

            await db.query(
                `
                UPDATE work_sessions
                SET pause_time = $1
                WHERE id = $2
                `,
                [now, row.id]
            );

            // 👇 ここを追記
            await db.query(
                `
                INSERT INTO session_pauses (session_id, pause_start)
                VALUES ($1, $2)
                `,
                [row.id, now]
            );

            if (interaction.client.persistentRanking) {
                interaction.client.persistentRanking.update();
            }

            const embed = new EmbedBuilder()
                .setTitle('⏸️ 作業一時停止')
                .setDescription('作業を一時停止しました。\n引数を入力せずに `/start` を実行すると、この作業を再開します。')
                .addFields(
                    { name: '作業名', value: row.task_name || '未設定', inline: true }
                )
                .setColor(0xFFA500)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'DBエラー' });
        }
    }
};