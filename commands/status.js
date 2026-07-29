'use strict';

const {
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('現在の作業状態を確認します')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        try {
            const result = await db.query(
                `
                    SELECT
                        state.paused_at,
                        state.paused_task_name,
                        state.paused_category_key,
                        interval.task_name,
                        interval.category_key,
                        interval.start_at
                    FROM activity_state AS state
                    LEFT JOIN activity_intervals AS interval
                        ON interval.id = state.active_interval_id
                       AND interval.guild_id = state.guild_id
                       AND interval.user_id = state.user_id
                    WHERE state.guild_id = $1
                      AND state.user_id = $2
                    LIMIT 1
                `,
                [interaction.guildId, interaction.user.id]
            );
            const state = result.rows[0];

            if (!state) {
                await interaction.editReply('作業中ではありません。');
            } else if (state.paused_at) {
                await interaction.editReply(
                    `一時停止中：${state.paused_task_name || state.paused_category_key || '未設定'}`
                );
            } else if (state.start_at) {
                await interaction.editReply(
                    `作業中：${state.task_name || state.category_key || '未設定'}`
                );
            } else {
                await interaction.editReply('作業中ではありません。');
            }
        } catch (error) {
            console.error('[Status Command Error]', error);
            await interaction.editReply('状態の取得に失敗しました。');
        }
    }
};
