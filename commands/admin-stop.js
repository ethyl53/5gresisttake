'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const db = require('../database/db');
const {
    stopActivity
} = require('../database/intervalService');

function requestRankingUpdate(client) {
    const manager =
        client.persistentRanking ||
        client.rankingSystem ||
        client.ranking;

    const promise = manager?.update?.();

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Admin Stop Ranking Update Error]',
                error
            );
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-stop')
        .setDescription(
            '指定ユーザーの作業を停止します'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription(
                    '停止するユーザー'
                )
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const user =
            interaction.options.getUser(
                'user',
                true
            );

        try {
            const result = await stopActivity(
                db,
                {
                    guildId:
                        interaction.guildId ||
                        '',
                    userId: user.id
                }
            );

            if (result.kind === 'none') {
                await interaction.editReply({
                    content:
                        `${user.username} は作業中または一時停止中ではありません。`
                });

                return;
            }

            requestRankingUpdate(
                interaction.client
            );

            await interaction.editReply({
                content:
                    `${user.username} の作業状態を終了しました。`
            });
        } catch (error) {
            console.error(
                '[Admin Stop Error]',
                error
            );

            await interaction.editReply({
                content:
                    '停止処理に失敗しました。'
            });
        }
    }
};
