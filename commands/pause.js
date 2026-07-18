'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    pauseActivity
} = require('../database/intervalService');

function requestPersistentRankingUpdate(client) {
    const manager =
        client.persistentRanking ||
        client.rankingSystem;

    const promise = manager?.update?.();

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Pause Ranking Update Error]',
                error
            );
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('現在の作業を一時停止します'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const result = await pauseActivity(
                db,
                {
                    guildId: interaction.guildId || '',
                    userId: interaction.user.id
                }
            );

            if (result.kind === 'none') {
                await interaction.editReply({
                    content:
                        '現在作業中ではありません。'
                });
                return;
            }

            if (result.kind === 'already_paused') {
                await interaction.editReply({
                    content:
                        'すでに一時停止中です。引数を指定せずに `/start` を実行すると再開できます。'
                });
                return;
            }

            requestPersistentRankingUpdate(
                interaction.client
            );

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('作業一時停止')
                        .setDescription(
                            '作業を一時停止しました。\n引数を指定せずに `/start` を実行すると、この作業を再開します。'
                        )
                        .addFields({
                            name: '作業名',
                            value:
                                result.interval.task_name ||
                                '未設定',
                            inline: true
                        })
                        .setColor(0xFFA500)
                        .setTimestamp()
                ]
            });
        } catch (error) {
            console.error(
                '[Pause Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};