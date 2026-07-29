'use strict';

const {
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    ensureGuildSettings,
    updateGuildSettings
} = require('../database/guildSettingsService');

function settingText(value) {
    return value ? '有効' : '無効';
}

function channelText(channelId) {
    return channelId ? `<#${channelId}>` : '未設定';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guild-settings')
        .setDescription('このサーバーのランキング投稿先を設定します')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('日次・週次・常設ランキングの投稿先')
                .addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((option) =>
            option
                .setName('daily-enabled')
                .setDescription('日次ランキングの投稿を有効にする')
        )
        .addBooleanOption((option) =>
            option
                .setName('weekly-enabled')
                .setDescription('週次ランキングの投稿を有効にする')
        )
        .addBooleanOption((option) =>
            option
                .setName('persistent-enabled')
                .setDescription('常設ランキングを有効にする')
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        if (!interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
            await interaction.editReply(
                'この設定を変更するには「サーバー管理」権限が必要です。'
            );
            return;
        }

        try {
            const channel = interaction.options.getChannel('channel');

            if (channel && channel.guildId !== interaction.guildId) {
                throw new Error('The selected channel is outside this guild');
            }
            const dailyEnabled = interaction.options.getBoolean('daily-enabled');
            const weeklyEnabled = interaction.options.getBoolean('weekly-enabled');
            const persistentEnabled = interaction.options.getBoolean('persistent-enabled');

            const changed = channel ||
                dailyEnabled !== null ||
                weeklyEnabled !== null ||
                persistentEnabled !== null;

            const settings = changed
                ? await updateGuildSettings(db, interaction.guildId, {
                    rankingChannelId:
                        channel?.id,
                    persistentRankingChannelId:
                        channel?.id,
                    dailyRankingEnabled: dailyEnabled,
                    weeklyRankingEnabled: weeklyEnabled,
                    persistentRankingEnabled: persistentEnabled
                })
                : await ensureGuildSettings(db, interaction.guildId);

            if (channel) {
                await interaction.client.persistentRanking
                    ?.update(interaction.guildId)
                    .catch((error) => {
                        console.error('[Guild Settings Ranking Update Error]', error);
                    });
            }

            await interaction.editReply(
                `ランキング投稿先: ${channelText(settings.ranking_channel_id)}\n` +
                `常設ランキング投稿先: ${channelText(settings.persistent_ranking_channel_id)}\n` +
                `日次ランキング: ${settingText(settings.daily_ranking_enabled)}\n` +
                `週次ランキング: ${settingText(settings.weekly_ranking_enabled)}\n` +
                `常設ランキング: ${settingText(settings.persistent_ranking_enabled)}`
            );
        } catch (error) {
            console.error('[Guild Settings Command Error]', error);
            await interaction.editReply('サーバー設定の保存に失敗しました。');
        }
    }
};
