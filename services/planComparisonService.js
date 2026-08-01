'use strict';

const {
    getPlannedIntervalsForRange
} = require('../database/plannedIntervalService');
const {
    scopedIntervals,
    subject
} = require('../utils/activityRead');
const {
    logicalDayRange
} = require('./logicalDayService');

function clipIntervals(rows, startAt, endAt) {
    const startMs = startAt.getTime();
    const endMs = endAt.getTime();

    return rows.map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        categoryKey: subject(row.category_key).key,
        subjectName: subject(row.category_key).name,
        colorHex: subject(row.category_key).colorHex,
        taskName: row.task_name || null,
        originalStartAt: new Date(row.start_at || row.startMs).getTime(),
        originalEndAt: new Date(row.end_at || row.endMs).getTime(),
        startAt: Math.max(startMs, Number(row.startMs ?? new Date(row.start_at).getTime())),
        endAt: Math.min(endMs, Number(row.endMs ?? new Date(row.end_at).getTime()))
    })).filter((row) => row.endAt > row.startAt);
}

function totalDuration(intervals) {
    return intervals.reduce(
        (total, interval) => total + interval.endAt - interval.startAt,
        0
    );
}

function subjectDurations(intervals) {
    const values = new Map();

    for (const interval of intervals) {
        const duration = interval.endAt - interval.startAt;
        values.set(
            interval.subjectName,
            (values.get(interval.subjectName) || 0) + duration
        );
    }

    return [...values.entries()]
        .filter(([, duration]) => duration >= 60_000)
        .sort((left, right) => right[1] - left[1])
        .map(([name, duration]) => ({ name, duration }));
}

function subjectComparison(planned, actual) {
    const values = new Map();
    const add = (intervals, key) => {
        for (const interval of intervals) {
            const current = values.get(interval.subjectName) || {
                name: interval.subjectName,
                planned: 0,
                actual: 0
            };
            current[key] += interval.endAt - interval.startAt;
            values.set(interval.subjectName, current);
        }
    };
    add(planned, 'planned');
    add(actual, 'actual');

    return [...values.values()]
        .filter((item) => Math.max(item.planned, item.actual) >= 60_000)
        .map((item) => ({
            ...item,
            difference: item.actual - item.planned,
            achievementRate: item.planned > 0 ? item.actual / item.planned : null
        }))
        .sort((left, right) => (right.planned + right.actual) - (left.planned + left.actual));
}

function at(intervals, time) {
    return intervals.find(
        (interval) => interval.startAt <= time && interval.endAt > time
    ) || null;
}

function compareIntervals(planned, actual, startAt, endAt) {
    const boundaries = new Set([startAt.getTime(), endAt.getTime()]);
    for (const interval of [...planned, ...actual]) {
        boundaries.add(interval.startAt);
        boundaries.add(interval.endAt);
    }
    const sorted = [...boundaries].sort((left, right) => left - right);
    const summary = {
        matched: 0,
        subjectMismatch: 0,
        unplannedActual: 0,
        unfulfilledPlan: 0
    };

    for (let index = 0; index < sorted.length - 1; index += 1) {
        const start = sorted[index];
        const end = sorted[index + 1];
        if (end <= start) continue;
        const plan = at(planned, start);
        const actualInterval = at(actual, start);
        const duration = end - start;

        if (plan && actualInterval) {
            if (plan.categoryKey === actualInterval.categoryKey) {
                summary.matched += duration;
            } else {
                summary.subjectMismatch += duration;
            }
        } else if (plan) {
            summary.unfulfilledPlan += duration;
        } else if (actualInterval) {
            summary.unplannedActual += duration;
        }
    }

    return summary;
}

async function getPlanComparison(db, {
    guildId,
    userId,
    dateText = null,
    now = new Date()
}) {
    const range = logicalDayRange(dateText, now);
    const [planRows, actualRows] = await Promise.all([
        getPlannedIntervalsForRange(db, {
            guildId,
            userId,
            startAt: range.start,
            endAt: range.end
        }),
        scopedIntervals(db, guildId, userId, range.start, range.end)
    ]);
    const planned = clipIntervals(planRows, range.start, range.end);
    const actual = clipIntervals(actualRows, range.start, range.end);
    const plannedTotal = totalDuration(planned);
    const actualTotal = totalDuration(actual);

    return {
        range,
        planned,
        actual,
        plannedTotal,
        actualTotal,
        difference: actualTotal - plannedTotal,
        achievementRate: plannedTotal > 0 ? actualTotal / plannedTotal : null,
        classification: compareIntervals(planned, actual, range.start, range.end),
        plannedSubjects: subjectDurations(planned),
        actualSubjects: subjectDurations(actual),
        subjects: subjectComparison(planned, actual)
    };
}

module.exports = {
    clipIntervals,
    compareIntervals,
    getPlanComparison,
    subjectComparison,
    subjectDurations,
    totalDuration
};
