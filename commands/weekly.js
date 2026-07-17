const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { intervals, aggregate, jstRange, format } = require('../utils/activityRead');
const { generateWeeklyTimelineBuffer } = require('../utils/timeline');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weekly')
        .setDescription('指定したユーザーの週間作業時間を表示（過去の週も指定可能）')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('確認したい月 (1〜12) ※未指定で今週')
                .setMinValue(1)
                .setMaxValue(12)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('week')
                .setDescription('確認したい第何週か (1〜5) ※未指定で第1週扱い')
                .setMinValue(1)
                .setMaxValue(5)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('確認したい年 (未指定なら今年)')
                .setMinValue(2020)
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;

        const monthOpt = interaction.options.getInteger('month');
        const weekOpt = interaction.options.getInteger('week');
        const yearOpt = interaction.options.getInteger('year') || new Date().getFullYear();

        let startMs, endMs, nowMs;
        let isCustom = false;
        let titleRange = '';

        // 💡 月または週が指定された場合は、過去の特定週のタイムスタンプを計算する
        if (monthOpt || weekOpt) {
            const targetMonth = monthOpt || new Date().getMonth() + 1;
            const targetWeek = weekOpt || 1;
            
            // 指定月の1日を取得
            const firstDay = new Date(yearOpt, targetMonth - 1, 1);
            const dayOfWeek = firstDay.getDay(); // 0: 日, 1: 月, ..., 6: 土
            
            // その月で「1日が含まれる週の月曜日」を算出
            const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            
            // 第1週の月曜日 02:00:00 のタイムスタンプ
            const week1Start = new Date(yearOpt, targetMonth - 1, 1 + diffToMonday, 2, 0, 0, 0);
            
            startMs = week1Start.getTime() + (targetWeek - 1) * 7 * 24 * 60 * 60 * 1000;
            endMs = startMs + 7 * 24 * 60 * 60 * 1000;
            nowMs = Date.now();
            isCustom = true;
            titleRange = `${yearOpt}年${targetMonth}月 第${targetWeek}週`;
        } else {
            // 指定がない場合はデフォルトの「今週」を使用
            const range = getWeeklyRange();
            startMs = range.startMs;
            endMs = range.endMs;
            nowMs = range.nowMs;
            titleRange = '今週';
        }

        try {
            const data = aggregate((await intervals(db, interaction.guildId || '', r.start, end)).filter(x => x.user_id === userId), r.start, end)[0];
            const username = interaction.guild 
                ? (await interaction.guild.members.fetch(userId).catch(() => null))?.displayName || targetUser.username
                : targetUser.username;

            if (!data) return interaction.editReply({ content: `**${username}** さんの${r.title}の作業記録はありません` });

            const details = Object.entries(data.subjects).sort((a, b) => b[1] - a[1]).map(([k, v]) => `・**${k}**: ${format(v)}`).join('\n') || 'データなし';

            const file = new AttachmentBuilder(await generateWeeklyTimelineBuffer(username, data.sessions, r.start.getTime()), { name: 'weekly_timeline.png' });

            const description = r.custom ? `指定された期間（${r.start.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 〜 ${r.end.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）の集計結果です。` : '今週の月曜日 02:00 から現在時刻までの集計結果です。';

            const embed = new EmbedBuilder().setTitle(`📅 ${r.title}の勉強実績 (${username})`).setDescription(description).addFields({ name: '🔥 総勉強時間', value: `**${format(data.total)}**`, inline: false }, { name: '📚 科目別合計', value: details, inline: false }).setColor(0x00FF7F).setImage('attachment://weekly_timeline.png').setFooter({ text: 'タイムラインは曜日ごとの表示です' }).setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [file] });
        } catch (err) {
            console.error('[Weekly Cmd Error]', err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};