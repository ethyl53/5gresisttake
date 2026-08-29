const { SlashCommandBuilder } = require('discord.js');
const { getChannelSystem } = require('../bcdice/manager');
const { processDiceRoll } = require('../bcdice/runner');

const MAJOR_SYSTEMS = [
    { name: 'クトゥルフ6版', value: 'Cthulhu' },
    { name: 'ソード・ワールド2.5', value: 'SwordWorld2.5' },
    { name: 'シノビガミ', value: 'ShinobiGami' }
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
                .setDescription('使用するSystem ID（未指定の場合は現在のチャンネル設定）')
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const filtered = MAJOR_SYSTEMS.filter(sys =>
            sys.name.includes(focusedValue) || sys.value.toLowerCase().includes(focusedValue.toLowerCase())
        );

        let choices = [...filtered];
        if (focusedValue && !MAJOR_SYSTEMS.some(sys => sys.value === focusedValue)) {
            choices.unshift({ name: `直接指定: ${focusedValue}`, value: focusedValue });
        }

        await interaction.respond(
            choices.slice(0, 25).map(choice => ({ name: choice.name, value: choice.value }))
        );
    },

    async execute(interaction) {
        const rawCommand = interaction.options.getString('command').trim();
        let systemId = interaction.options.getString('system');

        if (!systemId) {
            systemId = await getChannelSystem(interaction.guildId, interaction.channelId);
        }

        // 先頭の s や 繰り返しコマンド後の s を判定（Secret Dice）
        const isSecret = /^s/i.test(rawCommand) || /^(?:rep|x|repeat)\d+\s+s/i.test(rawCommand);

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
                await interaction.followUp({ content: 'ダイスロールの実行中にエラーが発生しました。', ephemeral: true }).catch(() => null);
            } else {
                await interaction.reply({ content: 'ダイスロールの実行中にエラーが発生しました。', ephemeral: true }).catch(() => null);
            }
        }
    }
};