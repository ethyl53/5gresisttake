SELECT
    namespace.nspname AS schema_name,
    table_class.relname AS table_name,
    index_class.relname AS index_name,
    index_data.indisprimary AS is_primary,
    index_data.indisunique AS is_unique,
    access_method.amname AS index_method,
    COALESCE(
        statistics.idx_scan,
        0
    ) AS index_scans,
    pg_size_pretty(
        pg_relation_size(
            index_class.oid
        )
    ) AS index_size,
    pg_get_indexdef(
        index_class.oid
    ) AS index_definition
FROM pg_index AS index_data
INNER JOIN pg_class AS table_class
    ON table_class.oid =
        index_data.indrelid
INNER JOIN pg_class AS index_class
    ON index_class.oid =
        index_data.indexrelid
INNER JOIN pg_namespace AS namespace
    ON namespace.oid =
        table_class.relnamespace
INNER JOIN pg_am AS access_method
    ON access_method.oid =
        index_class.relam
LEFT JOIN pg_stat_user_indexes AS statistics
    ON statistics.indexrelid =
        index_class.oid
WHERE namespace.nspname = 'public'
ORDER BY
    table_class.relname,
    index_data.indisprimary DESC,
    index_data.indisunique DESC,
    index_class.relname;
