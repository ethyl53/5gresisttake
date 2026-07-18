SELECT
    guild_id,
    COUNT(*)::int AS interval_count,
    COUNT(*) FILTER (
        WHERE is_active
    )::int AS active_interval_count,
    COUNT(*) FILTER (
        WHERE is_active
          AND end_at IS NULL
    )::int AS open_interval_count
FROM activity_intervals
GROUP BY guild_id
ORDER BY guild_id;

SELECT
    guild_id,
    COUNT(*)::int AS state_count,
    COUNT(*) FILTER (
        WHERE active_interval_id IS NOT NULL
    )::int AS running_state_count,
    COUNT(*) FILTER (
        WHERE paused_at IS NOT NULL
    )::int AS paused_state_count
FROM activity_state
GROUP BY guild_id
ORDER BY guild_id;
