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
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    target_note TEXT,
    max_price REAL,
    grade TEXT,
    condition TEXT,
    region TEXT NOT NULL DEFAULT 'ANY',
    listing_type TEXT NOT NULL DEFAULT 'ANY',
    negative_keywords TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chases_user_id ON chases(user_id);

  CREATE TABLE IF NOT EXISTS sent_alerts (
    chase_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    source TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    guild_id TEXT,
    listing_title TEXT,
    listing_price REAL,
    listing_currency TEXT,
    price_delta REAL,
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
    chase_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    alert_currency TEXT NOT NULL DEFAULT 'USD',
    show_images INTEGER NOT NULL DEFAULT 1,
    compact_mode INTEGER NOT NULL DEFAULT 0,
    quiet_hours_start INTEGER,
    quiet_hours_end INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_community_feed (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'PULSE',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ignored_listing_fingerprints (
    user_id TEXT NOT NULL,
    chase_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, chase_id, fingerprint)
  );

  CREATE TABLE IF NOT EXISTS guild_started_users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS guild_daily_stats_posts (
    guild_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, day_key)
  );

  CREATE TABLE IF NOT EXISTS user_weekly_reflection_posts (
    user_id TEXT NOT NULL,
    week_key TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, week_key)
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
  db.exec(`ALTER TABLE chases ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'ANY';`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE chases ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL';`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE chases ADD COLUMN target_note TEXT;`);
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
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN guild_id TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN price_delta REAL;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN chase_cooldown_minutes INTEGER NOT NULL DEFAULT 30;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN alert_currency TEXT NOT NULL DEFAULT 'USD';`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN show_images INTEGER NOT NULL DEFAULT 1;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN compact_mode INTEGER NOT NULL DEFAULT 0;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE guild_community_feed ADD COLUMN mode TEXT NOT NULL DEFAULT 'PULSE';`);
} catch {
  // Column already exists on upgraded databases.
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_chases_guild_id ON chases(guild_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_user_time ON sent_alerts(user_id, sent_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_guild_time ON sent_alerts(guild_id, sent_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ignored_listing_fingerprints_user_chase ON ignored_listing_fingerprints(user_id, chase_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_guild_started_users_guild_time ON guild_started_users(guild_id, started_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_weekly_reflection_posts_user_week ON user_weekly_reflection_posts(user_id, week_key);`);
