'use strict';

// ==========================================
// CoCキャラシ制作（CST）の珍しさ計算
// ==========================================

// 3d6の合計値3～18に対応する出現組み合わせ数
const THREE_D6_COUNTS = [
    1, 3, 6, 10, 15, 21, 25, 27,
    27, 25, 21, 15, 10, 6, 3, 1
];

// 2d6の合計値2～12に対応する出現組み合わせ数
const TWO_D6_COUNTS = [
    1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1
];

// すべての確率の積と、その積を持つ組み合わせ数を集計する。
// Mapのキーは確率の分子に相当する整数の積。
// Mapの値は、その積を持つ能力値の組み合わせ数（BigInt）。
function buildRarityDistribution() {
    const distributions = [
        THREE_D6_COUNTS, // STR
        THREE_D6_COUNTS, // CON
        THREE_D6_COUNTS, // POW
        THREE_D6_COUNTS, // DEX
        THREE_D6_COUNTS, // APP
        TWO_D6_COUNTS,   // SIZ
        TWO_D6_COUNTS,   // INT
        THREE_D6_COUNTS  // EDU
    ];

    let dp = new Map([[1, 1n]]);

    for (const weights of distributions) {
        const next = new Map();

        for (const [product, count] of dp) {
            for (const weight of weights) {
                const nextProduct = product * weight;

                next.set(
                    nextProduct,
                    (next.get(nextProduct) ?? 0n) + count
                );
            }
        }

        dp = next;
    }

    // 計算漏れがないことを理論上の総確率で検証する。
    let totalMass = 0n;
    let totalOutcomes = 0n;

    for (const [product, count] of dp) {
        totalMass += BigInt(product) * count;
        totalOutcomes += count;
    }

    const expectedMass = 216n ** 6n * 36n ** 2n;
    const expectedOutcomes = 16n ** 6n * 11n ** 2n;

    if (
        totalMass !== expectedMass ||
        totalOutcomes !== expectedOutcomes
    ) {
        throw new Error(
            '[CST Rarity] 確率分布の検証に失敗しました。'
        );
    }

    return dp;
}

// Bot起動時に一度だけ分布を構築する。
const RARITY_DISTRIBUTION = buildRarityDistribution();

// 能力値から確率の分子に相当する整数を取得する。
function getStatWeight(stat) {
    if (stat.formula === '2d6+6') {
        return TWO_D6_COUNTS[stat.value - 8];
    }

    if (stat.formula === '3d6+3') {
        return THREE_D6_COUNTS[stat.value - 6];
    }

    if (stat.formula === '3d6') {
        return THREE_D6_COUNTS[stat.value - 3];
    }

    throw new Error(
        `[CST Rarity] 未対応の能力値形式: ${stat.formula}`
    );
}

// 百分率を、極端に小さい値でも0.00%にならないように整形する。
function formatPercent(percent) {
    const decimalPlaces = Math.min(
        20,
        Math.max(2, 1 - Math.floor(Math.log10(percent)))
    );

    return percent
        .toFixed(decimalPlaces)
        .replace(/\.?0+$/, '');
}

// 今回と同じか、それ以上に珍しい組み合わせの確率を返す。
// 戻り値は「百分率の文字列」。例: "0.5"
function getCocCharacterRarityPercent(stats) {
    let observedProduct = 1;

    for (const stat of stats) {
        const weight = getStatWeight(stat);

        if (
            !Number.isInteger(weight) ||
            weight < 1
        ) {
            throw new Error(
                '[CST Rarity] 能力値が不正です。'
            );
        }

        observedProduct *= weight;
    }

    // 出現確率が今回以下の組み合わせをすべて合計する。
    let rareMass = 0n;

    for (const [product, count] of RARITY_DISTRIBUTION) {
        if (product <= observedProduct) {
            rareMass += BigInt(product) * count;
        }
    }

    const totalMass = 216n ** 6n * 36n ** 2n;

    // BigIntのまま比較・集計し、最後の表示時だけ小数にする。
    const percent =
        Number(rareMass) / Number(totalMass) * 100;

    return formatPercent(percent);
}

module.exports = {
    getCocCharacterRarityPercent
};