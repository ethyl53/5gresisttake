// 2D6の出目（2〜12）ごとの確率分布 (確率 = パターン数 / 36)
const D66_PROBABILITIES = {
    2: 1/36, 3: 2/36, 4: 3/36, 5: 4/36, 6: 5/36, 7: 6/36,
    8: 5/36, 9: 4/36, 10: 3/36, 11: 2/36, 12: 1/36
};

function calcShinobigami(command) {
    // 例: "SG@5" などの目標値抽出
    const match = command.match(/SG(?:@(\d+))?/);
    if (!match) throw new Error('シノビガミのコマンド形式（SG@目標値）として認識できません。');

    const target = parseInt(match[1], 10) || 5; // デフォルト目標値5
    let successRate = 0;
    let fumbleRate = D66_PROBABILITIES[2]; // ファンブル（2）は固定で失敗扱いの場合が多い
    let specialRate = D66_PROBABILITIES[12]; // スペシャル（12）

    for (let dice = target; dice <= 12; dice++) {
        successRate += D66_PROBABILITIES[dice] || 0;
    }

    // 忍具（振り直し）や神丹（回復による行動回数増加）の期待値計算を
    // この下に数式として追加していく基盤となります。
    
    return {
        text: `**目標値:** ${target}\n` +
              `**成功確率:** ${(successRate * 100).toFixed(2)}%\n` +
              `**スペシャル率:** ${(specialRate * 100).toFixed(2)}%\n` +
              `**ファンブル率:** ${(fumbleRate * 100).toFixed(2)}%\n` +
              `\n*※忍具や神丹による行動回数の期待値変動は今後のアップデートで追加可能です。*`
    };
}

module.exports = { calcShinobigami };