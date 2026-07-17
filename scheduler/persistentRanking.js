const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { intervals, aggregate, jstRange, format } = require('../utils/activityRead');
const { getTodayRange, getWeeklyRange, formatTime, generateTimelineBuffer, resolveSubject } = require('../utils/timeline');

// 現在作業中・一時停止中のユーザー一覧を取得してテキスト化
async function buildWorkingFields(client, guildId) {
    const now = new Date();
    // 全期間から is_active な interval を取得し、end_at が null のものを現在作業中と見なす
    const all = await intervals(db, guildId || '', new Date(0), new Date(now.getTime() + 1));
    const working = all.filter(x => x.end_at === null);

    if (!working.length) return '現在、作業中のメンバーはいません。💤\n`/start` で作業を始めましょう！';

    let text = '';
    for (const row of working) {
        let username = `ユーザー(${row.user_id.slice(-4)})`;
        try {
            const user = client.users.cache.get(row.user_id);
            if (user) username = user.displayName || user.username;
        } catch (e) {}

        const startMs = row.startMs || new Date(row.start_at).getTime();
        const elapsedMs = Date.now() - startMs;
        const taskName = row.task_name || '未設定';

        text += `🟢 **${username}** : 📝 \`${taskName}\` (${formatTime(elapsedMs)} 経過)\n`;
    }
    return text;
}

// 今週のランキングEmbedを構築
async function buildWeeklyEmbed(client, guildId) {
    const week = jstRange(7);
    const start = week.start;
    const now = new Date();

    const rows = aggregate(await intervals(db, guildId || '', start, now), start, now);

    const sorted = rows;
    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < sorted.length; i++) {
        const u = sorted[i];
        let username = `ユーザー(${u.userId.slice(-4)})`;
        try { const user = client.users.cache.get(u.userId); if (user) username = user.displayName || user.username; } catch(e){}
        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username} \u00A0\u00A0 **${format(u.total)}**\n`;
    }
    if (!text) text = 'まだ今週の作業記録がありません。';
    return new EmbedBuilder().setTitle('📅 今週のランキング (月曜2:00～現在)').setDescription(text).setColor(0x00FF7F);
}

// 今日のランキング＆タイムライン画像を構築
async function buildDailyData(client, guildId) {
    const day = jstRange();
    const start = day.start;
    const now = new Date();

    const rows = aggregate(await intervals(db, guildId || '', start, now), start, now);

    const timelineData = rows.map(u => ({ username: client.users.cache.get(u.userId)?.username || u.userId, sessions: u.sessions }));

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < rows.length; i++) {
        const u = rows[i];
        let username = client.users.cache.get(u.userId)?.username || u.userId;
        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username} \u00A0\u00A0 **${format(u.total)}**\n`;
    }
    if (!text) text = '今日の作業記録はまだありません。';

    const embed = new EmbedBuilder().setTitle('📊 今日のランキング＆タイムライン').setDescription(text).setColor(0x00BFFF).setFooter({ text: '※作業開始/終了時にリアルタイム更新されます' }).setTimestamp();

    let attachment = null;
    if (timelineData.length > 0) {
        const buffer = await generateTimelineBuffer(timelineData, start.getTime());
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

        const workingText = await buildWorkingFields(client, channel.guildId);
        const workingEmbed = new EmbedBuilder()
            .setTitle('🔥 現在リアルタイムで作業中のメンバー')
            .setDescription(workingText)
            .setColor(0xFFA500);

        const weeklyEmbed = await buildWeeklyEmbed(client, channel.guildId);
        const dailyData = await buildDailyData(client, channel.guildId);

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

// 自動更新の間引き判定用変数
let lastCronExecutionTime = 0;

module.exports = (client) => {
    // 10分ごとの定期判定
    cron.schedule('*/10 * * * *', async () => {
        try {
            // 現在進行中のセッション（activity_intervals の end_at が NULL）の件数を取得
            const activeSessions = await db.query(`SELECT COUNT(*) FROM activity_intervals WHERE is_active AND end_at IS NULL`);
            const activeCount = parseInt(activeSessions.rows[0].count, 10);
            const now = Date.now();

            // 作業中のユーザーが誰もいない場合の間引き判定
            if (activeCount === 0) {
                // スパン設定：30分（30 * 60 * 1000 ミリ秒）
                // 1時間間隔に変更する場合は「60 * 60 * 1000」に書き換えてください
                const IDLE_INTERVAL = 60 * 60 * 1000;

                // 前回の実際の自動更新から指定時間が経過していなければスキップ
                if (now - lastCronExecutionTime < IDLE_INTERVAL) {
                    return;
                }
            }

            // 条件をクリアした場合、または作業者がいる場合は更新を実行
            lastCronExecutionTime = now;
            safeUpdate(client, false);

        } catch (e) {
            console.error('[Cron Filter Error]', e);
            // データベースエラー等が発生した場合は、安全側に倒して通常通り更新を試みる
            safeUpdate(client, false);
        }
    });

    return {
        resend: () => safeUpdate(client, true),
        update: () => safeUpdate(client, false)
    };
};
