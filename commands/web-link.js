'use strict';

const {
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');

const {
    createLinkCode
} = require('../database/webAccountService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('web-link')
        .setDescription(
            'Webコンソール用の一度限りの連携コードを発行します'
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const result = await createLinkCode(
                db,
                interaction.user.id,
                10
            );

            await interaction.editReply({
                content:
                    'Webコンソールの連携コードを発行しました。\n\n' +
                    `コード: \`${result.code}\`\n` +
                    `有効期限: ${result.expiresInMinutes}分\n\n` +
                    '学校のiPadでGoogleログイン後、このコードを入力してください。' +
                    'コードは1回使用すると無効になります。'
            });
        } catch (error) {
            console.error(
                '[Web Link Command Error]',
                error
            );

            await interaction.editReply({
                content:
                    '連携コードの発行に失敗しました。'
            });
        }
    }
};
