const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getTodayRange, getWeeklyRange, formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 🟢 STEP11対応: 現在作業中・一時停止中のユーザー一覧を取得してテキスト化
async function buildWorkingFields(client) {
    const nowMs = Date.now();
    // pause_time の有無に関わらず、未終了のセッションをすべて取得
    const result = await db.query(`
        SELECT user_id, task_name, start_time, pause_time, paused_duration
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

        const startMs = Number(row.start_time);
        const totalPaused = Number(row.paused_duration || 0);
        const taskName = row.task_name || '未設定';

        if (row.pause_time) {
            // ⏸️ 一時停止中の場合：経過時間は「一時停止した瞬間」までの実稼働時間
            const pauseStartMs = Number(row.pause_time);
            const elapsedMs = pauseStartMs - startMs - totalPaused;
            text += `⏸️ **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} で一時停止中)\n`;
        } else {
            // 🟢 通常作業中の場合：経過時間は「現在時刻」までの実稼働時間
            const elapsedMs = nowMs - startMs - totalPaused;
            text += `🟢 **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} 経過)\n`;
        }
    }
    return text;
}

// 1️⃣ STEP10対応: 今週のランキングEmbedを構築（Node側で中抜きを正確に計算）
async function buildWeeklyEmbed(client) {
    const weeklyStart = getWeeklyRange().startMs;
    const nowMs = Date.now();

    // 期間内に重なるセッションをすべて抽出
    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [weeklyStart, nowMs]);

    const rows = result.rows;

    // 一時停止履歴を一括取得
    const pausesMap = {};
    if (rows.length > 0) {
        const sessionIds = rows.map(r => r.id);
        const pauseResult = await db.query(`
            SELECT * FROM session_pauses
            WHERE session_id = ANY($1::integer[])
            ORDER BY pause_start ASC
        `, [sessionIds]);

        for (const pRow of pauseResult.rows) {
            if (!pausesMap[pRow.session_id]) pausesMap[pRow.session_id] = [];
            pausesMap[pRow.session_id].push({
                start: Number(pRow.pause_start),
                end: pRow.pause_end ? Number(pRow.pause_end) : nowMs
            });
        }
    }

    const userStats = {};
    for (const row of rows) {
        const actualStart = Math.max(Number(row.start_time), weeklyStart);
        const actualEnd = Math.min(row.end_time ? Number(row.end_time) : nowMs, nowMs);

        if (actualStart < actualEnd) {
            // 今週の範囲内に重なっている一時停止の長さを計算
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
            if (!userStats[userId]) userStats[userId] = 0;
            userStats[userId] += duration;
        }
    }

    const sortedUsers = Object.entries(userStats).sort((a, b) => b[1] - a[1]);

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < sortedUsers.length; i++) {
        const [userId, timeMs] = sortedUsers[i];
        let username = 'Unknown';
        try {
            const user = client.users.cache.get(userId);
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

// 2️⃣ STEP10対応: 今日のランキング＆タイムライン画像を構築（中抜きの正確な反映）
async function buildDailyData(client) {
    const dailyStart = getTodayRange().startMs;
    const nowMs = Date.now();

    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [dailyStart, nowMs]);

    const pausesMap = {};
    if (result.rows.length > 0) {
        const sessionIds = result.rows.map(row => row.id);
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

    for (const row of result.rows) {
        const sessionStart = Number(row.start_time);
        const sessionEnd = row.end_time ? Number(row.end_time) : nowMs;
        
        const actualStart = Math.max(sessionStart, dailyStart);
        const actualEnd = Math.min(sessionEnd, nowMs);

        if (actualStart < actualEnd) {
            // 💡 今日の範囲内に重なっている一時停止の長さを正確に計算
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
            
            userStats[userId].sessions.push({
                start: actualStart,
                end: actualEnd,
                colorHex: subjectInfo.hex,
                pauses: sessionPauses
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

// メモリエクステンション監視
function checkMemory() {
    const used = process.memoryUsage().rss / 1024 / 1024;
    console.log(`[MEM] ${used.toFixed(1)} MB`);

    if (used > 450) {
        console.error('[MEM] limit exceeded. exiting.');
        process.exit(1); 
    }
}

let isUpdating = false;
let updatePending = false;
let resendPending = false;

async function safeUpdate(client, forceResend = false) {
    if (forceResend) resendPending = true;
    if (isUpdating) {
        updatePending = true;
        return;
    }
    isUpdating = true;

    while (true) {
        const shouldResend = resendPending;
        resendPending = false;
        updatePending = false;

        try {
            await updatePersistentRankingCore(client, shouldResend);
            checkMemory();
        } catch (err) {
            console.error('[Safe Update Error]', err);
        }

        if (!updatePending && !resendPending) {
            break; 
        }
    }
    isUpdating = false;
}

module.exports = (client) => {
    cron.schedule('*/10 * * * *', () => {
        safeUpdate(client, false);
    });

    return {
        resend: () => safeUpdate(client, true),
        update: () => safeUpdate(client, false)
    };
};