const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { formatTime } = require('../utils/timeline');

// 全期間の集計＆Embed生成
async function buildPersistentEmbed(client) {
    const nowMs = Date.now();
    // end_timeがない(進行中)場合は Date.now() - start_time で計算
    const result = await db.query(`
        SELECT user_id,
               SUM(COALESCE(duration, $1::bigint - start_time)) as total_duration
        FROM work_sessions
        GROUP BY user_id
        ORDER BY total_duration DESC
    `, [nowMs]);

    let text = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i];
        const userId = row.user_id;
        const timeMs = Number(row.total_duration);

        let username = 'Unknown';
        try {
            const user = await client.users.fetch(userId);
            username = user.displayName || user.username;
        } catch(e) {}

        const rankIcon = medals[i] || `**${i+1}.**`;
        text += `${rankIcon} ${username} \u00A0\u00A0 **${formatTime(timeMs)}**\n`;
    }

    if (!text) text = 'まだ作業記録がありません。';

    return new EmbedBuilder()
        .setTitle('🏆 常設ランキング (全期間)')
        .setDescription(text)
        .setColor(0xFFD700)
        .setFooter({ text: '※10分ごとに自動更新されます' })
        .setTimestamp();
}

// 常設ランキングの更新または再送信
async function updatePersistentRanking(client, forceResend = false) {
    const channelId = process.env.RANKING_CHANNEL_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = await buildPersistentEmbed(client);

        // DBから前回のメッセージIDを取得
        const stateRes = await db.query(`SELECT value FROM bot_state WHERE key = 'ranking_message_id'`);
        let messageId = stateRes.rows.length ? stateRes.rows[0].value : null;

        let targetMessage = null;
        if (messageId) {
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (e) {
                targetMessage = null; // 削除済みや取得失敗
            }
        }

        // 時報送信後など、最下部へ移動させるために強制削除
        if (forceResend && targetMessage) {
            await targetMessage.delete().catch(() => null);
            targetMessage = null;
        }

        if (targetMessage) {
            // 既存メッセージがあれば更新
            await targetMessage.edit({ embeds: [embed] });
        } else {
            // 新規送信し、メッセージIDをDBに保存
            const newMessage = await channel.send({ embeds: [embed] });
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