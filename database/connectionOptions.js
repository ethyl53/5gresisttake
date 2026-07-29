'use strict';

function decode(value) {
    try {
        return decodeURIComponent(value);
    } catch (error) {
        throw new Error('DATABASE_URL contains invalid percent encoding');
    }
}

function connectionOptions(databaseUrl, ssl) {
    let parsed;
    try {
        parsed = new URL(databaseUrl);
    } catch (error) {
        throw new Error('DATABASE_URL is not a valid PostgreSQL URL');
    }

    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
        throw new Error('DATABASE_URL is missing PostgreSQL connection details');
    }

    return {
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
        user: decode(parsed.username),
        password: decode(parsed.password),
        database: decode(parsed.pathname.slice(1)),
        ssl
    };
}

module.exports = {
    connectionOptions
};
