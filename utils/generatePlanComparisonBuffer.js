'use strict';

const { createCanvas } = require('canvas');
const {
    getJstParts
} = require('../services/logicalDayService');

function formatHour(time) {
    const parts = getJstParts(new Date(time));
    return `${String(parts.hour).padStart(2, '0')}:00`;
}

function drawPanel(ctx, {
    x,
    y,
    width,
    height,
    title,
    emptyLabel,
    intervals,
    startAt,
    endAt
}) {
    const axisWidth = 54;
    const contentX = x + axisWidth;
    const contentWidth = width - axisWidth - 12;
    const headerHeight = 28;
    const chartY = y + headerHeight;
    const chartHeight = height - headerHeight - 12;
    const total = endAt - startAt;

    ctx.fillStyle = '#36393f';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#4f545c';
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(title, x + 12, y + 19);

    for (let index = 0; index <= 24; index += 2) {
        const position = index / 24;
        const lineY = chartY + chartHeight * position;
        const hour = (2 + index) % 24;
        ctx.strokeStyle = '#4a4d54';
        ctx.beginPath();
        ctx.moveTo(contentX, lineY + 0.5);
        ctx.lineTo(contentX + contentWidth, lineY + 0.5);
        ctx.stroke();
        ctx.fillStyle = '#b5bac1';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${String(hour).padStart(2, '0')}:00`, contentX - 7, lineY + 4);
    }

    ctx.textAlign = 'left';
    if (!intervals.length) {
        ctx.fillStyle = '#b5bac1';
        ctx.font = '14px sans-serif';
        ctx.fillText(emptyLabel, contentX + 12, chartY + 28);
        return;
    }

    for (const interval of intervals) {
        const intervalStart = Math.max(startAt, interval.startAt);
        const intervalEnd = Math.min(endAt, interval.endAt);
        const top = chartY + ((intervalStart - startAt) / total) * chartHeight;
        const bottom = chartY + ((intervalEnd - startAt) / total) * chartHeight;
        const blockHeight = Math.max(2, bottom - top);
        ctx.fillStyle = interval.colorHex;
        ctx.fillRect(contentX + 4, top, contentWidth - 8, blockHeight);

        if (blockHeight >= 17) {
            ctx.fillStyle = interval.colorHex === '#FFFF00' ? '#202225' : '#ffffff';
            ctx.font = '12px sans-serif';
            const label = interval.taskName || interval.subjectName;
            ctx.fillText(label.slice(0, 24), contentX + 9, top + Math.min(blockHeight - 4, 13));
        }
    }
}

function generatePlanComparisonBuffer(comparison) {
    const width = 960;
    const height = 740;
    const padding = 24;
    const gap = 20;
    const panelWidth = (width - padding * 2 - gap) / 2;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const startAt = comparison.range.start.getTime();
    const endAt = comparison.range.end.getTime();
    const dayParts = getJstParts(comparison.range.start);

    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(
        `予定・実績比較 ${dayParts.year}年${dayParts.month}月${dayParts.day}日`,
        padding,
        30
    );
    ctx.fillStyle = '#b5bac1';
    ctx.font = '12px sans-serif';
    ctx.fillText(`表示範囲 ${formatHour(startAt)} ～ 翌日02:00`, padding, 51);

    drawPanel(ctx, {
        x: padding,
        y: 68,
        width: panelWidth,
        height: height - 92,
        title: '予定',
        emptyLabel: '予定なし',
        intervals: comparison.planned,
        startAt,
        endAt
    });
    drawPanel(ctx, {
        x: padding + panelWidth + gap,
        y: 68,
        width: panelWidth,
        height: height - 92,
        title: '実績',
        emptyLabel: '実績なし',
        intervals: comparison.actual,
        startAt,
        endAt
    });

    const buffer = canvas.toBuffer('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return buffer;
}

module.exports = {
    generatePlanComparisonBuffer
};
