
const Database = require("better-sqlite3");
const path = require("node:path");

// Database disimpan di folder database/.
const dbPath = path.join(__dirname, "zero-trust.db");

const db = new Database(dbPath);

// Pengaturan dasar SQLite.
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// Membuat tabel dan indeks.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL
      CHECK (role IN ('admin', 'dosen', 'mahasiswa')),
    full_name TEXT NOT NULL,
    nim TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
      CHECK (is_active IN (0, 1)),
    UNIQUE (user_id, device_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_code TEXT NOT NULL UNIQUE,
    class_name TEXT NOT NULL,
    lecturer_id INTEGER NOT NULL,
    FOREIGN KEY (lecturer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0
      CHECK (score >= 0 AND score <= 100),
    is_final INTEGER NOT NULL DEFAULT 0
      CHECK (is_final IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, student_id),
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, class_id),
    FOREIGN KEY (student_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subject TEXT,
    endpoint TEXT NOT NULL,
    device_id TEXT,
    decision TEXT NOT NULL
      CHECK (decision IN ('allow', 'deny')),
    reason TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_devices_user
    ON devices(user_id, device_id);

  CREATE INDEX IF NOT EXISTS idx_classes_lecturer
    ON classes(lecturer_id);

  CREATE INDEX IF NOT EXISTS idx_grades_student
    ON grades(student_id);

  CREATE INDEX IF NOT EXISTS idx_audit_occurred
    ON audit_logs(occurred_at);
`);

console.log("Database berhasil diinisialisasi.");

module.exports = db;
