const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');

// 設定時間（ミリ秒単位）
const WARN_TIMEOUT = 3 * 60 * 60 * 1000;   // 3時間経過で警告
const AUTO_STOP_TIMEOUT = 15 * 60 * 1000;  // 警告から15分応答なしで自動停止

async function initMonitor(client) {
    // サーバーへの余計な負荷（クエリ回数）を減らすため、チェック間隔を5分(300000ms)に最適化
    setInterval(async () => {
        const now = Date.now();

        try {
            // ==========================================
            // 機能 A: 予定（スケジュール）通知リマインダー
            // ==========================================
            const schedules = await db.query(
                `SELECT id, user_id, title, description, event_time FROM user_schedules WHERE remind_time <= $1`,
                [now]
            );

            for (const row of schedules.rows) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const eventDate = new Date(Number(row.event_time)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                    
                    await user.send(`🔔 **スケジュール通知**\n登録された予定の時間（または事前通知）になりました。\n\n📌 **タイトル:** ${row.title}\n📝 **内容:** ${row.description || 'なし'}\n⏰ **予定日時(JST):** ${eventDate}`);
                } catch (err) {
                    console.error(`[Monitor] ユーザー ${row.user_id} への予定通知DM送信に失敗。`, err);
                }
                
                // 【容量節約】通知が完了したデータは、DBの肥大化を防ぐために即座に物理削除
                await db.query(`DELETE FROM user_schedules WHERE id = $1`, [row.id]);
            }

            // ==========================================
            // 機能 B: 作業の放置確認・自動停止
            // ==========================================
            // 1. 長時間放置セッションへの警告送信
            const warningTargets = await db.query(`
                SELECT user_id, start_time, task_name
                FROM work_sessions
                WHERE end_time IS NULL AND warned_at IS NULL
                AND ($1 - COALESCE(last_check, start_time)) > $2
            `, [now, WARN_TIMEOUT]);

            for (const row of warningTargets.rows) {
                try {
                    const user = await client.users.fetch(row.user_id);
                    const rowButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`keep_working_${row.user_id}`)
                            .setLabel('作業を継続する')
                            .setStyle(ButtonStyle.Success)
                    );

                    await user.send({
                        content: `⏳ **作業確認通知**\n「**${row.task_name || '未設定'}**」の開始から長時間経過しています。まだ作業中ですか？\n※応答がない場合、自動的に記録を停止します。`,
                        components: [rowButton]
                    });
                } catch (err) {
                    console.error(`[Monitor] 作業者 ${row.user_id} へのDM送信に失敗。`);
                }

                await db.query(`UPDATE work_sessions SET warned_at = $1 WHERE user_id = $2 AND end_time IS NULL`, [now, row.user_id]);
            }

            // 2. 警告から規定時間経過したセッションの自動シャットダウン
            const stopTargets = await db.query(`
                SELECT user_id, start_time, warned_at, task_name
                FROM work_sessions
                WHERE end_time IS NULL AND warned_at IS NOT NULL
                AND ($1 - warned_at) > $2
            `, [now, AUTO_STOP_TIMEOUT]);

            for (const row of stopTargets.rows) {
                const stopTime = Number(row.warned_at);
                const duration = stopTime - Number(row.start_time);

                await db.query(`
                    UPDATE work_sessions
                    SET end_time = $1, duration = $2, warned_at = NULL, last_check = NULL
                    WHERE user_id = $3 AND end_time IS NULL
                `, [stopTime, duration, row.user_id]);

                try {
                    const user = await client.users.fetch(row.user_id);
                    await user.send(`🛑 応答がなかったため、作業「**${row.task_name || '未設定'}**」の記録を自動停止しました。`);
                } catch (err) {
                    // DM拒否ユーザーは無視
                }
            }

        } catch (err) {
            console.error('[Monitor Loop Error]', err);
        }
    }, 300000); // 300000ms = 5分ごとに全ての監視をまとめて実行
}

module.exports = { initMonitor };