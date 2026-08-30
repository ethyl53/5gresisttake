function calcSwordWorld(command) {
    // 例: "K20+3@10"
    const match = command.match(/K(\d+)(?:\+(\d+))?(?:@(\d+))?/);
    if (!match) throw new Error('SW2.5のコマンド形式（K威力+修正値@C値）として認識できません。');

    const power = parseInt(match[1], 10);
    const modifier = parseInt(match[2], 10) || 0;
    const critValue = parseInt(match[3], 10) || 10;

    if (critValue < 3) throw new Error('クリティカル値は3以上である必要があります。');

    // 実際の期待値計算にはBCDiceの威力レーティング表（0〜100の配列データ）を
    // JSON等の形式でローカルに保持し、参照する処理が必要になります。
    
    return {
        text: `**威力:** ${power} / **修正値:** +${modifier} / **C値:** ${critValue}\n` +
              `\n*※SW2.5の正確な期待値算出には威力表データの内部実装が必要です。*`
    };
}

module.exports = { calcSwordWorld };