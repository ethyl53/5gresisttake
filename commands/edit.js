const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');

// 前回のタイムライン描画と互換性を持たせるため、保存する色（Hex）と科目名を定義
const subjectData = {
    math: { name: '数学', hex: '#0074FF' },
    chemistry: { name: '化学', hex: '#66CCFF' },
    physics: { name: '物理', hex: '#FFA500' },
    english: { name: '英語', hex: '#FFFF00' },
    social: { name: '社会', hex: '#00B000' },
    other: { name: 'その他', hex: '#FF0000' }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('過去の記録を追加・修正・削除')
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
        )
        // 日付オプションを新規追加（必須ではないため省略時は「今日」になります）
        .addStringOption(option =>
            option
                .setName('date')
                .setDescription('日付 YYYY-MM-DD または MM-DD (省略時は今日)')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            const subject = interaction.options.getString('subject');
            const startText = interaction.options.getString('start');
            const endText = interaction.options.getString('end');
            const dateText = interaction.options.getString('date');

            const startParts = startText.split(':');
            const endParts = endText.split(':');

            if (startParts.length !== 2 || endParts.length !== 2) {
                return interaction.reply({
                    content: '時刻は HH:MM 形式で入力してください',
                    ephemeral: true
                });
            }

            // --- 日付のパース処理 ---
            let targetDate = new Date(); // デフォルトはコマンド実行日の現在時刻

            if (dateText) {
                // MM-DD または MM/DD に対応するため、年を補完する簡易処理
                let parsedDateText = dateText.replace(/\//g, '-');
                if (parsedDateText.split('-').length === 2) {
                    parsedDateText = `${targetDate.getFullYear()}-${parsedDateText}`;
                }

                const parsed = new Date(parsedDateText);
                if (isNaN(parsed.getTime())) {
                    return interaction.reply({
                        content: '無効な日付です。YYYY-MM-DD または MM-DD 形式で入力してください。',
                        ephemeral: true
                    });
                }
                targetDate = parsed;
            }

            // 指定された日付に時刻をセット
            const start = new Date(targetDate);
            start.setHours(Number(startParts[0]), Number(startParts[1]), 0, 0);

            const end = new Date(targetDate);
            end.setHours(Number(endParts[0]), Number(endParts[1]), 0, 0);

            if (end <= start) {
                return interaction.reply({
                    content: '終了時刻は開始時刻より後にしてください。日を跨ぐ場合は2つに分割して登録してください。',
                    ephemeral: true
                });
            }

            const startMs = start.getTime();
            const endMs = end.getTime();
            const userId = interaction.user.id;

            // --- 重複ログの取得（※他人のログを消さないよう user_id = $1 を追加） ---
            const overlap = await db.query(
                `
                SELECT *
                FROM work_sessions
                WHERE user_id = $1
                  AND start_time < $3
                  AND COALESCE(end_time, start_time) > $2
                `,
                [userId, startMs, endMs]
            );

            // --- 既存ログの自動トリミング処理 ---
            for (const row of overlap.rows) {
                await db.query(
                    `DELETE FROM work_sessions WHERE id = $1`,
                    [row.id]
                );

                // 被ったログの前半部分を再挿入
                if (Number(row.start_time) < startMs) {
                    await db.query(
                        `
                        INSERT INTO work_sessions (user_id, task_name, color, start_time, end_time, duration)
                        VALUES ($1, $2, $3, $4, $5, $6)
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

                // 被ったログの後半部分を再挿入
                if (row.end_time && Number(row.end_time) > endMs) {
                    await db.query(
                        `
                        INSERT INTO work_sessions (user_id, task_name, color, start_time, end_time, duration)
                        VALUES ($1, $2, $3, $4, $5, $6)
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

            // --- 新規ログの挿入 (delete以外) ---
            if (subject !== 'delete') {
                const info = subjectData[subject] || subjectData.other;

                await db.query(
                    `
                    INSERT INTO work_sessions (user_id, task_name, color, start_time, end_time, duration)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    `,
                    [
                        userId,
                        info.name,
                        info.hex,
                        startMs,
                        endMs,
                        endMs - startMs
                    ]
                );
            }

            // --- 結果の埋め込みメッセージ作成 ---
            // 日付を YYYY/MM/DD のフォーマットに整形
            const yyyy = targetDate.getFullYear();
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
            const dd = String(targetDate.getDate()).padStart(2, '0');
            const dateDisplay = `${yyyy}/${mm}/${dd}`;

            const embed = new EmbedBuilder()
                .setTitle('✅ 記録編集完了')
                .addFields(
                    { name: '日付', value: dateDisplay, inline: false },
                    { name: '科目', value: subject === 'delete' ? '🗑️ 削除' : subjectData[subject].name, inline: true },
                    { name: '開始', value: startText, inline: true },
                    { name: '終了', value: endText, inline: true }
                )
                .setColor(subject === 'delete' ? 0xFF0000 : 0x00BFFF)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error('[Edit Cmd Error]', err);
            await interaction.reply({
                content: '編集中にエラーが発生しました',
                ephemeral: true
            });
        }
    }
};