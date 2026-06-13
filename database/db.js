const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
const dbDir = path.dirname(dbPath);

console.log(`[DB] opening SQLite path=${dbPath}`);

// Ensure data directory exists and is writable
try {
	fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
} catch (err) {
	console.error('Failed to ensure database directory:', err);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
	if (err) {
		console.error('Failed to open database:', err);
		if (dbPath !== '/tmp/database.sqlite') {
			console.warn('[DB] retrying with fallback /tmp/database.sqlite');
			const fallbackPath = '/tmp/database.sqlite';
			const fallbackDir = path.dirname(fallbackPath);
			try {
				fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o755 });
			} catch (mkdirErr) {
				console.error('Failed to ensure fallback database directory:', mkdirErr);
			}
			const fallbackDb = new sqlite3.Database(fallbackPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (fallbackErr) => {
				if (fallbackErr) {
					console.error('Failed to open fallback database:', fallbackErr);
				}
			});
			module.exports = fallbackDb;
		}
	}
});

module.exports = db;