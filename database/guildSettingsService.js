'use strict';

const DEFAULT_TIMEZONE = 'Asia/Tokyo';

function legacyFallbackFor(guildId) {
    return process.env.GUILD_ID &&
        process.env.GUILD_ID === guildId
        ? {
            guild_id: guildId,
            ranking_channel_id:
                process.env.RANKING_CHANNEL_ID || null,
            persistent_ranking_channel_id:
                process.env.RANKING_CHANNEL_ID || null,
            daily_ranking_enabled: true,
            weekly_ranking_enabled: true,
            persistent_ranking_enabled: true,
            timezone: DEFAULT_TIMEZONE,
            is_legacy_fallback: true
        }
        : null;
}

async function getGuildSettings(db, guildId) {
    if (!guildId) {
        return null;
    }

    const result = await db.query(
        `
            SELECT *
            FROM guild_settings
            WHERE guild_id = $1
            LIMIT 1
        `,
        [guildId]
    );

    return result.rows[0] || legacyFallbackFor(guildId);
}

async function ensureGuildSettings(db, guildId) {
    if (!guildId) {
        throw new Error('guildId is required');
    }

    const fallback = legacyFallbackFor(guildId);
    const result = await db.query(
        `
            INSERT INTO guild_settings (
                guild_id,
                ranking_channel_id,
                persistent_ranking_channel_id,
                timezone
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id)
            DO UPDATE SET updated_at = NOW()
            RETURNING *
        `,
        [
            guildId,
            fallback?.ranking_channel_id || null,
            fallback?.persistent_ranking_channel_id || null,
            DEFAULT_TIMEZONE
        ]
    );

    return result.rows[0];
}

async function updateGuildSettings(db, guildId, changes) {
    if (!guildId) {
        throw new Error('guildId is required');
    }

    const current = await ensureGuildSettings(db, guildId);
    const next = {
        rankingChannelId:
            changes.rankingChannelId === undefined
                ? current.ranking_channel_id
                : changes.rankingChannelId,
        persistentRankingChannelId:
            changes.persistentRankingChannelId === undefined
                ? current.persistent_ranking_channel_id
                : changes.persistentRankingChannelId,
        dailyRankingEnabled:
            changes.dailyRankingEnabled === undefined
                ? current.daily_ranking_enabled
                : changes.dailyRankingEnabled,
        weeklyRankingEnabled:
            changes.weeklyRankingEnabled === undefined
                ? current.weekly_ranking_enabled
                : changes.weeklyRankingEnabled,
        persistentRankingEnabled:
            changes.persistentRankingEnabled === undefined
                ? current.persistent_ranking_enabled
                : changes.persistentRankingEnabled
    };

    const result = await db.query(
        `
            UPDATE guild_settings
            SET
                ranking_channel_id = $2,
                persistent_ranking_channel_id = $3,
                daily_ranking_enabled = $4,
                weekly_ranking_enabled = $5,
                persistent_ranking_enabled = $6,
                timezone = $7,
                updated_at = NOW()
            WHERE guild_id = $1
            RETURNING *
        `,
        [
            guildId,
            next.rankingChannelId || null,
            next.persistentRankingChannelId || null,
            Boolean(next.dailyRankingEnabled),
            Boolean(next.weeklyRankingEnabled),
            Boolean(next.persistentRankingEnabled),
            DEFAULT_TIMEZONE
        ]
    );

    return result.rows[0];
}

async function configuredGuildSettings(db, guildIds) {
    if (!Array.isArray(guildIds) || guildIds.length === 0) {
        return [];
    }

    const result = await db.query(
        `
            SELECT *
            FROM guild_settings
            WHERE guild_id = ANY($1::text[])
        `,
        [guildIds]
    );

    const byGuild = new Map(
        result.rows.map((row) => [row.guild_id, row])
    );

    return guildIds
        .map((guildId) =>
            byGuild.get(guildId) || legacyFallbackFor(guildId)
        )
        .filter(Boolean);
}

module.exports = {
    DEFAULT_TIMEZONE,
    configuredGuildSettings,
    ensureGuildSettings,
    getGuildSettings,
    updateGuildSettings
};
