const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');

const subjectColors = {
    math: 'blue',
    chemistry: 'lightblue',
    physics: 'orange',
    english: 'yellow',
    social: 'green',
    other: 'gray'
};

module.exports = {

    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('記録を追加・修正・削除')

        .addStringOption(option =>
            option
                .setName('subject')
                .setDescription('科目')
                .setRequired(true)
                .addChoices(
                    { name: '数学', value: 'math' },
                    { name: '化学', value: 'chemistry' },
                    { name: '物理', value: 'physics' },
                    { name: '英語', value: 'english' },
                    { name: '社会', value: 'social' },
                    { name: 'その他', value: 'other' },
                    { name: '削除', value: 'delete' }
                )
        )

        .addStringOption(option =>
            option
                .setName('start')
                .setDescription('開始時刻 HH:MM')
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName('end')
                .setDescription('終了時刻 HH:MM')
                .setRequired(true)
        ),

    async execute(interaction) {

        try {

            const subject =
                interaction.options.getString('subject');

            const startText =
                interaction.options.getString('start');

            const endText =
                interaction.options.getString('end');

            const startParts =
                startText.split(':');

            const endParts =
                endText.split(':');

            if (
                startParts.length !== 2 ||
                endParts.length !== 2
            ) {

                return interaction.reply({
                    content:
                        '時刻は HH:MM 形式で入力してください'
                });
            }

            const now = new Date();

            const start =
                new Date(now);

            start.setHours(
                Number(startParts[0]),
                Number(startParts[1]),
                0,
                0
            );

            const end =
                new Date(now);

            end.setHours(
                Number(endParts[0]),
                Number(endParts[1]),
                0,
                0
            );

            if (end <= start) {

                return interaction.reply({
                    content:
                        '終了時刻は開始時刻より後にしてください'
                });
            }

            const startMs = start.getTime();
            const endMs = end.getTime();

            const overlap =
                await db.query(
                    `
                    SELECT *
                    FROM work_sessions
                    WHERE
                        start_time < $1
                    AND
                        COALESCE(end_time,start_time) > $2
                    `,
                    [
                        endMs,
                        startMs
                    ]
                );

            for (const row of overlap.rows) {

                await db.query(
                    `
                    DELETE FROM work_sessions
                    WHERE id = $1
                    `,
                    [row.id]
                );

                if (
                    Number(row.start_time)
                    < startMs
                ) {

                    await db.query(
                        `
                        INSERT INTO work_sessions
                        (
                            user_id,
                            task_name,
                            color,
                            start_time,
                            end_time,
                            duration
                        )
                        VALUES
                        ($1,$2,$3,$4,$5,$6)
                        `,
                        [
                            row.user_id,
                            row.task_name,
                            row.color,
                            row.start_time,
                            startMs,
                            startMs - Number(row.start_time)
                        ]
                    );
                }

                if (
                    row.end_time &&
                    Number(row.end_time)
                    > endMs
                ) {

                    await db.query(
                        `
                        INSERT INTO work_sessions
                        (
                            user_id,
                            task_name,
                            color,
                            start_time,
                            end_time,
                            duration
                        )
                        VALUES
                        ($1,$2,$3,$4,$5,$6)
                        `,
                        [
                            row.user_id,
                            row.task_name,
                            row.color,
                            endMs,
                            row.end_time,
                            Number(row.end_time) - endMs
                        ]
                    );
                }
            }

            if (subject !== 'delete') {

                await db.query(
                    `
                    INSERT INTO work_sessions
                    (
                        user_id,
                        task_name,
                        color,
                        start_time,
                        end_time,
                        duration
                    )
                    VALUES
                    ($1,$2,$3,$4,$5,$6)
                    `,
                    [
                        interaction.user.id,
                        subject,
                        subjectColors[subject],
                        startMs,
                        endMs,
                        endMs - startMs
                    ]
                );
            }

            const embed =
                new EmbedBuilder()
                    .setTitle('記録編集完了')
                    .addFields(
                        {
                            name: '科目',
                            value: subject
                        },
                        {
                            name: '開始',
                            value: startText,
                            inline: true
                        },
                        {
                            name: '終了',
                            value: endText,
                            inline: true
                        }
                    )
                    .setColor(0x00BFFF)
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

        } catch (err) {

            console.error(err);

            await interaction.reply({
                content: '編集中にエラーが発生しました'
            });
        }
    }
};