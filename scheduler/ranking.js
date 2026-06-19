const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 毎日2:00区切りの範囲を取得
function getDailyRange() {
    const d = new Date();
    d.setHours(d.getHours() - 1); // 2:00ジャスト実行時のブレ防止
    
    const start = new Date(d);
    if (start.getHours() < 2) start.setDate(start.getDate() - 1);
    start.setHours(2, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(1, 59, 59, 999);
    
    return { startMs: start.getTime(), endMs: end.getTime() };
}

// 週間（月曜2:00区切り）の範囲を取得
function getWeeklyRange() {
    const daily = getDailyRange();
    const startMs = daily.startMs - 6 * 24 * 60 * 60 * 1000;
    return { startMs, endMs: daily.endMs };
}

// 💡 期間集計 ＆ ランキングEmbed ＆ タイムライン総括画像の統合ビルド関数
async function buildRankingAndTimeline(client, startMs, endMs, title, color, includeTimeline = false) {
    const nowMs = Date.now();

    // 期間内に重なるセッションをすべて取得
    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $3::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [startMs, endMs, nowMs]);

    const rows = result.rows;

    // 紐づく一時停止履歴を一括取得
    const pausesMap = {};
    if (rows.length > 0) {
        const sessionIds = rows.map(row => row.id);
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
                end: pRow.pause_end ? Number(pRow.pause_end) : nowMs
            });
        }
    }

    const userStats = {};

    for (const row of rows) {
        const sessionStart = Number(row.start_time);
        const sessionEnd = row.end_time ? Number(row.end_time) : nowMs;
        
        const actualStart = Math.max(sessionStart, startMs);
        const actualEnd = Math.min(sessionEnd, endMs);

        if (actualStart < actualEnd) {
            // 期間内に被っている一時停止の長さを正確に計算
            let totalPauseInRange = 0;
            const sessionPauses = pausesMap[row.id] || [];
            for (const p of sessionPauses) {
                const overlapStart = Math.max(p.start, actualStart);
                const overlapEnd = Math.min(p.end, actualEnd);
                if (overlapStart < overlapEnd) {
                    totalPauseInRange += (overlapEnd - overlapStart);
                }
            }

            const duration = actualEnd - actualStart - totalPauseInRange;
            if (duration <= 0) continue;

            const userId = row.user_id;
            const subjectInfo = resolveSubject(row.color || row.task_name);

            if (!userStats[userId]) {
                userStats[userId] = { userId, totalTime: 0, sessions: [] };
            }

            userStats[userId].totalTime += duration;
            
            if (includeTimeline) {
                userStats[userId].sessions.push({
                    start: actualStart,
                    end: actualEnd,
                    colorHex: subjectInfo.hex,
                    pauses: sessionPauses
                });
            }
        }
    }

    // 勉強時間の長い順にソート
    const sortedUsers = Object.values(userStats).sort((a, b) => b.totalTime - a.totalTime);
    
    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    const timelineData = [];

    for (let i = 0; i < sortedUsers.length; i++) {
        const stat = sortedUsers[i];
        let username = 'Unknown';
        try {
            const user = await client.users.fetch(stat.userId);
            username = user.displayName || user.username;
        } catch(e) {}

        if (includeTimeline) {
            timelineData.push({ username, sessions: stat.sessions });
        }
        
        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username}\n**${formatTime(stat.totalTime)}**\n\n`;
    }

    if (!text) text = '作業記録がありませんでした。';

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(text)
        .setColor(color)
        .setTimestamp();

    let attachment = null;
    // 💡 デイリー用かつデータが存在する場合、全員分の縦並び24hタイムライン画像を生成
    if (includeTimeline && timelineData.length > 0) {
        const buffer = await generateTimelineBuffer(timelineData, startMs);
        const fileName = `daily_summary_${Date.now()}.png`;
        attachment = new AttachmentBuilder(buffer, { name: fileName });
        embed.setImage(`attachment://${fileName}`);
    }

    return { embed, attachment };
}

module.exports = (client, persistentRankingManager) => {
    // 毎日 02:00 に時報実行
    cron.schedule('0 2 * * *', async () => {
        const channelId = process.env.RANKING_CHANNEL_ID;
        if (!channelId) return;

        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;

            // 1. デイリー時報送信（第6引数を true にしてタイムライン画像付き）
            const dailyRange = getDailyRange();
            const { embed: dailyEmbed, attachment: dailyAttachment } = await buildRankingAndTimeline(
                client, dailyRange.startMs, dailyRange.endMs, '📊 昨日の作業ランキング', 0x00BFFF, true
            );
            
            const dailyPayload = { embeds: [dailyEmbed] };
            if (dailyAttachment) dailyPayload.files = [dailyAttachment];
            await channel.send(dailyPayload);

            // 2. 月曜のみ：ウィークリー時報送信（画像は不要なので false）
            if (new Date().getDay() === 1) {
                const weeklyRange = getWeeklyRange();
                const { embed: weeklyEmbed } = await buildRankingAndTimeline(
                    client, weeklyRange.startMs, weeklyRange.endMs, '📅 週間作業ランキング', 0x00FF7F, false
                );
                await channel.send({ embeds: [weeklyEmbed] });
            }

            // 3. 常設ランキングを一度削除し、新しく最下部に送り直す
            await persistentRankingManager.resend();

        } catch (e) {
            console.error('[Time Signal Cron Error]', e);
        }
    });
    
    // 午前3時の自動再起動によるリフレッシュ
    cron.schedule('0 3 * * *', () => {
        console.log('[Sleep/Reset Mode] Exiting process for Railway auto-restart.');
        process.exit(0); 
    });
};