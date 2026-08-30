const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { calculateExpectedValue } = require('../calc/index');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('expected')
        .setDescription('指定したシステムとコマンドの期待値・確率を計算します')
        .addStringOption(option =>
            option.setName('system')
                .setDescription('計算するTRPGシステム')
                .setRequired(true)
                .addChoices(
                    { name: 'シノビガミ (ShinobiGami)', value: 'ShinobiGami' },
                    { name: 'ソード・ワールド2.5 (SwordWorld2.5)', value: 'SwordWorld2.5' }
                ))
        .addStringOption(option =>
            option.setName('command')
                .setDescription('計算対象のコマンド（例: K20+3@9, SG@5）')
                .setRequired(true)),

    async execute(interaction) {
        const systemId = interaction.options.getString('system');
        const command = interaction.options.getString('command');

        await interaction.deferReply();

        try {
            const result = calculateExpectedValue(systemId, command);
            
            const embed = new EmbedBuilder()
                .setColor('#9C27B0')
                .setTitle(`📊 期待値計算: ${systemId}`)
                .setDescription(`**入力コマンド:** \`${command}\`\n\n${result.text}`);

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: `❌ 計算エラー: ${error.message}` });
        }
    }
};