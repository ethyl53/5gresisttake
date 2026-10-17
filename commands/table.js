
const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    BUILT_IN_TABLES,
    rollBuiltInTable
} = require('../bcdice/tableRoller');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('table')
        .setDescription('登録済みのロールテーブルを振ります')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('振る表を選択してください')
                .setRequired(true)
                .addChoices(
                    ...Object.keys(BUILT_IN_TABLES).map(name => ({
                        name,
                        value: name
                    }))
                )
        ),

    async execute(interaction) {
        const name = interaction.options.getString('name');
        const result = rollBuiltInTable(name);

        if (!result) {
            return interaction.reply({
                content: '指定された表が見つかりません。',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#6F6F6F')
            .setTitle(result.title)
            .setDescription(
                `出目：${result.roll}（1d${result.max}）\n` +
                `結果：${result.result ?? 'この出目に対応する結果がありません。'}`
            );

        await interaction.reply({ embeds: [embed] });
    }
};