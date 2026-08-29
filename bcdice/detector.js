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
 * 例:
 *
 * 2d6
 * 2d6 +2
 * CCB<=25 目星
 * SG
 * K20+5
 *
 * は対象。
 *
 * 2d6めめめ
 * めめめ2d6
 *
 * は対象外。
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
    // クトゥルフ
    // ==========================================

    if (/^CCB(?:\s|$)/i.test(text)) {
        return {
            command: text,
            systemId: 'Cthulhu'
        };
    }

    if (/^CC(?:\s|<=|>=|<|>|$)/i.test(text)) {
        return {
            command: text,
            systemId: 'Cthulhu'
        };
    }

    // ==========================================
    // シノビガミ
    // ==========================================

    if (/^SG(?:\s|[+-]|\d|$)/i.test(text)) {
        return {
            command: text,
            systemId: 'ShinobiGami'
        };
    }

    // ==========================================
    // SW2.5
    // ==========================================

    if (/^K(?:R)?\d+(?:\s|[+-]|$)/i.test(text)) {
        return {
            command: text,
            systemId: 'SwordWorld2_5'
        };
    }

    // ==========================================
    // 一般的なダイス
    // ==========================================

    if (/^\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/.test(text)) {
        return {
            command: text,
            systemId: null
        };
    }

    // ==========================================
    // D66等
    // ==========================================

    if (/^D66(?:\s|$)/i.test(text)) {
        return {
            command: text,
            systemId: null
        };
    }

    // ==========================================
    // Choice系
    // ==========================================

    if (/^choice(?:\s|$)/i.test(text)) {
        return {
            command: text,
            systemId: null
        };
    }

    return null;
}

module.exports = {
    normalizeCommand,
    detectDiceCommand
};