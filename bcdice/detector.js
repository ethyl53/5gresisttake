// ==========================================
// Sasaとの基本ダイス競合回避設定
// ==========================================
//
// true  : xdx / sxdx の基本ダイス、および
//         算術演算を伴う基本ダイスをBCDiceで処理しない
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
//   1d100
//   3d6
//   2D20
//   1d100+5
//   2d6-1
//   1d100*2
//   1d100/2
//
// シークレット:
//
//   s1d100
//   s3d6
//   S2D20
//   s1d100+5
//
// 一方、判定・比較を行う式は除外しない:
//
//   1d100<=50
//   1d100>=50
//   1d20=10
//   1d20<10
//   1d20>10
//
// ==========================================
function isBasicDiceCommand(str) {
    if (!str) return false;

    const text = str.trim();

    // ------------------------------------------
    // 通常ダイス
    // ------------------------------------------
    //
    // xdx の直後が
    //   + - * /
    // のいずれか、または文字列終端の場合に対象。
    //
    // 比較演算子
    //   <= >= < > =
    // は対象外。
    //
    if (/^\d+[dD]\d+(?:[+\-*/].*|$)/.test(text)) {
        return true;
    }

    // ------------------------------------------
    // シークレットダイス
    // ------------------------------------------
    if (/^s\d+[dD]\d+(?:[+\-*/].*|$)/i.test(text)) {
        return true;
    }

    return false;
}


/**
 * 先頭の s/S がシークレット指定フラグかどうか判定する関数
 *
 * シノビガミの通常コマンド:
 *   SG
 *   2SG
 *   3SG
 *   SG@6
 *   3SG>=5
 *
 * については、先頭の S をシークレット指定と誤判定しない。
 *
 * 一方、
 *   sSG
 *   s2SG
 *   s3SG>=5
 *
 * はシークレット指定として扱う。
 */
function isSecretPrefix(str) {
    if (!/^s/i.test(str)) return false;

    // ==========================================
    // シノビガミの通常コマンドを除外
    // ==========================================
    //
    // SG
    // 2SG
    // 3SG
    // SG@6
    // 3SG>=5
    //
    // などは先頭の S がコマンド名そのもの。
    // したがってシークレット指定とはみなさない。
    //
    if (
        /^(?:\d+)?SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(str)
    ) {
        return false;
    }

    // ==========================================
    // それ以外で先頭がSなら
    // シークレット指定として扱う
    // ==========================================
    return true;
}


/**
 * 通常メッセージを自動ロール対象として扱うか判定
 *
 * 対応形式:
 * - 通常ダイス (例: K30[7]$+2, 2D6, SG)
 * - シークレットダイス (例: sK30[7]$+2, s2D6, sSG)
 * - 繰り返しダイス (例: x3 K30[7]$+2, rep5 2D6, x3 SG)
 * - シークレット＋繰り返し (例: sx3 K30, x3 sSG)
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
    // Sasaとの競合回避
    // ==========================================
    //
    // プレフィックス解析より前に判定する。
    //
    // これにより:
    //
    //   1d100
    //   1d100+5
    //   2d6-1
    //   1d100*2
    //   1d100/2
    //   s1d100
    //   s1d100+5
    //
    // はそのまま無視される。
    //
    // 一方:
    //
    //   1d100<=50
    //   1d100>=50
    //   1d20=10
    //   1d20<10
    //   1d20>10
    //
    // はBCDice側で処理される。
    // ==========================================
    if (IGNORE_BASIC_DICE && isBasicDiceCommand(text)) {
        return null;
    }

    // ==========================================
    // プレフィックス解析（シークレット & 繰り返し）
    // ==========================================
    let checkText = text;
    let secret = false;

    // ------------------------------------------
    // 先頭のシークレット判定
    // 例:
    //   sK30
    //   sSG
    //   s3SG
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
    // 繰り返し後ろのシークレット判定
    // 例:
    //   x3 sK30
    //   x3 sSG
    //   x3 s3SG
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
        /^(?:\d+)?SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(
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
    // 単純な xdx / sxdx や算術演算を伴う
    // 基本ダイス式は上で除外されている。
    //
    // 比較演算子を含むものは上で除外されないため、
    // ここからBCDiceへ渡される。
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