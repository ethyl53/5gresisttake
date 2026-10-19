
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
    rollCocCharacterStats,
    MAX_COC_CHARACTER_STATS_REPEATS
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
        )
        .addIntegerOption(option =>
            option
                .setName('count')
                .setDescription('実行回数（省略時は1回、最大10回）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(MAX_COC_CHARACTER_STATS_REPEATS)
        )
        .addBooleanOption(option =>
            option
                .setName('secret')
                .setDescription('オンにすると結果を自分だけに表示します')
                .setRequired(false)
        ),

    async execute(interaction) {
        const name = interaction.options.getString('name');
        const count = interaction.options.getInteger('count') ?? 1;
        const secret = interaction.options.getBoolean('secret') ?? false;

        // シークレット設定
        const replyOptions = {
            ephemeral: secret
        };

        // Discord側の入力制限に加え、実行時にも検証する
        if (
            !Number.isSafeInteger(count) ||
            count < 1 ||
            count > MAX_COC_CHARACTER_STATS_REPEATS
        ) {
            return interaction.reply({
                content:
                    `実行回数は1～${MAX_COC_CHARACTER_STATS_REPEATS}回で指定してください。`,
                ephemeral: true
            });
        }

        // CST専用処理
        if (name === COC_CHARACTER_TABLE_NAME) {
            for (let i = 0; i < count; i++) {
                const result = rollCocCharacterStats();

                const embed = new EmbedBuilder()
                    .setColor('#47B2BE')
                    .setTitle(`◇ ${COC_CHARACTER_TABLE_NAME}`)
                    .setDescription(result.description)
                    .setFooter({
                        text: `生成 ${i + 1}/${count}`
                    });

                if (i === 0) {
                    await interaction.reply({
                        embeds: [embed],
                        ...replyOptions
                    });
                } else {
                    await interaction.followUp({
                        embeds: [embed],
                        ...replyOptions
                    });
                }
            }

            return;
        }

        // 通常のロールテーブル処理
        if (!BUILT_IN_TABLES[name]) {
            return interaction.reply({
                content: '指定された表が見つかりません。',
                ephemeral: true
            });
        }

        for (let i = 0; i < count; i++) {
            const result = rollBuiltInTable(name);

            if (!result) {
                if (i === 0) {
                    return interaction.reply({
                        content: '指定された表が見つかりません。',
                        ephemeral: true
                    });
                }

                return interaction.followUp({
                    content: '表の抽選中にエラーが発生しました。',
                    ...replyOptions
                });
            }

            const embed = new EmbedBuilder()
                .setColor('#955BBC')
                .setDescription(
                    `**${result.title}**\n` +
                    `出目：${result.roll}（1d${result.max}）\n` +
                    `${result.result ?? 'この出目に対応する結果がありません。'}`
                )
                .setFooter({
                    text: `実行 ${i + 1}/${count}`
                });

            if (i === 0) {
                await interaction.reply({
                    embeds: [embed],
                    ...replyOptions
                });
            } else {
                await interaction.followUp({
                    embeds: [embed],
                    ...replyOptions
                });
            }
        }
    }
};