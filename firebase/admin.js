'use strict';

const {
    applicationDefault,
    cert,
    getApps,
    initializeApp
} = require('firebase-admin/app');

const {
    getAuth
} = require('firebase-admin/auth');

const {
    getDatabase
} = require('firebase-admin/database');

let services = null;

function parseServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
        const json = Buffer.from(
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
            'base64'
        ).toString('utf8');

        try {
            return JSON.parse(json);
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is invalid JSON');
        }
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            return JSON.parse(
                process.env.FIREBASE_SERVICE_ACCOUNT_JSON
            );
        } catch (error) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON');
        }
    }

    return null;
}

function getFirebaseServices() {
    if (services) {
        return services;
    }

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!databaseURL) {
        throw new Error(
            'FIREBASE_DATABASE_URL is not configured'
        );
    }

    const serviceAccount =
        parseServiceAccount();

    if (!serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error(
            'Firebase credentials are not configured (set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON_BASE64)'
        );
    }

    const credential = serviceAccount
        ? cert(serviceAccount)
        : applicationDefault();

    const app = getApps()[0] || initializeApp({
        credential,
        databaseURL,
        projectId:
            process.env.FIREBASE_PROJECT_ID ||
            'tk-f83ff'
    });

    services = {
        app,
        auth: getAuth(app),
        database: getDatabase(app)
    };

    console.log('[Firebase Admin] initialized');

    return services;
}

module.exports = {
    getFirebaseServices
};
