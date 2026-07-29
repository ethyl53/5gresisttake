'use strict';

const {
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-update')
        .setDescription('このサーバーの常設ランキングをすぐに更新します')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        if (!interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )) {
            await interaction.editReply(
                'この操作には管理者権限が必要です。'
            );
            return;
        }

        try {
            const manager = interaction.client.persistentRanking ||
                interaction.client.rankingSystem ||
                interaction.client.ranking;

            if (!manager?.update) {
                await interaction.editReply('ランキング更新機能を開始できていません。');
                return;
            }

            const result = await manager.update(interaction.guildId);
            if (result?.updated === false) {
                await interaction.editReply('このサーバーのランキング投稿先が未設定、無効、または利用できません。');
                return;
            }

            await interaction.editReply('このサーバーの常設ランキングを更新しました。');
        } catch (error) {
            console.error('[Force Update Command Error]', error);
            await interaction.editReply('ランキングの更新中にエラーが発生しました。');
        }
    }
};
