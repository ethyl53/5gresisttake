const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-stop')
        .setDescription('【管理者用】指定したユーザーの作業を強制停止します')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('強制停止したい対象のユーザー')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // 管理者権限を持つメンバーのみ実行可能

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const now = Date.now();

        try {
            // 💡 修正：計算に必要となる paused_duration と pause_time も一緒に取得
            const result = await db.query(
                `
                SELECT start_time, task_name, paused_duration, pause_time FROM work_sessions
                WHERE user_id = $1 AND end_time IS NULL
                LIMIT 1
                `,
                [targetUser.id]
            );

            const row = result.rows[0];
            if (!row) {
                return interaction.editReply({
                    content: `❌ **${targetUser.username}** さんは現在作業中（または放置中）ではありません。`
                });
            }

            const startTime = Number(row.start_time);
            const pausedDuration = Number(row.paused_duration || 0);
            
            let duration = 0;

            // 💡 修正：状態に応じた正確な純作業時間の計算
            if (row.pause_time) {
                // ⏸️ 一時停止中のまま強制停止された場合：純作業時間は「一時停止した瞬間」まで
                duration = Number(row.pause_time) - startTime - pausedDuration;
            } else {
                // 🟢 作業中のまま強制停止された場合：現在時刻から総一時停止時間を引く
                duration = now - startTime - pausedDuration;
            }

            // 安全のためのマイナス値防止
            duration = Math.max(0, duration);

            // セッションを現在時刻で強制終了
            await db.query(
                `
                UPDATE work_sessions
                SET end_time = $1, duration = $2, warned_at = NULL, last_check = NULL
                WHERE user_id = $3 AND end_time IS NULL
                `,
                [now, duration, targetUser.id]
            );

            await interaction.editReply({
                content: `🚨 **${targetUser.username}** さんの作業（${row.task_name || '未設定'}）を強制停止しました。\n⏱️ 計上された作業時間: ${Math.floor(duration / 1000 / 60)}分`
            });

        } catch (err) {
            console.error('[Admin Stop Error]', err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};