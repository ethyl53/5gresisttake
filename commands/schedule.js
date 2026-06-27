const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('新しく予定（リマインダー）を登録します')
        .addStringOption(option => 
            option.setName('date').setDescription('日付を入力してください (例: 2026-07-10)').setRequired(true))
        .addStringOption(option => 
            option.setName('time').setDescription('時間を入力してください (例: 15:30)').setRequired(true))
        .addStringOption(option => 
            option.setName('title').setDescription('予定のタイトル').setRequired(true))
        .addStringOption(option => 
            option.setName('content').setDescription('予定の詳細内容（任意）').setRequired(false))
        .addIntegerOption(option =>
            option.setName('advance')
                .setDescription('事前通知のタイミングを選択')
                .setRequired(false)
                .addChoices(
                    { name: '予定時刻ぴったり', value: 0 },
                    { name: '5分前', value: 5 },
                    { name: '15分前', value: 15 },
                    { name: '30分前', value: 30 },
                    { name: '1時間前', value: 60 },
                    { name: '1日前', value: 1440 }
                )),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const date = interaction.options.getString('date').trim();
        const time = interaction.options.getString('time').trim();
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('content') || '';
        const advanceMinutes = interaction.options.getInteger('advance') ?? 0;

        // 日本時間 (JST: +09:00) として解釈できるISO文字列を生成
        const targetIsoStr = `${date}T${time}:00+09:00`;
        const eventTime = Date.parse(targetIsoStr);

        // バリデーションチェック
        if (isNaN(eventTime)) {
            return interaction.editReply({
                content: '❌ 日付または時間の形式が正しくありません。\n型を合わせて再入力してください。\n入力例：日付 `2026-07-10` / 時間 `15:30`'
            });
        }

        if (eventTime < Date.now()) {
            return interaction.editReply({ content: '❌ 過去の日時は指定できません。未来の日時を入力してください。' });
        }

        // 通知を実行するべき絶対時間を算出
        const remindTime = eventTime - (advanceMinutes * 60 * 1000);

        try {
            await db.query(
                `INSERT INTO user_schedules (user_id, title, description, event_time, remind_time)
                 VALUES ($1, $2, $3, $4, $5)`,
                [interaction.user.id, title, description, eventTime, remindTime]
            );

            const displayTime = new Date(eventTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            const timingText = advanceMinutes === 0 ? '予定時刻ぴったり' : `${advanceMinutes}分前`;

            await interaction.editReply({
                content: `📅 **予定を登録しました！**\n\n📌 **タイトル:** ${title}\n⏰ **日時(JST):** ${displayTime}\n🔔 **通知タイミング:** ${timingText}\n※指定の時間にDMで通知が届きます。`
            });

        } catch (err) {
            console.error('[Schedule Register Error]', err);
            await interaction.editReply({ content: 'データベースへの登録中にエラーが発生しました。' });
        }
    }
};