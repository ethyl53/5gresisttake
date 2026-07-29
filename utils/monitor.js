'use strict';

const cron = require('node-cron');

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const db = require('../database/db');
const {
    getGuildSettings
} = require('../database/guildSettingsService');
const {
    stopActivity
} = require('../database/intervalService');

const CONTINUE_PREFIX =
    'activity_monitor_continue:';

const STOP_PREFIX =
    'activity_monitor_stop:';

function positiveIntegerEnv(name, fallback) {
    const parsed = Number.parseInt(
        process.env[name],
        10
    );

    return Number.isInteger(parsed) &&
        parsed > 0
        ? parsed
        : fallback;
}

const CONFIRM_AFTER_MINUTES =
    positiveIntegerEnv(
        'WORK_CONFIRM_AFTER_MINUTES',
        180
    );

const RESPONSE_GRACE_MINUTES =
    positiveIntegerEnv(
        'WORK_CONFIRM_GRACE_MINUTES',
        30
    );

const CHECK_CRON =
    process.env.WORK_MONITOR_CRON ||
    '* * * * *';

function getRankingManager(client) {
    return (
        client.persistentRanking ||
        client.rankingSystem ||
        client.ranking
    );
}

function requestRankingUpdate(client, guildId) {
    const promise =
        getRankingManager(client)
            ?.update?.(guildId);

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Monitor Ranking Update Error]',
                error
            );
        });
    }
}

function requestRankingResend(client, guildId) {
    const promise =
        getRankingManager(client)
            ?.resend?.(guildId);

    if (
        promise &&
        typeof promise.catch === 'function'
    ) {
        promise.catch((error) => {
            console.error(
                '[Monitor Ranking Resend Error]',
                error
            );
        });
    }
}

async function sendChannelFallback(
    client,
    guildId,
    payload
) {
    const settings = await getGuildSettings(
        db,
        guildId
    );

    const channelId =
        settings?.ranking_channel_id ||
        settings?.persistent_ranking_channel_id;

    if (!channelId) {
        return false;
    }

    const channel =
        await client.channels
            .fetch(channelId)
            .catch(() => null);

    if (
        !channel ||
        !channel.isTextBased() ||
        channel.guildId !== guildId
    ) {
        return false;
    }

    await channel.send(payload);

    requestRankingResend(client, guildId);

    return true;
}

async function ensureMonitorRows() {
    await db.query(
        `
            INSERT INTO activity_monitor_state (
                active_interval_id,
                guild_id,
                user_id,
                last_confirmed_at,
                confirmation_sent_at,
                confirmation_deadline,
                updated_at
            )
            SELECT
                interval.id,
                interval.guild_id,
                interval.user_id,
                interval.start_at,
                NULL,
                NULL,
                NOW()
            FROM activity_intervals AS interval
            INNER JOIN activity_state AS state
                ON state.guild_id = interval.guild_id
               AND state.user_id = interval.user_id
               AND state.active_interval_id = interval.id
            WHERE interval.is_active = TRUE
              AND interval.end_at IS NULL
            ON CONFLICT (guild_id, user_id)
            DO UPDATE SET
                active_interval_id =
                    EXCLUDED.active_interval_id,
                last_confirmed_at =
                    CASE
                        WHEN activity_monitor_state.active_interval_id =
                             EXCLUDED.active_interval_id
                        THEN activity_monitor_state.last_confirmed_at
                        ELSE EXCLUDED.last_confirmed_at
                    END,
                confirmation_sent_at =
                    CASE
                        WHEN activity_monitor_state.active_interval_id =
                             EXCLUDED.active_interval_id
                        THEN activity_monitor_state.confirmation_sent_at
                        ELSE NULL
                    END,
                confirmation_deadline =
                    CASE
                        WHEN activity_monitor_state.active_interval_id =
                             EXCLUDED.active_interval_id
                        THEN activity_monitor_state.confirmation_deadline
                        ELSE NULL
                    END,
                updated_at = NOW()
        `
    );

    await db.query(
        `
            DELETE FROM activity_monitor_state AS monitor
            WHERE NOT EXISTS (
                SELECT 1
                FROM activity_intervals AS interval
                INNER JOIN activity_state AS state
                    ON state.guild_id = interval.guild_id
                   AND state.user_id = interval.user_id
                   AND state.active_interval_id = interval.id
                WHERE interval.id =
                        monitor.active_interval_id
                  AND interval.is_active = TRUE
                  AND interval.end_at IS NULL
            )
        `
    );
}

async function sendConfirmation(client, row) {
    const claimed = await db.query(
        `
            UPDATE activity_monitor_state
            SET
                confirmation_sent_at = NOW(),
                confirmation_deadline =
                    NOW() +
                    ($3::text || ' minutes')::interval,
                updated_at = NOW()
            WHERE active_interval_id = $1
              AND guild_id = $2
              AND confirmation_sent_at IS NULL
            RETURNING
                confirmation_sent_at,
                confirmation_deadline
        `,
        [
            row.active_interval_id,
            row.guild_id,
            RESPONSE_GRACE_MINUTES
        ]
    );

    if (claimed.rowCount === 0) {
        return;
    }

    const continueButton =
        new ButtonBuilder()
            .setCustomId(
                CONTINUE_PREFIX +
                row.guild_id +
                ':' +
                row.active_interval_id
            )
            .setLabel('作業を継続する')
            .setStyle(ButtonStyle.Primary);

    const stopButton =
        new ButtonBuilder()
            .setCustomId(
                STOP_PREFIX +
                row.guild_id +
                ':' +
                row.active_interval_id
            )
            .setLabel('作業を終了する')
            .setStyle(ButtonStyle.Danger);

    const components = [
        new ActionRowBuilder()
            .addComponents(
                continueButton,
                stopButton
            )
    ];

    try {
        const guild = client.guilds.cache.get(
            row.guild_id
        ) || await client.guilds.fetch(
            row.guild_id
        ).catch(() => null);

        const user = await client.users.fetch(
            row.user_id
        );

        const startedAt = new Date(
            row.start_at
        ).toLocaleString(
            'ja-JP',
            {
                timeZone: 'Asia/Tokyo'
            }
        );

        await user.send({
            content:
                '作業開始から一定時間が経過しました。\n' +
                `対象サーバー: ${guild?.name || row.guild_id}\n` +
                `作業名: ${row.task_name || '未設定'}\n` +
                `開始時刻: ${startedAt}\n\n` +
                `${RESPONSE_GRACE_MINUTES}分以内に継続を確認してください。` +
                '反応がない場合は、停止忘れ防止のため自動終了します。',
            components
        });
    } catch (error) {
        console.error(
            '[Monitor DM Error]',
            {
                userId: row.user_id,
                intervalId:
                    row.active_interval_id,
                message: error.message
            }
        );

        try {
            const sent =
                await sendChannelFallback(
                    client,
                    row.guild_id,
                    {
                        content:
                            `<@${row.user_id}> ` +
                            '作業開始から一定時間が経過しました。' +
                            `${RESPONSE_GRACE_MINUTES}分以内に継続を確認してください。` +
                            '反応がない場合は自動終了します。',
                        components
                    }
                );

            if (!sent) {
                console.error(
                    '[Monitor Fallback Error] Ranking channel was not available'
                );
            }
        } catch (fallbackError) {
            console.error(
                '[Monitor Fallback Error]',
                fallbackError
            );
        }
    }
}

async function autoStopExpired(client, row) {
    const deadline = new Date(
        row.confirmation_deadline
    );

    const result = await stopActivity(
        db,
        {
            guildId: row.guild_id,
            userId: row.user_id,
            now: deadline,
            expectedIntervalId:
                row.active_interval_id
        }
    );

    if (result.kind !== 'stopped') {
        await db.query(
            `
                DELETE FROM activity_monitor_state
                WHERE active_interval_id = $1
                  AND guild_id = $2
            `,
            [row.active_interval_id, row.guild_id]
        );

        return;
    }

    requestRankingUpdate(client, row.guild_id);

    const stoppedAt =
        deadline.toLocaleString(
            'ja-JP',
            {
                timeZone: 'Asia/Tokyo'
            }
        );

    try {
        const guild = client.guilds.cache.get(
            row.guild_id
        ) || await client.guilds.fetch(
            row.guild_id
        ).catch(() => null);

        const user = await client.users.fetch(
            row.user_id
        );

        await user.send({
            content:
                '継続確認への反応がなかったため、作業を自動終了しました。\n' +
                `対象サーバー: ${guild?.name || row.guild_id}\n` +
                `終了時刻: ${stoppedAt}\n` +
                '実際の終了時刻と異なる場合は `/edit` で修正してください。'
        });
    } catch (error) {
        console.error(
            '[Monitor Auto-stop DM Error]',
            {
                userId: row.user_id,
                message: error.message
            }
        );

        try {
            await sendChannelFallback(
                client,
                row.guild_id,
                {
                    content:
                        `<@${row.user_id}> ` +
                        '継続確認への反応がなかったため、作業を自動終了しました。' +
                        `終了時刻: ${stoppedAt}`
                }
            );
        } catch (fallbackError) {
            console.error(
                '[Monitor Auto-stop Fallback Error]',
                fallbackError
            );
        }
    }
}

let running = false;

async function checkMonitor(client) {
    if (running) {
        return;
    }

    running = true;

    try {
        await ensureMonitorRows();

        const result = await db.query(
            `
                SELECT
                    monitor.active_interval_id,
                    monitor.guild_id,
                    monitor.user_id,
                    monitor.last_confirmed_at,
                    monitor.confirmation_sent_at,
                    monitor.confirmation_deadline,
                    interval.category_key,
                    interval.task_name,
                    interval.start_at
                FROM activity_monitor_state AS monitor
                INNER JOIN activity_intervals AS interval
                    ON interval.id =
                        monitor.active_interval_id
                INNER JOIN activity_state AS state
                    ON state.guild_id =
                        monitor.guild_id
                   AND state.user_id =
                        monitor.user_id
                   AND state.active_interval_id =
                        monitor.active_interval_id
                WHERE interval.is_active = TRUE
                  AND interval.end_at IS NULL
                ORDER BY
                    monitor.last_confirmed_at ASC
            `
        );

        const now = new Date();

        for (const row of result.rows) {
            if (
                row.confirmation_deadline &&
                new Date(
                    row.confirmation_deadline
                ) <= now
            ) {
                await autoStopExpired(
                    client,
                    row
                );

                continue;
            }

            if (!row.confirmation_sent_at) {
                const dueAt =
                    new Date(
                        row.last_confirmed_at
                    ).getTime() +
                    CONFIRM_AFTER_MINUTES *
                    60_000;

                if (dueAt <= now.getTime()) {
                    await sendConfirmation(
                        client,
                        row
                    );
                }
            }
        }
    } catch (error) {
        console.error(
            '[Activity Monitor Error]',
            error
        );
    } finally {
        running = false;
    }
}

async function handleMonitorButton(
    interaction
) {
    if (!interaction.isButton()) {
        return false;
    }

    const customId = interaction.customId;

    const isContinue =
        customId.startsWith(
            CONTINUE_PREFIX
        );

    const isStop =
        customId.startsWith(
            STOP_PREFIX
        );

    if (!isContinue && !isStop) {
        return false;
    }

    const encodedTarget = customId.slice(
        (
            isContinue
                ? CONTINUE_PREFIX
                : STOP_PREFIX
        ).length
    );

    // New buttons carry both guild and interval.  Old interval-only buttons
    // remain safe because interval UUIDs are globally unique in PostgreSQL.
    const targetSeparator = encodedTarget.lastIndexOf(':');
    const guildId = targetSeparator > 0
        ? encodedTarget.slice(0, targetSeparator)
        : null;
    const intervalId = targetSeparator > 0
        ? encodedTarget.slice(targetSeparator + 1)
        : encodedTarget;

    const result = await db.query(
        `
            SELECT
                monitor.active_interval_id,
                monitor.guild_id,
                monitor.user_id,
                interval.task_name
            FROM activity_monitor_state AS monitor
            INNER JOIN activity_intervals AS interval
                ON interval.id =
                    monitor.active_interval_id
            INNER JOIN activity_state AS state
                ON state.guild_id =
                    monitor.guild_id
               AND state.user_id =
                    monitor.user_id
               AND state.active_interval_id =
                    monitor.active_interval_id
            WHERE monitor.active_interval_id = $1
              AND ($2::text IS NULL OR monitor.guild_id = $2)
              AND interval.is_active = TRUE
              AND interval.end_at IS NULL
            LIMIT 1
        `,
        [intervalId, guildId]
    );

    const row = result.rows[0];

    if (!row) {
        await interaction.update({
            content:
                'この確認はすでに無効です。対象の作業は終了または切り替え済みです。',
            components: []
        }).catch(async () => {
            await interaction.reply({
                content:
                    'この確認はすでに無効です。',
                flags:
                    MessageFlags.Ephemeral
            });
        });

        return true;
    }

    if (interaction.user.id !== row.user_id) {
        await interaction.reply({
            content:
                'この確認は対象ユーザー本人だけが操作できます。',
            flags: MessageFlags.Ephemeral
        });

        return true;
    }

    if (isContinue) {
        const updated = await db.query(
            `
                UPDATE activity_monitor_state
                SET
                    last_confirmed_at = NOW(),
                    confirmation_sent_at = NULL,
                    confirmation_deadline = NULL,
                    updated_at = NOW()
                WHERE active_interval_id = $1
                  AND guild_id = $2
                RETURNING active_interval_id
            `,
            [intervalId, row.guild_id]
        );

        await interaction.update({
            content:
                updated.rowCount > 0
                    ? '作業の継続を確認しました。次回の確認まではそのまま記録を継続します。'
                    : 'この確認はすでに無効です。',
            components: []
        });

        return true;
    }

    const stopped = await stopActivity(
        db,
        {
            guildId: row.guild_id,
            userId: row.user_id,
            now: new Date(),
            expectedIntervalId: intervalId
        }
    );

    if (stopped.kind === 'stopped') {
        requestRankingUpdate(
            interaction.client,
            row.guild_id
        );

        await interaction.update({
            content: '作業を終了しました。',
            components: []
        });
    } else {
        await interaction.update({
            content:
                '対象の作業はすでに終了または切り替え済みです。',
            components: []
        });
    }

    return true;
}

function initMonitor(client) {
    console.log(
        '[Activity Monitor] enabled',
        {
            confirmAfterMinutes:
                CONFIRM_AFTER_MINUTES,
            graceMinutes:
                RESPONSE_GRACE_MINUTES,
            cron: CHECK_CRON
        }
    );

    checkMonitor(client);

    const task = cron.schedule(
        CHECK_CRON,
        () => {
            checkMonitor(client);
        },
        {
            timezone: 'Asia/Tokyo'
        }
    );

    return () => {
        task.stop();
        task.destroy();
    };
}

module.exports = {
    initMonitor,
    handleMonitorButton
};
