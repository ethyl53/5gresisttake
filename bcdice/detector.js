function looksLikeDiceCommand(content) {
    if (!content) return false;

    const text = content.trim();

    if (!text) return false;

    // 改行を含む通常文章は自動ロールしない
    if (text.includes('\n')) {
        return false;
    }

    // 明らかな文章を除外するため、
    // ダイスコマンドとして使われやすい記号・形式を確認する。
    //
    // 最終的な判定はBCDice API側に任せる。
    //
    // ここでは「APIへ送る価値があるか」の軽いフィルタだけを行う。

    const patterns = [
        /^\d+[dD]\d+/,
        /^CC(?:B|F)?(?:[<>]=?\d+)?/i,
        /^SG(?:[+-]\d+)?(?:>=\d+)?/i,
        /^K\d+/i,
        /^KR\d+/i,
        /^2D\d+/i,
        /^D66/i,
        /^choice(?:\[|\(|\s)/i,
        /^c[0-9]/i,
        /^x\d+\s+/i,
        /^rep\d+\s+/i,
        /^repeat\d+\s+/i
    ];

    return patterns.some(pattern => pattern.test(text));
}

module.exports = {
    looksLikeDiceCommand
};