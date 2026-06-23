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
            let targetDate = new Date();

            if (dateText) {
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

            // 💡 軽量化・安定化：DB処理の前に応答を保留し、3秒タイムアウトエラーを完全に回避
            await interaction.deferReply();

            // 💡 軽量化・高速化：トランザクションを開始して一括書き込み（ディスクI/Oの大幅削減）
            await db.query('BEGIN');

            try {
                // 💡 軽量化：SELECT * をやめ、必要なカラムのみを抽出
                // 💡 高速化：COALESCE関数を排除してDBインデックスを有効化。同時に、進行中ログの重複検知漏れバグも修正
                const overlap = await db.query(
                    `
                    SELECT id, user_id, task_name, color, start_time, end_time
                    FROM work_sessions
                    WHERE user_id = $1
                      AND start_time < $3
                      AND (end_time > $2 OR end_time IS NULL)
                    `,
                    [userId, startMs, endMs]
                );

                // --- 既存ログの自動トリミング処理 ---
                for (const row of overlap.rows) {
                    await db.query(`DELETE FROM work_sessions WHERE id = $1`, [row.id]);

                    // 被ったログの前半部分を再挿入
                    const rowStart = Number(row.start_time);
                    if (rowStart < startMs) {
                        await db.query(
                            `
                            INSERT INTO work_sessions (user_id, task_name, color, start_time, end_time, duration)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            `,
                            [row.user_id, row.task_name, row.color, row.start_time, startMs, startMs - rowStart]
                        );
                    }

                    // 被ったログの後半部分を再挿入
                    if (row.end_time) {
                        const rowEnd = Number(row.end_time);
                        if (rowEnd > endMs) {
                            await db.query(
                                `
                                INSERT INTO work_sessions (user_id, task_name, color, start_time, end_time, duration)
                                VALUES ($1, $2, $3, $4, $5, $6)
                                `,
                                [row.user_id, row.task_name, row.color, endMs, row.end_time, rowEnd - endMs]
                            );
                        }
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
                        [userId, info.name, info.hex, startMs, endMs, endMs - startMs]
                    );
                }

                // トランザクションをコミット
                await db.query('COMMIT');

            } catch (dbErr) {
                // エラー時はロールバックして整合性を保つ
                await db.query('ROLLBACK');
                throw dbErr;
            }

            // --- 結果の埋め込みメッセージ作成 ---
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

            // deferReplyしているため editReply で送信
            await interaction.editReply({ embeds: [embed] });

            // 💡 追加機能：ランキングの自動更新を連動（safeUpdateが走り、安全に即時反映されます）
            if (interaction.client.ranking && typeof interaction.client.ranking.update === 'function') {
                interaction.client.ranking.update();
            }

        } catch (err) {
            console.error('[Edit Cmd Error]', err);
            if (interaction.deferred) {
                await interaction.editReply({ content: '編集中にエラーが発生しました' });
            } else {
                await interaction.reply({ content: '編集中にエラーが発生しました', ephemeral: true });
            }
        }
    }
};