const {
    DEFAULT_SYSTEM,
    parseDiceMessage
} = require('./bcdiceParser');

const BCDICE_API_BASE =
    process.env.BCDICE_API_URL ||
    'https://bcdice.kazagakure.net';

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

    /*
     * APIのリクエスト形式については
     * 実際のAPI仕様を確認して最終確定する。
     */

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
         * APIレスポンスの実際の形式を確認後、
         * ここを最終調整する。
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

        await message.reply({
            content: resultText
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
    handleDiceMessage
};