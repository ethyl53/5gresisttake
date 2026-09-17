// ==========================================
// Sasaとの基本ダイス競合回避設定
// ==========================================
//
// true  : xdx / sxdx を先頭とする基本ダイス式を
//         BCDiceで処理しない
//
// false : 基本ダイスも従来どおりBCDiceで処理する
//
// Sasaを削除した後などは false に変更するだけで
// この機能を無効化できます。
// ==========================================
const IGNORE_BASIC_DICE = true;


// ==========================================
// コマンド文字列の正規化
// ==========================================
function normalizeCommand(content) {
    if (!content) return '';

    return content
        .trim()
        .replace(/[^\S\r\n]+/g, ' ');
}


// ==========================================
// Sasaとの競合対象となる基本ダイス判定
// ==========================================
//
// 対象:
//
// 通常:
//   1d100
//   3d6
//   2D20
//   1d100+5
//   2d6-1
//   1d100<=50
//
// シークレット:
//   s1d100
//   s3d6
//   S2D20
//   s1d100+5
//   s3d6>=4
//
// 「先頭が xdx / sxdx である一般ダイス式」を
// 対象とする。
// ==========================================
function isBasicDiceCommand(str) {
    if (!str) return false;

    const text = str.trim();

    // ------------------------------------------
    // 通常ダイス
    // ------------------------------------------
    //
    // 例:
    //   1d100
    //   3d6
    //   1d100+5
    //   2d6-1
    //   1d100<=50
    //
    // xdx の直後は、
    //   空白
    //   + - * / < >
    //   =
    // のいずれかであることを要求する。
    //
    // これにより、
    //   1d100
    //   1d100+5
    //   1d100<=50
    // などをまとめて対象にする。
    //
    if (/^\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/.test(text)) {
        return true;
    }

    // ------------------------------------------
    // シークレットダイス
    // ------------------------------------------
    //
    // 例:
    //   s1d100
    //   s3d6
    //   s1d100+5
    //   s3d6>=4
    //
    if (/^s\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/i.test(text)) {
        return true;
    }

    return false;
}


// ==========================================
// 先頭の s/S がシークレット指定フラグかどうか判定
// ==========================================
//
// SGコマンド（SG, 2*SG, SG@6 など）の S を
// シークレット指定として誤判定しないよう制御
// ==========================================
function isSecretPrefix(str) {
    if (!/^s/i.test(str)) return false;

    // 「SG」自体をシークレット指定として扱わない
    //
    // 例:
    //   SG      -> false
    //   2*SG    -> false
    //
    // 一方、
    //   sSG     -> true
    //   s2*SG   -> true
    //
    if (
        /^\d\*SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(str) &&
        !/^s/i.test(
            str.replace(/^\d\*/, '').slice(1)
        )
    ) {
        return false;
    }

    return true;
}


// ==========================================
// 通常メッセージを自動ロール対象として扱うか判定
// ==========================================
//
// 対応形式:
//
// - 通常ダイス
//     K30[7]$+2
//     2D6
//     SG
//
// - シークレットダイス
//     sK30[7]$+2
//     s2D6
//     sSG
//
// - 繰り返しダイス
//     x3 K30[7]$+2
//     rep5 2D6
//     x3 SG
//
// - シークレット＋繰り返し
//     sx3 K30
//     x3 sSG
//
// @param {string} content
// @returns {{ command: string, systemId: string|null, secret: boolean } | null}
// ==========================================
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
    // Sasaとの競合回避
    // ==========================================
    //
    // プレフィックス解析より前に判定する。
    //
    // これにより、
    //   1d100
    //   1d100+5
    //   1d100<=50
    //   s1d100
    //   s1d100+5
    // などをそのまま無視できる。
    //
    // IGNORE_BASIC_DICE = false にすれば
    // この機能を無効化できる。
    // ==========================================
    if (IGNORE_BASIC_DICE && isBasicDiceCommand(text)) {
        return null;
    }

    // ==========================================
    // プレフィックス解析
    // （シークレット & 繰り返し）
    // ==========================================
    let checkText = text;
    let secret = false;

    // ------------------------------------------
    // 先頭のシークレット判定
    // 例:
    //   sK30
    //   sSG
    // ------------------------------------------
    if (isSecretPrefix(checkText)) {
        secret = true;
        checkText = checkText.slice(1);
    }

    // ------------------------------------------
    // 繰り返し判定
    // 例:
    //   rep3 K20
    //   x3 K20
    //   repeat3 K20
    //
    // 末尾の空白を必須とする
    // ------------------------------------------
    const repeatMatch = checkText.match(
        /^(?:rep|x|repeat)\d+\s+/i
    );

    if (repeatMatch) {
        checkText = checkText.slice(repeatMatch[0].length);
    }

    // ------------------------------------------
    // 繰り返し指定の後ろのシークレット判定
    // 例:
    //   x3 sK30
    //   x3 sSG
    // ------------------------------------------
    if (!secret && isSecretPrefix(checkText)) {
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
    if (
        /^\d\*SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(
            commandText
        )
    ) {
        return {
            command: text,
            systemId: 'ShinobiGami',
            secret
        };
    }

    // ==========================================
    // SW2.5
    // ==========================================
    if (
        /^K(?:R)?\d+(?:\s|[+\-*@#$[\]]|$)/i.test(
            commandText
        )
    ) {
        return {
            command: text,
            systemId: 'SwordWorld2.5',
            secret
        };
    }

    // ==========================================
    // 一般的なダイス
    // ==========================================
    //
    // IGNORE_BASIC_DICE = true の場合、
    // 単純な xdx / sxdx を先頭とする式は
    // この位置に来る前に除外されている。
    //
    // IGNORE_BASIC_DICE = false の場合は、
    // 従来どおりここからBCDiceへ渡す。
    // ==========================================
    if (
        /^\d+[dD]\d+(?:\s|[+\-*/<>=]|$)/.test(
            commandText
        )
    ) {
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
    isBasicDiceCommand,
    detectDiceCommand
};