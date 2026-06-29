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
        await interaction.deferReply();

        const userId = interaction.user.id;

        try {
            const result = await db.query(
                `
                SELECT id, task_name, color, start_time, pause_time, paused_duration
                FROM work_sessions
                WHERE user_id = $1
                  AND end_time IS NULL
                LIMIT 1
                `,
                [userId]
            );

            const row = result.rows[0];

            if (!row) {
                return interaction.editReply({
                    content: '現在作業中ではありません。'
                });
            }

            const endTime = Date.now();
            let pausedDuration = Number(row.paused_duration || 0);
            let duration = 0;

            const client = await db.connect();
            try {
                await client.query('BEGIN');

                // 一時停止中のまま /stop された場合の救済ロジック
                if (row.pause_time) {
                    const extraPause = endTime - Number(row.pause_time);
                    pausedDuration += extraPause;

                    await client.query(
                        `
                        UPDATE session_pauses
                        SET pause_end = $1
                        WHERE session_id = $2 AND pause_end IS NULL
                        `,
                        [endTime, row.id]
                    );
                }

                duration = endTime - Number(row.start_time) - pausedDuration;
                duration = Math.max(0, duration); // マイナス値防止

                await client.query(
                    `
                    UPDATE work_sessions
                    SET
                        end_time = $1,
                        duration = $2,
                        pause_time = NULL,
                        paused_duration = $3
                    WHERE id = $4
                    `,
                    [endTime, duration, pausedDuration, row.id]
                );

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }

            // 💡 統一修正：ランキング自動更新を確実にキックする
            if (interaction.client.rankingSystem && typeof interaction.client.rankingSystem.update === 'function') {
                interaction.client.rankingSystem.update();
            }

            const totalMinutes = Math.floor(duration / 1000 / 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            const embed = new EmbedBuilder()
                .setTitle('◆作業終了')
                .setDescription('作業を終了しました。')
                .addFields(
                    { name: '作業名', value: row.task_name || '未設定', inline: true },
                    { name: '時間', value: `${hours}時間 ${minutes}分`, inline: true }
                )
                .setColor(colorMap[row.color] || 0x00BFFF)
                .setFooter({ text: `ユーザー: ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            const errMsg = 'データベースエラーが発生しました。';
            if (interaction.deferred) {
                await interaction.editReply({ content: errMsg }).catch(() => null);
            } else {
                await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => null);
            }
        }
    }
};