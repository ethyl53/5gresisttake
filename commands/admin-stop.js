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
            // 対象ユーザーの実行中のセッションを確認
            const result = await db.query(
                `
                SELECT start_time, task_name FROM work_sessions
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

            const duration = now - Number(row.start_time);

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