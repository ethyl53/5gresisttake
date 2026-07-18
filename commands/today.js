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
    jstRange,
    format
} = require('../utils/activityRead');

const {
    generateTimelineBuffer
} = require('../utils/timeline');

function formatBreakdown(values) {
    const lines =
        Object.entries(values)
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )
            .map(
                ([name, value]) =>
                    `・**${name}**: ${format(value)}`
            );

    return (
        lines.join('\n') ||
        'データなし'
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('today')
        .setDescription(
            '指定したユーザーの今日の作業時間を表示します'
        )
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription(
                    '確認するユーザー。未指定の場合は自分'
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser =
            interaction.options.getUser(
                'user'
            ) ||
            interaction.user;

        const range = jstRange();
        const now = new Date();

        try {
            const allRows =
                await intervals(
                    db,
                    interaction.guildId ||
                        '',
                    range.start,
                    now
                );

            const data =
                aggregate(
                    allRows.filter(
                        (row) =>
                            row.user_id ===
                            targetUser.id
                    ),
                    range.start,
                    now
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
                        `**${username}** さんの今日の作業記録はありません。`
                });

                return;
            }

            const file =
                new AttachmentBuilder(
                    await generateTimelineBuffer(
                        [
                            {
                                username,
                                sessions:
                                    data.sessions
                            }
                        ],
                        range.start.getTime()
                    ),
                    {
                        name:
                            'timeline.png'
                    }
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `今日の作業実績 (${username})`
                    )
                    .setDescription(
                        `期間: ` +
                        `${range.start.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} ～ ` +
                        `${now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
                    )
                    .addFields(
                        {
                            name:
                                '合計時間',
                            value:
                                `**${format(data.total)}**`
                        },
                        {
                            name:
                                '科目別',
                            value:
                                formatBreakdown(
                                    data.subjects
                                ),
                            inline:
                                true
                        },
                        {
                            name:
                                '作業別',
                            value:
                                formatBreakdown(
                                    data.tasks
                                ),
                            inline:
                                true
                        }
                    )
                    .setColor(
                        0x00BFFF
                    )
                    .setImage(
                        'attachment://timeline.png'
                    )
                    .setFooter({
                        text:
                            'タイムラインは5分単位で表示されます'
                    })
                    .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                files: [file]
            });
        } catch (error) {
            console.error(
                '[Today Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    'データベース処理中にエラーが発生しました。'
            });
        }
    }
};
