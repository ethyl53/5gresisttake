const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const db = require('../database/db');

const colorMap = {
    red: 0xFF0000,
    orange: 0xFFA500,
    yellow: 0xFFFF00,
    green: 0x00B000,
    blue: 0x0074FF,
    purple: 0x8A2BE2,
    gray: 0x808080
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('作業開始')

        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('作業色')
                .addChoices(
                    { name: '赤', value: 'red' },
                    { name: '橙', value: 'orange' },
                    { name: '黄', value: 'yellow' },
                    { name: '緑', value: 'green' },
                    { name: '青', value: 'blue' },
                    { name: '紫', value: 'purple' },
                    { name: '灰', value: 'gray' }
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('task')
                .setDescription('作業名')
                .setRequired(false)
        ),

    async execute(interaction) {

    const userId = interaction.user.id;

    const color =
        interaction.options.getString('color');

    const task =
        interaction.options.getString('task');

    db.get(
        `
        SELECT *
        FROM work_sessions
        WHERE user_id = ?
        AND end_time IS NULL
        `,
        [userId],

        (err, row) => {

            if (err) {
                console.error('DB GET error:', err);

                return interaction.reply({
                    content: 'DBエラー',
                    ephemeral: true
                });
            }

            // 前の作業がある場合は自動終了
            if (row) {
                const endTime = Date.now();
                const duration = endTime - row.start_time;

                db.run(
                    `
                    UPDATE work_sessions
                    SET
                        end_time = ?,
                        duration = ?
                    WHERE id = ?
                    `,
                    [endTime, duration, row.id],
                    (updateErr) => {
                        if (updateErr) {
                            console.error('DB UPDATE error:', updateErr);
                            return interaction.reply({
                                content: '前の作業終了に失敗しました',
                                ephemeral: true
                            });
                        }

                        // 前の作業の終了メッセージを作成
                        const totalMinutes = Math.floor(duration / 1000 / 60);
                        const hours = Math.floor(totalMinutes / 60);
                        const minutes = totalMinutes % 60;

                        const previousEmbed = new EmbedBuilder()
                            .setTitle('◆作業終了（自動）')
                            .setDescription('新しい作業開始のため、前の作業を終了しました。')
                            .addFields(
                                { name: '作業名', value: row.task_name || '未設定', inline: true },
                                { name: '時間', value: `${hours}時間 ${minutes}分`, inline: true }
                            )
                            .setColor(colorMap[row.color] || 0x00BFFF)
                            .setFooter({ text: `ユーザー: ${interaction.user.tag}` })
                            .setTimestamp();

                        // 前の作業の終了メッセージを送信
                        interaction.reply({ embeds: [previousEmbed] });

                        // 前の作業を終了してから新しい作業を開始
                        setTimeout(() => {
                            startNewWork();
                        }, 500);
                    }
                );
            } else {
                // 前の作業がない場合は直接新しい作業を開始
                startNewWork();
            }

            // 新しい作業を開始する関数
            function startNewWork() {
                const startTime = Date.now();
                db.run(
                    `
                    INSERT INTO work_sessions
                    (
                        user_id,
                        task_name,
                        color,
                        start_time
                    )
                    VALUES (?, ?, ?, ?)
                    `,
                    [
                        userId,
                        task || null,
                        color || null,
                        startTime
                    ],
                    (insertErr) => {

                        if (insertErr) {
                            console.error('DB RUN error:', insertErr);

                            const replyMethod = row ? 'followUp' : 'reply';
                            return interaction[replyMethod]({
                                content: '保存失敗',
                                ephemeral: true
                            });
                        }

                        const embed = new EmbedBuilder()
                            .setTitle('◇作業開始')
                            .setDescription('作業を開始しました。')
                            .addFields(
                                { name: '作業名', value: task || '未設定', inline: true },
                                { name: '色', value: color || '未設定', inline: true }
                            )
                            .setColor(colorMap[color] || 0x00BFFF)
                            .setFooter({ text: `ユーザー: ${interaction.user.tag}` })
                            .setTimestamp();

                        const replyMethod = row ? 'followUp' : 'reply';
                        interaction[replyMethod]({ embeds: [embed] });
                    }
                );
            }
        }
    );
}
};