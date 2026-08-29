function normalizeCommand(content) {
    if (!content) return '';

    return content
        .trim()
        .replace(/\s+/g, ' ');
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

    const text = normalizeCommand(content);

    if (!text) {
        return null;
    }

    // 複数行メッセージは対象外
    if (text.includes('\n')) {
        return null;
    }

    // ==========================================
    // シークレット指定
    // ==========================================

    const secret =
        /^s/i.test(text);

    const commandText =
        secret ? text.slice(1) : text;

    if (!commandText) {
        return null;
    }

    // ==========================================
    // クトゥルフ
    // ==========================================

    if (/^CCB(?:<=|>=|=|<|>|\s|$)/i.test(commandText)) {
        return {
            command: commandText,
            systemId: 'Cthulhu',
            secret
        };
    }

    if (/^CC(?:\s|<=|>=|<|>|$)/i.test(commandText)) {
        return {
            command: commandText,
            systemId: 'Cthulhu',
            secret
        };
    }

    // ==========================================
    // シノビガミ
    // ==========================================

    if (/^\d+SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(commandText)) {
        return {
            command: commandText,
            systemId: 'ShinobiGami',
            secret
        };
    }

    // ==========================================
    // SW2.5
    // ==========================================

    if (/^K(?:R)?\d+(?:\s|[+-]|$)/i.test(commandText)) {
        return {
            command: commandText,
            systemId: 'SwordWorld2.5',
            secret
        };
    }

    // ==========================================
    // 一般的なダイス
    // ==========================================

    if (/^\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/.test(commandText)) {
        return {
            command: commandText,
            systemId: null,
            secret
        };
    }

    // ==========================================
    // D66等
    // ==========================================

    if (/^D66(?:\s|$)/i.test(commandText)) {
        return {
            command: commandText,
            systemId: null,
            secret
        };
    }

    // ==========================================
    // Choice系
    // ==========================================

    if (/^choice(?:\s|$)/i.test(commandText)) {
        return {
            command: commandText,
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