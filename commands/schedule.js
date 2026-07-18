'use strict';

const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const db = require('../database/db');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseJstDateTime(dateText, timeText) {
    const dateMatch =
        /^(\d{4})-(\d{2})-(\d{2})$/.exec(
            dateText
        );

    const timeMatch =
        /^(\d{2}):(\d{2})$/.exec(
            timeText
        );

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
        minute
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

    return utcMs;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription(
            '新しい予定とリマインダーを登録します'
        )
        .addStringOption((option) =>
            option
                .setName('date')
                .setDescription(
                    '日付。例: 2026-07-10'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('time')
                .setDescription(
                    '時刻。例: 15:30'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('title')
                .setDescription(
                    '予定のタイトル'
                )
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('content')
                .setDescription(
                    '予定の詳細内容'
                )
        )
        .addIntegerOption((option) =>
            option
                .setName('advance')
                .setDescription(
                    '事前通知のタイミング'
                )
                .addChoices(
                    {
                        name: '予定時刻ちょうど',
                        value: 0
                    },
                    {
                        name: '5分前',
                        value: 5
                    },
                    {
                        name: '15分前',
                        value: 15
                    },
                    {
                        name: '30分前',
                        value: 30
                    },
                    {
                        name: '1時間前',
                        value: 60
                    },
                    {
                        name: '1日前',
                        value: 1440
                    }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const dateText =
            interaction.options
                .getString('date', true)
                .trim();

        const timeText =
            interaction.options
                .getString('time', true)
                .trim();

        const title =
            interaction.options
                .getString('title', true)
                .trim();

        const description =
            interaction.options.getString(
                'content'
            ) || '';

        const advanceMinutes =
            interaction.options.getInteger(
                'advance'
            ) ?? 0;

        const eventTime =
            parseJstDateTime(
                dateText,
                timeText
            );

        if (eventTime === null) {
            await interaction.editReply({
                content:
                    '日付または時刻の形式が正しくありません。\n日付は `2026-07-10`、時刻は `15:30` の形式で入力してください。'
            });
            return;
        }

        if (eventTime <= Date.now()) {
            await interaction.editReply({
                content:
                    '過去の日時は指定できません。未来の日時を入力してください。'
            });
            return;
        }

        const remindTime =
            eventTime -
            advanceMinutes * 60_000;

        if (remindTime <= Date.now()) {
            await interaction.editReply({
                content:
                    '選択した事前通知時刻がすでに過ぎています。より短い事前通知を選択してください。'
            });
            return;
        }

        try {
            await db.query(
                `
                    INSERT INTO user_schedules (
                        user_id,
                        title,
                        description,
                        event_time,
                        remind_time
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5
                    )
                `,
                [
                    interaction.user.id,
                    title,
                    description,
                    eventTime,
                    remindTime
                ]
            );

            const displayTime =
                new Date(eventTime).toLocaleString(
                    'ja-JP',
                    {
                        timeZone: 'Asia/Tokyo'
                    }
                );

            const timingText =
                advanceMinutes === 0
                    ? '予定時刻ちょうど'
                    : `${advanceMinutes}分前`;

            await interaction.editReply({
                content:
                    `予定を登録しました。\n\n` +
                    `タイトル: ${title}\n` +
                    `日時: ${displayTime}\n` +
                    `通知: ${timingText}\n` +
                    `指定時刻にDMで通知されます。`
            });
        } catch (error) {
            console.error(
                '[Schedule Register Error]',
                error
            );

            await interaction.editReply({
                content:
                    '予定の登録中にデータベースエラーが発生しました。'
            });
        }
    }
};