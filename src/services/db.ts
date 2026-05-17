import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbFile = process.env.DATABASE_PATH ?? './data/vaultr.db';
const resolvedDbPath = path.resolve(dbFile);

fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

export const db = new Database(resolvedDbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS chases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    card_name TEXT NOT NULL,
    max_price REAL,
    grade TEXT,
    condition TEXT,
    region TEXT NOT NULL DEFAULT 'ANY',
    negative_keywords TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chases_user_id ON chases(user_id);

  CREATE TABLE IF NOT EXISTS sent_alerts (
    chase_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    source TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    listing_title TEXT,
    listing_price REAL,
    listing_currency TEXT,
    listing_url TEXT,
    match_score INTEGER,
    PRIMARY KEY (chase_id, listing_id, source)
  );

  CREATE TABLE IF NOT EXISTS guild_alert_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_plans (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'FREE',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_alert_settings (
    user_id TEXT PRIMARY KEY,
    min_score INTEGER NOT NULL DEFAULT 50,
    max_alerts_per_hour INTEGER NOT NULL DEFAULT 20,
    quiet_hours_start INTEGER,
    quiet_hours_end INTEGER,
    updated_at TEXT NOT NULL
  );
`);

try {
  db.exec(`ALTER TABLE chases ADD COLUMN guild_id TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE chases ADD COLUMN negative_keywords TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}

try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN user_id TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN listing_title TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN listing_price REAL;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN listing_currency TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN listing_url TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN match_score INTEGER;`);
} catch {
  // Column already exists on upgraded databases.
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_chases_guild_id ON chases(guild_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_user_time ON sent_alerts(user_id, sent_at);`);
