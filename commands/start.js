const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');

const colorMap = {
    orange: 0xFFA500,
    yellow: 0xFFFF00,
    green: 0x00B000,
    blue: 0x0074FF,
    lightblue: 0x66CCFF,
    gray: 0x808080
};

const subjectColorMap = {
    math: 'blue',
    chemistry: 'lightblue',
    physics: 'orange',
    english: 'yellow',
    social: 'green',
    other: 'gray'
};

const subjectNameMap = {
    math: '数学',
    chemistry: '化学',
    physics: '物理',
    english: '英語',
    social: '社会',
    other: 'その他'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('作業開始')
        .addStringOption(option =>
            option
                .setName('subject')
                .setDescription('科目')
                .addChoices(
                    { name: '数学', value: 'math' },
                    { name: '化学', value: 'chemistry' },
                    { name: '物理', value: 'physics' },
                    { name: '英語', value: 'english' },
                    { name: '社会', value: 'social' },
                    { name: 'その他', value: 'other' }
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
        // 💡 軽量化・安定化：DB処理の前に応答を保留し、3秒タイムアウトエラーを完全に回避
        await interaction.deferReply();

        const userId = interaction.user.id;
        const subject = interaction.options.getString('subject');
        const color = subjectColorMap[subject] || null;
        const task = interaction.options.getString('task');

        try {
            // 💡 軽量化：SELECT * を廃止し、必要なカラムのみを取得してメモリ消費を削減
            const result = await db.query(
                `
                SELECT id, task_name, color, start_time, pause_time, paused_duration
                FROM work_sessions
                WHERE user_id = $1
                  AND end_time IS NULL
                LIMIT 1
                `,
                [userId]
            );

            const row = result.rows[0];

            // 🟢 一時停止中で、かつ「新しい引数が指定されていない」場合のみ再開する
            if (row && row.pause_time && !subject && !task) {
                const now = Date.now();
                const pausedTime = now - Number(row.pause_time);

                const client = await db.connect();
                try {
                    await client.query('BEGIN');

                    await client.query(
                        `
                        UPDATE work_sessions
                        SET
                            pause_time = NULL,
                            paused_duration = COALESCE(paused_duration, 0) + $1
                        WHERE id = $2
                        `,
                        [pausedTime, row.id]
                    );

                    await client.query(
                        `
                        UPDATE session_pauses
                        SET pause_end = $1
                        WHERE session_id = $2 AND pause_end IS NULL
                        `,
                        [now, row.id]
                    );

                    await client.query('COMMIT');
                } catch (txErr) {
                    await client.query('ROLLBACK');
                    throw txErr;
                } finally {
                    client.release();
                }

                if (interaction.client.persistentRanking?.update) {
                    interaction.client.persistentRanking.update();
                }

                const embed = new EmbedBuilder()
                    .setTitle('▶️ 作業再開')
                    .setDescription('一時停止中の作業を再開しました。')
                    .addFields({ name: '作業名', value: row.task_name || '未設定' })
                    .setColor(colorMap[row.color] || 0x00BFFF)
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            // 🟢 新規作業の開始（前の作業が残っている場合の自動終了処理を含む）
            const startTime = Date.now();
            let previousDuration = 0;

            const client = await db.connect();
            try {
                await client.query('BEGIN');

                if (row) {
                    let pausedDuration = Number(row.paused_duration || 0);

                    // もし「一時停止中のまま」新しい作業が始められた場合の救済ロジック
                    if (row.pause_time) {
                        const extraPause = startTime - Number(row.pause_time);
                        pausedDuration += extraPause;

                        await client.query(
                            `
                            UPDATE session_pauses
                            SET pause_end = $1
                            WHERE session_id = $2 AND pause_end IS NULL
                            `,
                            [startTime, row.id]
                        );
                    }

                    // 停止時間を正確に引いて純粋な作業時間を出す
                    previousDuration = startTime - Number(row.start_time) - pausedDuration;

                    await client.query(
                        `
                        UPDATE work_sessions
                        SET
                            end_time = $1,
                            duration = $2,
                            pause_time = NULL,
                            paused_duration = $3
                        WHERE id = $4
                        `,
                        [startTime, previousDuration, pausedDuration, row.id]
                    );
                }

                // 新規セッションのインサート
                await client.query(
                    `
                    INSERT INTO work_sessions (user_id, task_name, color, start_time)
                    VALUES ($1, $2, $3, $4)
                    `,
                    [userId, task || null, color, startTime]
                );

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }

            if (interaction.client.persistentRanking?.update) {
                interaction.client.persistentRanking.update();
            }

            const startEmbed = new EmbedBuilder()
                .setTitle('◆作業開始')
                .setDescription('作業を開始しました。')
                .addFields(
                    { name: '作業名', value: task || '未設定', inline: true },
                    { name: '科目', value: subjectNameMap[subject] || '未設定', inline: true }
                )
                .setColor(colorMap[color] || 0x00BFFF)
                .setFooter({ text: `ユーザー: ${interaction.user.tag}` })
                .setTimestamp();

            // 💡 修正：自動終了があった場合は editReply と followUp で通知を安全に分割
            if (row) {
                const totalMinutes = Math.floor(previousDuration / 1000 / 60);
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

                await interaction.editReply({ embeds: [previousEmbed] });
                await interaction.followUp({ embeds: [startEmbed] });
            } else {
                await interaction.editReply({ embeds: [startEmbed] });
            }

        } catch (err) {
            console.error(err);
            const errMsg = 'データベースエラーが発生しました。';
            if (interaction.deferred) {
                await interaction.editReply({ content: errMsg });
            } else {
                await interaction.reply({ content: errMsg, ephemeral: true });
            }
        }
    }
};