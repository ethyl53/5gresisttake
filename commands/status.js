'use strict';

const {
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    getCurrentState
} = require('../database/timelineService');

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
            const state = await getCurrentState(
                db,
                interaction.guildId,
                interaction.user.id
            );

            if (state.status === 'idle') {
                await interaction.editReply('作業中ではありません。');
            } else if (state.status === 'paused') {
                await interaction.editReply(
                    `一時停止中：${state.taskName || state.categoryKey || '未設定'}`
                );
            } else if (state.status === 'running') {
                await interaction.editReply(
                    `作業中：${state.taskName || state.categoryKey || '未設定'}`
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
