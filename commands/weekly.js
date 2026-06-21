const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getWeeklyRange, resolveSubject, formatTime, generateWeeklyTimelineBuffer } = require('../utils/timeline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly')
        .setDescription('指定したユーザーの今週の作業時間を表示（月曜2:00〜現在まで）')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;
        const { startMs, endMs, nowMs } = getWeeklyRange();

        try {
            // 月曜日2:00〜翌月曜日1:59までの広域範囲で抽出
            const result = await db.query(`
                SELECT * FROM work_sessions
                WHERE user_id = $1 
                AND start_time <= $3 
                AND (end_time IS NULL OR end_time >= $2)
                ORDER BY start_time ASC
            `, [userId, startMs, endMs]);

            const rows = result.rows;

            const username = interaction.guild 
                ? (await interaction.guild.members.fetch(userId).catch(() => null))?.displayName || targetUser.username
                : targetUser.username;

            if (!rows.length) {
                return interaction.editReply({ content: `**${username}** さんの今週の作業記録はありません` });
            }

            // 💡 一時停止の履歴は「タイムライングラフの描画」のためだけに取得
            const sessionIds = rows.map(r => r.id);
            const pausesMap = {};
            if (sessionIds.length > 0) {
                const pauseResult = await db.query(`
                    SELECT * FROM session_pauses
                    WHERE session_id = ANY($1::integer[])
                    ORDER BY pause_start ASC
                `, [sessionIds]);

                for (const pRow of pauseResult.rows) {
                    if (!pausesMap[pRow.session_id]) {
                        pausesMap[pRow.session_id] = [];
                    }
                    pausesMap[pRow.session_id].push({
                        start: Number(pRow.pause_start),
                        end: pRow.pause_end ? Number(pRow.pause_end) : Date.now()
                    });
                }
            }

            let totalTime = 0;
            const subjectTotals = {};
            const graphSessions = [];

            for (const row of rows) {
                const sessionStart = Number(row.start_time);
                const sessionEnd = row.end_time ? Number(row.end_time) : Date.now();
                
                const actualStart = Math.max(sessionStart, startMs);
                const actualEnd = Math.min(sessionEnd, endMs);
                const statsEnd = Math.min(actualEnd, nowMs);

                if (actualStart < statsEnd) {
                    let activeDuration = 0;

                    if (row.end_time) {
                        activeDuration = Number(row.duration || 0);
                        if (sessionStart < startMs) activeDuration -= (startMs - sessionStart);
                        if (sessionEnd > statsEnd) activeDuration -= (sessionEnd - statsEnd);
                        activeDuration = Math.max(0, Math.min(activeDuration, Number(row.duration || 0)));
                    } else {
                        let currentEnd = row.pause_time ? Number(row.pause_time) : nowMs;
                        activeDuration = currentEnd - sessionStart - Number(row.paused_duration || 0);
                        if (sessionStart < startMs) activeDuration -= (startMs - sessionStart);
                        activeDuration = Math.max(0, activeDuration);
                    }

                    activeDuration = Math.min(activeDuration, 86400000); // 24h limit

                    if (activeDuration > 0) {
                        totalTime += activeDuration;
                        const subjectInfo = resolveSubject(row.color || row.task_name);
                        subjectTotals[subjectInfo.name] = (subjectTotals[subjectInfo.name] || 0) + activeDuration;
                    }
                }

                // グラフにプロットするデータ
                const graphEnd = Math.min(actualEnd, nowMs);
                if (actualStart < graphEnd) {
                    const subjectInfo = resolveSubject(row.color || row.task_name);
                    
                    // 💡 描画バグ防止（タイムスタンプが壊れていても実働時間に合わせてバーを短くカット）
                    let drawEnd = graphEnd;
                    if (row.end_time) {
                        const dbDuration = Number(row.duration || 0);
                        const rawDiff = sessionEnd - sessionStart;
                        if (rawDiff > dbDuration + Number(row.paused_duration || 0) + 3600000) {
                            drawEnd = Math.min(graphEnd, sessionStart + dbDuration + Number(row.paused_duration || 0));
                        }
                    }

                    graphSessions.push({
                        start: actualStart,
                        end: drawEnd,
                        colorHex: subjectInfo.hex,
                        pauses: pausesMap[row.id] || []
                    });
                }
            }

            const sortedSubjects = Object.entries(subjectTotals).sort((a, b) => b[1] - a[1]);
            const subjectDetails = sortedSubjects.map(([name, time]) => `・**${name}**: ${formatTime(time)}`).join('\n') || 'データなし';

            // 7行構成の週間タイムライン画像を生成
            const buffer = await generateWeeklyTimelineBuffer(username, graphSessions, startMs);
            const attachment = new AttachmentBuilder(buffer, { name: 'weekly_timeline.png' });

            const embed = new EmbedBuilder()
                .setTitle(`📅 今週の勉強実績 (${username})`)
                .setDescription('今週の月曜日 02:00 から現在時刻までの集計結果です。')
                .addFields(
                    { name: '🔥 総勉強時間', value: `**${formatTime(totalTime)}**`, inline: false },
                    { name: '📚 科目別合計', value: subjectDetails, inline: false }
                )
                .setColor(0x00FF7F)
                .setImage('attachment://weekly_timeline.png')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (err) {
            console.error('[Weekly Cmd Error]', err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};