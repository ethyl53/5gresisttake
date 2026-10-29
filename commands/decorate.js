
'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const pool = require('../database/db');
const { createPayload } = require('../utils/decorate');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('decorate')
        .setDescription('装飾したEmbed・告知・引用カードを送信します')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('作成するカードの種類')
                .setRequired(true)
                .addChoices(
                    { name: '基本Embed', value: 'embed' },
                    { name: '告知', value: 'announce' },
                    { name: '引用カード', value: 'quote' }
                ))
        .addStringOption(option =>
            option.setName('title')
                .setDescription('タイトル（256文字以内）')
                .setMaxLength(256)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('本文、または引用カードの補足文')
                .setMaxLength(4096)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('色（例: #5865F2）')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('image')
                .setDescription('画像URL')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('url')
                .setDescription('タイトルに設定するリンクURL')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('preset')
                .setDescription('告知の種別')
                .addChoices(
                    { name: '重要', value: 'important' },
                    { name: '募集', value: 'recruitment' },
                    { name: 'お知らせ', value: 'notice' }
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('message_url')
                .setDescription('引用元のDiscordメッセージURL（引用カード用）')
                .setRequired(false)),

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

            const data = {
                mode: interaction.options.getString('mode'),
                title: interaction.options.getString('title'),
                description: interaction.options.getString('description'),
                color: interaction.options.getString('color'),
                image: interaction.options.getString('image'),
                url: interaction.options.getString('url'),
                preset: interaction.options.getString('preset'),
                messageUrl: interaction.options.getString('message_url')
            };

            await createPayload({
                pool,
                channel: interaction.channel,
                member,
                user: interaction.user,
                data
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