'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    intervals,
    aggregate,
    jstCurrentWeekRange,
    format
} = require('../utils/activityRead');

const {
    generateWeeklyTimelineBuffer
} = require('../utils/timeline');

const JST_OFFSET_MS =
    9 * 60 * 60 * 1000;

const WEEK_MS =
    7 * 24 * 60 * 60 * 1000;

function currentJstYearMonth() {
    const date = new Date(
        Date.now() +
        JST_OFFSET_MS
    );

    return {
        year:
            date.getUTCFullYear(),
        month:
            date.getUTCMonth() + 1
    };
}

function customWeekRange(
    year,
    month,
    week
) {
    const firstDayWeekday =
        new Date(
            Date.UTC(
                year,
                month - 1,
                1
            )
        ).getUTCDay();

    const daysFromMonday =
        (firstDayWeekday + 6) % 7;

    const firstMondayDate =
        1 - daysFromMonday;

    const start = new Date(
        Date.UTC(
            year,
            month - 1,
            firstMondayDate +
                (week - 1) * 7,
            2 - 9,
            0,
            0,
            0
        )
    );

    return {
        start,
        end: new Date(
            start.getTime() +
            WEEK_MS
        )
    };
}

function breakdown(subjects) {
    return (
        Object.entries(subjects)
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )
            .map(
                ([name, value]) =>
                    `・**${name}**: ${format(value)}`
            )
            .join('\n') ||
        'データなし'
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly')
        .setDescription(
            '指定したユーザーの週間作業時間を表示します'
        )
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription(
                    '確認するユーザー。未指定の場合は自分'
                )
        )
        .addIntegerOption((option) =>
            option
                .setName('month')
                .setDescription(
                    '確認する月。未指定の場合は今週'
                )
                .setMinValue(1)
                .setMaxValue(12)
        )
        .addIntegerOption((option) =>
            option
                .setName('week')
                .setDescription(
                    'その月の第何週か'
                )
                .setMinValue(1)
                .setMaxValue(6)
        )
        .addIntegerOption((option) =>
            option
                .setName('year')
                .setDescription(
                    '確認する年'
                )
                .setMinValue(2020)
                .setMaxValue(2100)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser =
            interaction.options.getUser(
                'user'
            ) ||
            interaction.user;

        const monthOption =
            interaction.options.getInteger(
                'month'
            );

        const weekOption =
            interaction.options.getInteger(
                'week'
            );

        const yearOption =
            interaction.options.getInteger(
                'year'
            );

        const current =
            currentJstYearMonth();

        const isCustom =
            monthOption !== null ||
            weekOption !== null ||
            yearOption !== null;

        const targetYear =
            yearOption ||
            current.year;

        const targetMonth =
            monthOption ||
            current.month;

        const targetWeek =
            weekOption ||
            1;

        const range =
            isCustom
                ? customWeekRange(
                    targetYear,
                    targetMonth,
                    targetWeek
                )
                : jstCurrentWeekRange();

        const now = new Date();

        const queryEnd =
            range.end < now
                ? range.end
                : now;

        const title =
            isCustom
                ? (
                    `${targetYear}年` +
                    `${targetMonth}月 ` +
                    `第${targetWeek}週`
                )
                : '今週';

        try {
            const allRows =
                queryEnd > range.start
                    ? await intervals(
                        db,
                        interaction.guildId ||
                            '',
                        range.start,
                        queryEnd
                    )
                    : [];

            const aggregateEnd =
                queryEnd > range.start
                    ? queryEnd
                    : range.end;

            const data =
                aggregate(
                    allRows.filter(
                        (row) =>
                            row.user_id ===
                            targetUser.id
                    ),
                    range.start,
                    aggregateEnd
                )[0];

            const member =
                interaction.guild
                    ? await interaction.guild
                        .members
                        .fetch(
                            targetUser.id
                        )
                        .catch(
                            () => null
                        )
                    : null;

            const username =
                member?.displayName ||
                targetUser.username;

            if (!data) {
                await interaction.editReply({
                    content:
                        `**${username}** さんの${title}の作業記録はありません。`
                });

                return;
            }

            const file =
                new AttachmentBuilder(
                    await generateWeeklyTimelineBuffer(
                        username,
                        data.sessions,
                        range.start.getTime()
                    ),
                    {
                        name:
                            'weekly_timeline.png'
                    }
                );

            const description =
                `${range.start.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} ～ ` +
                `${queryEnd.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `${title}の作業実績 (${username})`
                    )
                    .setDescription(
                        description
                    )
                    .addFields(
                        {
                            name:
                                '総作業時間',
                            value:
                                `**${format(data.total)}**`
                        },
                        {
                            name:
                                '科目別合計',
                            value:
                                breakdown(
                                    data.subjects
                                )
                        }
                    )
                    .setColor(
                        0x00FF7F
                    )
                    .setImage(
                        'attachment://weekly_timeline.png'
                    )
                    .setFooter({
                        text:
                            'タイムラインは月曜日02:00を起点に表示されます'
                    })
                    .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                files: [file]
            });
        } catch (error) {
            console.error(
                '[Weekly Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};
