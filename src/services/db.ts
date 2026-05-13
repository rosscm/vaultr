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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chases_user_id ON chases(user_id);
  CREATE INDEX IF NOT EXISTS idx_chases_guild_id ON chases(guild_id);

  CREATE TABLE IF NOT EXISTS sent_alerts (
    chase_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    source TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (chase_id, listing_id, source)
  );

  CREATE TABLE IF NOT EXISTS guild_alert_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

try {
  db.exec(`ALTER TABLE chases ADD COLUMN guild_id TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
