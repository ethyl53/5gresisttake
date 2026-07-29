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
    const fakeDb = {
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

    assert.equal(queryArgs[0], 'guild-A');
    assert.equal(queryArgs[1], 'user-1');
    assert.equal(day.intervals[0].isClipped, true);
    assert.equal(day.intervals[0].originalStartAt,
        new Date('2026-07-19T16:30:00.000Z').getTime());
});

test('range edits lock and mutate only the selected guild/user scope', async () => {
    const calls = [];
    const client = {
        async query(sql, args = []) {
            calls.push({ sql, args });
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

    assert.deepEqual(lock.args, ['guild-A:user-1']);
    assert.deepEqual(mutation.args.slice(0, 2), ['guild-A', 'delete']);
    assert.ok(intervals.every(({ args }) => args[0] === 'guild-A'));
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
