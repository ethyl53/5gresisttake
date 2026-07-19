'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const EDITABLE_DAYS = 30;

const {
    subject
} = require('../utils/activityRead');

function parseDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
        String(dateKey || '')
    );

    if (!match) {
        throw new Error('日付の形式が正しくありません。');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const utcMs = Date.UTC(
        year,
        month - 1,
        day,
        2 - 9,
        0,
        0,
        0
    );

    const check = new Date(
        utcMs + JST_OFFSET_MS
    );

    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        check.getUTCHours() !== 2
    ) {
        throw new Error('存在しない日付です。');
    }

    return new Date(utcMs);
}

function getCurrentDateKey(now = new Date()) {
    const jst = new Date(
        now.getTime() + JST_OFFSET_MS
    );

    if (jst.getUTCHours() < 2) {
        jst.setUTCDate(
            jst.getUTCDate() - 1
        );
    }

    return [
        jst.getUTCFullYear(),
        String(jst.getUTCMonth() + 1).padStart(2, '0'),
        String(jst.getUTCDate()).padStart(2, '0')
    ].join('-');
}

function getDayRange(dateKey) {
    const start = parseDateKey(dateKey);

    return {
        dateKey,
        start,
        end: new Date(
            start.getTime() + DAY_MS
        )
    };
}

function validateDateKey(dateKey, now = new Date()) {
    const requested = getDayRange(dateKey);
    const current = getDayRange(
        getCurrentDateKey(now)
    );

    if (requested.start > current.start) {
        throw new Error(
            '未来の日付は表示できません。'
        );
    }

    if (
        requested.start.getTime() <
        current.start.getTime() -
            (EDITABLE_DAYS - 1) * DAY_MS
    ) {
        throw new Error(
            `Webから編集できるのは過去${EDITABLE_DAYS}日以内です。`
        );
    }

    return requested;
}

function validateEditableRange(
    startAt,
    endAt,
    now = new Date()
) {
    if (
        !(startAt instanceof Date) ||
        Number.isNaN(startAt.getTime()) ||
        !(endAt instanceof Date) ||
        Number.isNaN(endAt.getTime()) ||
        endAt <= startAt
    ) {
        throw new Error(
            '開始時刻と終了時刻を確認してください。'
        );
    }

    if (endAt > now) {
        throw new Error(
            '未来の学習記録は保存できません。'
        );
    }

    const oldest = new Date(
        now.getTime() - EDITABLE_DAYS * DAY_MS
    );

    if (startAt < oldest) {
        throw new Error(
            `Webから編集できるのは過去${EDITABLE_DAYS}日以内です。`
        );
    }

    if (
        endAt.getTime() - startAt.getTime() <
        60_000
    ) {
        throw new Error(
            '1分未満の記録は保存できません。'
        );
    }
}

async function getTimelineForDay(
    db,
    {
        guildId,
        userId,
        dateKey,
        now = new Date()
    }
) {
    const range = validateDateKey(
        dateKey,
        now
    );

    const result = await db.query(
        `
            SELECT
                id,
                category_key,
                task_name,
                start_at,
                end_at
            FROM activity_intervals
            WHERE guild_id = $1
              AND user_id = $2
              AND is_active = TRUE
              AND start_at < $4
              AND COALESCE(end_at, NOW()) > $3
            ORDER BY start_at ASC
        `,
        [
            guildId,
            userId,
            range.start,
            range.end
        ]
    );

    return {
        dateKey,
        startAt: range.start.getTime(),
        endAt: range.end.getTime(),
        intervals: result.rows.map(
            (row) => {
                const info = subject(
                    row.category_key
                );

                const originalStartAt =
                    new Date(
                        row.start_at
                    ).getTime();

                const originalEndAt =
                    row.end_at
                        ? new Date(
                            row.end_at
                        ).getTime()
                        : now.getTime();

                const displayStartAt =
                    Math.max(
                        range.start.getTime(),
                        originalStartAt
                    );

                const displayEndAt =
                    Math.min(
                        range.end.getTime(),
                        originalEndAt
                    );

                return {
                    id: row.id,
                    categoryKey: info.key,
                    subjectName: info.name,
                    taskName:
                        row.task_name || null,
                    startAt: displayStartAt,
                    endAt: displayEndAt,
                    originalStartAt,
                    originalEndAt,
                    isClipped:
                        displayStartAt !==
                            originalStartAt ||
                        displayEndAt !==
                            originalEndAt,
                    isRunning:
                        row.end_at === null
                };
            }
        )
    };
}

async function getCurrentState(
    db,
    guildId,
    userId,
    now = new Date()
) {
    const result = await db.query(
        `
            SELECT
                state.active_interval_id,
                state.paused_category_key,
                state.paused_task_name,
                state.paused_at,
                interval.category_key,
                interval.task_name,
                interval.start_at
            FROM activity_state AS state
            LEFT JOIN activity_intervals AS interval
                ON interval.id = state.active_interval_id
               AND interval.is_active = TRUE
               AND interval.end_at IS NULL
            WHERE state.guild_id = $1
              AND state.user_id = $2
            LIMIT 1
        `,
        [guildId, userId]
    );

    const row = result.rows[0];

    if (!row) {
        return {
            status: 'idle',
            serverNow: now.getTime()
        };
    }

    if (row.active_interval_id) {
        return {
            status: 'running',
            intervalId:
                row.active_interval_id,
            categoryKey:
                row.category_key || 'other',
            taskName:
                row.task_name || null,
            startAt: new Date(
                row.start_at
            ).getTime(),
            serverNow: now.getTime()
        };
    }

    if (row.paused_at) {
        return {
            status: 'paused',
            categoryKey:
                row.paused_category_key ||
                'other',
            taskName:
                row.paused_task_name || null,
            pausedAt: new Date(
                row.paused_at
            ).getTime(),
            serverNow: now.getTime()
        };
    }

    return {
        status: 'idle',
        serverNow: now.getTime()
    };
}

module.exports = {
    EDITABLE_DAYS,
    getCurrentDateKey,
    getCurrentState,
    getDayRange,
    getTimelineForDay,
    validateDateKey,
    validateEditableRange
};
