const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const tableModule = require('../bcdice/tableRoller');

if (
    !tableModule ||
    !tableModule.BUILT_IN_TABLES ||
    typeof tableModule.rollBuiltInTable !== 'function' ||
    typeof tableModule.rollCocCharacterStats !== 'function'
) {
    throw new Error(
        '[Table Command] bcdice/tableRoller.js のエクスポートを確認してください。'
    );
}

const {
    BUILT_IN_TABLES,
    rollBuiltInTable,
    COC_CHARACTER_TABLE_NAME,
    rollCocCharacterStats
} = tableModule;

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
                    })),
                    {
                        name: COC_CHARACTER_TABLE_NAME,
                        value: COC_CHARACTER_TABLE_NAME
                    }
                )
        ),

    async execute(interaction) {
        const name = interaction.options.getString('name');

        // CoCキャラシ制作専用処理
        if (name === COC_CHARACTER_TABLE_NAME) {
            const result = rollCocCharacterStats();

            const embed = new EmbedBuilder()
                .setColor('#47B2BE')
                .setTitle(`◇ ${result.title}`)
                .setDescription(result.description);

            return interaction.reply({
                embeds: [embed]
            });
        }

        // 通常の表処理
        const result = rollBuiltInTable(name);

        if (!result) {
            return interaction.reply({
                content: '指定された表が見つかりません。',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#955BBC')
            .setDescription(
                `**${result.title}**\n` +
                `出目：${result.roll}（1d${result.max}）\n` +
                `${result.result ?? 'この出目に対応する結果がありません。'}`
            );

        return interaction.reply({
            embeds: [embed]
        });
    }
};