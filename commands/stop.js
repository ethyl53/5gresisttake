const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { stopActivity } = require('../database/intervalService');
module.exports = { data: new SlashCommandBuilder().setName('stop').setDescription('作業を終了します'), async execute(interaction) {
  await interaction.deferReply();
  try { const r = await stopActivity(db, { guildId: interaction.guildId || '', userId: interaction.user.id });
    await interaction.editReply(r.kind === 'stopped' ? `作業を終了しました：${r.interval.task_name || r.interval.category_key || '未設定'}` : r.kind === 'stopped_paused' ? '一時停止中の作業を終了しました。' : '作業中ではありません。');
    interaction.client.persistentRanking?.update?.();
  } catch (e) { console.error('[stop]', e); await interaction.editReply('終了処理に失敗しました。'); }
} };
