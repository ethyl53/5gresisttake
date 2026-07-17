const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { pauseActivity } = require('../database/intervalService');
module.exports = { data: new SlashCommandBuilder().setName('pause').setDescription('作業を一時停止します'), async execute(interaction) {
  await interaction.deferReply();
  try { const r = await pauseActivity(db, { guildId: interaction.guildId || '', userId: interaction.user.id });
    await interaction.editReply(r.kind === 'paused' ? `一時停止しました：${r.interval.task_name || r.interval.category_key || '未設定'}` : r.kind === 'already_paused' ? 'すでに一時停止中です。' : '作業中ではありません。');
    interaction.client.persistentRanking?.update?.();
  } catch (e) { console.error('[pause]', e); await interaction.editReply('一時停止処理に失敗しました。'); }
} };
