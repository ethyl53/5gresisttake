const { EmbedBuilder } = require('discord.js');
const { bcdiceRequest } = require('./api');

const BCDICE_EMBED_COLORS = {
    FAILURE: '#DC004E',
    SUCCESS: '#2196F3',
    NORMAL: '#6F6F6F'
};

function getDiceResultType(result, systemId) {
    if (systemId === 'SwordWorld2.5') {
        return 'normal';
    }
    if (result?.fumble === true) return 'fumble';
    if (result?.failure === true) return 'failure';
    if (result?.critical === true) return 'critical';
    if (result?.special === true) return 'special';
    if (result?.success === true) return 'success';
    return 'normal';
}

function getDiceEmbedColor(resultType) {
    switch (resultType) {
        case 'fumble':
        case 'failure':
            return BCDICE_EMBED_COLORS.FAILURE;
        case 'critical':
        case 'special':
        case 'success':
            return BCDICE_EMBED_COLORS.SUCCESS;
        default:
            return BCDICE_EMBED_COLORS.NORMAL;
    }
}

/**
 * 自動ロール・/roll共通のダイス実行・返答処理
 */
async function processDiceRoll({ systemId, command, secret, user, replyable }) {
    const result = await bcdiceRequest(systemId, command);

    const resultText = result?.text || result?.result || result?.message;
    if (!resultText) {
        throw new Error('Unexpected BCDice API response');
    }

    const resultType = getDiceResultType(result, systemId);
    const embedColor = getDiceEmbedColor(resultType);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(resultText);

    const userDisplayName = user.displayName || user.username;

    if (secret) {
        const noticeContent = `Secret Dice | ${userDisplayName}`;
        if (replyable.isInteraction) {
            await replyable.reply({ content: noticeContent, ephemeral: false });
        } else {
            await replyable.reply({
                content: noticeContent,
                allowedMentions: { repliedUser: false }
            });
        }
        try {
            await user.send({ embeds: [embed] });
        } catch (dmError) {
            console.error('[BCDice] Failed to send secret result DM:', dmError);
        }
    } else {
        if (replyable.isInteraction) {
            await replyable.reply({ embeds: [embed] });
        } else {
            await replyable.reply({
                embeds: [embed],
                allowedMentions: { repliedUser: false }
            });
        }
    }
}

module.exports = { processDiceRoll };