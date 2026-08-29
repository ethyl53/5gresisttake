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
 * - 先頭のS/sはシークレットダイス指定として扱う
 */

const DEFAULT_SYSTEM = 'Cthulhu6th';

/**
 * システム固有コマンドの判定
 *
 * @param {string} command
 * @returns {string|null}
 */
function detectSystem(command) {

    /*
     * シークレット指定のSを除いた状態で
     * システム判定を行う。
     *
     * 実際にBCDiceへ渡すcommandは
     * Sを残したままにする。
     */
    const commandForDetection =
        command.replace(/^s/i, '');

    // --------------------------------------------------
    // クトゥルフ神話TRPG
    // --------------------------------------------------

    // CCB / CCB<=25 / CCB>=50 など
    if (/^CCB(?:<=|>=|=|<|>|\s|$)/i.test(commandForDetection)) {
        return 'Cthulhu6th';
    }

    // CC / CC<=25 などもCoC系
    if (/^CC(?:<=|>=|=|<|>|\s|$)/i.test(commandForDetection)) {
        return 'Cthulhu6th';
    }

    // --------------------------------------------------
    // シノビガミ
    // --------------------------------------------------

    // SG
    // sSG
    // いずれもシノビガミとして扱う。
    if (/^SG(?:\s|$)/i.test(commandForDetection)) {
        return 'Shinobigami';
    }

    // 数字付きSGも許可
    if (/^\d+SG(?:\s|$)/i.test(commandForDetection)) {
        return 'Shinobigami';
    }

    // --------------------------------------------------
    // SW2.5
    // --------------------------------------------------

    /*
     * 以下をSW2.5として扱う。
     *
     * K20
     * K20+5
     * K20[12]+8
     * K20[10]+7$+2
     * KR20+5
     */
    if (
        /^K(?:R)?\d+(?:\[\d+\])?(?:[+\-*/]\d+)?(?:\$[+\-*/]?\d+)?(?:\s|$)/i
            .test(commandForDetection)
    ) {
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
 *   system: string|null,
 *   secret: boolean
 * }|null}
 */
function parseDiceMessage(content) {

    if (!content) {
        return null;
    }

    const text =
        content.trim();

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
    // シークレットダイス判定
    // --------------------------------------------------

    const secret =
        /^s/i.test(text);

    /*
     * システム判定だけSを除外。
     *
     * command自体はtextをそのまま返すので、
     * BCDiceへは s1d100 / sCCB<=5 等が
     * そのまま渡される。
     */
    const commandForDetection =
        secret ? text.slice(1) : text;

    if (!commandForDetection) {
        return null;
    }

    // --------------------------------------------------
    // システム固有コマンド
    // --------------------------------------------------

    const detectedSystem =
        detectSystem(text);

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
     * シークレット指定時：
     * s1d100
     * s2d6+4
     */
    const genericDicePattern =
        /^\d+[dD]\d+(?:\s*[+\-*/]\s*\d+)?$/;

    const isGenericDice =
        genericDicePattern.test(commandForDetection);

    /*
     * CCB / SG / K系などシステム固有コマンドは、
     * それぞれBCDice側の文法に任せる。
     */
    const isKnownSystemCommand =
        detectedSystem !== null;

    if (!isKnownSystemCommand && !isGenericDice) {
        return null;
    }

    return {
        /*
         * Sを含めた元のコマンドをBCDiceへ渡す。
         */
        command: text,

        system: detectedSystem,

        secret
    };
}

module.exports = {
    DEFAULT_SYSTEM,
    detectSystem,
    parseDiceMessage
};