const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getTodayRange, getWeeklyRange, formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 🟢 現在作業中のユーザー一覧を取得してテキスト化
async function buildWorkingFields(client) {
    const nowMs = Date.now();
    const result = await db.query(`
        SELECT user_id, task_name, start_time 
        FROM work_sessions 
        WHERE end_time IS NULL
        ORDER BY start_time ASC
    `);

    if (result.rows.length === 0) {
        return '現在、作業中のメンバーはいません。💤\n`/start` で作業を始めましょう！';
    }

    let text = '';
    for (const row of result.rows) {
        let username = 'Unknown';
        try {
            const user = client.users.cache.get(row.user_id);
            username = user.displayName || user.username;
        } catch(e) {}

        const elapsedMs = nowMs - Number(row.start_time);
        const taskName = row.task_name || '未設定';
        text += `🟢 **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} 経過)\n`;
    }
    return text;
}

// 1️⃣ 今週のランキングEmbedを構築
async function buildWeeklyEmbed(client) {
    const weeklyStart = getWeeklyRange().startMs;
    const nowMs = Date.now();

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
            const user = client.users.cache.get(row.user_id);
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

// 2️⃣ 今日のランキング＆タイムライン画像を構築
async function buildDailyData(client) {
    const dailyStart = getTodayRange().startMs;
    const nowMs = Date.now();

    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [dailyStart, nowMs]);

    const userStats = {};

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

    const sortedUsers = Object.values(userStats).sort((a, b) => b.totalTime - a.totalTime);
    
    const timelineData = [];
    let text = '';
    const medals = ['🥇', '🥈', '🥉'];

    for (let i = 0; i < sortedUsers.length; i++) {
        const stat = sortedUsers[i];
        let username = 'Unknown';
        try {
            const user = client.users.cache.get(stat.userId);
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
        .setFooter({ text: '※作業開始/終了時にリアルタイム更新されます' })
        .setTimestamp();

    let attachment = null;
    if (timelineData.length > 0) {
        const buffer = await generateTimelineBuffer(timelineData, dailyStart);
        const fileName = `timeline_${Date.now()}.png`;
        attachment = new AttachmentBuilder(buffer, { name: fileName });
        embed.setImage(`attachment://${fileName}`);
    }

    return { embed, attachment };
}

// 3️⃣ 実際の送信・更新ロジック
async function updatePersistentRankingCore(client, forceResend = false) {
    const channelId = process.env.RANKING_CHANNEL_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const workingText = await buildWorkingFields(client);
        const workingEmbed = new EmbedBuilder()
            .setTitle('🔥 現在リアルタイムで作業中のメンバー')
            .setDescription(workingText)
            .setColor(0xFFA500);

        const weeklyEmbed = await buildWeeklyEmbed(client);
        const dailyData = await buildDailyData(client);

        const messagePayload = {
            embeds: [workingEmbed, weeklyEmbed, dailyData.embed],
            files: dailyData.attachment ? [dailyData.attachment] : []
        };

        const stateRes = await db.query(`SELECT value FROM bot_state WHERE key = 'ranking_message_id'`);
        let messageId = stateRes.rows.length ? stateRes.rows[0].value : null;

        let targetMessage = null;
        if (messageId) {
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (e) {
                targetMessage = null;
            }
        }

        if (forceResend && targetMessage) {
            await targetMessage.delete().catch(() => null);
            targetMessage = null;
        }

        if (targetMessage) {
            await targetMessage.edit(messagePayload);
        } else {
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

// 🚦 排他制御（ロック/キュー機構）: 同時多発するリクエストを安全に処理する
let isUpdating = false;
let updatePending = false;
let resendPending = false;

async function safeUpdate(client, forceResend = false) {
    if (forceResend) resendPending = true;
    
    if (isUpdating) {
        // すでに誰かが更新処理中の場合は「次も頼む」とフラグだけ立てて即終了する
        updatePending = true;
        return;
    }
    
    isUpdating = true;

    // キューが空になるまでループ処理する（Discord APIをいじめない設計）
    while (true) {
        const shouldResend = resendPending;
        resendPending = false; // フラグを消費
        updatePending = false; // フラグを消費

        try {
            await updatePersistentRankingCore(client, shouldResend);
        } catch (err) {
            console.error('[Safe Update Error]', err);
        }

        // 処理中に別の誰かが /start してフラグが立っていたら、もう1周する
        if (!updatePending && !resendPending) {
            break; 
        }
    }

    isUpdating = false;
}

module.exports = (client) => {
    // 10分ごとの定期バックグラウンド更新
    cron.schedule('*/10 * * * *', () => {
        safeUpdate(client, false);
    });

    return {
        // 外部（index.js や /start）からはこの安全な関数だけを呼び出せるようにする
        resend: () => safeUpdate(client, true),
        update: () => safeUpdate(client, false)
    };
};