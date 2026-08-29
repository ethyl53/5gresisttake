const {
    EmbedBuilder
} = require('discord.js');

const {
    DEFAULT_SYSTEM,
    parseDiceMessage
} = require('./bcdiceParser');

const BCDICE_API_BASE =
    process.env.BCDICE_API_URL ||
    'https://bcdice.kazagakure.net';

/*
 * Embedカラー
 */
const EMBED_COLORS = {
    FAILURE: '#DC004E',
    SUCCESS: '#2196F3',
    NORMAL: '#6F6F6F'
};

/**
 * BCDice APIを使用してダイスを振る。
 *
 * @param {string} system
 * @param {string} command
 * @returns {Promise<object>}
 */
async function rollDice(system, command) {

    const url =
        `${BCDICE_API_BASE}/v2/game_system/` +
        `${encodeURIComponent(system)}/roll`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            command
        })
    });

    if (!response.ok) {
        throw new Error(
            `BCDice API Error: ${response.status} ${response.statusText}`
        );
    }

    return await response.json();
}

/**
 * BCDiceの結果から結果種別を判定する。
 *
 * 優先順位:
 * 1. ファンブル
 * 2. 失敗
 * 3. クリティカル
 * 4. スペシャル
 * 5. 成功
 * 6. その他
 *
 * @param {object} result
 * @returns {'fumble'|'failure'|'critical'|'special'|'success'|'normal'}
 */
function getResultType(result) {

    if (!result) {
        return 'normal';
    }

    /*
     * ソード・ワールド2.5は今回の
     * 成功・失敗等の色分け対象外。
     */
    if (result.system === 'SwordWorld2.5') {
        return 'normal';
    }

    /*
     * ファンブルを最優先。
     */
    if (result.fumble === true) {
        return 'fumble';
    }

    /*
     * 失敗。
     */
    if (result.failure === true) {
        return 'failure';
    }

    /*
     * クリティカル。
     *
     * BCDiceではクリティカル時に
     * success=true と critical=true の
     * 両方が設定される場合があるため、
     * successより先に確認する。
     */
    if (result.critical === true) {
        return 'critical';
    }

    /*
     * special がAPIレスポンスに存在する場合。
     *
     * システムによっては独立したspecialフラグを
     * 持たないため、存在する場合のみ利用する。
     */
    if (result.special === true) {
        return 'special';
    }

    /*
     * 成功。
     */
    if (result.success === true) {
        return 'success';
    }

    return 'normal';
}

/**
 * 結果種別からEmbedカラーを取得する。
 *
 * @param {'fumble'|'failure'|'critical'|'special'|'success'|'normal'} resultType
 * @returns {string}
 */
function getResultColor(resultType) {

    switch (resultType) {

        case 'fumble':
        case 'failure':
            return EMBED_COLORS.FAILURE;

        case 'critical':
        case 'special':
        case 'success':
            return EMBED_COLORS.SUCCESS;

        default:
            return EMBED_COLORS.NORMAL;
    }
}

/**
 * DiscordメッセージをBCDiceへ渡す。
 *
 * @param {import('discord.js').Message} message
 */
async function handleDiceMessage(message) {

    const parsed =
        parseDiceMessage(message.content);

    if (!parsed) {
        return;
    }

    /*
     * システム固有コマンドが検出された場合は
     * それを使用する。
     *
     * 汎用コマンドの場合はデフォルトシステムを使用する。
     */
    const system =
        parsed.system || DEFAULT_SYSTEM;

    try {

        const result =
            await rollDice(
                system,
                parsed.command
            );

        /*
         * APIレスポンスの結果本文。
         */
        const resultText =
            result.result ||
            result.text ||
            result.message ||
            result.error;

        if (!resultText) {
            console.error(
                '[BCDice] Unknown API response:',
                result
            );

            return;
        }

        /*
         * 結果判定用にシステムIDを付与。
         *
         * rollDice() のAPIレスポンスそのものは
         * 変更せず、内部判定用に利用する。
         */
        const resultWithSystem = {
            ...result,
            system
        };

        const resultType =
            getResultType(resultWithSystem);

        const embedColor =
            getResultColor(resultType);

        const embed =
            new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(resultText);

        /*
         * シークレットダイスの場合は
         * チャンネルではなく実行者本人へDMする。
         *
         * 結果を通常メッセージで送ると
         * 他の参加者にも見えてしまうため。
         */
        if (parsed.secret === true) {

            try {

                await message.author.send({
                    embeds: [embed]
                });

                /*
                 * チャンネルにはロール結果を出さない。
                 */
                return;

            } catch (dmError) {

                console.error(
                    '[BCDice Secret Roll DM Error]',
                    dmError
                );

                /*
                 * DMできない場合は結果を公開しない。
                 */
                await message.reply({
                    content:
                        'シークレットダイスの結果をDMに送信できませんでした。'
                }).catch(() => null);

                return;
            }
        }

        /*
         * 通常ダイス。
         */
        await message.reply({
            embeds: [embed]
        });

    } catch (error) {

        console.error(
            '[BCDice Roll Error]',
            error
        );

        await message.reply({
            content:
                'BCDiceの処理中にエラーが発生しました。'
        }).catch(() => null);
    }
}

module.exports = {
    rollDice,
    handleDiceMessage,
    getResultType,
    getResultColor,
    EMBED_COLORS
};