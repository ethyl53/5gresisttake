const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../database/db');
const { intervals, aggregate, jstRange, format } = require('../utils/activityRead');
const { generateTimelineBuffer } = require('../utils/timeline');

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

        // オプションからターゲットユーザーを取得（なければコマンド実行者）
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userId = targetUser.id;
        const r = jstRange();
        const now = new Date();
        try {
            const data = aggregate((await intervals(db, interaction.guildId || '', r.start, now)).filter(x => x.user_id === userId), r.start, now)[0];
            const username = interaction.guild 
                ? (await interaction.guild.members.fetch(userId).catch(() => null))?.displayName || targetUser.username
                : targetUser.username;

            if (!data) return interaction.editReply({ content: `**${username}** さんの今日の作業記録はありません` });

            const lines = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `・**${k}**: ${format(v)}`).join('\n') || 'データなし';

            const file = new AttachmentBuilder(await generateTimelineBuffer([{ username, sessions: data.sessions }], r.start.getTime()), { name: 'timeline.png' });
            const embed = new EmbedBuilder().setTitle(`📊 今日の作業実績 (${username})`).setDescription(`期間: ${r.start.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} 〜 ${new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`).addFields({ name: '🔥 合計時間', value: `**${format(data.total)}**`, inline: false }, { name: '📚 科目別', value: lines(data.subjects), inline: true }, { name: '📝 作業別', value: lines(data.tasks), inline: true }).setColor(0x00BFFF).setImage('attachment://timeline.png').setFooter({ text: 'タイムラインは 5分ごとの区切りで表示されます' }).setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [file] });
        } catch (err) {
            console.error('[Today Cmd Error]', err);
            await interaction.editReply({ content: 'データベースエラーが発生しました。' });
        }
    }
};