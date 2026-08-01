-- Read-only checks for migration 007. Run before and after applying it.

SELECT COUNT(*) AS activity_interval_count
FROM activity_intervals;

SELECT COUNT(*) AS active_activity_interval_count
FROM activity_intervals
WHERE is_active = TRUE;

SELECT
    to_regclass('public.record_scopes') AS record_scopes,
    to_regclass('public.record_scope_members') AS record_scope_members,
    to_regclass('public.record_scope_link_codes') AS record_scope_link_codes,
    to_regclass('public.planned_intervals') AS planned_intervals,
    to_regclass('public.planned_mutations') AS planned_mutations;

SELECT COUNT(*) AS record_scope_member_count
FROM record_scope_members;

SELECT COUNT(*) AS planned_interval_count
FROM planned_intervals;

-- Must return zero rows. A row here would mean an invalid cross-user scope.
SELECT members.scope_id, members.guild_id, members.user_id
FROM record_scope_members AS members
JOIN record_scopes AS scopes ON scopes.id = members.scope_id
WHERE members.user_id <> scopes.owner_user_id;
