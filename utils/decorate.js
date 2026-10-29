
'use strict';

const {
    WebhookClient,
    EmbedBuilder,
    PermissionsBitField
} = require('discord.js');

const COLOR_CHOICES = {
    blue: 0x3984D6,
    red: 0xE53935,
    green: 0x43A047,
    yellow: 0xFBC02D,
    purple: 0x955BBC,
    gray: 0x6F6F6F,
    blurple: 0x5865F2
};

function parseColor(value) {
    if (value === undefined || value === null || value === '') {
        return COLOR_CHOICES.blue;
    }

    const normalized = String(value).trim().toLowerCase();

    if (Object.prototype.hasOwnProperty.call(COLOR_CHOICES, normalized)) {
        return COLOR_CHOICES[normalized];
    }

    const hex = normalized.replace(/^#/, '');

    if (!/^[0-9a-f]{6}$/i.test(hex)) {
        throw new Error(
            '色は青・赤・緑・黄・紫・灰色・青紫、または #3984D6 のような6桁のカラーコードで指定してください。'
        );
    }

    return Number.parseInt(hex, 16);
}

function isHttpUrl(value) {
    if (!value) return false;

    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function buildEmbed(data) {
    const description = String(
        data.description ?? data.text ?? ''
    ).trim();

    if (!description) {
        throw new Error('本文を入力してください。');
    }

    if (description.length > 4096) {
        throw new Error('本文は4096文字以内にしてください。');
    }

    const embed = new EmbedBuilder()
        .setColor(parseColor(data.color))
        .setDescription(description);

    // 既存のコメントコマンドとの互換性のため、
    // JSONからタイトルや画像などが渡された場合は引き続き使用する。
    if (data.title) {
        const title = String(data.title);

        if (title.length > 256) {
            throw new Error('タイトルは256文字以内にしてください。');
        }

        embed.setTitle(title);
    }

    if (data.url) {
        if (!isHttpUrl(data.url)) {
            throw new Error('リンクURLは http:// または https:// で指定してください。');
        }

        embed.setURL(data.url);
    }

    if (data.image) {
        if (!isHttpUrl(data.image)) {
            throw new Error('画像URLは http:// または https:// で指定してください。');
        }

        embed.setImage(data.image);
    }

    if (data.thumbnail) {
        if (!isHttpUrl(data.thumbnail)) {
            throw new Error('サムネイルURLは http:// または https:// で指定してください。');
        }

        embed.setThumbnail(data.thumbnail);
    }

    if (data.footer) {
        const footer = String(data.footer);

        if (footer.length > 2048) {
            throw new Error('フッターは2048文字以内にしてください。');
        }

        embed.setFooter({ text: footer });
    }

    return embed;
}

async function getWebhook(pool, channel) {
    if (!channel.guild) {
        throw new Error('サーバー内のチャンネルで使用してください。');
    }

    if (!channel.isTextBased() || !channel.isSendable()) {
        throw new Error('このチャンネルには送信できません。');
    }

    const me = channel.guild.members.me;

    if (!me) {
        throw new Error('Botのサーバー情報を取得できませんでした。');
    }

    const permissions = channel.permissionsFor(me);

    if (
        !permissions ||
        !permissions.has(PermissionsBitField.Flags.ManageWebhooks)
    ) {
        throw new Error(
            'このチャンネルでWebhookを管理する権限がありません。'
        );
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS decorate_webhooks (
            channel_id TEXT PRIMARY KEY,
            webhook_id TEXT NOT NULL,
            webhook_token TEXT NOT NULL
        );
    `);

    const saved = await pool.query(
        `SELECT webhook_id, webhook_token
         FROM decorate_webhooks
         WHERE channel_id = $1`,
        [channel.id]
    );

    if (saved.rows.length > 0) {
        const row = saved.rows[0];

        return new WebhookClient({
            id: row.webhook_id,
            token: row.webhook_token
        });
    }

    const created = await channel.createWebhook({
        name: 'Message Decorator'
    });

    if (!created.token) {
        throw new Error('Webhookのトークンを取得できませんでした。');
    }

    await pool.query(
        `INSERT INTO decorate_webhooks
            (channel_id, webhook_id, webhook_token)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id)
         DO UPDATE SET
            webhook_id = EXCLUDED.webhook_id,
            webhook_token = EXCLUDED.webhook_token`,
        [channel.id, created.id, created.token]
    );

    return new WebhookClient({
        id: created.id,
        token: created.token
    });
}

async function createPayload({
    pool,
    channel,
    member,
    user,
    data
}) {
    const embed = buildEmbed(data);
    const webhook = await getWebhook(pool, channel);

    const displayName =
        member?.displayName ||
        user.globalName ||
        user.username;

    const avatarURL = user.displayAvatarURL({
        extension: 'png',
        size: 256
    });

    await webhook.send({
        username: displayName,
        avatarURL,
        embeds: [embed],
        allowedMentions: { parse: [] }
    });
}

module.exports = {
    COLOR_CHOICES,
    parseColor,
    buildEmbed,
    createPayload
};