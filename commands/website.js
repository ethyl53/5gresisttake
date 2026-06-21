const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const crypto = require('crypto');
const db = require('../database/db');

module.exports = {

data:
new SlashCommandBuilder()
.setName('website')
.setDescription('Web版ログインURLを発行'),

async execute(interaction) {

    const token =
        crypto.randomBytes(32).toString('hex');

    const now = Date.now();

    const expires =
        now + 7 * 24 * 60 * 60 * 1000;

    await db.query(
        `
        INSERT INTO web_tokens
        (
            token,
            user_id,
            created_at,
            expires_at
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
            token,
            interaction.user.id,
            now,
            expires
        ]
    );

    const url =
`https://study-web-console.vercel.app/login?token=${token}`;

    const embed =
        new EmbedBuilder()
            .setTitle('🌐 Web版ログインURL')
            .setDescription(
                `以下のURLをiPadで開いてください。\n\n${url}`
            )
            .setColor(0x00BFFF);

    await interaction.reply({
        embeds:[embed],
        ephemeral:true
    });
}
};