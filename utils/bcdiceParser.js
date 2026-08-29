/**
 * BCDice 自動判定用パーサー
 *
 * Discordの通常メッセージから、
 * 「これはBCDiceに渡してよいダイスコマンドか」
 * を判定する。
 *
 * 基本方針：
 * - メッセージ全体がダイスコマンドであること
 * - 前後の文章を含むメッセージには反応しない
 * - 「2d6めめめ」のような文字列には反応しない
 * - CCB / SG / SW2.5系など明確なシステム固有コマンドは
 *   システムを自動推定する
 * - 汎用的なダイス式はデフォルトシステムを使用する
 */

const DEFAULT_SYSTEM = 'Cthulhu6th';

/**
 * システム固有コマンドの判定
 *
 * @param {string} command
 * @returns {string|null}
 */
function detectSystem(command) {

    const normalized = command
        .trim()
        .toUpperCase();

    // --------------------------------------------------
    // クトゥルフ神話TRPG
    // --------------------------------------------------

    // CCB / CCB<=25 / CCB>=50 など
    if (/^CCB(?:<=|>=|=|<|>|\s|$)/i.test(command)) {
        return 'Cthulhu6th';
    }

    // CC / CC<=25 などもCoC系
    if (/^CC(?:<=|>=|=|<|>|\s|$)/i.test(command)) {
        return 'Cthulhu6th';
    }

    // --------------------------------------------------
    // シノビガミ
    // --------------------------------------------------

    if (/^SG(?:\s|$)/i.test(command)) {
        return 'Shinobigami';
    }

    // --------------------------------------------------
    // SW2.5
    // --------------------------------------------------

    // 威力表
    //
    // K20[12]+8
    // k10+5
    // K20[10]+7$+2
    //
    // などをSW2.5として扱う。
    if (/^K\d+(?:\[\d+\])?(?:[+\-*/]\d+)*(?:\$[+\-*/]?\d+)?/i.test(command)) {
        return 'SwordWorld2.5';
    }

    // --------------------------------------------------
    // システム固有判定が見つからなかった
    // --------------------------------------------------

    return null;
}

/**
 * メッセージがダイスコマンドとして成立しているか判定する。
 *
 * @param {string} content
 * @returns {{
 *   command: string,
 *   system: string|null
 * }|null}
 */
function parseDiceMessage(content) {

    if (!content) {
        return null;
    }

    const text = content.trim();

    if (!text) {
        return null;
    }

    // --------------------------------------------------
    // 明らかに通常文章なら除外
    // --------------------------------------------------

    // 改行を含む通常文章は現段階では対象外
    if (/[\r\n]/.test(text)) {
        return null;
    }

    // Discordのメンション等
    if (text.includes('<@') || text.includes('<#')) {
        return null;
    }

    // --------------------------------------------------
    // システム固有コマンド
    // --------------------------------------------------

    const detectedSystem = detectSystem(text);

    // --------------------------------------------------
    // 汎用ダイス式
    // --------------------------------------------------

    /*
     * 基本的な XdY 形式。
     *
     * 例：
     * 1d6
     * 2d6
     * 3d100
     * 2d6+4
     * 1d20-2
     *
     * Dは大文字小文字どちらでも可。
     */

    const genericDicePattern =
        /^\d+[dD]\d+(?:\s*[+\-*/]\s*\d+)*$/;

    /*
     * CCB / SG / K系などシステム固有コマンドは、
     * それぞれBCDice側の文法に任せる。
     */
    const isKnownSystemCommand =
        detectedSystem !== null;

    const isGenericDice =
        genericDicePattern.test(text);

    if (!isKnownSystemCommand && !isGenericDice) {
        return null;
    }

    return {
        command: text,
        system: detectedSystem
    };
}

module.exports = {
    DEFAULT_SYSTEM,
    detectSystem,
    parseDiceMessage
};