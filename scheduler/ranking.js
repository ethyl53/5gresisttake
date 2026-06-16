const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getYesterdayRange, resolveSubject, formatTime, generateTimelineBuffer } = require('../utils/timeline');

// index.js などで require('./scheduler/ranking')(client); のように呼び出してください
module.exports = (client) => {
    // 毎日 02:00 に実行
    cron.schedule('0 2 * * *', async () => {
        try {
            // 送信先のチャンネルIDを指定してください
            const targetChannelId = 'YOUR_CHANNEL_ID_HERE'; 
            const channel = await client.channels.fetch(targetChannelId).catch(() => null);
            if (!channel) return;

            const { startMs, endMs } = getYesterdayRange();

            // 前日の全ユーザーのセッションを取得
            const result = await db.query(`
                SELECT * FROM work_sessions
                WHERE start_time <= $2 
                AND (end_time IS NULL OR end_time >= $1)
            `, [startMs, endMs]);

            const rows = result.rows;
            if (!rows.length) {
                return channel.send('昨日の作業記録はありませんでした。今日からまた頑張りましょう！');
            }

            const userStats = {};
            const globalSubjectTotals = {};

            // クリッピング & 全体集計
            for (const row of rows) {
                const sessionStart = Number(row.start_time);
                // 2:00の時点で終了していない作業があれば、2:00時点(endMs)で強制カット扱い
                const sessionEnd = row.end_time ? Number(row.end_time) : endMs;
                
                const actualStart = Math.max(sessionStart, startMs);
                const actualEnd = Math.min(sessionEnd, endMs);

                if (actualStart < actualEnd) {
                    const duration = actualEnd - actualStart;
                    const userId = row.user_id;
                    const subjectInfo = resolveSubject(row.color || row.task_name);

                    if (!userStats[userId]) {
                        userStats[userId] = { userId, totalTime: 0, sessions: [] };
                    }

                    userStats[userId].totalTime += duration;
                    userStats[userId].sessions.push({
                        start: actualStart,
                        end: actualEnd,
                        colorHex: subjectInfo.hex
                    });

                    globalSubjectTotals[subjectInfo.name] = (globalSubjectTotals[subjectInfo.name] || 0) + duration;
                }
            }

            // ランキング作成（時間の多い順）
            const sortedUsers = Object.values(userStats).sort((a, b) => b.totalTime - a.totalTime);
            
            // ユーザー名取得とタイムライン用データの作成
            const timelineData = [];
            let rankingText = '';
            const medals = ['🥇', '🥈', '🥉'];

            for (let i = 0; i < sortedUsers.length; i++) {
                const stat = sortedUsers[i];
                let username = 'Unknown';
                try {
                    const user = await client.users.fetch(stat.userId);
                    username = user.displayName || user.username;
                } catch (e) {}

                timelineData.push({ username, sessions: stat.sessions });
                
                const rankIcon = medals[i] || `**${i + 1}.**`;
                rankingText += `${rankIcon} ${username} : ${formatTime(stat.totalTime)}\n`;
            }

            // 全体の科目別統計
            const sortedSubjects = Object.entries(globalSubjectTotals).sort((a, b) => b[1] - a[1]);
            const subjectDetails = sortedSubjects.map(([name, time]) => `・${name}: ${formatTime(time)}`).join('\n') || 'データなし';

            // 画像生成 (全員分のレーンが描画される)
            const buffer = await generateTimelineBuffer(timelineData, startMs);
            const attachment = new AttachmentBuilder(buffer, { name: 'daily_timeline.png' });

            const embed = new EmbedBuilder()
                .setTitle('🏆 昨日の作業ランキング & 統計')
                .setDescription('昨日の2:00〜今日の1:59までの集計結果です！\n\n**【ランキング】**\n' + rankingText)
                .addFields({ name: '📚 全体の科目別統計', value: subjectDetails, inline: false })
                .setColor(0xFFD700)
                .setImage('attachment://daily_timeline.png')
                .setTimestamp();

            await channel.send({ embeds: [embed], files: [attachment] });

        } catch (err) {
            console.error('[Ranking Scheduler Error]', err);
        }
    });
};