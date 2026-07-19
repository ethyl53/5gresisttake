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

function getCurrentJstDateParts() {
    const jstNow = new Date(
        Date.now() + JST_OFFSET_MS
    );

    return {
        year: jstNow.getUTCFullYear(),
        month: jstNow.getUTCMonth() + 1,
        day: jstNow.getUTCDate()
    };
}

function parseDateOption(dateText) {
    const current =
        getCurrentJstDateParts();

    if (!dateText) {
        return {
            ...current,
            wasProvided: false,
            explicitYear: false
        };
    }

    const normalized =
        dateText.trim();

    const fullDateMatch =
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
            .exec(normalized);

    if (fullDateMatch) {
        return {
            year: Number(fullDateMatch[1]),
            month: Number(fullDateMatch[2]),
            day: Number(fullDateMatch[3]),
            wasProvided: true,
            explicitYear: true
        };
    }

    const monthDayMatch =
        /^(\d{1,2})-(\d{1,2})$/
            .exec(normalized);

    if (monthDayMatch) {
        return {
            year: current.year,
            month: Number(monthDayMatch[1]),
            day: Number(monthDayMatch[2]),
            wasProvided: true,
            explicitYear: false
        };
    }

    return null;
}

function parseTimeText(timeText) {
    const match =
        /^(\d{1,2}):(\d{2})$/
            .exec(timeText);

    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    return {
        hour,
        minute
    };
}

function buildJstDateTime(
    dateParts,
    timeText
) {
    if (!dateParts) {
        return null;
    }

    const timeParts =
        parseTimeText(timeText);

    if (!timeParts) {
        return null;
    }

    const {
        year,
        month,
        day
    } = dateParts;

    if (
        year < 1 ||
        year > 9999 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    const utcMs = Date.UTC(
        year,
        month - 1,
        day,
        timeParts.hour - 9,
        timeParts.minute,
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
        check.getUTCHours() !==
            timeParts.hour ||
        check.getUTCMinutes() !==
            timeParts.minute
    ) {
        return null;
    }

    return new Date(utcMs);
}

function getJstParts(date) {
    const jstDate = new Date(
        date.getTime() + JST_OFFSET_MS
    );

    return {
        year: jstDate.getUTCFullYear(),
        month: jstDate.getUTCMonth() + 1,
        day: jstDate.getUTCDate(),
        hour: jstDate.getUTCHours(),
        minute: jstDate.getUTCMinutes()
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatTimeOnly(date) {
    const parts = getJstParts(date);

    return (
        `${pad2(parts.hour)}:` +
        `${pad2(parts.minute)}`
    );
}

function formatDateAndTime(
    date,
    showYear
) {
    const parts = getJstParts(date);

    const dateText = showYear
        ? (
            `${parts.year}年` +
            `${parts.month}月` +
            `${parts.day}日`
        )
        : (
            `${parts.month}月` +
            `${parts.day}日`
        );

    return (
        `${dateText} ` +
        `${pad2(parts.hour)}:` +
        `${pad2(parts.minute)}`
    );
}

function isSameJstDate(
    first,
    second
) {
    const a = getJstParts(first);
    const b = getJstParts(second);

    return (
        a.year === b.year &&
        a.month === b.month &&
        a.day === b.day
    );
}

function formatPeriod(
    startAt,
    endAt,
    dateOption
) {
    const sameDate =
        isSameJstDate(
            startAt,
            endAt
        );

    /*
     * dateを省略した場合、
     * 同日内なら時刻だけを表示します。
     */
    if (!dateOption.wasProvided) {
        if (sameDate) {
            return (
                `${formatTimeOnly(startAt)} ～ ` +
                `${formatTimeOnly(endAt)}`
            );
        }

        return (
            `${formatDateAndTime(startAt, false)} ～ ` +
            `${formatDateAndTime(endAt, false)}`
        );
    }

    /*
     * dateに年を入力しなかった場合、
     * 完了表示にも年を表示しません。
     */
    if (sameDate) {
        return (
            `${formatDateAndTime(
                startAt,
                dateOption.explicitYear
            )} ～ ` +
            `${formatTimeOnly(endAt)}`
        );
    }

    return (
        `${formatDateAndTime(
            startAt,
            dateOption.explicitYear
        )} ～ ` +
        `${formatDateAndTime(
            endAt,
            dateOption.explicitYear
        )}`
    );
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
            '指定した時間帯の作業記録を追加・置換・削除します'
        )
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('subject')
                .setDescription(
                    '科目。記録を消す場合は「削除」を選択'
                )
                .setRequired(true)
                .addChoices(
                    {
                        name: '数学',
                        value: 'math'
                    },
                    {
                        name: '化学',
                        value: 'chemistry'
                    },
                    {
                        name: '物理',
                        value: 'physics'
                    },
                    {
                        name: '英語',
                        value: 'english'
                    },
                    {
                        name: '社会',
                        value: 'social'
                    },
                    {
                        name: 'その他',
                        value: 'other'
                    },
                    {
                        name: '削除',
                        value: 'delete'
                    }
                )
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
                .setName('date')
                .setDescription(
                    '開始日。省略時は今日。例: 7-18 / 2025-7-18'
                )
        )
        .addStringOption((option) =>
            option
                .setName('task')
                .setDescription(
                    '作業名。削除を選んだ場合は使用しません'
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        if (!interaction.guildId) {
            await interaction.editReply({
                content:
                    'このコマンドはサーバー内でのみ使用できます。'
            });

            return;
        }

        const subject =
            interaction.options.getString(
                'subject',
                true
            );

        const startText =
            interaction.options
                .getString('start', true)
                .trim();

        const endText =
            interaction.options
                .getString('end', true)
                .trim();

        const rawDateText =
            interaction.options.getString(
                'date'
            );

        const dateText = rawDateText
            ? rawDateText.trim()
            : null;

        const taskText =
            interaction.options.getString(
                'task'
            );

        const taskName = taskText
            ? taskText.trim() || null
            : null;

        const deleteOnly =
            subject === 'delete';

        const categoryKey = deleteOnly
            ? null
            : subject;

        const dateOption =
            parseDateOption(dateText);

        if (!dateOption) {
            await interaction.editReply({
                content:
                    '日付の形式が正しくありません。\n' +
                    '年を省略する場合は `7-18`、年を指定する場合は `2025-7-18` の形式で入力してください。'
            });

            return;
        }

        const startAt =
            buildJstDateTime(
                dateOption,
                startText
            );

        let endAt =
            buildJstDateTime(
                dateOption,
                endText
            );

        if (!startAt || !endAt) {
            await interaction.editReply({
                content:
                    '日付または時刻の形式が正しくありません。\n' +
                    '時刻は `15:30`、日付は `7-18` または `2025-7-18` の形式で入力してください。'
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

        /*
         * 終了時刻が開始時刻より前の場合は、
         * 翌日の終了時刻として扱います。
         *
         * 例:
         * start 23:00
         * end   01:00
         *
         * 23:00から翌日01:00までとなります。
         */
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

        /*
         * サーバーごとに記録を分離するため、
         * interaction.guildIdを必ず使用します。
         */
        const guildId =
            interaction.guildId;

        const userId =
            interaction.user.id;

        const action = deleteOnly
            ? 'delete'
            : 'replace';

        try {
            const result =
                await replaceRange(
                    db,
                    {
                        guildId,
                        userId,
                        startAt,
                        endAt,
                        categoryKey,
                        taskName:
                            deleteOnly
                                ? null
                                : taskName,
                        deleteOnly,
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
                        deleteOnly
                            ? '作業記録を削除しました'
                            : '作業記録を追加・置換しました'
                    )
                    .addFields(
                        {
                            name: '期間',
                            value:
                                formatPeriod(
                                    startAt,
                                    endAt,
                                    dateOption
                                )
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
                        deleteOnly
                            ? 0xFF0000
                            : (
                                SUBJECT_COLORS[
                                    categoryKey
                                ] ||
                                0x00BFFF
                            )
                    )
                    .setTimestamp();

            if (!deleteOnly) {
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

            const message = String(
                error.message || ''
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