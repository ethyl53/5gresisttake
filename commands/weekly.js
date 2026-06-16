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

            let totalTime = 0;
            const subjectTotals = {};
            const graphSessions = [];

            for (const row of rows) {
                const sessionStart = Number(row.start_time);
                const sessionEnd = row.end_time ? Number(row.end_time) : Date.now();
                
                const actualStart = Math.max(sessionStart, startMs);
                const actualEnd = Math.min(sessionEnd, endMs);

                if (actualStart < actualEnd) {
                    // 総勉強時間の集計は「月曜2:00からコマンド送信時(nowMs)」までに制限する
                    const statsEnd = Math.min(actualEnd, nowMs);
                    if (actualStart < statsEnd) {
                        const duration = statsEnd - actualStart;
                        totalTime += duration;

                        const subjectInfo = resolveSubject(row.color || row.task_name);
                        subjectTotals[subjectInfo.name] = (subjectTotals[subjectInfo.name] || 0) + duration;
                    }

                    // グラフにプロットするデータも送信時(nowMs)で上限カット（送信時以降を空白化するため）
                    const graphEnd = Math.min(actualEnd, nowMs);
                    if (actualStart < graphEnd) {
                        const subjectInfo = resolveSubject(row.color || row.task_name);
                        graphSessions.push({
                            start: actualStart,
                            end: graphEnd,
                            colorHex: subjectInfo.hex
                        });
                    }
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