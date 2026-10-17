const { SlashCommandBuilder } = require('discord.js');
const { getChannelSystem } = require('../bcdice/manager');
const { processDiceRoll } = require('../bcdice/runner');

const MAJOR_SYSTEMS = [
    { name: 'Cthulhu', value: 'Cthulhu' },
    { name: 'SwordWorld2.5', value: 'SwordWorld2.5' },
    { name: 'ShinobiGami', value: 'ShinobiGami' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('BCDice APIへコマンドを直接送信してダイスを振ります。')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('実行するBCDiceコマンド (例: CCB<=25 目星, sCCB<=5, K30[7]$+2)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('system')
                .setDescription('使用するシステム（未指定の場合は現在のチャンネル設定）')
                .addChoices(...MAJOR_SYSTEMS)
        )
        .addStringOption(option =>
            option.setName('custom_system')
                .setDescription('任意のBCDice System ID（例: DiceBot）')
        ),

    async execute(interaction) {
        const rawCommand = interaction.options.getString('command').trim();

        const selectedSystem = interaction.options.getString('system');
        const customSystem = interaction.options.getString('custom_system')?.trim();

        // 固定選択と自由入力が同時に指定された場合はエラー
        if (selectedSystem && customSystem) {
            return interaction.reply({
                content: 'system と custom_system は同時に指定できません。どちらか一方を指定してください。',
                ephemeral: true
            });
        }

        // 指定されたシステムを使用。未指定の場合はチャンネル設定を使用
        let systemId = selectedSystem || customSystem || null;

        if (!systemId) {
            systemId = await getChannelSystem(
                interaction.guildId,
                interaction.channelId
            );
        }

        // 先頭の s や 繰り返しコマンド後の s を判定（Secret Dice）
        const isSecret =
            /^s/i.test(rawCommand) ||
            /^(?:rep|x|repeat)\d+\s+s/i.test(rawCommand);

        try {
            await processDiceRoll({
                systemId,
                command: rawCommand,
                secret: isSecret,
                user: interaction.user,
                replyable: {
                    isInteraction: true,
                    reply: (options) => interaction.reply(options)
                }
            });
        } catch (error) {
            console.error('[Roll Command Error]', error);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: 'ダイスロールの実行中にエラーが発生しました。',
                    ephemeral: true
                }).catch(() => null);
            } else {
                await interaction.reply({
                    content: 'ダイスロールの実行中にエラーが発生しました。',
                    ephemeral: true
                }).catch(() => null);
            }
        }
    }
};