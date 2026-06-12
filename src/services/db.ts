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
    listing_posted_at TEXT,
    alert_latency_seconds INTEGER,
    source_first_seen_at TEXT,
    source_last_seen_at TEXT,
    source_rank INTEGER,
    PRIMARY KEY (chase_id, listing_id, source)
  );

  CREATE TABLE IF NOT EXISTS source_observations (
    chase_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    query_key TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    source_rank INTEGER,
    listing_title TEXT,
    listing_price REAL,
    listing_currency TEXT,
    listing_posted_at TEXT,
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
    alert_currency TEXT NOT NULL DEFAULT 'USD',
    shipping_country TEXT,
    shipping_postal_code TEXT,
    listing_source_mode TEXT NOT NULL DEFAULT 'EBAY',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_discovery_preferences (
    user_id TEXT NOT NULL,
    focus TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, focus)
  );

  CREATE TABLE IF NOT EXISTS user_discovery_seen (
    user_id TEXT NOT NULL,
    suggestion_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, suggestion_name)
  );

  CREATE TABLE IF NOT EXISTS user_discovery_feedback (
    user_id TEXT NOT NULL,
    suggestion_name TEXT NOT NULL,
    lane TEXT NOT NULL,
    feedback TEXT NOT NULL,
    interaction_count INTEGER NOT NULL DEFAULT 1,
    first_interacted_at TEXT NOT NULL,
    last_interacted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, suggestion_name)
  );

  CREATE TABLE IF NOT EXISTS user_discovery_state (
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    profile_fingerprint TEXT NOT NULL,
    suggestion_names_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mode)
  );

  CREATE TABLE IF NOT EXISTS discovery_market_cache (
    cache_key TEXT PRIMARY KEY,
    suggestion_name TEXT NOT NULL,
    display_currency TEXT NOT NULL,
    destination_country TEXT,
    listing_id TEXT,
    listing_title TEXT,
    listing_url TEXT,
    image_url TEXT,
    typical_raw_asking_total REAL,
    market_sample_size INTEGER,
    typical_raw_sold_total REAL,
    sold_sample_size INTEGER,
    source_status TEXT,
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_market_refresh_jobs (
    cache_key TEXT PRIMARY KEY,
    suggestion_name TEXT NOT NULL,
    suggestion_json TEXT NOT NULL,
    user_id TEXT NOT NULL,
    active_chases_json TEXT NOT NULL,
    destination_json TEXT,
    range_json TEXT,
    target_currency TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    run_after TEXT NOT NULL,
    locked_by TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_discovery_market_refresh_jobs_status_run_after
    ON discovery_market_refresh_jobs(status, run_after, priority, created_at);

  CREATE INDEX IF NOT EXISTS idx_discovery_market_refresh_jobs_locked_by
    ON discovery_market_refresh_jobs(locked_by, locked_at);

  CREATE TABLE IF NOT EXISTS discovery_reference_cache (
    cache_key TEXT PRIMARY KEY,
    suggestion_name TEXT NOT NULL,
    image_url TEXT,
    source_name TEXT,
    source_card_id TEXT,
    source_status TEXT,
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_scheduled_drops (
    user_id TEXT NOT NULL,
    drop_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PREPARING',
    title TEXT NOT NULL,
    summary TEXT,
    currency TEXT NOT NULL,
    available_at TEXT NOT NULL,
    expires_at TEXT,
    generated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_state_updated_at TEXT,
    market_ready_count INTEGER NOT NULL DEFAULT 0,
    image_ready_count INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, drop_type, period_key)
  );

  CREATE TABLE IF NOT EXISTS discovery_scheduled_drop_items (
    user_id TEXT NOT NULL,
    drop_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    suggestion_name TEXT NOT NULL,
    suggestion_json TEXT NOT NULL,
    image_url TEXT,
    image_source_name TEXT,
    market_status TEXT NOT NULL,
    market_currency TEXT NOT NULL,
    asking_total REAL,
    asking_sample_size INTEGER,
    sold_total REAL,
    sold_sample_size INTEGER,
    listing_id TEXT,
    listing_title TEXT,
    listing_url TEXT,
    market_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, drop_type, period_key, position),
    FOREIGN KEY (user_id, drop_type, period_key)
      REFERENCES discovery_scheduled_drops(user_id, drop_type, period_key)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discovery_scheduled_drop_announcements (
    guild_id TEXT NOT NULL,
    drop_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    posted_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, drop_type, period_key)
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

  CREATE TABLE IF NOT EXISTS alert_feedback (
    user_id TEXT NOT NULL,
    chase_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    feedback TEXT NOT NULL,
    feedback_reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, chase_id, listing_id)
  );

  CREATE TABLE IF NOT EXISTS chase_poll_state (
    chase_id TEXT PRIMARY KEY,
    last_checked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_vault_actions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    card_name TEXT NOT NULL,
    lane TEXT NOT NULL,
    max_price REAL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_taste_memory (
    user_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    source TEXT NOT NULL,
    card_name TEXT NOT NULL,
    max_price REAL,
    weight REAL NOT NULL,
    interaction_count INTEGER NOT NULL DEFAULT 1,
    first_interacted_at TEXT NOT NULL,
    last_interacted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, signal_id, source)
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
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN listing_posted_at TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN alert_latency_seconds INTEGER;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN source_first_seen_at TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN source_last_seen_at TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE sent_alerts ADD COLUMN source_rank INTEGER;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN alert_currency TEXT NOT NULL DEFAULT 'USD';`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN shipping_country TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN shipping_postal_code TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}
db.exec(`
  UPDATE user_alert_settings
  SET shipping_postal_code = substr(replace(replace(upper(shipping_postal_code), ' ', ''), '-', ''), 1, 3)
  WHERE shipping_country = 'CA' AND shipping_postal_code IS NOT NULL;

  UPDATE user_alert_settings
  SET shipping_postal_code = substr(replace(replace(upper(shipping_postal_code), ' ', ''), '-', ''), 1, 5)
  WHERE shipping_country = 'US' AND shipping_postal_code IS NOT NULL;

  UPDATE user_alert_settings
  SET shipping_postal_code = NULL
  WHERE shipping_country NOT IN ('CA', 'US') AND shipping_postal_code IS NOT NULL;
`);
try {
  db.exec(`ALTER TABLE user_alert_settings ADD COLUMN listing_source_mode TEXT NOT NULL DEFAULT 'EBAY';`);
} catch {
  // Column already exists on upgraded databases.
}
db.exec(`UPDATE user_alert_settings SET listing_source_mode = 'EBAY' WHERE listing_source_mode = 'DEFAULT';`);
try {
  db.exec(`ALTER TABLE user_alert_settings DROP COLUMN quiet_hours_start;`);
} catch {
  // Column is already absent on fresh or upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings DROP COLUMN quiet_hours_end;`);
} catch {
  // Column is already absent on fresh or upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings DROP COLUMN chase_cooldown_minutes;`);
} catch {
  // Column is already absent on fresh or upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings DROP COLUMN show_images;`);
} catch {
  // Column is already absent on fresh or upgraded databases.
}
try {
  db.exec(`ALTER TABLE user_alert_settings DROP COLUMN compact_mode;`);
} catch {
  // Column is already absent on fresh or upgraded databases.
}
try {
  db.exec(`ALTER TABLE discovery_market_cache ADD COLUMN typical_raw_sold_total REAL;`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE discovery_market_cache ADD COLUMN sold_sample_size INTEGER;`);
} catch {
  // Column already exists on upgraded databases.
}
db.exec(`
  DELETE FROM discovery_market_cache
  WHERE cache_key LIKE '%|%|%|'
    AND EXISTS (
      SELECT 1
      FROM discovery_market_cache AS country_cache
      WHERE country_cache.cache_key = substr(discovery_market_cache.cache_key, 1, length(discovery_market_cache.cache_key) - 1)
    );

  UPDATE discovery_market_cache
  SET cache_key = substr(cache_key, 1, length(cache_key) - 1)
  WHERE cache_key LIKE '%|%|%|';
`);

const legacyDiscoveryMarketCacheRows = db.prepare(`
  SELECT cache_key, suggestion_name, display_currency, destination_country
  FROM discovery_market_cache
  WHERE cache_key NOT LIKE '[%'
`).all() as Array<{ cache_key: string; suggestion_name: string; display_currency: string; destination_country: string | null }>;
const discoveryMarketCacheKeyExistsStmt = db.prepare(`SELECT 1 FROM discovery_market_cache WHERE cache_key = ?`);
const updateDiscoveryMarketCacheKeyStmt = db.prepare(`UPDATE discovery_market_cache SET cache_key = ? WHERE cache_key = ?`);
const deleteDiscoveryMarketCacheKeyStmt = db.prepare(`DELETE FROM discovery_market_cache WHERE cache_key = ?`);
for (const row of legacyDiscoveryMarketCacheRows) {
  const structuredKey = JSON.stringify([
    row.suggestion_name.trim().toLowerCase(),
    row.display_currency,
    row.destination_country?.trim().toUpperCase() ?? ''
  ]);
  if (structuredKey === row.cache_key) continue;
  if (discoveryMarketCacheKeyExistsStmt.get(structuredKey)) {
    deleteDiscoveryMarketCacheKeyStmt.run(row.cache_key);
  } else {
    updateDiscoveryMarketCacheKeyStmt.run(structuredKey, row.cache_key);
  }
}

const discoveryPreferenceColumns = db.prepare(`PRAGMA table_info(user_discovery_preferences);`).all() as Array<{ name: string; pk: number }>;
const hasMultiFocusDiscoveryPreferenceKey = discoveryPreferenceColumns.some((column) => column.name === 'user_id' && column.pk === 1) && discoveryPreferenceColumns.some((column) => column.name === 'focus' && column.pk === 2);
if (discoveryPreferenceColumns.length > 0 && !hasMultiFocusDiscoveryPreferenceKey) {
  db.exec(`
    DROP TABLE IF EXISTS user_discovery_preferences_next;
    CREATE TABLE user_discovery_preferences_next (
      user_id TEXT NOT NULL,
      focus TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, focus)
    );
    INSERT OR IGNORE INTO user_discovery_preferences_next (user_id, focus, updated_at)
    SELECT user_id, TRIM(focus), updated_at
    FROM user_discovery_preferences
    WHERE focus IS NOT NULL AND TRIM(focus) != '';
    DROP TABLE user_discovery_preferences;
    ALTER TABLE user_discovery_preferences_next RENAME TO user_discovery_preferences;
  `);
}
try {
  db.exec(`ALTER TABLE guild_community_feed ADD COLUMN mode TEXT NOT NULL DEFAULT 'PULSE';`);
} catch {
  // Column already exists on upgraded databases.
}
try {
  db.exec(`ALTER TABLE alert_feedback ADD COLUMN feedback_reason TEXT;`);
} catch {
  // Column already exists on upgraded databases.
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_chases_guild_id ON chases(guild_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_user_time ON sent_alerts(user_id, sent_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_guild_time ON sent_alerts(guild_id, sent_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_listing_lookup ON sent_alerts(chase_id, listing_id, source);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_alerts_latency ON sent_alerts(alert_latency_seconds);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_source_observations_user_seen ON source_observations(user_id, last_seen_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_source_observations_listing ON source_observations(listing_id, source);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_source_observations_last_seen ON source_observations(last_seen_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ignored_listing_fingerprints_user_chase ON ignored_listing_fingerprints(user_id, chase_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_guild_started_users_guild_time ON guild_started_users(guild_id, started_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_weekly_reflection_posts_user_week ON user_weekly_reflection_posts(user_id, week_key);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_discovery_preferences_user_updated ON user_discovery_preferences(user_id, updated_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_discovery_seen_user_last_seen ON user_discovery_seen(user_id, last_seen_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_user_discovery_feedback_user_feedback ON user_discovery_feedback(user_id, feedback, last_interacted_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_market_cache_suggestion ON discovery_market_cache(suggestion_name, fetched_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_reference_cache_suggestion ON discovery_reference_cache(suggestion_name, fetched_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_scheduled_drops_user_available ON discovery_scheduled_drops(user_id, drop_type, available_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_scheduled_drops_status_available ON discovery_scheduled_drops(drop_type, status, available_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_scheduled_drop_items_lookup ON discovery_scheduled_drop_items(user_id, drop_type, period_key, position);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_vault_actions_user ON discovery_vault_actions(user_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_vault_actions_expires ON discovery_vault_actions(expires_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_feedback_user_time ON alert_feedback(user_id, created_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_chase_poll_state_last_checked ON chase_poll_state(last_checked_at);`);
