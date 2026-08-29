const db = require('../database/db');

async function getGuildSystem(guildId) {
    const result = await db.query(`
        SELECT system_id
        FROM bcdice_guild_settings
        WHERE guild_id = $1
    `, [guildId]);

    if (result.rows.length === 0) {
        return 'DiceBot';
    }

    return result.rows[0].system_id;
}

async function getChannelSystem(guildId, channelId) {
    const channelResult = await db.query(`
        SELECT system_id
        FROM bcdice_settings
        WHERE guild_id = $1
          AND channel_id = $2
    `, [guildId, channelId]);

    if (channelResult.rows.length > 0) {
        return channelResult.rows[0].system_id;
    }

    return await getGuildSystem(guildId);
}

async function setGuildSystem(guildId, systemId) {
    await db.query(`
        INSERT INTO bcdice_guild_settings
            (guild_id, system_id)
        VALUES
            ($1, $2)
        ON CONFLICT (guild_id)
        DO UPDATE SET system_id = EXCLUDED.system_id
    `, [guildId, systemId]);
}

async function setChannelSystem(guildId, channelId, systemId) {
    await db.query(`
        INSERT INTO bcdice_settings
            (guild_id, channel_id, system_id)
        VALUES
            ($1, $2, $3)
        ON CONFLICT (guild_id, channel_id)
        DO UPDATE SET system_id = EXCLUDED.system_id
    `, [guildId, channelId, systemId]);
}

async function resetChannelSystem(guildId, channelId) {
    await db.query(`
        DELETE FROM bcdice_settings
        WHERE guild_id = $1
          AND channel_id = $2
    `, [guildId, channelId]);
}

module.exports = {
    getGuildSystem,
    getChannelSystem,
    setGuildSystem,
    setChannelSystem,
    resetChannelSystem
};