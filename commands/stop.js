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
        .setName('stop')
        .setDescription('作業終了'),

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

            const endTime = Date.now();
            let pausedDuration = Number(row.paused_duration || 0);

            // 🟢 一時停止中のまま /stop された場合の救済ロジック
            if (row.pause_time) {
                // 中抜きにされていた最後の停止時間を算出して加算
                const extraPause = endTime - Number(row.pause_time);
                pausedDuration += extraPause;

                // 履歴側の pause_end も現在の終了時間でクローズする
                await db.query(
                    `
                    UPDATE session_pauses
                    SET pause_end = $1
                    WHERE session_id = $2 AND pause_end IS NULL
                    `,
                    [endTime, row.id]
                );
            }

            // 正確に計算された累積停止時間を引いて、純作業時間を出す
            const duration = endTime - Number(row.start_time) - pausedDuration;

            await db.query(
                `
                UPDATE work_sessions
                SET
                    end_time = $1,
                    duration = $2,
                    pause_time = NULL,
                    paused_duration = $3
                WHERE id = $4
                `,
                [
                    endTime,
                    duration,
                    pausedDuration,
                    row.id
                ]
            );

            // 常設ランキング更新
            if (interaction.client.persistentRanking) {
                interaction.client.persistentRanking.update();
            }

            const totalMinutes = Math.floor(duration / 1000 / 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            const embed = new EmbedBuilder()
                .setTitle('◆作業終了')
                .setDescription('作業を終了しました。')
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
                .setColor(colorMap[row.color] || 0x00BFFF)
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