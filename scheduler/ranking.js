const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { formatTime } = require('../utils/timeline');

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

// 共通：期間集計＆Embed生成
async function buildTimeRangeEmbed(client, startMs, endMs, title, color) {
    const nowMs = Date.now();
    // 期間内の被り部分のみを正確に切り出し(LEAST/GREATEST)、かつ現在進行中(IS NULL)も対応する最強のSQL
    const result = await db.query(`
        SELECT user_id,
               SUM(
                   LEAST(COALESCE(end_time, $3::bigint), $2::bigint) - GREATEST(start_time, $1::bigint)
               ) as total_duration
        FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $3::bigint) >= $1::bigint
        GROUP BY user_id
        ORDER BY total_duration DESC
    `, [startMs, endMs, nowMs]);

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i];
        const userId = row.user_id;
        const timeMs = Number(row.total_duration);
        
        if (timeMs <= 0) continue;

        let username = 'Unknown';
        try {
            const user = await client.users.fetch(userId);
            username = user.displayName || user.username;
        } catch(e) {}

        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username}\n**${formatTime(timeMs)}**\n\n`;
    }

    if (!text) text = '作業記録がありませんでした。';

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(text)
        .setColor(color)
        .setTimestamp();
}

module.exports = (client, persistentRankingManager) => {
    // 毎日 02:00 に時報実行
    cron.schedule('0 2 * * *', async () => {
        const channelId = process.env.RANKING_CHANNEL_ID;
        if (!channelId) return;

        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;

            // 1. デイリー時報送信
            const dailyRange = getDailyRange();
            const dailyEmbed = await buildTimeRangeEmbed(
                client, dailyRange.startMs, dailyRange.endMs, '📊 昨日の作業ランキング', 0x00BFFF
            );
            await channel.send({ embeds: [dailyEmbed] });

            // 2. 月曜のみ：ウィークリー時報送信
            if (new Date().getDay() === 1) {
                const weeklyRange = getWeeklyRange();
                const weeklyEmbed = await buildTimeRangeEmbed(
                    client, weeklyRange.startMs, weeklyRange.endMs, '📅 週間作業ランキング', 0x00FF7F
                );
                await channel.send({ embeds: [weeklyEmbed] });
            }

            // 3. 常設ランキングを一度削除し、新しく最下部に送り直す
            await persistentRankingManager.resend();

        } catch (e) {
            console.error('[Time Signal Cron Error]', e);
        }
    });
    
    // ─── ここから追加（午前3時の自動再起動によるリフレッシュ） ───
    cron.schedule('0 3 * * *', () => {
        console.log('[Sleep/Reset Mode] Exiting process for Railway auto-restart.');
        process.exit(0); 
    });
    // ─── ここまで追加 ───
};