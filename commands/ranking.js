const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');

function format(ms) {
    const totalMinutes = Math.floor(ms / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${minutes}分`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('作業時間ランキングを表示')
        .addStringOption(option =>
            option
                .setName('period')
                .setDescription('ランキング期間')
                .addChoices(
                    { name: '本日', value: 'today' },
                    { name: '今週', value: 'week' },
                    { name: '今月', value: 'month' }
                )
                .setRequired(false)
        ),

    async execute(interaction) {
        // APIフェッチや大量データ処理による3秒タイムアウトを防ぐ
        await interaction.deferReply();

        const period = interaction.options.getString('period') || 'today';
        let start, end, title;
        const now = Date.now();

        if (period === 'today') {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            start = todayStart.getTime();
            end = todayEnd.getTime();
            title = '📊 本日の作業ランキング';
        } else if (period === 'week') {
            end = now;
            start = now - 7 * 24 * 60 * 60 * 1000;
            title = '🏆 今週の作業ランキング';
        } else {
            end = now;
            start = now - 30 * 24 * 60 * 60 * 1000;
            title = '🎯 今月の作業ランキング';
        }

        try {
            // 必要なカラムのみを取得してDB負荷を軽減
            const result = await db.query(
                `
                SELECT user_id, duration, start_time
                FROM work_sessions
                WHERE start_time BETWEEN $1 AND $2
                `,
                [start, end]
            );

            const rows = result.rows;
            if (!rows.length) {
                return interaction.editReply({ content: 'ランキングデータがありません' });
            }

            const totals = {};
            for (const row of rows) {
                const duration = row.duration
                    ? Number(row.duration)
                    : now - Number(row.start_time);

                totals[row.user_id] = (totals[row.user_id] || 0) + duration;
            }

            // ソートし、Embedの制限と負荷を考慮して上位20名に絞り込む
            const ranking = Object.entries(totals)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);

            const medals = ['🥇', '🥈', '🥉'];

            // Promise.all でユーザーフェッチを並列化（超高速化 ＆ レートリミット回避）
            const rankingLines = await Promise.all(
                ranking.map(async ([userId, total], i) => {
                    const medal = i < 3 ? medals[i] : `${i + 1}位`;
                    try {
                        // キャッシュにあればそれを使用、なければfetch
                        const user = interaction.client.users.cache.get(userId)
                            || await interaction.client.users.fetch(userId);
                        return `${medal} **${user.username}**\n${format(total)}\n\n`;
                    } catch (err) {
                        console.error(`Failed to fetch user ${userId}:`, err);
                        return `${medal} **ユーザー取得失敗**\n${format(total)}\n\n`;
                    }
                })
            );

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(rankingLines.join(''))
                .setColor(0x00BFFF)
                .setFooter({
                    text: `更新: ${new Date().toLocaleString('ja-JP')}`
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};