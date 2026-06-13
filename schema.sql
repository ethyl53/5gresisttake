CREATE TABLE IF NOT EXISTS work_sessions (
id INTEGER PRIMARY KEY AUTOINCREMENT,

user_id TEXT NOT NULL,

task_name TEXT,

color TEXT,

start_time INTEGER NOT NULL,

end_time INTEGER,

duration INTEGER

);