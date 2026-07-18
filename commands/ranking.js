'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    intervals,
    aggregate,
    jstRange,
    jstCurrentWeekRange,
    jstCurrentMonthRange,
    format
} = require('../utils/activityRead');

function resolveRange(period) {
    const now = new Date();

    if (period === 'week') {
        const range =
            jstCurrentWeekRange(now);

        return {
            title:
                '今週の作業ランキング',
            start: range.start,
            end: now
        };
    }

    if (period === 'month') {
        const range =
            jstCurrentMonthRange(now);

        return {
            title:
                '今月の作業ランキング',
            start: range.start,
            end: now
        };
    }

    const range =
        jstRange(1, now);

    return {
        title:
            '今日の作業ランキング',
        start: range.start,
        end: now
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ranking')
        .setDescription(
            '作業時間ランキングを表示します'
        )
        .addStringOption((option) =>
            option
                .setName('period')
                .setDescription(
                    'ランキング期間'
                )
                .addChoices(
                    {
                        name: '本日',
                        value: 'today'
                    },
                    {
                        name: '今週',
                        value: 'week'
                    },
                    {
                        name: '今月',
                        value: 'month'
                    }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const period =
            interaction.options.getString(
                'period'
            ) ||
            'today';

        const range =
            resolveRange(period);

        try {
            const data =
                aggregate(
                    await intervals(
                        db,
                        interaction.guildId ||
                            '',
                        range.start,
                        range.end
                    ),
                    range.start,
                    range.end
                ).slice(0, 20);

            if (data.length === 0) {
                await interaction.editReply({
                    content:
                        'ランキングデータがありません。'
                });

                return;
            }

            const lines =
                await Promise.all(
                    data.map(
                        async (
                            row,
                            index
                        ) => {
                            const cached =
                                interaction.client
                                    .users
                                    .cache
                                    .get(
                                        row.userId
                                    );

                            const user =
                                cached ||
                                await interaction.client
                                    .users
                                    .fetch(
                                        row.userId
                                    )
                                    .catch(
                                        () => null
                                    );

                            const username =
                                user?.displayName ||
                                user?.username ||
                                `ユーザー(${String(row.userId).slice(-4)})`;

                            return (
                                `**${index + 1}位** ${username}\n` +
                                `**${format(row.total)}**`
                            );
                        }
                    )
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        range.title
                    )
                    .setDescription(
                        lines.join(
                            '\n\n'
                        )
                    )
                    .setColor(
                        0x00BFFF
                    )
                    .setFooter({
                        text:
                            `更新: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
                    })
                    .setTimestamp();

            await interaction.editReply({
                embeds: [embed]
            });
        } catch (error) {
            console.error(
                '[Ranking Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};
