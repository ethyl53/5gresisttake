'use strict';

// ==========================================
// Sasaとの基本ダイス競合回避設定
// ==========================================
//
// true  : xdx / sxdx の基本ダイス、および
//         算術演算を伴う基本ダイスをBCDiceで処理しない
//
// false : 基本ダイスも従来どおりBCDiceで処理する
//
const IGNORE_BASIC_DICE = false;


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
function isBasicDiceCommand(str) {
    if (!str) return false;

    const text = str.trim();

    // 通常ダイスと算術演算
    if (/^\d+[dD]\d+(?:[+\-*/].*|$)/.test(text)) {
        return true;
    }

    // シークレットダイスと算術演算
    if (/^s\d+[dD]\d+(?:[+\-*/].*|$)/i.test(text)) {
        return true;
    }

    // D66 / D66N / D66S / D66A
    if (/^s?D66[NSA]?(?:\s|$)/i.test(text)) {
        return true;
    }

    return false;
}


// ==========================================
// 先頭の s/S がシークレット指定か判定
// ==========================================
function isSecretPrefix(str) {
    if (!/^s/i.test(str)) return false;

    // シノビガミの通常コマンドを除外
    if (
        /^(?:\d+)?SG(?:\s|@|#|>=|<=|>|<|=|[+-]|\d|$)/i.test(str)
    ) {
        return false;
    }

    return true;
}


// ==========================================
// 通常メッセージを自動ロール対象として扱うか判定
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
    if (IGNORE_BASIC_DICE && isBasicDiceCommand(text)) {
        return null;
    }

    // ==========================================
    // プレフィックス解析
    // ==========================================
    let checkText = text;

    // シークレット指定の有無
    let secret = false;

    // 先頭のシークレット指定
    if (isSecretPrefix(checkText)) {
        secret = true;
        checkText = checkText.slice(1);
    }

    // ==========================================
    // 繰り返しコマンドのプレフィックス
    // ==========================================
    //
    // rep2 CCB<=5
    // x2 CCB<=5
    // repeat2 CCB<=5
    //
    // APIに渡す command は元の text のまま。
    // ここではシステム判定のためだけに除去する。
    //
    const repeatMatch = checkText.match(
        /^(?:rep|repeat|x)[1-9]\d*\s+/i
    );

    if (repeatMatch) {
        checkText = checkText.slice(repeatMatch[0].length);
    }

    // 繰り返し指定の後ろにあるシークレット指定
    //
    // x2 sCCB<=5
    // rep2 sSG
    //
    if (!secret && isSecretPrefix(checkText)) {
        secret = true;
        checkText = checkText.slice(1);
    }

    // システム判定用コマンド
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
    // D66
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
    if (/^choice(?:\d+)?(?:\[|\(|\s)/i.test(commandText)) {
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