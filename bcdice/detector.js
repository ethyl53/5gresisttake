function normalizeCommand(content) {
    if (!content) return '';

    return content
        .trim()
        .replace(/[^\S\r\n]+/g, ' ');
}

/**
 * 通常メッセージを自動ロール対象として扱うか判定
 *
 * 対応形式:
 * - 通常ダイス (例: K30[7]$+2, 2D6)
 * - シークレットダイス (例: sK30[7]$+2, s2D6)
 * - 繰り返しダイス (例: x3 K30[7]$+2, rep5 2D6)
 * - シークレット＋繰り返し (例: sx3 K30, x3 sK30)
 *
 * @param {string} content
 * @returns {{ command: string, systemId: string|null, secret: boolean } | null}
 */
function detectDiceCommand(content) {
    if (!content) {
        return null;
    }

    // 複数行メッセージは対象外
    if (content.includes('\n')) {
        return null;
    }

    const text = normalizeCommand(content);

    if (!text) {
        return null;
    }

    // ==========================================
    // プレフィックス解析（シークレット & 繰り返し）
    // ==========================================

    let checkText = text;
    let secret = false;

    // 先頭のシークレット判定 (例: sK30, sx3 K30)
    if (/^s/i.test(checkText)) {
        secret = true;
        checkText = checkText.slice(1);
    }

    // 繰り返し判定 (例: x3 , rep5 , repeat3 ) ※末尾の空白必須
    const repeatMatch = checkText.match(/^(?:rep|x|repeat)\d+\s+/i);
    if (repeatMatch) {
        checkText = checkText.slice(repeatMatch[0].length);
    }

    // 繰り返し後ろのシークレット判定 (例: x3 sK30)
    if (!secret && /^s/i.test(checkText)) {
        secret = true;
        checkText = checkText.slice(1);
    }

    // システム判定用コマンドテキスト
    const commandText = checkText;

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

    if (/^\d*SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(commandText)) {
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