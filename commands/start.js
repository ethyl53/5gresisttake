'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    startActivity
} = require('../database/intervalService');

const SUBJECT_NAMES = {
    math: '数学',
    chemistry: '化学',
    physics: '物理',
    english: '英語',
    social: '社会',
    other: 'その他'
};

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
                '[Start Ranking Update Error]',
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
        .setName('start')
        .setDescription('作業を開始または再開します')
        .addStringOption((option) =>
            option
                .setName('subject')
                .setDescription('科目')
                .addChoices(
                    { name: '数学', value: 'math' },
                    { name: '化学', value: 'chemistry' },
                    { name: '物理', value: 'physics' },
                    { name: '英語', value: 'english' },
                    { name: '社会', value: 'social' },
                    { name: 'その他', value: 'other' }
                )
        )
        .addStringOption((option) =>
            option
                .setName('task')
                .setDescription('作業名')
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const subject =
            interaction.options.getString('subject');

        const taskName =
            interaction.options.getString('task');

        try {
            const result = await startActivity(
                db,
                {
                    guildId: interaction.guildId || '',
                    userId: interaction.user.id,
                    categoryKey: subject,
                    taskName
                }
            );

            if (result.kind === 'already_running') {
                await interaction.editReply({
                    content:
                        '現在作業中です。別の作業を開始する場合は、科目または作業名を指定してください。'
                });
                return;
            }

            if (result.kind === 'paused_data_missing') {
                await interaction.editReply({
                    content:
                        '再開する作業情報がありません。科目または作業名を指定してください。'
                });
                return;
            }

            requestPersistentRankingUpdate(
                interaction.client
            );

            const current = result.current;

            if (result.kind === 'resumed') {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('作業再開')
                            .setDescription(
                                '一時停止中の作業を再開しました。'
                            )
                            .addFields({
                                name: '作業名',
                                value:
                                    current.task_name ||
                                    '未設定'
                            })
                            .setColor(
                                SUBJECT_COLORS[
                                    current.category_key
                                ] || 0x00BFFF
                            )
                            .setTimestamp()
                    ]
                });
                return;
            }

            const startEmbed =
                new EmbedBuilder()
                    .setTitle('作業開始')
                    .setDescription(
                        '作業を開始しました。'
                    )
                    .addFields(
                        {
                            name: '作業名',
                            value:
                                current.task_name ||
                                '未設定',
                            inline: true
                        },
                        {
                            name: '科目',
                            value:
                                SUBJECT_NAMES[
                                    current.category_key
                                ] || '未設定',
                            inline: true
                        }
                    )
                    .setColor(
                        SUBJECT_COLORS[
                            current.category_key
                        ] || 0x00BFFF
                    )
                    .setFooter({
                        text:
                            `ユーザー: ${interaction.user.tag}`
                    })
                    .setTimestamp();

            if (result.kind === 'switched') {
                const previous = result.previous;

                const durationMs =
                    new Date(previous.end_at).getTime() -
                    new Date(previous.start_at).getTime();

                const previousEmbed =
                    new EmbedBuilder()
                        .setTitle(
                            '前の作業を自動終了'
                        )
                        .setDescription(
                            '新しい作業を開始するため、前の作業を終了しました。'
                        )
                        .addFields(
                            {
                                name: '作業名',
                                value:
                                    previous.task_name ||
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
                                previous.category_key
                            ] || 0x00BFFF
                        )
                        .setFooter({
                            text:
                                `ユーザー: ${interaction.user.tag}`
                        })
                        .setTimestamp();

                await interaction.editReply({
                    embeds: [previousEmbed]
                });

                await interaction.followUp({
                    embeds: [startEmbed]
                });

                return;
            }

            await interaction.editReply({
                embeds: [startEmbed]
            });
        } catch (error) {
            console.error(
                '[Start Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};