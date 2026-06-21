const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getTodayRange, getWeeklyRange, formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 現在作業中・一時停止中のユーザー一覧を取得してテキスト化
async function buildWorkingFields(client) {
    const nowMs = Date.now();
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
        let username = `ユーザー(${row.user_id.slice(-4)})`;
        try {
            const user = client.users.cache.get(row.user_id);
            if (user) {
                username = user.displayName || user.username;
            }
        } catch(e) {}

        const startMs = Number(row.start_time);
        const totalPaused = Number(row.paused_duration || 0);
        const taskName = row.task_name || '未設定';

        if (row.pause_time) {
            const pauseStartMs = Number(row.pause_time);
            const elapsedMs = pauseStartMs - startMs - totalPaused;
            text += `⏸️ **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} で一時停止中)\n`;
        } else {
            const elapsedMs = nowMs - startMs - totalPaused;
            text += `🟢 **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} 経過)\n`;
        }
    }
    return text;
}

// 今週のランキングEmbedを構築
async function buildWeeklyEmbed(client) {
    const weeklyStart = getWeeklyRange().startMs;
    const nowMs = Date.now();

    const result = await db.query(`
        SELECT * FROM work_sessions
        WHERE start_time <= $2::bigint AND COALESCE(end_time, $2::bigint) >= $1::bigint
        ORDER BY start_time ASC
    `, [weeklyStart, nowMs]);

    const userStats = {};
    for (const row of result.rows) {
        const sessionStart = Number(row.start_time);
        const sessionEnd = row.end_time ? Number(row.end_time) : nowMs;

        const actualStart = Math.max(sessionStart, weeklyStart);
        const actualEnd = Math.min(sessionEnd, nowMs);

        if (actualStart >= actualEnd) continue;

        let activeDuration = 0;

        if (row.end_time) {
            activeDuration = Number(row.duration || 0);
            if (sessionStart < weeklyStart) activeDuration -= (weeklyStart - sessionStart);
            if (sessionEnd > nowMs) activeDuration -= (sessionEnd - nowMs);
            activeDuration = Math.max(0, Math.min(activeDuration, Number(row.duration || 0)));
        } else {
            let currentEnd = row.pause_time ? Number(row.pause_time) : nowMs;
            activeDuration = currentEnd - sessionStart - Number(row.paused_duration || 0);
            if (sessionStart < weeklyStart) activeDuration -= (weeklyStart - sessionStart);
            activeDuration = Math.max(0, activeDuration);
        }

        activeDuration = Math.min(activeDuration, 86400000);

        if (activeDuration <= 0) continue;

        const userId = row.user_id;
        if (!userStats[userId]) userStats[userId] = 0;
        userStats[userId] += activeDuration;
    }

    const sortedUsers = Object.entries(userStats).sort((a, b) => b[1] - a[1]);

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < sortedUsers.length; i++) {
        const [userId, timeMs] = sortedUsers[i];
        let username = `ユーザー(${userId.slice(-4)})`;
        try {
            const user = client.users.cache.get(userId);
            if (user) {
                username = user.displayName || user.username;
            }
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

// 今日のランキング＆タイムライン画像を構築
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

        if (actualStart >= actualEnd) continue;

        let activeDuration = 0;

        if (row.end_time) {
            activeDuration = Number(row.duration || 0);
            if (sessionStart < dailyStart) activeDuration -= (dailyStart - sessionStart);
            if (sessionEnd > nowMs) activeDuration -= (sessionEnd - nowMs);
            activeDuration = Math.max(0, Math.min(activeDuration, Number(row.duration || 0)));
        } else {
            let currentEnd = row.pause_time ? Number(row.pause_time) : nowMs;
            activeDuration = currentEnd - sessionStart - Number(row.paused_duration || 0);
            if (sessionStart < dailyStart) activeDuration -= (dailyStart - sessionStart);
            activeDuration = Math.max(0, activeDuration);
        }

        activeDuration = Math.min(activeDuration, 86400000);
        if (activeDuration <= 0) continue;

        const userId = row.user_id;
        const subjectInfo = resolveSubject(row.color || row.task_name);

        if (!userStats[userId]) {
            userStats[userId] = { userId, totalTime: 0, sessions: [] };
        }

        userStats[userId].totalTime += activeDuration;
        
        let drawEnd = actualEnd;
        if (row.end_time) {
            const dbDuration = Number(row.duration || 0);
            const rawDiff = sessionEnd - sessionStart;
            if (rawDiff > dbDuration + Number(row.paused_duration || 0) + 3600000) {
                drawEnd = Math.min(actualEnd, sessionStart + dbDuration + Number(row.paused_duration || 0));
            }
        }

        userStats[userId].sessions.push({
            start: actualStart,
            end: drawEnd,
            colorHex: subjectInfo.hex,
            pauses: pausesMap[row.id] || []
        });
    }

    const sortedUsers = Object.values(userStats).sort((a, b) => b.totalTime - a.totalTime);
    
    const timelineData = [];
    let text = '';
    const medals = ['🥇', '🥈', '🥉'];

    for (let i = 0; i < sortedUsers.length; i++) {
        const stat = sortedUsers[i];
        let username = `ユーザー(${stat.userId.slice(-4)})`;
        try {
            const user = client.users.cache.get(stat.userId);
            if (user) {
                username = user.displayName || user.username;
            }
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

// 実際の送信・更新ロジック
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

        // 💡 修正の要：attachments: [] を渡して過去の画像キャッシュを強制リセット
        const messagePayload = {
            embeds: [workingEmbed, weeklyEmbed, dailyData.embed],
            files: dailyData.attachment ? [dailyData.attachment] : [],
            attachments: [] 
        };

        const stateRes = await db.query(`SELECT value FROM bot_state WHERE key = 'ranking_message_id'`);
        let messageId = stateRes.rows.length ? stateRes.rows[0].value : null;

        let targetMessage = null;
        if (messageId) {
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (e) {
                targetMessage = null; // メッセージが手動削除などで見つからない場合
            }
        }

        if (forceResend && targetMessage) {
            await targetMessage.delete().catch(() => null);
            targetMessage = null;
        }

        if (targetMessage) {
            try {
                // 通常の編集処理
                await targetMessage.edit(messagePayload);
            } catch (editError) {
                // 💡 セーフティネット：万が一権限エラーなどで編集が失敗した場合、残骸を削除して新規で送り直す
                console.error('[Edit Recovery] 編集に失敗しました。再生成します:', editError.message);
                await targetMessage.delete().catch(() => null);
                
                const newMessage = await channel.send(messagePayload);
                await db.query(`
                    INSERT INTO bot_state (key, value) VALUES ('ranking_message_id', $1)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                `, [newMessage.id]);
            }
        } else {
            // 新規送信処理
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

// 自動更新の間引き判定用変数
let lastCronExecutionTime = 0;

module.exports = (client) => {
    // 10分ごとの定期判定
    cron.schedule('*/10 * * * *', async () => {
        try {
            const activeSessions = await db.query(`
                SELECT COUNT(*) FROM work_sessions 
                WHERE end_time IS NULL
            `);
            const activeCount = parseInt(activeSessions.rows[0].count, 10);
            const now = Date.now();

            if (activeCount === 0) {
                const IDLE_INTERVAL = 30 * 60 * 1000;
                if (now - lastCronExecutionTime < IDLE_INTERVAL) {
                    return;
                }
            }

            lastCronExecutionTime = now;
            safeUpdate(client, false);

        } catch (e) {
            console.error('[Cron Filter Error]', e);
            safeUpdate(client, false);
        }
    });

    return {
        resend: () => safeUpdate(client, true),
        update: () => safeUpdate(client, false)
    };
};