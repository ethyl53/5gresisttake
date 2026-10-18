
'use strict';

// 3d6の合計値3～18に対応する出現組み合わせ数
const THREE_D6_COUNTS = [
    1, 3, 6, 10, 15, 21, 25, 27,
    27, 25, 21, 15, 10, 6, 3, 1
];

// 2d6の合計値2～12に対応する出現組み合わせ数
const TWO_D6_COUNTS = [
    1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1
];

// CSTの能力値生成方式
const STAT_DISTRIBUTIONS = [
    THREE_D6_COUNTS, // STR
    THREE_D6_COUNTS, // CON
    THREE_D6_COUNTS, // POW
    THREE_D6_COUNTS, // DEX
    THREE_D6_COUNTS, // APP
    TWO_D6_COUNTS,   // SIZ
    TWO_D6_COUNTS,   // INT
    THREE_D6_COUNTS  // EDU
];

// 各能力値の平均値
const STAT_MEANS = [
    10.5, 10.5, 10.5, 10.5, 10.5,
    13, 13, 13.5
];

// 各能力値の分散
// 3d6: 35/4 = 8.75
// 2d6: 35/6
const VARIANCE_3D6 = 35 / 4;
const VARIANCE_2D6 = 35 / 6;

const STAT_STANDARD_DEVIATIONS = [
    Math.sqrt(VARIANCE_3D6),
    Math.sqrt(VARIANCE_3D6),
    Math.sqrt(VARIANCE_3D6),
    Math.sqrt(VARIANCE_3D6),
    Math.sqrt(VARIANCE_3D6),
    Math.sqrt(VARIANCE_2D6),
    Math.sqrt(VARIANCE_2D6),
    Math.sqrt(VARIANCE_3D6)
];

// 各能力値の出現数から、確率の積ごとの分布を作る。
// 同じ積になる組み合わせはまとめて集計する。
function buildRarityDistribution() {
    let dp = new Map([[1, 1n]]);

    for (const weights of STAT_DISTRIBUTIONS) {
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
            '[CST] 珍しさの確率分布の検証に失敗しました。'
        );
    }

    return dp;
}

const RARITY_DISTRIBUTION = buildRarityDistribution();
const TOTAL_PROBABILITY_MASS = 216n ** 6n * 36n ** 2n;

// 能力値の形式と値から、その値が出る出目の組み合わせ数を取得
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
        `[CST] 未対応の能力値形式: ${stat.formula}`
    );
}

// 珍しさをパーセント表示用の文字列にする
function formatPercent(percent) {
    if (percent === 0) {
        return '0';
    }

    const decimalPlaces = Math.min(
        20,
        Math.max(2, 1 - Math.floor(Math.log10(percent)))
    );

    return percent
        .toFixed(decimalPlaces)
        .replace(/\.?0+$/, '');
}

// 珍しさ：今回と同じか、それ以上に珍しい組み合わせの確率
function getCocCharacterRarityPercent(stats) {
    if (!Array.isArray(stats) || stats.length !== 8) {
        throw new Error('[CST] 能力値は8個必要です。');
    }

    let observedProduct = 1;

    for (const stat of stats) {
        const weight = getStatWeight(stat);

        if (
            !Number.isInteger(weight) ||
            weight < 1
        ) {
            throw new Error('[CST] 能力値が不正です。');
        }

        observedProduct *= weight;
    }

    let rareMass = 0n;

    for (const [product, count] of RARITY_DISTRIBUTION) {
        if (product <= observedProduct) {
            rareMass += BigInt(product) * count;
        }
    }

    const percent =
        Number(rareMass) / Number(TOTAL_PROBABILITY_MASS) * 100;

    return formatPercent(percent);
}

// 総合偏差値相当：各能力値を標準化して統合する
function getCocCharacterOverallScore(stats) {
    if (!Array.isArray(stats) || stats.length !== 8) {
        throw new Error('[CST] 能力値は8個必要です。');
    }

    let zScoreSum = 0;

    for (let i = 0; i < stats.length; i++) {
        const stat = stats[i];

        if (!Number.isFinite(stat.value)) {
            throw new Error('[CST] 能力値が不正です。');
        }

        const expectedFormula =
            i === 5 || i === 6 ? '2d6+6' :
            i === 7 ? '3d6+3' :
            '3d6';

        if (stat.formula !== expectedFormula) {
            throw new Error(
                `[CST] ${stat.name}の能力値形式が想定と異なります。`
            );
        }

        const zScore =
            (stat.value - STAT_MEANS[i]) /
            STAT_STANDARD_DEVIATIONS[i];

        zScoreSum += zScore;
    }

    const overallScore =
        50 + 10 * zScoreSum / Math.sqrt(8);

    return overallScore.toFixed(1);
}

module.exports = {
    getCocCharacterRarityPercent,
    getCocCharacterOverallScore
};