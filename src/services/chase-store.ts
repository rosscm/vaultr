import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { normalizePlanTier } from './plans.js';
import type { Chase, SentAlert, UserAlertSettings, UserPlan } from '../types.js';

type ChaseRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  card_name: string;
  priority: 'GRAIL' | 'HIGH' | 'NORMAL';
  target_note: string | null;
  max_price: number | null;
  grade: string | null;
  condition: string | null;
  listing_type: 'ANY' | 'AUCTION' | 'BUY_IT_NOW';
  negative_keywords: string | null;
  created_at: string;
};

function mapRow(row: ChaseRow): Chase {
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id ?? undefined,
    cardName: row.card_name,
    priority: row.priority ?? 'NORMAL',
    targetNote: row.target_note ?? undefined,
    maxPrice: row.max_price ?? undefined,
    grade: row.grade ?? undefined,
    condition: row.condition ?? undefined,
    listingType: row.listing_type ?? 'ANY',
    negativeKeywords: row.negative_keywords
      ? row.negative_keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : undefined,
    createdAt: row.created_at
  };
}

const insertChaseStmt = db.prepare(`
  INSERT INTO chases (id, user_id, guild_id, card_name, priority, target_note, max_price, grade, condition, listing_type, negative_keywords, created_at)
  VALUES (@id, @user_id, @guild_id, @card_name, @priority, @target_note, @max_price, @grade, @condition, @listing_type, @negative_keywords, @created_at)
`);

const listChasesStmt = db.prepare(`
  SELECT id, user_id, guild_id, card_name, priority, target_note, max_price, grade, condition, listing_type, negative_keywords, created_at
  FROM chases
  WHERE user_id = ?
  ORDER BY
    CASE priority
      WHEN 'GRAIL' THEN 1
      WHEN 'HIGH' THEN 2
      ELSE 3
    END ASC,
    created_at ASC
`);

const listAllChasesStmt = db.prepare(`
  SELECT id, user_id, guild_id, card_name, priority, target_note, max_price, grade, condition, listing_type, negative_keywords, created_at
  FROM chases
  ORDER BY created_at DESC
`);

const removeChaseStmt = db.prepare(`
  DELETE FROM chases
  WHERE user_id = ? AND id = ?
`);

const updateChaseStmt = db.prepare(`
  UPDATE chases
  SET card_name = @card_name,
      priority = @priority,
      target_note = @target_note,
      max_price = @max_price,
      grade = @grade,
      condition = @condition,
      listing_type = @listing_type,
      negative_keywords = @negative_keywords
  WHERE user_id = @user_id AND id = @id
`);

const insertSentAlertStmt = db.prepare(`
  INSERT INTO sent_alerts (chase_id, listing_id, source, sent_at, user_id, listing_title, listing_price, listing_currency, listing_url, match_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const hasSentAlertStmt = db.prepare(`
  SELECT 1
  FROM sent_alerts
  WHERE chase_id = ? AND listing_id = ? AND source = ?
  LIMIT 1
`);

const upsertGuildAlertChannelStmt = db.prepare(`
  INSERT INTO guild_alert_channels (guild_id, channel_id, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    updated_at = excluded.updated_at
`);

const getGuildAlertChannelStmt = db.prepare(`
  SELECT channel_id
  FROM guild_alert_channels
  WHERE guild_id = ?
`);

const upsertGuildCommunityFeedStmt = db.prepare(`
  INSERT INTO guild_community_feed (guild_id, enabled, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);

const getGuildCommunityFeedStmt = db.prepare(`
  SELECT enabled
  FROM guild_community_feed
  WHERE guild_id = ?
`);

const countChasesByUserStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM chases
  WHERE user_id = ?
`);

const getUserPlanStmt = db.prepare(`
  SELECT user_id, tier, status, updated_at
  FROM user_plans
  WHERE user_id = ?
`);

const upsertUserPlanStmt = db.prepare(`
  INSERT INTO user_plans (user_id, tier, status, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    tier = excluded.tier,
    status = excluded.status,
    updated_at = excluded.updated_at
`);

const getUserAlertSettingsStmt = db.prepare(`
  SELECT user_id, min_score, max_alerts_per_hour, chase_cooldown_minutes, alert_currency, quiet_hours_start, quiet_hours_end, updated_at
  FROM user_alert_settings
  WHERE user_id = ?
`);

const upsertUserAlertSettingsStmt = db.prepare(`
  INSERT INTO user_alert_settings (user_id, min_score, max_alerts_per_hour, chase_cooldown_minutes, alert_currency, quiet_hours_start, quiet_hours_end, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    min_score = excluded.min_score,
    max_alerts_per_hour = excluded.max_alerts_per_hour,
    chase_cooldown_minutes = excluded.chase_cooldown_minutes,
    alert_currency = excluded.alert_currency,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    updated_at = excluded.updated_at
`);

const countRecentAlertsByUserStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts
  WHERE user_id = ? AND sent_at >= ?
`);

const countRecentAlertsByChaseStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts
  WHERE user_id = ? AND chase_id = ? AND sent_at >= ?
`);

const listRecentAlertsByUserStmt = db.prepare(`
  SELECT chase_id, user_id, listing_id, source, sent_at, listing_title, listing_price, listing_currency, listing_url, match_score
  FROM sent_alerts
  WHERE user_id = ?
  ORDER BY sent_at DESC
  LIMIT ?
`);

const getSentAlertByKeyStmt = db.prepare(`
  SELECT chase_id, user_id, listing_id, source, sent_at, listing_title, listing_price, listing_currency, listing_url, match_score
  FROM sent_alerts
  WHERE user_id = ? AND chase_id = ? AND listing_id = ? AND source = ?
  LIMIT 1
`);

const insertIgnoredFingerprintStmt = db.prepare(`
  INSERT OR IGNORE INTO ignored_listing_fingerprints (user_id, chase_id, fingerprint, created_at)
  VALUES (?, ?, ?, ?)
`);

const hasIgnoredFingerprintStmt = db.prepare(`
  SELECT 1
  FROM ignored_listing_fingerprints
  WHERE user_id = ? AND chase_id = ? AND fingerprint = ?
  LIMIT 1
`);

export function addChase(input: Omit<Chase, 'id' | 'createdAt'>): Chase {
  const chase: Chase = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  insertChaseStmt.run({
    id: chase.id,
    user_id: chase.userId,
    guild_id: chase.guildId ?? null,
    card_name: chase.cardName,
    priority: chase.priority ?? 'NORMAL',
    target_note: chase.targetNote ?? null,
    max_price: chase.maxPrice ?? null,
    grade: chase.grade ?? null,
    condition: chase.condition ?? null,
    listing_type: chase.listingType ?? 'ANY',
    negative_keywords: chase.negativeKeywords?.join(',') ?? null,
    created_at: chase.createdAt
  });

  return chase;
}

export function listChases(userId: string): Chase[] {
  const rows = listChasesStmt.all(userId) as ChaseRow[];
  return rows.map(mapRow);
}

export function countUserChases(userId: string): number {
  const row = countChasesByUserStmt.get(userId) as { count: number };
  return Number(row.count);
}

export function listAllChases(): Chase[] {
  const rows = listAllChasesStmt.all() as ChaseRow[];
  return rows.map(mapRow);
}

export function removeChase(userId: string, chaseId: string): boolean {
  const result = removeChaseStmt.run(userId, chaseId);
  return result.changes > 0;
}

export function updateChase(userId: string, chaseId: string, patch: Partial<Omit<Chase, 'id' | 'userId' | 'createdAt'>>): Chase | null {
  const current = listChases(userId).find((c) => c.id === chaseId);
  if (!current) return null;

  const next: Chase = {
    ...current,
    cardName: patch.cardName ?? current.cardName,
    priority: patch.priority ?? current.priority ?? 'NORMAL',
    targetNote: patch.targetNote ?? current.targetNote,
    maxPrice: patch.maxPrice ?? current.maxPrice,
    grade: patch.grade ?? current.grade,
    condition: patch.condition ?? current.condition,
    listingType: patch.listingType ?? current.listingType ?? 'ANY',
    negativeKeywords: patch.negativeKeywords ?? current.negativeKeywords
  };

  const result = updateChaseStmt.run({
    id: chaseId,
    user_id: userId,
    card_name: next.cardName,
    priority: next.priority ?? 'NORMAL',
    target_note: next.targetNote ?? null,
    max_price: next.maxPrice ?? null,
    grade: next.grade ?? null,
    condition: next.condition ?? null,
    listing_type: next.listingType ?? 'ANY',
    negative_keywords: next.negativeKeywords?.join(',') ?? null
  });

  return result.changes > 0 ? next : null;
}

export function hasAlertBeenSent(chaseId: string, listingId: string, source: 'EBAY'): boolean {
  const row = hasSentAlertStmt.get(chaseId, listingId, source) as { 1: number } | undefined;
  return !!row;
}

export function markAlertSent(chaseId: string, userId: string, listingId: string, source: 'EBAY'): boolean {
  return markAlertSentWithDetails(chaseId, userId, listingId, source, {});
}

export function markAlertSentWithDetails(
  chaseId: string,
  userId: string,
  listingId: string,
  source: 'EBAY',
  details: {
    listingTitle?: string;
    listingPrice?: number;
    listingCurrency?: string;
    listingUrl?: string;
    matchScore?: number;
  }
): boolean {
  try {
    insertSentAlertStmt.run(
      chaseId,
      listingId,
      source,
      new Date().toISOString(),
      userId,
      details.listingTitle ?? null,
      details.listingPrice ?? null,
      details.listingCurrency ?? null,
      details.listingUrl ?? null,
      details.matchScore ?? null
    );
    return true;
  } catch {
    return false;
  }
}

export function setGuildAlertChannel(guildId: string, channelId: string): void {
  upsertGuildAlertChannelStmt.run(guildId, channelId, new Date().toISOString());
}

export function getGuildAlertChannel(guildId: string): string | null {
  const row = getGuildAlertChannelStmt.get(guildId) as { channel_id: string } | undefined;
  return row?.channel_id ?? null;
}

export function setGuildCommandChannel(guildId: string, channelId: string): void {
  setGuildAlertChannel(guildId, channelId);
}

export function getGuildCommandChannel(guildId: string): string | null {
  return getGuildAlertChannel(guildId);
}

export function setGuildCommunityFeedEnabled(guildId: string, enabled: boolean): void {
  upsertGuildCommunityFeedStmt.run(guildId, enabled ? 1 : 0, new Date().toISOString());
}

export function isGuildCommunityFeedEnabled(guildId: string): boolean {
  const row = getGuildCommunityFeedStmt.get(guildId) as { enabled: number } | undefined;
  return (row?.enabled ?? 0) === 1;
}

export function getUserPlan(userId: string): UserPlan {
  const row = getUserPlanStmt.get(userId) as
    | { user_id: string; tier: string; status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; updated_at: string }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    upsertUserPlanStmt.run(userId, 'FREE', 'ACTIVE', now);
    return {
      userId,
      tier: 'FREE',
      status: 'ACTIVE',
      updatedAt: now
    };
  }

  return {
    userId: row.user_id,
    tier: normalizePlanTier(row.tier),
    status: row.status,
    updatedAt: row.updated_at
  };
}

export function setUserPlan(userId: string, tier: 'FREE' | 'PRO', status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE'): UserPlan {
  const now = new Date().toISOString();
  upsertUserPlanStmt.run(userId, tier, status, now);
  return {
    userId,
    tier,
    status,
    updatedAt: now
  };
}

export function getUserAlertSettings(userId: string): UserAlertSettings {
  const row = getUserAlertSettingsStmt.get(userId) as
    | {
        user_id: string;
        min_score: number;
        max_alerts_per_hour: number;
        chase_cooldown_minutes: number;
        alert_currency: 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY';
        quiet_hours_start: number | null;
        quiet_hours_end: number | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    upsertUserAlertSettingsStmt.run(userId, 60, 10, 30, 'USD', null, null, now);
    return {
      userId,
      minScore: 60,
      maxAlertsPerHour: 10,
      chaseCooldownMinutes: 30,
      alertCurrency: 'USD',
      updatedAt: now
    };
  }

  return {
    userId: row.user_id,
    minScore: row.min_score,
    maxAlertsPerHour: row.max_alerts_per_hour,
    chaseCooldownMinutes: row.chase_cooldown_minutes,
    alertCurrency: row.alert_currency ?? 'USD',
    quietHoursStart: row.quiet_hours_start ?? undefined,
    quietHoursEnd: row.quiet_hours_end ?? undefined,
    updatedAt: row.updated_at
  };
}

export function setUserAlertSettings(
  userId: string,
  patch: Partial<
    Pick<UserAlertSettings, 'minScore' | 'maxAlertsPerHour' | 'chaseCooldownMinutes' | 'alertCurrency' | 'quietHoursStart' | 'quietHoursEnd'>
  >
): UserAlertSettings {
  const current = getUserAlertSettings(userId);
  const next: UserAlertSettings = {
    userId,
    minScore: patch.minScore ?? current.minScore,
    maxAlertsPerHour: patch.maxAlertsPerHour ?? current.maxAlertsPerHour,
    chaseCooldownMinutes: patch.chaseCooldownMinutes ?? current.chaseCooldownMinutes,
    alertCurrency: patch.alertCurrency ?? current.alertCurrency,
    quietHoursStart: patch.quietHoursStart ?? current.quietHoursStart,
    quietHoursEnd: patch.quietHoursEnd ?? current.quietHoursEnd,
    updatedAt: new Date().toISOString()
  };

  upsertUserAlertSettingsStmt.run(
    userId,
    next.minScore,
    next.maxAlertsPerHour,
    next.chaseCooldownMinutes,
    next.alertCurrency,
    next.quietHoursStart ?? null,
    next.quietHoursEnd ?? null,
    next.updatedAt
  );

  return next;
}

export function countUserAlertsInLastHour(userId: string): number {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = countRecentAlertsByUserStmt.get(userId, cutoff) as { count: number };
  return Number(row.count);
}

export function countChaseAlertsWithinMinutes(userId: string, chaseId: string, minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = countRecentAlertsByChaseStmt.get(userId, chaseId, cutoff) as { count: number };
  return Number(row.count);
}

export function listRecentAlerts(userId: string, limit = 20): SentAlert[] {
  const rows = listRecentAlertsByUserStmt.all(userId, limit) as Array<{
    chase_id: string;
    user_id: string;
    listing_id: string;
    source: 'EBAY';
    sent_at: string;
    listing_title: string | null;
    listing_price: number | null;
    listing_currency: string | null;
    listing_url: string | null;
    match_score: number | null;
  }>;

  return rows.map((row) => ({
    chaseId: row.chase_id,
    userId: row.user_id,
    listingId: row.listing_id,
    source: row.source,
    sentAt: row.sent_at,
    listingTitle: row.listing_title ?? undefined,
    listingPrice: row.listing_price ?? undefined,
    listingCurrency: row.listing_currency ?? undefined,
    listingUrl: row.listing_url ?? undefined,
    matchScore: row.match_score ?? undefined
  }));
}

export function getSentAlertByKey(
  userId: string,
  chaseId: string,
  listingId: string,
  source: 'EBAY'
): SentAlert | null {
  const row = getSentAlertByKeyStmt.get(userId, chaseId, listingId, source) as
    | {
        chase_id: string;
        user_id: string;
        listing_id: string;
        source: 'EBAY';
        sent_at: string;
        listing_title: string | null;
        listing_price: number | null;
        listing_currency: string | null;
        listing_url: string | null;
        match_score: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    chaseId: row.chase_id,
    userId: row.user_id,
    listingId: row.listing_id,
    source: row.source,
    sentAt: row.sent_at,
    listingTitle: row.listing_title ?? undefined,
    listingPrice: row.listing_price ?? undefined,
    listingCurrency: row.listing_currency ?? undefined,
    listingUrl: row.listing_url ?? undefined,
    matchScore: row.match_score ?? undefined
  };
}

export function addIgnoredListingFingerprint(userId: string, chaseId: string, fingerprint: string): void {
  insertIgnoredFingerprintStmt.run(userId, chaseId, fingerprint, new Date().toISOString());
}

export function isListingFingerprintIgnored(userId: string, chaseId: string, fingerprint: string): boolean {
  const row = hasIgnoredFingerprintStmt.get(userId, chaseId, fingerprint) as { 1: number } | undefined;
  return !!row;
}

export function resetUserAlertSettings(userId: string): UserAlertSettings {
  const now = new Date().toISOString();
  upsertUserAlertSettingsStmt.run(userId, 60, 10, 30, 'USD', null, null, now);
  return {
    userId,
    minScore: 60,
    maxAlertsPerHour: 10,
    chaseCooldownMinutes: 30,
    alertCurrency: 'USD',
    updatedAt: now
  };
}
