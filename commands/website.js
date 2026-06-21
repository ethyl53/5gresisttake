const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const crypto = require('crypto');
const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('website')
        .setDescription('Web版ログインURLを発行'),

    async execute(interaction) {
        try {
            const token = crypto.randomBytes(32).toString('hex');
            const now = Date.now();
            const expires = now + 7 * 24 * 60 * 60 * 1000;
            const userId = interaction.user.id;

            // 🟢 同一ユーザーの古いトークンを事前に削除して重複を防ぐ
            await db.query(
                `DELETE FROM web_tokens WHERE user_id = $1`,
                [userId]
            );

            // 新しいトークンをインサート
            await db.query(
                `INSERT INTO web_tokens (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
                [token, userId, now, expires]
            );

            // 👇ここをご自身のVercelのドメインに変更してください
            const url = `https://study-web-console.app/login?token=${token}`;

            const embed = new EmbedBuilder()
                .setTitle('Web版ログインURL')
                .setDescription(`以下のURLをiPadで開いてください。\n\n${url}`)
                .setColor(0x00BFFF);

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        } catch (error) {
            console.error('[WEBSITE ERROR]', error);
            await interaction.reply({ 
                content: 'URLの発行中にエラーが発生しました。', 
                ephemeral: true 
            });
        }
    }
};