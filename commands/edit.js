'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    replaceRange
} = require('../database/intervalService');

const JST_OFFSET_MS =
    9 * 60 * 60 * 1000;

const DAY_MS =
    24 * 60 * 60 * 1000;

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

function requestRankingUpdate(client) {
    const manager =
        client.persistentRanking ||
        client.rankingSystem ||
        client.ranking;

    const promise =
        manager?.update?.();

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Edit Ranking Update Error]',
                error
            );
        });
    }
}

function parseJstDateTime(
    dateText,
    timeText
) {
    const dateMatch =
        /^(\d{4})-(\d{2})-(\d{2})$/
            .exec(dateText);

    const timeMatch =
        /^(\d{2}):(\d{2})$/
            .exec(timeText);

    if (!dateMatch || !timeMatch) {
        return null;
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    const utcMs = Date.UTC(
        year,
        month - 1,
        day,
        hour - 9,
        minute,
        0,
        0
    );

    const check = new Date(
        utcMs + JST_OFFSET_MS
    );

    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        check.getUTCHours() !== hour ||
        check.getUTCMinutes() !== minute
    ) {
        return null;
    }

    return new Date(utcMs);
}

function formatJst(date) {
    return new Intl.DateTimeFormat(
        'ja-JP',
        {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }
    ).format(date);
}

function formatDuration(ms) {
    const totalMinutes = Math.floor(
        Math.max(0, ms) / 60_000
    );

    return (
        `${Math.floor(totalMinutes / 60)}時間` +
        `${totalMinutes % 60}分`
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription(
            '指定した時間帯の作業記録を追加または削除します'
        )
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('操作')
                .setRequired(true)
                .addChoices(
                    {
                        name: '記録を追加・置換',
                        value: 'replace'
                    },
                    {
                        name: '記録を削除',
                        value: 'delete'
                    }
                )
        )
        .addStringOption((option) =>
            option
                .setName('date')
                .setDescription(
                    '開始日。例: 2026-07-18'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('start')
                .setDescription(
                    '開始時刻。例: 15:30'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('end')
                .setDescription(
                    '終了時刻。例: 17:00'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('subject')
                .setDescription(
                    '追加・置換する科目'
                )
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
                .setDescription(
                    '追加・置換する作業名'
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const action =
            interaction.options.getString(
                'action',
                true
            );

        const dateText =
            interaction.options
                .getString('date', true)
                .trim();

        const startText =
            interaction.options
                .getString('start', true)
                .trim();

        const endText =
            interaction.options
                .getString('end', true)
                .trim();

        const categoryKey =
            interaction.options.getString(
                'subject'
            );

        const taskName =
            interaction.options.getString(
                'task'
            );

        if (
            action === 'replace' &&
            !categoryKey
        ) {
            await interaction.editReply({
                content:
                    '記録を追加・置換する場合は、科目を指定してください。'
            });

            return;
        }

        const startAt =
            parseJstDateTime(
                dateText,
                startText
            );

        let endAt =
            parseJstDateTime(
                dateText,
                endText
            );

        if (!startAt || !endAt) {
            await interaction.editReply({
                content:
                    '日付または時刻の形式が正しくありません。\n' +
                    '日付は `2026-07-18`、時刻は `15:30` の形式で入力してください。'
            });

            return;
        }

        if (
            endAt.getTime() ===
            startAt.getTime()
        ) {
            await interaction.editReply({
                content:
                    '開始時刻と終了時刻を同じにすることはできません。'
            });

            return;
        }

        if (endAt < startAt) {
            endAt = new Date(
                endAt.getTime() + DAY_MS
            );
        }

        if (
            endAt.getTime() -
            startAt.getTime() <
            60_000
        ) {
            await interaction.editReply({
                content:
                    '1分未満の作業記録は登録できません。'
            });

            return;
        }

        if (
            endAt.getTime() >
            Date.now()
        ) {
            await interaction.editReply({
                content:
                    '未来の時間を作業記録として登録または削除することはできません。'
            });

            return;
        }

        const guildId =
            interaction.guildId || '';

        const userId =
            interaction.user.id;

        try {
            const result =
                await replaceRange(
                    db,
                    {
                        guildId,
                        userId,
                        startAt,
                        endAt,
                        categoryKey:
                            action === 'replace'
                                ? categoryKey
                                : null,
                        taskName:
                            action === 'replace'
                                ? (
                                    taskName ||
                                    null
                                )
                                : null,
                        deleteOnly:
                            action === 'delete',
                        actorUserId:
                            userId,
                        note:
                            `discord-edit:${action}:` +
                            `${startAt.toISOString()}:` +
                            `${endAt.toISOString()}`
                    }
                );

            requestRankingUpdate(
                interaction.client
            );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        action === 'replace'
                            ? '作業記録を追加・置換しました'
                            : '作業記録を削除しました'
                    )
                    .addFields(
                        {
                            name: '期間',
                            value:
                                `${formatJst(startAt)} ～ ` +
                                `${formatJst(endAt)}`
                        },
                        {
                            name: '長さ',
                            value:
                                formatDuration(
                                    endAt.getTime() -
                                    startAt.getTime()
                                ),
                            inline: true
                        },
                        {
                            name:
                                '置換された既存区間',
                            value:
                                `${result.replaced}件`,
                            inline: true
                        }
                    )
                    .setColor(
                        action === 'replace'
                            ? (
                                SUBJECT_COLORS[
                                    categoryKey
                                ] ||
                                0x00BFFF
                            )
                            : 0xFF0000
                    )
                    .setTimestamp();

            if (action === 'replace') {
                embed.addFields(
                    {
                        name: '科目',
                        value:
                            SUBJECT_NAMES[
                                categoryKey
                            ] ||
                            'その他',
                        inline: true
                    },
                    {
                        name: '作業名',
                        value:
                            taskName ||
                            '未設定',
                        inline: true
                    }
                );
            }

            await interaction.editReply({
                embeds: [embed]
            });
        } catch (error) {
            console.error(
                '[Edit Command Error]',
                error
            );

            const message =
                String(
                    error.message ||
                    ''
                );

            if (
                message.includes(
                    'overlaps a running activity'
                )
            ) {
                await interaction.editReply({
                    content:
                        '現在進行中の作業と指定範囲が重なっています。先に `/pause` または `/stop` を実行してください。'
                });

                return;
            }

            await interaction.editReply({
                content:
                    '作業記録の編集処理中にエラーが発生しました。'
            });
        }
    }
};
