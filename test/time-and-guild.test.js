'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getCurrentJstDayStart,
    jstCurrentWeekRange,
    jstRange,
    subject
} = require('../utils/activityRead');
const {
    getCurrentDateKey,
    getTimelineForDay
} = require('../database/timelineService');
const {
    replaceRange
} = require('../database/intervalService');
const {
    buildRangeFromOptions,
    logicalDayRange
} = require('../services/logicalDayService');
const {
    compareIntervals,
    subjectComparison
} = require('../services/planComparisonService');
const {
    generatePlanComparisonBuffer
} = require('../utils/generatePlanComparisonBuffer');

test('02:00 JST boundary consistently assigns 01:30 to the previous logical day', () => {
    const now = new Date('2026-07-20T16:30:00.000Z'); // 01:30 JST on 7/21
    const start = getCurrentJstDayStart(now);

    assert.equal(start.toISOString(), '2026-07-19T17:00:00.000Z');
    assert.equal(getCurrentDateKey(now), '2026-07-20');
    assert.equal(jstRange(1, now).start.toISOString(), start.toISOString());
});

test('week before Monday 02:00 starts on the preceding Monday', () => {
    const now = new Date('2026-07-19T16:30:00.000Z'); // Monday 01:30 JST
    const range = jstCurrentWeekRange(now);

    assert.equal(range.start.toISOString(), '2026-07-12T17:00:00.000Z');
});

test('only the six canonical subjects are exposed by the shared reader', () => {
    assert.deepEqual(subject('math'), {
        key: 'math',
        name: '数学',
        colorHex: '#0074FF'
    });
    assert.deepEqual(subject('purple'), {
        key: 'other',
        name: 'その他',
        colorHex: '#FF0000'
    });
});

test('timeline query always scopes records by guild and preserves original bounds', async () => {
    let queryArgs = null;
    const client = {
        async query(sql) {
            if (sql.includes('FROM record_scope_members AS members')) {
                return { rows: [{ id: 'scope-a', owner_user_id: 'user-1' }] };
            }
            if (sql.includes('FROM record_scope_members')) {
                return { rows: [{ guild_id: 'guild-A', user_id: 'user-1' }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    const fakeDb = {
        connect: async () => client,
        async query(_sql, args) {
            queryArgs = args;
            return {
                rows: [{
                    id: 'interval-a',
                    category_key: 'english',
                    task_name: 'reading',
                    start_at: '2026-07-19T16:30:00.000Z',
                    end_at: '2026-07-19T18:00:00.000Z'
                }]
            };
        }
    };

    const day = await getTimelineForDay(fakeDb, {
        guildId: 'guild-A',
        userId: 'user-1',
        dateKey: '2026-07-20',
        now: new Date('2026-07-20T18:00:00.000Z')
    });

    assert.equal(queryArgs[0], 'user-1');
    assert.deepEqual(queryArgs[1], ['guild-A']);
    assert.equal(day.intervals[0].isClipped, true);
    assert.equal(day.intervals[0].originalStartAt,
        new Date('2026-07-19T16:30:00.000Z').getTime());
});

test('range edits lock and mutate only the selected guild/user scope', async () => {
    const calls = [];
    const client = {
        async query(sql, args = []) {
            calls.push({ sql, args });
            if (sql.includes('FROM record_scope_members AS members')) {
                return { rowCount: 1, rows: [{ id: 'scope-a', owner_user_id: 'user-1' }] };
            }
            if (sql.includes('FROM record_scope_members')) {
                return { rowCount: 1, rows: [{ guild_id: 'guild-A', user_id: 'user-1' }] };
            }
            if (sql.includes('INSERT INTO activity_mutations')) {
                return { rowCount: 1, rows: [{ id: 'mutation-1' }] };
            }
            if (sql.includes('FROM activity_intervals') && sql.includes('FOR UPDATE')) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
    const fakeDb = { connect: async () => client };

    await replaceRange(fakeDb, {
        guildId: 'guild-A',
        userId: 'user-1',
        startAt: new Date('2026-07-18T01:00:00.000Z'),
        endAt: new Date('2026-07-18T02:00:00.000Z'),
        deleteOnly: true
    });

    const lock = calls.find(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    const mutation = calls.find(({ sql }) => sql.includes('INSERT INTO activity_mutations'));
    const intervals = calls.filter(({ sql }) => sql.includes('FROM activity_intervals'));

    assert.deepEqual(lock.args, ['record-member:guild-A:user-1']);
    const scopeLock = calls.find(({ args }) => args[0] === 'record-scope:scope-a');
    assert.deepEqual(mutation.args.slice(0, 2), ['guild-A', 'delete']);
    assert.ok(scopeLock);
    assert.ok(intervals.some(({ args }) => Array.isArray(args[1]) && args[1][0] === 'guild-A'));
});

test('plan dates use JST and a cross-midnight range ends the following day', () => {
    const range = buildRangeFromOptions({
        dateText: '7-18',
        startText: '23:00',
        endText: '01:00',
        now: new Date('2026-07-01T00:00:00.000Z')
    });

    assert.equal(range.startAt.toISOString(), '2026-07-18T14:00:00.000Z');
    assert.equal(range.endAt.toISOString(), '2026-07-18T16:00:00.000Z');
    assert.equal(logicalDayRange('2026-07-18').start.toISOString(), '2026-07-17T17:00:00.000Z');

    assert.throws(() => buildRangeFromOptions({
        dateText: '2026-02-29', startText: '10:00', endText: '11:00'
    }), /存在しない日付/);
    assert.throws(() => buildRangeFromOptions({
        dateText: '7-18', startText: '10:00', endText: '10:00'
    }), /同じ/);
});

test('plan comparison splits boundaries into all four classifications', () => {
    const start = new Date('2026-07-17T17:00:00.000Z');
    const end = new Date('2026-07-17T22:00:00.000Z');
    const plan = [
        { startAt: start.getTime(), endAt: start.getTime() + 2 * 60 * 60 * 1000, categoryKey: 'math' },
        { startAt: start.getTime() + 2 * 60 * 60 * 1000, endAt: start.getTime() + 3 * 60 * 60 * 1000, categoryKey: 'english' },
        { startAt: start.getTime() + 3 * 60 * 60 * 1000, endAt: start.getTime() + 4 * 60 * 60 * 1000, categoryKey: 'social' }
    ];
    const actual = [
        { startAt: start.getTime(), endAt: start.getTime() + 60 * 60 * 1000, categoryKey: 'math' },
        { startAt: start.getTime() + 60 * 60 * 1000, endAt: start.getTime() + 3 * 60 * 60 * 1000, categoryKey: 'physics' },
        { startAt: start.getTime() + 4 * 60 * 60 * 1000, endAt: end.getTime(), categoryKey: 'other' }
    ];
    const result = compareIntervals(plan, actual, start, end);

    assert.equal(result.matched, 60 * 60 * 1000);
    assert.equal(result.subjectMismatch, 2 * 60 * 60 * 1000);
    assert.equal(result.unfulfilledPlan, 60 * 60 * 1000);
    assert.equal(result.unplannedActual, 60 * 60 * 1000);
});

test('subject comparison keeps planned and actual totals separate', () => {
    const rows = [
        {
            subjectName: '数学',
            startAt: 0,
            endAt: 2 * 60 * 60 * 1000
        }
    ];
    const actual = [
        {
            subjectName: '数学',
            startAt: 0,
            endAt: 90 * 60 * 1000
        },
        {
            subjectName: '英語',
            startAt: 0,
            endAt: 60 * 60 * 1000
        }
    ];
    const results = subjectComparison(rows, actual);
    const math = results.find((item) => item.name === '数学');
    const english = results.find((item) => item.name === '英語');

    assert.equal(math.planned, 2 * 60 * 60 * 1000);
    assert.equal(math.actual, 90 * 60 * 1000);
    assert.equal(math.achievementRate, 0.75);
    assert.equal(english.planned, 0);
    assert.equal(english.actual, 60 * 60 * 1000);
});

test('plan comparison image renders both empty panels safely', () => {
    const start = new Date('2026-07-17T17:00:00.000Z');
    const image = generatePlanComparisonBuffer({
        range: { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) },
        planned: [],
        actual: []
    });

    assert.ok(Buffer.isBuffer(image));
    assert.ok(image.length > 100);
});

test('activity services reject an empty guild scope instead of reading legacy rows', async () => {
    await assert.rejects(
        getTimelineForDay(
            { query: async () => ({ rows: [] }) },
            {
                guildId: '',
                userId: 'user-1',
                dateKey: '2026-07-20'
            }
        ),
        /guildId is required/
    );

    await assert.rejects(
        replaceRange(
            { connect: async () => { throw new Error('must not connect'); } },
            {
                guildId: '',
                userId: 'user-1',
                startAt: new Date('2026-07-18T01:00:00.000Z'),
                endAt: new Date('2026-07-18T02:00:00.000Z'),
                deleteOnly: true
            }
        ),
        /guildId is required/
    );
});
