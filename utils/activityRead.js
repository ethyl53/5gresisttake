'use strict';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SUBJECTS = {
    math: { name: '数学', colorHex: '#0074FF' },
    chemistry: { name: '化学', colorHex: '#66CCFF' },
    physics: { name: '物理', colorHex: '#FFA500' },
    english: { name: '英語', colorHex: '#FFFF00' },
    social: { name: '社会', colorHex: '#00B000' },
    other: { name: 'その他', colorHex: '#FF0000' }
};

const SUBJECT_ALIASES = {
    math: 'math',
    mathematics: 'math',
    '数学': 'math',
    blue: 'math',
    '#0074ff': 'math',

    chemistry: 'chemistry',
    chemical: 'chemistry',
    '化学': 'chemistry',
    lightblue: 'chemistry',
    'light-blue': 'chemistry',
    '#66ccff': 'chemistry',

    physics: 'physics',
    '物理': 'physics',
    orange: 'physics',
    '#ffa500': 'physics',

    english: 'english',
    '英語': 'english',
    yellow: 'english',
    '#ffff00': 'english',

    social: 'social',
    society: 'social',
    '社会': 'social',
    green: 'social',
    '#00b000': 'social',

    other: 'other',
    others: 'other',
    'その他': 'other',
    red: 'other',
    gray: 'other',
    grey: 'other',
    purple: 'other',
    '#ff0000': 'other',
    '#808080': 'other'
};

function normalizeCategoryKey(value) {
    const raw = String(value || '')
        .trim()
        .replace(/^legacy-color:/i, '')
        .toLowerCase();

    return SUBJECT_ALIASES[raw] || 'other';
}

function subject(value) {
    const key = normalizeCategoryKey(value);
    const info = SUBJECTS[key];

    return {
        key,
        name: info.name,
        colorHex: info.colorHex
    };
}

function asDate(value, name) {
    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError(
            `${name} must be a valid Date`
        );
    }

    return date;
}

function getCurrentJstDayStart(now = new Date()) {
    const current = asDate(now, 'now');

    const jstDate = new Date(
        current.getTime() + JST_OFFSET_MS
    );

    if (jstDate.getUTCHours() < 2) {
        jstDate.setUTCDate(
            jstDate.getUTCDate() - 1
        );
    }

    jstDate.setUTCHours(2, 0, 0, 0);

    return new Date(
        jstDate.getTime() - JST_OFFSET_MS
    );
}

function jstRange(days = 1, now = new Date()) {
    const safeDays =
        Number.isInteger(days) && days > 0
            ? days
            : 1;

    const currentDayStart =
        getCurrentJstDayStart(now);

    return {
        start: new Date(
            currentDayStart.getTime() -
            (safeDays - 1) * DAY_MS
        ),
        end: new Date(
            currentDayStart.getTime() +
            DAY_MS
        )
    };
}

function jstCurrentWeekRange(now = new Date()) {
    const currentDayStart =
        getCurrentJstDayStart(now);

    const currentDayInJst = new Date(
        currentDayStart.getTime() +
        JST_OFFSET_MS
    );

    const weekday =
        currentDayInJst.getUTCDay();

    const daysSinceMonday =
        (weekday + 6) % 7;

    const start = new Date(
        currentDayStart.getTime() -
        daysSinceMonday * DAY_MS
    );

    return {
        start,
        end: new Date(
            start.getTime() +
            7 * DAY_MS
        )
    };
}

function jstCurrentMonthRange(now = new Date()) {
    const current = asDate(now, 'now');

    const jstDate = new Date(
        current.getTime() + JST_OFFSET_MS
    );

    const year =
        jstDate.getUTCFullYear();

    const month =
        jstDate.getUTCMonth();

    const start = new Date(
        Date.UTC(
            year,
            month,
            1,
            2 - 9,
            0,
            0,
            0
        )
    );

    const end = new Date(
        Date.UTC(
            year,
            month + 1,
            1,
            2 - 9,
            0,
            0,
            0
        )
    );

    return { start, end };
}

function jstPreviousDayRange(now = new Date()) {
    const end = getCurrentJstDayStart(now);

    return {
        start: new Date(
            end.getTime() - DAY_MS
        ),
        end
    };
}

function jstPreviousWeekRange(now = new Date()) {
    const currentWeek =
        jstCurrentWeekRange(now);

    return {
        start: new Date(
            currentWeek.start.getTime() -
            7 * DAY_MS
        ),
        end: currentWeek.start
    };
}

async function intervals(
    db,
    guildId,
    start,
    end
) {
    const rangeStart = asDate(start, 'start');
    const rangeEnd = asDate(end, 'end');

    const result = await db.query(
        `
            SELECT
                id,
                guild_id,
                user_id,
                category_key,
                task_name,
                start_at,
                end_at
            FROM activity_intervals
            WHERE guild_id = $1
              AND is_active = TRUE
              AND start_at < $3
              AND COALESCE(end_at, NOW()) > $2
            ORDER BY start_at ASC
        `,
        [
            guildId || '',
            rangeStart,
            rangeEnd
        ]
    );

    const nowMs = Date.now();

    return result.rows.map((row) => ({
        ...row,
        startMs: new Date(
            row.start_at
        ).getTime(),
        endMs: row.end_at
            ? new Date(
                row.end_at
            ).getTime()
            : nowMs
    }));
}

async function activeIntervals(db, guildId) {
    const result = await db.query(
        `
            SELECT
                id,
                guild_id,
                user_id,
                category_key,
                task_name,
                start_at
            FROM activity_intervals
            WHERE guild_id = $1
              AND is_active = TRUE
              AND end_at IS NULL
            ORDER BY start_at ASC
        `,
        [guildId || '']
    );

    return result.rows.map((row) => ({
        ...row,
        startMs: new Date(
            row.start_at
        ).getTime()
    }));
}

async function pausedStates(db, guildId) {
    const result = await db.query(
        `
            SELECT
                guild_id,
                user_id,
                paused_category_key,
                paused_task_name,
                paused_at
            FROM activity_state
            WHERE guild_id = $1
              AND active_interval_id IS NULL
              AND paused_at IS NOT NULL
            ORDER BY paused_at ASC
        `,
        [guildId || '']
    );

    return result.rows.map((row) => ({
        ...row,
        pausedMs: new Date(
            row.paused_at
        ).getTime()
    }));
}

function aggregate(rows, start, end) {
    const rangeStart = asDate(start, 'start');
    const rangeEnd = asDate(end, 'end');

    const users = new Map();
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    for (const row of rows) {
        const intervalStartMs = Math.max(
            rangeStartMs,
            Number(row.startMs)
        );

        const intervalEndMs = Math.min(
            rangeEndMs,
            Number(row.endMs)
        );

        if (
            !Number.isFinite(intervalStartMs) ||
            !Number.isFinite(intervalEndMs) ||
            intervalEndMs <= intervalStartMs
        ) {
            continue;
        }

        const info = subject(row.category_key);

        const user = users.get(row.user_id) || {
            userId: row.user_id,
            total: 0,
            sessions: [],
            subjects: {},
            tasks: {}
        };

        const durationMs =
            intervalEndMs - intervalStartMs;

        user.total += durationMs;

        user.sessions.push({
            start: intervalStartMs,
            end: intervalEndMs,
            colorHex: info.colorHex
        });

        user.subjects[info.name] =
            (user.subjects[info.name] || 0) +
            durationMs;

        const taskName =
            row.task_name || '未設定';

        user.tasks[taskName] =
            (user.tasks[taskName] || 0) +
            durationMs;

        users.set(row.user_id, user);
    }

    return [...users.values()].sort(
        (a, b) => b.total - a.total
    );
}

function format(ms) {
    const numeric = Number(ms);

    const safeMs = Math.max(
        0,
        Number.isFinite(numeric)
            ? numeric
            : 0
    );

    const totalMinutes = Math.floor(
        safeMs / 60_000
    );

    const hours = Math.floor(
        totalMinutes / 60
    );

    const minutes =
        totalMinutes % 60;

    return `${hours}時間${minutes}分`;
}

module.exports = {
    intervals,
    activeIntervals,
    pausedStates,
    aggregate,
    jstRange,
    jstCurrentWeekRange,
    jstCurrentMonthRange,
    jstPreviousDayRange,
    jstPreviousWeekRange,
    getCurrentJstDayStart,
    subject,
    format
};
