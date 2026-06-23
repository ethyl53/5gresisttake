const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { getTodayRange, resolveSubject, formatTime, generateTimelineBuffer } = require('../utils/timeline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('today')
        .setDescription('指定したユーザーの今日の作業時間を表示（2:00〜翌1:59）')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;
        const { startMs, endMs } = getTodayRange();

        try {
            // クエリを必要最小限のカラム選択に絞り込んで軽量化
            const result = await db.query(`
                SELECT start_time, end_time, color, task_name 
                FROM work_sessions
                WHERE user_id = $1 
                AND start_time <= $3 
                AND (end_time IS NULL OR end_time >= $2)
                ORDER BY start_time ASC
            `, [userId, startMs, endMs]);

            const rows = result.rows;

            const username = interaction.guild 
                ? (await interaction.guild.members.fetch(userId).catch(() => null))?.displayName || targetUser.username
                : targetUser.username;

            if (!rows.length) {
                return interaction.editReply({ content: `**${username}** さんの今日の作業記録はありません` });
            }

            let totalTime = 0;
            const subjectTotals = {};
            const taskTotals = {};
            const timelineSessions = [];
            const now = Date.now();

            for (const row of rows) {
                const sessionStart = Number(row.start_time);
                const sessionEnd = row.end_time ? Number(row.end_time) : now;
                
                const actualStart = Math.max(sessionStart, startMs);
                const actualEnd = Math.min(sessionEnd, endMs);

                if (actualStart < actualEnd) {
                    const duration = actualEnd - actualStart;
                    totalTime += duration;

                    const subjectInfo = resolveSubject(row.color || row.task_name);
                    const taskName = row.task_name || '未設定';

                    subjectTotals[subjectInfo.name] = (subjectTotals[subjectInfo.name] || 0) + duration;
                    taskTotals[taskName] = (taskTotals[taskName] || 0) + duration;

                    timelineSessions.push({
                        start: actualStart,
                        end: actualEnd,
                        colorHex: subjectInfo.hex
                    });
                }
            }

            const sortedSubjects = Object.entries(subjectTotals).sort((a, b) => b[1] - a[1]);
            const sortedTasks = Object.entries(taskTotals).sort((a, b) => b[1] - a[1]);

            const subjectDetails = sortedSubjects.map(([name, time]) => `・**${name}**: ${formatTime(time)}`).join('\n') || 'データなし';
            const taskDetails = sortedTasks.map(([name, time]) => `・${name}: ${formatTime(time)}`).join('\n') || 'データなし';

            const buffer = await generateTimelineBuffer([{ username, sessions: timelineSessions }], startMs);
            const attachment = new AttachmentBuilder(buffer, { name: 'timeline.png' });

            const embed = new EmbedBuilder()
                .setTitle(`📊 今日の作業実績 (${username})`)
                .addFields(
                    { name: '🔥 合計時間', value: `**${formatTime(totalTime)}**`, inline: false },
                    { name: '📚 科目別', value: subjectDetails, inline: true },
                    { name: '📝 作業別', value: taskDetails, inline: true }
                )
                .setColor(0x00BFFF)
                .setImage('attachment://timeline.png')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (err) {
            console.error('[Today Cmd Error]', err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};