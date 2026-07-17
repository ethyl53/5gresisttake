const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { startActivity } = require('../database/intervalService');

module.exports = {
  data: new SlashCommandBuilder().setName('start').setDescription('作業を開始します')
    .addStringOption(o => o.setName('subject').setDescription('科目').addChoices(
      { name: '数学', value: 'math' }, { name: '化学', value: 'chemistry' }, { name: '物理', value: 'physics' },
      { name: '英語', value: 'english' }, { name: '社会', value: 'social' }, { name: 'その他', value: 'other' }))
    .addStringOption(o => o.setName('task').setDescription('作業名')),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      const result = await startActivity(db, { guildId: interaction.guildId || '', userId: interaction.user.id, categoryKey: interaction.options.getString('subject'), taskName: interaction.options.getString('task') });
      if (result.kind === 'already_running') return interaction.editReply('すでに作業中です。別作業へ切り替える場合は科目または作業名を指定してください。');
      if (result.kind === 'paused_data_missing') return interaction.editReply('再開する作業情報がありません。科目または作業名を指定してください。');
      const row = result.current;
      const action = result.kind === 'resumed' ? '再開' : result.kind === 'switched' ? '切替' : '開始';
      await interaction.editReply(`作業を${action}しました：${row.task_name || row.category_key || '未設定'}`);
      interaction.client.persistentRanking?.update?.();
    } catch (error) { console.error('[start]', error); await interaction.editReply('開始処理に失敗しました。'); }
  }
};
