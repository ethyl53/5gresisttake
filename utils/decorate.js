'use strict';

const {
    WebhookClient,
    EmbedBuilder,
    PermissionsBitField
} = require('discord.js');

const ANNOUNCEMENTS = {
    important: {
        title: '重要なお知らせ',
        color: 0xE53935,
        icon: '🔔'
    },
    recruitment: {
        title: 'メンバー募集',
        color: 0x43A047,
        icon: '📣'
    },
    notice: {
        title: 'お知らせ',
        color: 0x3984D6,
        icon: 'ℹ️'
    }
};

function isHttpUrl(value) {
    if (!value) return false;

    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function parseColor(value) {
    if (value === undefined || value === null || value === '') {
        return 0x5865F2;
    }

    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFF) {
            throw new Error('色は 0～16777215 の整数で指定してください。');
        }
        return value;
    }

    const normalized = String(value).trim().replace(/^#/, '');

    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        throw new Error('色は #5865F2 のような6桁の16進数で指定してください。');
    }

    return Number.parseInt(normalized, 16);
}

function buildEmbed(data) {
    const embed = new EmbedBuilder();
    const title = data.title ? String(data.title) : '';
    const description = data.description ? String(data.description) : '';

    if (title.length > 256) {
        throw new Error('タイトルは256文字以内にしてください。');
    }

    if (description.length > 4096) {
        throw new Error('本文は4096文字以内にしてください。');
    }

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);

    embed.setColor(parseColor(data.color));

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
        'SELECT webhook_id, webhook_token FROM decorate_webhooks WHERE channel_id = $1',
        [channel.id]
    );


    if (saved.rows.length > 0) {
        const row = saved.rows[0];

        try {
            const webhooks = await channel.fetchWebhooks();
            const existing = webhooks.get(row.webhook_id);

            if (existing && existing.token === row.webhook_token) {
                return new WebhookClient({
                    id: row.webhook_id,
                    token: row.webhook_token
                });
            }

            await pool.query(
                'DELETE FROM decorate_webhooks WHERE channel_id = $1',
                [channel.id]
            );
        } catch (error) {
            console.error('[Decorate] Saved webhook validation failed:', error);

            await pool.query(
                'DELETE FROM decorate_webhooks WHERE channel_id = $1',
                [channel.id]
            );
        }
    }

    const created = await channel.createWebhook({
        name: 'Message Decorator'
    });

    if (!created.token) {
        throw new Error('Webhookのトークンを取得できませんでした。');
    }

    await pool.query(
        `INSERT INTO decorate_webhooks (channel_id, webhook_id, webhook_token)
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

async function resolveQuote(guild, messageUrl) {
    if (!messageUrl) {
        throw new Error('引用元のメッセージURLを指定してください。');
    }

    let parsed;

    try {
        parsed = new URL(messageUrl);
    } catch {
        throw new Error('引用元URLの形式が正しくありません。');
    }

    if (
        !['discord.com', 'www.discord.com', 'canary.discord.com',
            'ptb.discord.com'].includes(parsed.hostname)
    ) {
        throw new Error('引用元にはDiscordのメッセージURLを指定してください。');
    }

    const match = parsed.pathname.match(
        /^\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/
    );

    if (!match) {
        throw new Error('サーバーのメッセージURLを指定してください。');
    }

    const [, guildId, channelId, messageId] = match;

    if (guildId !== guild.id) {
        throw new Error('引用元は現在のサーバー内のメッセージにしてください。');
    }

    const channel = await guild.channels.fetch(channelId);

    if (!channel || !channel.isTextBased() || !channel.messages) {
        throw new Error('引用元のチャンネルを取得できませんでした。');
    }

    const message = await channel.messages.fetch(messageId);

    return message;
}

async function createPayload({
    pool,
    channel,
    member,
    user,
    data
}) {
    const mode = data.mode || 'embed';
    let embed;

    if (mode === 'announce') {
        const preset = ANNOUNCEMENTS[data.preset || 'notice'];

        if (!preset) {
            throw new Error(
                '告知種別は important / recruitment / notice から選んでください。'
            );
        }

        embed = buildEmbed({
            title: data.title || preset.title,
            description: data.description,
            color: data.color ?? preset.color,
            image: data.image,
            thumbnail: data.thumbnail,
            url: data.url,
            footer: data.footer
        });

        embed.setAuthor({ name: preset.icon + ' ' + preset.title });
    } else if (mode === 'quote') {
        const quoted = await resolveQuote(channel.guild, data.messageUrl);
        const quotedText = quoted.content || '（本文なし）';
        const excerpt = quotedText.length > 3500
            ? quotedText.slice(0, 3497) + '...'
            : quotedText;

        embed = new EmbedBuilder()
            .setColor(parseColor(data.color))
            .setAuthor({
                name: quoted.member?.displayName ||
                    quoted.author.globalName ||
                    quoted.author.username,
                iconURL: quoted.author.displayAvatarURL()
            })
            .setDescription(excerpt)
            .addFields({
                name: '引用元',
                value: '[元メッセージを開く](' + quoted.url + ')'
            });

        if (data.title) {
            if (String(data.title).length > 256) {
                throw new Error('タイトルは256文字以内にしてください。');
            }
            embed.setTitle(String(data.title));
        }

        if (data.description) {
            if (String(data.description).length > 1000) {
                throw new Error('引用の補足文は1000文字以内にしてください。');
            }
            embed.addFields({
                name: '補足',
                value: String(data.description)
            });
        }
    } else if (mode === 'embed') {
        embed = buildEmbed(data);
    } else {
        throw new Error('mode は embed / announce / quote のいずれかにしてください。');
    }

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
    ANNOUNCEMENTS,
    buildEmbed,
    createPayload
};