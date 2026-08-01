'use strict';

const {
    AttachmentBuilder,
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

const db = require('../database/db');
const {
    getPlanComparison
} = require('../services/planComparisonService');
const {
    formatJstDateTime
} = require('../services/logicalDayService');
const {
    format
} = require('../utils/activityRead');
const {
    generatePlanComparisonBuffer
} = require('../utils/generatePlanComparisonBuffer');

function achievementRateText(comparison) {
    if (comparison.plannedTotal === 0) {
        return comparison.actualTotal === 0 ? '—' : '計画なし';
    }

    return `${(comparison.achievementRate * 100).toFixed(1)}%`;
}

function subjectComparisonText(items) {
    if (!items.length) return '記録はありません';
    return items.map((item) => {
        const rate = item.planned > 0
            ? `${(item.achievementRate * 100).toFixed(1)}%`
            : (item.actual > 0 ? '計画なし' : '—');
        const difference = `${item.difference >= 0 ? '+' : '−'}${format(Math.abs(item.difference))}`;
        return `${item.name}　予定 ${format(item.planned)} / 実績 ${format(item.actual)} / ${rate} / ${difference}`;
    }).join('\n');
}

function addLongFields(embed, name, value) {
    const chunks = [];
    let current = '';

    for (const line of value.split('\n')) {
        if ((current.length + line.length + 1) > 1000 && current) {
            chunks.push(current);
            current = line;
        } else {
            current = current ? `${current}\n${line}` : line;
        }
    }
    if (current) chunks.push(current);

    chunks.forEach((chunk, index) => {
        embed.addFields({
            name: index ? `${name}（続き）` : name,
            value: chunk,
            inline: false
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plan-report')
        .setDMPermission(false)
        .setDescription('予定と実績を比較します')
        .addStringOption((option) => option
            .setName('date')
            .setDescription('日付（例: 7-18 または 2026-7-18）')),

    async execute(interaction) {
        await interaction.deferReply();

        if (!interaction.guildId) {
            await interaction.editReply('このコマンドはサーバー内でのみ利用できます。');
            return;
        }

        try {
            const comparison = await getPlanComparison(db, {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                dateText: interaction.options.getString('date')
            });
            const classification = comparison.classification;
            const embed = new EmbedBuilder()
                .setTitle('予定・実績比較')
                .setColor(0x00BFFF)
                .setDescription(
                    `${formatJstDateTime(comparison.range.start, { includeYear: true })} ～ 翌日02:00`
                )
                .addFields(
                    { name: '予定合計', value: format(comparison.plannedTotal), inline: true },
                    { name: '実績合計', value: format(comparison.actualTotal), inline: true },
                    {
                        name: '差分',
                        value: `${comparison.difference >= 0 ? '+' : '−'}${format(Math.abs(comparison.difference))}`,
                        inline: true
                    },
                    { name: '達成率', value: achievementRateText(comparison), inline: true },
                    {
                        name: '一致',
                        value: format(classification.matched),
                        inline: true
                    },
                    {
                        name: '科目不一致',
                        value: format(classification.subjectMismatch),
                        inline: true
                    },
                    {
                        name: '予定外の実績',
                        value: format(classification.unplannedActual),
                        inline: true
                    },
                    {
                        name: '未達の予定',
                        value: format(classification.unfulfilledPlan),
                        inline: true
                    }
                )
                .setTimestamp();
            addLongFields(embed, '科目別比較', subjectComparisonText(comparison.subjects));

            const attachment = new AttachmentBuilder(
                generatePlanComparisonBuffer(comparison),
                { name: 'plan-report.png' }
            );
            embed.setImage('attachment://plan-report.png');
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            console.error('[Plan Report Command Error]', error);
            await interaction.editReply(
                error.message.startsWith('日付') || error.message.startsWith('存在しない')
                    ? error.message
                    : '予定・実績比較の作成に失敗しました。'
            );
        }
    }
};
