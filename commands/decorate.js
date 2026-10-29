
'use strict';

const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const pool = require('../database/db');
const { createPayload } = require('../utils/decorate');

const COLOR_CHOICES = [
    { name: '青', value: 'blue' },
    { name: '赤', value: 'red' },
    { name: '緑', value: 'green' },
    { name: '黄', value: 'yellow' },
    { name: '紫', value: 'purple' },
    { name: '灰色', value: 'gray' },
    { name: '青紫（Discord標準風）', value: 'blurple' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('decorate')
        .setDescription('色付きの装飾メッセージを送信します')
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('使用する色')
                .addChoices(...COLOR_CHOICES)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('custom_color')
                .setDescription('任意のカラーコード（例: #7B68EE）。こちらが優先されます')
                .setMaxLength(7)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('text')
                .setDescription('装飾する本文')
                .setMaxLength(4096)
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: 'サーバー内で使用してください。',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const member = await interaction.guild.members.fetch(
                interaction.user.id
            );

            const selectedColor =
                interaction.options.getString('custom_color') ||
                interaction.options.getString('color') ||
                'blue';

            const text = interaction.options.getString('text');

            await createPayload({
                pool,
                channel: interaction.channel,
                member,
                user: interaction.user,
                data: {
                    color: selectedColor,
                    description: text
                }
            });

            await interaction.editReply(
                '装飾メッセージを送信しました。'
            );
        } catch (error) {
            console.error('[Decorate] Slash command failed:', error);

            await interaction.editReply(
                '送信できませんでした：' + error.message
            );
        }
    }
};