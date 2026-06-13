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

const createTableSql = `
CREATE TABLE IF NOT EXISTS work_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    task_name TEXT,
    color TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER
);
`;

let resolveReady;
let rejectReady;

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
	if (err) {
		console.error('Failed to open database:', err);
		rejectReady(err);
		return;
	}

	db.serialize(() => {
		db.run(createTableSql, (createErr) => {
			if (createErr) {
				console.error('Failed to create work_sessions table:', createErr);
				rejectReady(createErr);
				return;
			}
			console.log('[DB] ensured work_sessions table exists');
			resolveReady();
		});
	});
});

db.ready = new Promise((resolve, reject) => {
	resolveReady = resolve;
	rejectReady = reject;
});

module.exports = db;