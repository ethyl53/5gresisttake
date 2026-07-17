const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { replaceRange } = require('../database/intervalService');
function parseTime(value, base) { const m = /^(?:[01]?\d|2[0-3]):[0-5]\d$/.exec(value); if (!m) return null; const d = new Date(base); const [h, min] = value.split(':').map(Number); d.setHours(h, min, 0, 0); return d; }
module.exports = { data: new SlashCommandBuilder().setName('edit').setDescription('作業記録を追加または削除します')
  .addStringOption(o => o.setName('subject').setDescription('科目').setRequired(true).addChoices({name:'数学',value:'math'},{name:'化学',value:'chemistry'},{name:'物理',value:'physics'},{name:'英語',value:'english'},{name:'社会',value:'social'},{name:'その他',value:'other'},{name:'削除',value:'delete'}))
  .addStringOption(o => o.setName('start').setDescription('開始 HH:MM').setRequired(true)).addStringOption(o => o.setName('end').setDescription('終了 HH:MM').setRequired(true)).addStringOption(o => o.setName('date').setDescription('日付 YYYY-MM-DD')),
  async execute(interaction) { await interaction.deferReply(); try {
    const dateText = interaction.options.getString('date'); const base = dateText ? new Date(`${dateText}T00:00:00+09:00`) : new Date();
    if (Number.isNaN(base.getTime())) return interaction.editReply('日付は YYYY-MM-DD で入力してください。');
    const start = parseTime(interaction.options.getString('start'), base); const end = parseTime(interaction.options.getString('end'), base);
    if (!start || !end || end <= start) return interaction.editReply('時刻は HH:MM 形式で、終了を開始より後にしてください。');
    const subject = interaction.options.getString('subject'); const r = await replaceRange(db, { guildId: interaction.guildId || '', userId: interaction.user.id, startAt:start, endAt:end, categoryKey:subject, deleteOnly:subject==='delete', note:'Discord /edit' });
    await interaction.editReply(subject === 'delete' ? `記録を削除しました（影響区間 ${r.replaced} 件）。` : `記録を保存しました（影響区間 ${r.replaced} 件）。`); interaction.client.persistentRanking?.update?.();
  } catch(e) { console.error('[edit]',e); await interaction.editReply(e.message.includes('running activity') ? '実行中の作業と重なっています。先に /stop を実行してください。' : '編集処理に失敗しました。'); } }
};
