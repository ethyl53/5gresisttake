function normalizeCommand(content) {
    if (!content) return '';

    return content
        .trim()
        // \s だと改行も置換してしまうため、水平方向の空白のみを対象にする
        .replace(/[^\S\r\n]+/g, ' ');
}

/**
 * 通常メッセージを自動ロール対象として扱うか判定
 *
 * 条件:
 * - 1行のみ
 * - コマンドは文頭から開始
 * - コマンドの直後には空白またはメッセージ末尾が必要
 *
 * secret:
 * - true ならシークレットダイス
 * - false なら通常ダイス
 */
function detectDiceCommand(content) {
    if (!content) {
        return null;
    }

    // 複数行メッセージは対象外
    // （改行が消える前に元のcontentで判定する）
    if (content.includes('\n')) {
        return null;
    }

    const text = normalizeCommand(content);

    if (!text) {
        return null;
    }

    // ==========================================
    // シークレット指定
    // ==========================================

    const secret = /^s/i.test(text);

    /*
     * システム判定用には先頭のSを除外する。
     *
     * ただし、実際にBCDiceへ渡すcommandは
     * 元のtextをそのまま使用する。
     */
    const commandText = secret ? text.slice(1) : text;

    if (!commandText) {
        return null;
    }

    // ==========================================
    // クトゥルフ
    // ==========================================

    if (/^CCB(?:<=|>=|=|<|>|\s|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: 'Cthulhu',
            secret
        };
    }

    if (/^CC(?:\s|<=|>=|<|>|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: 'Cthulhu',
            secret
        };
    }

    // ==========================================
    // シノビガミ
    // ==========================================

    if (/^\d+SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: 'ShinobiGami',
            secret
        };
    }

    // ==========================================
    // SW2.5
    // ==========================================

    if (/^K(?:R)?\d+(?:\s|[+-\[\$@#]|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: 'SwordWorld2.5',
            secret
        };
    }

    // ==========================================
    // 一般的なダイス
    // ==========================================

    if (/^\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/.test(commandText)) {
        return {
            command: text,
            systemId: null,
            secret
        };
    }

    // ==========================================
    // D66等
    // ==========================================

    if (/^D66(?:\s|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: null,
            secret
        };
    }

    // ==========================================
    // Choice系
    // ==========================================

    if (/^choice(?:\s|$)/i.test(commandText)) {
        return {
            command: text,
            systemId: null,
            secret
        };
    }

    return null;
}

module.exports = {
    normalizeCommand,
    detectDiceCommand
};