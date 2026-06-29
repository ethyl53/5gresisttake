const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getWeeklyRange, resolveSubject, formatTime, generateWeeklyTimelineBuffer } = require('../utils/timeline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly')
        .setDescription('指定したユーザーの週間作業時間を表示（過去の週も指定可能）')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('確認したい月 (1〜12) ※未指定で今週')
                .setMinValue(1)
                .setMaxValue(12)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('week')
                .setDescription('確認したい第何週か (1〜5) ※未指定で第1週扱い')
                .setMinValue(1)
                .setMaxValue(5)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('確認したい年 (未指定なら今年)')
                .setMinValue(2020)
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;

        const monthOpt = interaction.options.getInteger('month');
        const weekOpt = interaction.options.getInteger('week');
        const yearOpt = interaction.options.getInteger('year') || new Date().getFullYear();

        let startMs, endMs;
        const nowMs = Date.now();
        let isCustom = false;
        let titleRange = '';

        if (monthOpt || weekOpt) {
            const targetMonth = monthOpt || new Date().getMonth() + 1;
            const targetWeek = weekOpt || 1;
            
            // 指定月の1日（JST基準）のタイムスタンプを安全に作成
            const firstDayJst = new Date(Date.UTC(yearOpt, targetMonth - 1, 1, -9, 0, 0, 0));
            const jstDate = new Date(firstDayJst.getTime() + 9 * 60 * 60 * 1000);
            const dayOfWeek = jstDate.getUTCDay(); // 0:日, 1:月...
            
            const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            
            // 第1週の月曜日 02:00:00 JST (= UTC 前日17:00:00)
            const week1Start = new Date(Date.UTC(yearOpt, targetMonth - 1, 1 + diffToMonday, 2 - 9, 0, 0, 0));
            
            startMs = week1Start.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000;
            endMs = startMs + 7 * 24 * 60 * 60 * 1000;
            isCustom = true;
            titleRange = `${yearOpt}年${targetMonth}月 第${targetWeek}週`;
        } else {
            const range = getWeeklyRange();
            startMs = range.startMs;
            endMs = range.endMs;
            titleRange = '今週';
        }

        try {
            // 💡 軽量化：必要なカラムのみに絞って取得
            const result = await db.query(`
                SELECT id, start_time, end_time, color, task_name FROM work_sessions
                WHERE user_id = $1 
                AND start_time <= $3::bigint 
                AND COALESCE(end_time, $4::bigint) >= $2::bigint
                ORDER BY start_time ASC
            `, [userId, startMs, endMs, nowMs]);

            const rows = result.rows;

            const username = interaction.guild 
                ? (await interaction.guild.members.fetch(userId).catch(() => null))?.displayName || targetUser.username
                : targetUser.username;

            if (!rows.length) {
                return interaction.editReply({ content: `**${username}** さんの${titleRange}の作業記録はありません` });
            }

            // 一時停止データの取得
            const sessionIds = rows.map(r => r.id);
            const pausesMap = {};
            if (sessionIds.length > 0) {
                const pauseResult = await db.query(`
                    SELECT session_id, pause_start, pause_end FROM session_pauses
                    WHERE session_id = ANY($1::integer[])
                    ORDER BY pause_start ASC
                `, [sessionIds]);

                for (const pRow of pauseResult.rows) {
                    if (!pausesMap[pRow.session_id]) {
                        pausesMap[pRow.session_id] = [];
                    }
                    pausesMap[pRow.session_id].push({
                        start: Number(pRow.pause_start),
                        end: pRow.pause_end ? Number(pRow.pause_end) : nowMs
                    });
                }
            }

            let totalTime = 0;
            const subjectTotals = {};
            const graphSessions = [];

            // 💡 修正：ranking.jsと完全に同一の「一時停止引き算アルゴリズム」へ統一
            for (const row of rows) {
                const sessionStart = Number(row.start_time);
                const sessionEnd = row.end_time ? Number(row.end_time) : nowMs;
                
                const actualStart = Math.max(sessionStart, startMs);
                const actualEnd = Math.min(sessionEnd, endMs);

                if (actualStart < actualEnd) {
                    let totalPauseInRange = 0;
                    const sessionPauses = pausesMap[row.id] || [];
                    for (const p of sessionPauses) {
                        const overlapStart = Math.max(p.start, actualStart);
                        const overlapEnd = Math.min(p.end, actualEnd);
                        if (overlapStart < overlapEnd) {
                            totalPauseInRange += (overlapEnd - overlapStart);
                        }
                    }

                    const activeDuration = actualEnd - actualStart - totalPauseInRange;
                    if (activeDuration <= 0) continue;

                    totalTime += activeDuration;
                    const subjectInfo = resolveSubject(row.color || row.task_name);
                    subjectTotals[subjectInfo.name] = (subjectTotals[subjectInfo.name] || 0) + activeDuration;

                    graphSessions.push({
                        start: actualStart,
                        end: actualEnd,
                        colorHex: subjectInfo.hex,
                        pauses: sessionPauses
                    });
                }
            }

            const sortedSubjects = Object.entries(subjectTotals).sort((a, b) => b[1] - a[1]);
            const subjectDetails = sortedSubjects.map(([name, time]) => `・**${name}**: ${formatTime(time)}`).join('\n') || 'データなし';

            const buffer = await generateWeeklyTimelineBuffer(username, graphSessions, startMs);
            const attachment = new AttachmentBuilder(buffer, { name: 'weekly_timeline.png' });

            const descriptionText = isCustom
                ? `指定された期間（${new Date(startMs).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 〜 ${new Date(endMs).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）の集計結果です。`
                : '今週の月曜日 02:00 から現在時刻までの集計結果です。';

            const embed = new EmbedBuilder()
                .setTitle(`📅 ${titleRange}の勉強実績 (${username})`)
                .setDescription(descriptionText)
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