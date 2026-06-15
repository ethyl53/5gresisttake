const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const db = require('../database/db');

function format(ms) {

    const totalMinutes =
        Math.floor(ms / 1000 / 60);

    const hours =
        Math.floor(totalMinutes / 60);

    const minutes =
        totalMinutes % 60;

    return `${hours}時間${minutes}分`;
}

module.exports = {

    data: new SlashCommandBuilder()
        .setName('working')
        .setDescription('現在作業中のユーザー一覧'),

    async execute(interaction) {

        try {

            const result =
                await db.query(
                    `
                    SELECT *
                    FROM work_sessions
                    WHERE end_time IS NULL
                    ORDER BY start_time ASC
                    `
                );

            const rows = result.rows;

            if (!rows.length) {

                return interaction.reply({
                    content: '現在作業中のユーザーはいません'
                });
            }

            let description = '';

            for (const row of rows) {

                try {

                    const user =
                        await interaction.client.users.fetch(
                            row.user_id
                        );

                    const elapsed =
                        Date.now()
                        - Number(row.start_time);

                    description +=
                        `**${user.username}**\n`
                        + `科目: ${row.color || '未設定'}\n`
                        + `作業: ${row.task_name || '未設定'}\n`
                        + `経過: ${format(elapsed)}\n\n`;

                } catch {

                    description +=
                        'ユーザー取得失敗\n\n';
                }
            }

            const embed =
                new EmbedBuilder()
                    .setTitle('現在作業中')
                    .setDescription(description)
                    .setColor(0x00BFFF)
                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

        } catch (err) {

            console.error(err);

            await interaction.reply({
                content: 'DBエラー'
            });
        }
    }
};