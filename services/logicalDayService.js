'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function asDate(value, name = 'date') {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`${name} must be a valid Date`);
    }

    return date;
}

function getJstParts(date = new Date()) {
    const jst = new Date(asDate(date).getTime() + JST_OFFSET_MS);
    return {
        year: jst.getUTCFullYear(),
        month: jst.getUTCMonth() + 1,
        day: jst.getUTCDate(),
        hour: jst.getUTCHours(),
        minute: jst.getUTCMinutes()
    };
}

function buildJstDateTime(year, month, day, hour = 0, minute = 0) {
    const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
    const check = getJstParts(date);

    if (
        check.year !== year ||
        check.month !== month ||
        check.day !== day ||
        check.hour !== hour ||
        check.minute !== minute
    ) {
        throw new Error('存在しない日付です。');
    }

    return date;
}

function parseDateOption(dateText, now = new Date()) {
    if (dateText === null || dateText === undefined || String(dateText).trim() === '') {
        return {
            wasProvided: false,
            hadExplicitYear: false,
            ...getJstParts(now)
        };
    }

    const raw = String(dateText).trim();
    const match = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(raw);

    if (!match) {
        throw new Error('日付は 7-18 または 2026-7-18 の形式で入力してください。');
    }

    const current = getJstParts(now);
    const year = match[1] ? Number(match[1]) : current.year;
    const month = Number(match[2]);
    const day = Number(match[3]);
    buildJstDateTime(year, month, day);

    return {
        year,
        month,
        day,
        wasProvided: true,
        hadExplicitYear: Boolean(match[1])
    };
}

function parseTimeOption(timeText) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || '').trim());

    if (!match) {
        throw new Error('時刻は 15:30 の形式で入力してください。');
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour > 23 || minute > 59) {
        throw new Error('時刻を確認してください。');
    }

    return { hour, minute };
}

function buildRangeFromOptions({ dateText, startText, endText, now = new Date() }) {
    const date = parseDateOption(dateText, now);
    const startTime = parseTimeOption(startText);
    const endTime = parseTimeOption(endText);
    const startAt = buildJstDateTime(
        date.year, date.month, date.day, startTime.hour, startTime.minute
    );
    let endAt = buildJstDateTime(
        date.year, date.month, date.day, endTime.hour, endTime.minute
    );

    if (endAt < startAt) {
        endAt = new Date(endAt.getTime() + DAY_MS);
    }
    if (endAt.getTime() === startAt.getTime()) {
        throw new Error('開始時刻と終了時刻は同じにできません。');
    }
    if (endAt.getTime() - startAt.getTime() < 60_000) {
        throw new Error('1分未満の記録は保存できません。');
    }

    return { date, startAt, endAt };
}

function getLogicalDayStart(now = new Date()) {
    const parts = getJstParts(now);
    const date = new Date(asDate(now).getTime() + JST_OFFSET_MS);
    if (parts.hour < 2) {
        date.setUTCDate(date.getUTCDate() - 1);
    }
    return buildJstDateTime(
        date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 2, 0
    );
}

function logicalDayRange(dateText = null, now = new Date()) {
    if (dateText === null || dateText === undefined || String(dateText).trim() === '') {
        const start = getLogicalDayStart(now);
        return { start, end: new Date(start.getTime() + DAY_MS), date: null };
    }
    const date = parseDateOption(dateText, now);
    const start = buildJstDateTime(date.year, date.month, date.day, 2, 0);
    return { start, end: new Date(start.getTime() + DAY_MS), date };
}

function formatJstDateTime(date, { includeYear = false, includeDate = true } = {}) {
    const parts = getJstParts(date);
    const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
    if (!includeDate) return time;
    return `${includeYear ? `${parts.year}年` : ''}${parts.month}月${parts.day}日 ${time}`;
}

function formatRangeForReply(range, { dateWasProvided = false, hadExplicitYear = false } = {}) {
    const startParts = getJstParts(range.startAt);
    const endParts = getJstParts(range.endAt);
    const sameDate = startParts.year === endParts.year &&
        startParts.month === endParts.month && startParts.day === endParts.day;

    if (!dateWasProvided && sameDate) {
        return `${formatJstDateTime(range.startAt, { includeDate: false })} ～ ${formatJstDateTime(range.endAt, { includeDate: false })}`;
    }

    return `${formatJstDateTime(range.startAt, { includeYear: hadExplicitYear })} ～ ${formatJstDateTime(range.endAt, { includeYear: hadExplicitYear || startParts.year !== endParts.year })}`;
}

module.exports = {
    DAY_MS,
    JST_OFFSET_MS,
    buildJstDateTime,
    buildRangeFromOptions,
    formatJstDateTime,
    formatRangeForReply,
    getJstParts,
    getLogicalDayStart,
    logicalDayRange,
    parseDateOption,
    parseTimeOption
};
