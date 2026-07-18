'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    stopActivity
} = require('../database/intervalService');

const SUBJECT_COLORS = {
    math: 0x0074FF,
    chemistry: 0x66CCFF,
    physics: 0xFFA500,
    english: 0xFFFF00,
    social: 0x00B000,
    other: 0xFF0000
};

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
                '[Stop Ranking Update Error]',
                error
            );
        });
    }
}

function formatDuration(ms) {
    const safeMs = Math.max(
        0,
        Number(ms) || 0
    );

    const totalMinutes = Math.floor(
        safeMs / 60_000
    );

    return (
        `${Math.floor(totalMinutes / 60)}時間 ` +
        `${totalMinutes % 60}分`
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('現在の作業を終了します'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const result = await stopActivity(
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

            requestPersistentRankingUpdate(
                interaction.client
            );

            if (result.kind === 'stopped_paused') {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('作業終了')
                            .setDescription(
                                '一時停止中の作業を終了しました。'
                            )
                            .setColor(0x00BFFF)
                            .setFooter({
                                text:
                                    `ユーザー: ${interaction.user.tag}`
                            })
                            .setTimestamp()
                    ]
                });
                return;
            }

            const interval = result.interval;

            const durationMs =
                new Date(interval.end_at).getTime() -
                new Date(interval.start_at).getTime();

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('作業終了')
                        .setDescription(
                            '作業を終了しました。'
                        )
                        .addFields(
                            {
                                name: '作業名',
                                value:
                                    interval.task_name ||
                                    '未設定',
                                inline: true
                            },
                            {
                                name: '時間',
                                value:
                                    formatDuration(
                                        durationMs
                                    ),
                                inline: true
                            }
                        )
                        .setColor(
                            SUBJECT_COLORS[
                                interval.category_key
                            ] || 0x00BFFF
                        )
                        .setFooter({
                            text:
                                `ユーザー: ${interaction.user.tag}`
                        })
                        .setTimestamp()
                ]
            });
        } catch (error) {
            console.error(
                '[Stop Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};