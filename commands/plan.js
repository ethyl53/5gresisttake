'use strict';

const {
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    replacePlannedRange
} = require('../database/plannedIntervalService');
const {
    buildRangeFromOptions,
    formatRangeForReply
} = require('../services/logicalDayService');
const {
    format,
    subject
} = require('../utils/activityRead');

const SUBJECT_CHOICES = [
    { name: '数学', value: 'math' },
    { name: '化学', value: 'chemistry' },
    { name: '物理', value: 'physics' },
    { name: '英語', value: 'english' },
    { name: '社会', value: 'social' },
    { name: 'その他', value: 'other' },
    { name: '削除', value: 'delete' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plan')
        .setDMPermission(false)
        .setDescription('学習予定を追加・置換します')
        .addStringOption((option) => option
            .setName('subject')
            .setDescription('科目、または削除')
            .setRequired(true)
            .addChoices(...SUBJECT_CHOICES))
        .addStringOption((option) => option
            .setName('start')
            .setDescription('開始時刻（例: 15:30）')
            .setRequired(true))
        .addStringOption((option) => option
            .setName('end')
            .setDescription('終了時刻（例: 17:00）')
            .setRequired(true))
        .addStringOption((option) => option
            .setName('date')
            .setDescription('日付（例: 7-18 または 2026-7-18）'))
        .addStringOption((option) => option
            .setName('task')
            .setDescription('作業名')),

    async execute(interaction) {
        await interaction.deferReply();

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        const selectedSubject = interaction.options.getString('subject', true);
        const dateText = interaction.options.getString('date');

        try {
            const range = buildRangeFromOptions({
                dateText,
                startText: interaction.options.getString('start', true),
                endText: interaction.options.getString('end', true)
            });
            const deleteOnly = selectedSubject === 'delete';
            const result = await replacePlannedRange(db, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                startAt: range.startAt,
                endAt: range.endAt,
                categoryKey: deleteOnly ? null : selectedSubject,
                taskName: deleteOnly ? null : interaction.options.getString('task'),
                deleteOnly,
                actorUserId: interaction.user.id,
                note: 'discord:/plan'
            });
            const info = deleteOnly ? null : subject(selectedSubject);
            const embed = new EmbedBuilder()
                .setTitle(deleteOnly ? '予定を削除しました' : '予定を追加・置換しました')
                .setColor(deleteOnly ? 0xFF0000 : parseInt(info.colorHex.slice(1), 16))
                .addFields(
                    {
                        name: '期間',
                        value: formatRangeForReply(range, {
                            dateWasProvided: range.date.wasProvided,
                            hadExplicitYear: range.date.hadExplicitYear
                        })
                    },
                    {
                        name: '長さ',
                        value: format(range.endAt.getTime() - range.startAt.getTime()),
                        inline: true
                    },
                    {
                        name: '置換した既存予定',
                        value: `${result.replaced}件`,
                        inline: true
                    }
                )
                .setTimestamp();

            if (!deleteOnly) {
                embed.addFields(
                    { name: '科目', value: info.name, inline: true },
                    {
                        name: '作業名',
                        value: interaction.options.getString('task') || '未設定',
                        inline: true
                    }
                );
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Plan Command Error]', error);
            await interaction.editReply(
                error.message.startsWith('日付') ||
                error.message.startsWith('時刻') ||
                error.message.startsWith('存在しない') ||
                error.message.startsWith('開始時刻') ||
                error.message.startsWith('1分未満')
                    ? error.message
                    : '予定の保存に失敗しました。'
            );
        }
    }
};
