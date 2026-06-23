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

        let startMs, endMs, nowMs;
        let isCustom = false;
        let titleRange = '';

        // 💡 月または週が指定された場合は、過去の特定週のタイムスタンプを計算する
        if (monthOpt || weekOpt) {
            const targetMonth = monthOpt || new Date().getMonth() + 1;
            const targetWeek = weekOpt || 1;
            
            // 指定月の1日を取得
            const firstDay = new Date(yearOpt, targetMonth - 1, 1);
            const dayOfWeek = firstDay.getDay(); // 0: 日, 1: 月, ..., 6: 土
            
            // その月で「1日が含まれる週の月曜日」を算出
            const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            
            // 第1週の月曜日 02:00:00 のタイムスタンプ
            const week1Start = new Date(yearOpt, targetMonth - 1, 1 + diffToMonday, 2, 0, 0, 0);
            
            startMs = week1Start.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000;
            endMs = startMs + 7 * 24 * 60 * 60 * 1000;
            nowMs = Date.now();
            isCustom = true;
            titleRange = `${yearOpt}年${targetMonth}月 第${targetWeek}週`;
        } else {
            // 指定がない場合はデフォルトの「今週」を使用
            const range = getWeeklyRange();
            startMs = range.startMs;
            endMs = range.endMs;
            nowMs = range.nowMs;
            titleRange = '今週';
        }

        try {
            // 指定された範囲に少しでもかぶっているセッションを抽出
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
                return interaction.editReply({ content: `**${username}** さんの${titleRange}の作業記録はありません` });
            }

            // 一時停止の履歴は「タイムライングラフの描画」のためだけに取得
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