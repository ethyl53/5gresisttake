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
        .setDescription('本日の作業ランキングを表示')
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
        const period = interaction.options.getString('period') || 'today';

        let start;
        let end;
        let title;

        if (period === 'today') {
            start = new Date();
            start.setHours(0, 0, 0, 0);
            end = new Date();
            end.setHours(23, 59, 59, 999);
            title = '📊 本日の作業ランキング';
        } else if (period === 'week') {
            end = new Date();
            start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
            title = '🏆 今週の作業ランキング';
        } else if (period === 'month') {
            end = new Date();
            start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
            title = '🎯 今月の作業ランキング';
        }

        db.all(
            `
            SELECT
                user_id,
                SUM(duration) as total
            FROM work_sessions
            WHERE start_time BETWEEN ? AND ?
            GROUP BY user_id
            ORDER BY total DESC
            `,
            [start.getTime(), end.getTime()],
            async (err, rows) => {
                if (err) {
                    console.error('DB GET error:', err);
                    return interaction.reply({
                        content: 'DBエラー',
                        ephemeral: true
                    });
                }

                if (!rows || rows.length === 0) {
                    return interaction.reply({
                        content: 'ランキングデータがありません',
                        ephemeral: true
                    });
                }

                let description = '';
                const medals = ['🥇', '🥈', '🥉'];

                for (let i = 0; i < rows.length; i++) {
                    try {
                        const user = await interaction.client.users.fetch(rows[i].user_id);
                        const medal = i < 3 ? medals[i] : `${i + 1}位`;
                        description += `${medal} **${user.username}**\n${format(rows[i].total)}\n\n`;
                    } catch (err) {
                        console.error('Failed to fetch user:', err);
                        description += `${i + 1}位 (ユーザー取得失敗)\n${format(rows[i].total)}\n\n`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor(0x00BFFF)
                    .setFooter({ text: `更新: ${new Date().toLocaleString('ja-JP')}` })
                    .setTimestamp();

                interaction.reply({ embeds: [embed] });
            }
        );
    }
};
