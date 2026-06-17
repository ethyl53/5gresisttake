const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getTodayRange, getWeeklyRange, formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 1️⃣ 今週（月曜2:00～現在）のランキングEmbedを構築
async function buildWeeklyEmbed(client) {
    const weeklyStart = getWeeklyRange().startMs;
    const nowMs = Date.now();

    // 期間内の被り部分のみを正確に切り出し
    const result = await db.query(`
        SELECT user_id,
               SUM(
                   LEAST(COALESCE(end_time, $2::bigint), $2::bigint) - GREATEST(start_time, $1::bigint)
               ) as total_duration
        FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        GROUP BY user_id
        ORDER BY total_duration DESC
    `, [weeklyStart, nowMs]);

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i];
        const timeMs = Number(row.total_duration);
        
        if (timeMs <= 0) continue;

        let username = 'Unknown';
        try {
            const user = await client.users.fetch(row.user_id);
            username = user.displayName || user.username;
        } catch(e) {}

        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username} \u00A0\u00A0 **${formatTime(timeMs)}**\n`;
    }

    if (!text) text = 'まだ今週の作業記録がありません。';

    return new EmbedBuilder()
        .setTitle('📅 今週のランキング (月曜2:00～現在)')
        .setDescription(text)
        .setColor(0x00FF7F);
}

// 2️⃣ 今日（今日2:00～現在）のランキング＆タイムライン画像を構築
async function buildDailyData(client) {
    const dailyStart = getTodayRange().startMs;
    const nowMs = Date.now();

    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [dailyStart, nowMs]);

    const userStats = {};

    // クリッピングとユーザーごとの集計
    for (const row of result.rows) {
        const sessionStart = Number(row.start_time);
        const sessionEnd = row.end_time ? Number(row.end_time) : nowMs;
        
        const actualStart = Math.max(sessionStart, dailyStart);
        const actualEnd = Math.min(sessionEnd, nowMs);

        if (actualStart < actualEnd) {
            const userId = row.user_id;
            const duration = actualEnd - actualStart;
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
        }
    }

    // ランキング作成（時間が長い順）
    const sortedUsers = Object.values(userStats).sort((a, b) => b.totalTime - a.totalTime);
    
    const timelineData = [];
    let text = '';
    const medals = ['🥇', '🥈', '🥉'];

    for (let i = 0; i < sortedUsers.length; i++) {
        const stat = sortedUsers[i];
        let username = 'Unknown';
        try {
            const user = await client.users.fetch(stat.userId);
            username = user.displayName || user.username;
        } catch(e) {}

        timelineData.push({ username, sessions: stat.sessions });
        
        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username} \u00A0\u00A0 **${formatTime(stat.totalTime)}**\n`;
    }

    if (!text) text = '今日の作業記録はまだありません。';

    const embed = new EmbedBuilder()
        .setTitle('📊 今日のランキング＆タイムライン')
        .setDescription(text)
        .setColor(0x00BFFF)
        .setFooter({ text: '※10分ごとに自動更新されます' })
        .setTimestamp();

    let attachment = null;
    if (timelineData.length > 0) {
        // 画像生成 (全員分のレーンが描画される)
        const buffer = await generateTimelineBuffer(timelineData, dailyStart);
        
        // キャッシュ対策：ファイル名にタイムスタンプを含めて常に新しい画像として認識させる
        const fileName = `timeline_${Date.now()}.png`;
        attachment = new AttachmentBuilder(buffer, { name: fileName });
        embed.setImage(`attachment://${fileName}`);
    }

    return { embed, attachment };
}

// 3️⃣ 常設ランキングの更新または再送信処理
async function updatePersistentRanking(client, forceResend = false) {
    const channelId = process.env.RANKING_CHANNEL_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        // 今週のEmbed と 今日のデータ（Embed+画像）を取得
        const weeklyEmbed = await buildWeeklyEmbed(client);
        const dailyData = await buildDailyData(client);

        const messagePayload = {
            embeds: [weeklyEmbed, dailyData.embed],
            // 画像がある場合は再送、なければ空配列で古い画像を消す
            files: dailyData.attachment ? [dailyData.attachment] : []
        };

        // DBから前回のメッセージIDを取得
        const stateRes = await db.query(`SELECT value FROM bot_state WHERE key = 'ranking_message_id'`);
        let messageId = stateRes.rows.length ? stateRes.rows[0].value : null;

        let targetMessage = null;
        if (messageId) {
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (e) {
                targetMessage = null; // 削除済みや取得失敗の場合は無視
            }
        }

        // 時報送信後など、最下部へ移動させるために強制削除
        if (forceResend && targetMessage) {
            await targetMessage.delete().catch(() => null);
            targetMessage = null;
        }

        if (targetMessage) {
            // 既存メッセージがあれば更新
            await targetMessage.edit(messagePayload);
        } else {
            // 新規送信し、メッセージIDをDBに保存
            const newMessage = await channel.send(messagePayload);
            await db.query(`
                INSERT INTO bot_state (key, value) VALUES ('ranking_message_id', $1)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `, [newMessage.id]);
        }
    } catch (e) {
        console.error('[Persistent Ranking Error]', e);
    }
}

module.exports = (client) => {
    // 10分ごとに編集(edit)更新
    cron.schedule('*/10 * * * *', () => {
        updatePersistentRanking(client, false);
    });

    return {
        resend: () => updatePersistentRanking(client, true), // 削除＆再送（最下部移動用）
        update: () => updatePersistentRanking(client, false) // 取得＆編集（起動時用）
    };
};