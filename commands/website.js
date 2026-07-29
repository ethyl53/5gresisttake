'use strict';

const {
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const WEB_CONSOLE_URL = process.env.WEB_CONSOLE_URL ||
    'https://tk-f83ff.web.app/';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('website')
        .setDescription('WebコンソールのURLを表示します'),

    async execute(interaction) {
        try {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('Webコンソール')
                        .setDescription(
                            `学校端末では次のURLを開いてGoogleログインしてください。\n\n${WEB_CONSOLE_URL}\n\n初回は \`/web-link\` で発行したコードによるDiscord連携が必要です。`
                        )
                        .setColor(0x00BFFF)
                ],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('[Website Command Error]', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'WebコンソールURLの表示に失敗しました。',
                    flags: MessageFlags.Ephemeral
                }).catch(() => null);
            }
        }
    }
};
