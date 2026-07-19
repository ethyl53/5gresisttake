'use strict';

const crypto = require('crypto');

const CODE_ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashLinkCode(code) {
    return crypto
        .createHash('sha256')
        .update(
            String(code || '')
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
        )
        .digest('hex');
}

function generateLinkCode() {
    let value = '';

    for (let index = 0; index < 8; index += 1) {
        value += CODE_ALPHABET[
            crypto.randomInt(
                0,
                CODE_ALPHABET.length
            )
        ];
    }

    return `${value.slice(0, 4)}-${value.slice(4)}`;
}

async function createLinkCode(
    db,
    discordUserId,
    ttlMinutes = 10
) {
    const plainCode = generateLinkCode();
    const codeHash = hashLinkCode(plainCode);

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `
                SELECT pg_advisory_xact_lock(
                    hashtextextended($1, 0)
                )
            `,
            [`web-link:${discordUserId}`]
        );

        await client.query(
            `
                DELETE FROM account_link_codes
                WHERE discord_user_id = $1
                  AND used_at IS NULL
            `,
            [discordUserId]
        );

        await client.query(
            `
                DELETE FROM account_link_codes
                WHERE expires_at < NOW() - INTERVAL '1 day'
            `
        );

        await client.query(
            `
                INSERT INTO account_link_codes (
                    discord_user_id,
                    code_hash,
                    expires_at
                )
                VALUES (
                    $1,
                    $2,
                    NOW() + ($3 * INTERVAL '1 minute')
                )
            `,
            [
                discordUserId,
                codeHash,
                ttlMinutes
            ]
        );

        await client.query('COMMIT');

        return {
            code: plainCode,
            expiresInMinutes: ttlMinutes
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

async function recordAudit(
    db,
    {
        firebaseUid,
        discordUserId = null,
        actionType,
        targetId = null,
        details = {}
    }
) {
    await db.query(
        `
            INSERT INTO web_audit_logs (
                firebase_uid,
                discord_user_id,
                action_type,
                target_id,
                details
            )
            VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        [
            firebaseUid,
            discordUserId,
            actionType,
            targetId,
            JSON.stringify(details)
        ]
    );
}

async function consumeLinkCode(
    db,
    {
        firebaseUid,
        codeHash,
        googleEmail = null,
        googleDisplayName = null
    }
) {
    if (!/^[0-9a-f]{64}$/.test(codeHash || '')) {
        const error = new Error(
            '連携コードの形式が正しくありません。'
        );
        error.code = 'INVALID_LINK_CODE';
        throw error;
    }

    const recentFailures = await db.query(
        `
            SELECT COUNT(*)::int AS count
            FROM web_audit_logs
            WHERE firebase_uid = $1
              AND action_type = 'link_failed'
              AND created_at > NOW() - INTERVAL '10 minutes'
        `,
        [firebaseUid]
    );

    if ((recentFailures.rows[0]?.count || 0) >= 10) {
        const error = new Error(
            '連携コードの試行回数が多すぎます。10分ほど待ってから再度お試しください。'
        );
        error.code = 'LINK_RATE_LIMIT';
        throw error;
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            `
                SELECT pg_advisory_xact_lock(
                    hashtextextended($1, 0)
                )
            `,
            [`firebase-link:${firebaseUid}`]
        );

        const codeResult = await client.query(
            `
                SELECT *
                FROM account_link_codes
                WHERE code_hash = $1
                  AND used_at IS NULL
                  AND expires_at > NOW()
                FOR UPDATE
            `,
            [codeHash]
        );

        if (codeResult.rowCount === 0) {
            const error = new Error(
                '連携コードが違うか、有効期限が切れています。Discordで新しいコードを発行してください。'
            );
            error.code = 'INVALID_LINK_CODE';
            throw error;
        }

        const code = codeResult.rows[0];

        const existingUid = await client.query(
            `
                SELECT *
                FROM web_users
                WHERE firebase_uid = $1
                FOR UPDATE
            `,
            [firebaseUid]
        );

        if (
            existingUid.rowCount > 0 &&
            existingUid.rows[0].discord_user_id !==
                code.discord_user_id
        ) {
            const error = new Error(
                'このGoogleアカウントは別のDiscordアカウントと連携済みです。'
            );
            error.code = 'FIREBASE_ALREADY_LINKED';
            throw error;
        }

        const existingDiscord = await client.query(
            `
                SELECT *
                FROM web_users
                WHERE discord_user_id = $1
                FOR UPDATE
            `,
            [code.discord_user_id]
        );

        if (
            existingDiscord.rowCount > 0 &&
            existingDiscord.rows[0].firebase_uid !==
                firebaseUid
        ) {
            const error = new Error(
                'このDiscordアカウントは別のGoogleアカウントと連携済みです。Discordから連携解除してください。'
            );
            error.code = 'DISCORD_ALREADY_LINKED';
            throw error;
        }

        await client.query(
            `
                INSERT INTO web_users (
                    firebase_uid,
                    discord_user_id,
                    google_email,
                    google_display_name,
                    linked_at,
                    last_login_at,
                    is_disabled
                )
                VALUES ($1, $2, $3, $4, NOW(), NOW(), FALSE)
                ON CONFLICT (firebase_uid)
                DO UPDATE SET
                    discord_user_id = EXCLUDED.discord_user_id,
                    google_email = EXCLUDED.google_email,
                    google_display_name = EXCLUDED.google_display_name,
                    last_login_at = NOW(),
                    is_disabled = FALSE
            `,
            [
                firebaseUid,
                code.discord_user_id,
                googleEmail,
                googleDisplayName
            ]
        );

        await client.query(
            `
                UPDATE account_link_codes
                SET used_at = NOW()
                WHERE id = $1
            `,
            [code.id]
        );

        await client.query(
            `
                INSERT INTO web_audit_logs (
                    firebase_uid,
                    discord_user_id,
                    action_type,
                    details
                )
                VALUES ($1, $2, 'link_success', '{}'::jsonb)
            `,
            [firebaseUid, code.discord_user_id]
        );

        await client.query('COMMIT');

        return {
            firebaseUid,
            discordUserId: code.discord_user_id
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => null);

        await recordAudit(
            db,
            {
                firebaseUid,
                actionType: 'link_failed',
                details: {
                    code: error.code || 'UNKNOWN'
                }
            }
        ).catch(() => null);

        throw error;
    } finally {
        client.release();
    }
}

async function getWebUser(db, firebaseUid) {
    const result = await db.query(
        `
            SELECT *
            FROM web_users
            WHERE firebase_uid = $1
              AND is_disabled = FALSE
            LIMIT 1
        `,
        [firebaseUid]
    );

    return result.rows[0] || null;
}

async function touchWebUser(db, firebaseUid) {
    await db.query(
        `
            UPDATE web_users
            SET last_login_at = NOW()
            WHERE firebase_uid = $1
        `,
        [firebaseUid]
    );
}

async function unlinkByFirebaseUid(db, firebaseUid) {
    const result = await db.query(
        `
            DELETE FROM web_users
            WHERE firebase_uid = $1
            RETURNING *
        `,
        [firebaseUid]
    );

    return result.rows[0] || null;
}

async function unlinkByDiscordUser(db, discordUserId) {
    const result = await db.query(
        `
            DELETE FROM web_users
            WHERE discord_user_id = $1
            RETURNING *
        `,
        [discordUserId]
    );

    await db.query(
        `
            DELETE FROM account_link_codes
            WHERE discord_user_id = $1
              AND used_at IS NULL
        `,
        [discordUserId]
    );

    return result.rows[0] || null;
}

module.exports = {
    createLinkCode,
    consumeLinkCode,
    getWebUser,
    hashLinkCode,
    recordAudit,
    touchWebUser,
    unlinkByDiscordUser,
    unlinkByFirebaseUid
};
