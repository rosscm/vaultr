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

const removeAllChasesByUserStmt = db.prepare(`
  DELETE FROM chases
  WHERE user_id = ?
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
  INSERT INTO sent_alerts (chase_id, listing_id, source, sent_at, user_id, guild_id, listing_title, listing_price, listing_currency, price_delta, listing_url, match_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  INSERT INTO guild_community_feed (guild_id, enabled, mode, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    mode = excluded.mode,
    updated_at = excluded.updated_at
`);

const getGuildCommunityFeedStmt = db.prepare(`
  SELECT enabled, mode
  FROM guild_community_feed
  WHERE guild_id = ?
`);

const countChasesByUserStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM chases
  WHERE user_id = ?
`);

const countNewHuntersByGuildTodayStmt = db.prepare(`
  SELECT COUNT(DISTINCT user_id) AS count
  FROM chases
  WHERE guild_id = ? AND created_at >= ?
`);

const insertGuildStartedUserStmt = db.prepare(`
  INSERT OR IGNORE INTO guild_started_users (guild_id, user_id, started_at)
  VALUES (?, ?, ?)
`);

const countStartedUsersByGuildTodayStmt = db.prepare(`
  SELECT COUNT(DISTINCT user_id) AS count
  FROM guild_started_users
  WHERE guild_id = ? AND started_at >= ?
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
  SELECT user_id, min_score, max_alerts_per_hour, chase_cooldown_minutes, alert_currency, show_images, compact_mode, quiet_hours_start, quiet_hours_end, updated_at
  FROM user_alert_settings
  WHERE user_id = ?
`);

const upsertUserAlertSettingsStmt = db.prepare(`
  INSERT INTO user_alert_settings (user_id, min_score, max_alerts_per_hour, chase_cooldown_minutes, alert_currency, show_images, compact_mode, quiet_hours_start, quiet_hours_end, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    min_score = excluded.min_score,
    max_alerts_per_hour = excluded.max_alerts_per_hour,
    chase_cooldown_minutes = excluded.chase_cooldown_minutes,
    alert_currency = excluded.alert_currency,
    show_images = excluded.show_images,
    compact_mode = excluded.compact_mode,
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

const listGuildCommandChannelsStmt = db.prepare(`
  SELECT guild_id, channel_id
  FROM guild_alert_channels
`);

const countGuildAlertsTodayStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts
  WHERE guild_id = ? AND sent_at >= ?
`);

const countGuildUsersAlertedTodayStmt = db.prepare(`
  SELECT COUNT(DISTINCT user_id) AS count
  FROM sent_alerts
  WHERE guild_id = ? AND sent_at >= ?
`);

const hasGuildDailyStatsPostedStmt = db.prepare(`
  SELECT 1
  FROM guild_daily_stats_posts
  WHERE guild_id = ? AND day_key = ?
  LIMIT 1
`);

const insertGuildDailyStatsPostedStmt = db.prepare(`
  INSERT OR IGNORE INTO guild_daily_stats_posts (guild_id, day_key, posted_at)
  VALUES (?, ?, ?)
`);

const hasUserWeeklyReflectionPostedStmt = db.prepare(`
  SELECT 1
  FROM user_weekly_reflection_posts
  WHERE user_id = ? AND week_key = ?
  LIMIT 1
`);

const insertUserWeeklyReflectionPostedStmt = db.prepare(`
  INSERT OR IGNORE INTO user_weekly_reflection_posts (user_id, week_key, posted_at)
  VALUES (?, ?, ?)
`);

const listGuildChaseNamesStmt = db.prepare(`
  SELECT card_name
  FROM chases
  WHERE guild_id = ?
`);

const listGuildRecentAlertTitlesStmt = db.prepare(`
  SELECT listing_title
  FROM sent_alerts
  WHERE guild_id = ? AND sent_at >= ? AND listing_title IS NOT NULL
`);

const countGuildGrailAlertsTodayStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts s
  INNER JOIN chases c ON c.id = s.chase_id
  WHERE s.guild_id = ? AND s.sent_at >= ? AND c.priority = 'GRAIL'
`);

const listUsersWithChasesStmt = db.prepare(`
  SELECT DISTINCT user_id
  FROM chases
`);

const countUserAlertsSinceStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts
  WHERE user_id = ? AND sent_at >= ?
`);

const countUserGrailAlertsSinceStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sent_alerts s
  INNER JOIN chases c ON c.id = s.chase_id
  WHERE s.user_id = ? AND s.sent_at >= ? AND c.priority = 'GRAIL'
`);

const countUserNewChasesSinceStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM chases
  WHERE user_id = ? AND created_at >= ?
`);

const listUserRecentAlertsSinceStmt = db.prepare(`
  SELECT listing_title
  FROM sent_alerts
  WHERE user_id = ? AND sent_at >= ? AND listing_title IS NOT NULL
  ORDER BY sent_at DESC
  LIMIT 25
`);

const upsertAlertFeedbackStmt = db.prepare(`
  INSERT INTO alert_feedback (user_id, chase_id, listing_id, feedback, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, chase_id, listing_id) DO UPDATE SET
    feedback = excluded.feedback,
    created_at = excluded.created_at
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

export function countGuildNewHuntersToday(guildId: string): number {
  const now = new Date();
  const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const row = countNewHuntersByGuildTodayStmt.get(guildId, localDayStart) as { count: number };
  return Number(row.count);
}

export function markGuildUserStarted(guildId: string, userId: string): boolean {
  const result = insertGuildStartedUserStmt.run(guildId, userId, new Date().toISOString());
  return result.changes > 0;
}

export function countGuildStartedUsersToday(guildId: string): number {
  const now = new Date();
  const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const row = countStartedUsersByGuildTodayStmt.get(guildId, localDayStart) as { count: number };
  return Number(row.count);
}

export function getGuildCommunityStatsToday(guildId: string): {
  newVaultrs: number;
  usersAlerted: number;
  matches: number;
  grailsSurfaced: number;
  topTrackedFamily: string;
  topTrackedTheme: string;
  hiddenDiscovery: string;
} {
  const now = new Date();
  const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const newVaultrs = countGuildStartedUsersToday(guildId);
  const usersRow = countGuildUsersAlertedTodayStmt.get(guildId, localDayStart) as { count: number };
  const matchesRow = countGuildAlertsTodayStmt.get(guildId, localDayStart) as { count: number };
  const grailsRow = countGuildGrailAlertsTodayStmt.get(guildId, localDayStart) as { count: number };
  const chaseNames = (listGuildChaseNamesStmt.all(guildId) as Array<{ card_name: string }>).map((row) => row.card_name);
  const alertTitles = (
    listGuildRecentAlertTitlesStmt.all(guildId, localDayStart) as Array<{ listing_title: string }>
  ).map((row) => row.listing_title);
  const collectorText = [...chaseNames, ...alertTitles];

  return {
    newVaultrs,
    usersAlerted: Number(usersRow?.count ?? 0),
    matches: Number(matchesRow?.count ?? 0),
    grailsSurfaced: Number(grailsRow?.count ?? 0),
    topTrackedFamily: inferFamilyFromText(collectorText) ?? 'Mixed collections',
    topTrackedTheme: inferThemeFromText(collectorText) ?? 'Varied styles',
    hiddenDiscovery: alertTitles[0] ?? 'No fresh spotlight yet'
  };
}

export function hasPostedGuildDailyStats(guildId: string, dayKey: string): boolean {
  const row = hasGuildDailyStatsPostedStmt.get(guildId, dayKey) as { 1: number } | undefined;
  return !!row;
}

export function markPostedGuildDailyStats(guildId: string, dayKey: string): boolean {
  const result = insertGuildDailyStatsPostedStmt.run(guildId, dayKey, new Date().toISOString());
  return result.changes > 0;
}

export function hasPostedUserWeeklyReflection(userId: string, weekKey: string): boolean {
  const row = hasUserWeeklyReflectionPostedStmt.get(userId, weekKey) as { 1: number } | undefined;
  return !!row;
}

export function markPostedUserWeeklyReflection(userId: string, weekKey: string): boolean {
  const result = insertUserWeeklyReflectionPostedStmt.run(userId, weekKey, new Date().toISOString());
  return result.changes > 0;
}

export function listUsersWithChases(): string[] {
  const rows = listUsersWithChasesStmt.all() as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

export function getUserWeeklyReflectionSummary(
  userId: string,
  sinceIso: string
): {
  alertsReceived: number;
  grailsSurfaced: number;
  newChasesAdded: number;
  topTasteFamily: string;
  topTasteTheme: string;
  recentDiscovery: string;
} {
  const alertsRow = countUserAlertsSinceStmt.get(userId, sinceIso) as { count: number };
  const grailsRow = countUserGrailAlertsSinceStmt.get(userId, sinceIso) as { count: number };
  const chasesRow = countUserNewChasesSinceStmt.get(userId, sinceIso) as { count: number };
  const titles = (listUserRecentAlertsSinceStmt.all(userId, sinceIso) as Array<{ listing_title: string }>).map(
    (row) => row.listing_title
  );
  const chases = listChases(userId).map((chase) => chase.cardName);

  return {
    alertsReceived: Number(alertsRow?.count ?? 0),
    grailsSurfaced: Number(grailsRow?.count ?? 0),
    newChasesAdded: Number(chasesRow?.count ?? 0),
    topTasteFamily: inferFamilyFromText([...titles, ...chases]) ?? 'Mixed collection',
    topTasteTheme: inferThemeFromText([...titles, ...chases]) ?? 'Varied styles',
    recentDiscovery: titles[0] ?? 'No new discoveries this week'
  };
}

export function listAllChases(): Chase[] {
  const rows = listAllChasesStmt.all() as ChaseRow[];
  return rows.map(mapRow);
}

export function removeChase(userId: string, chaseId: string): boolean {
  const result = removeChaseStmt.run(userId, chaseId);
  return result.changes > 0;
}

export function removeAllChases(userId: string): number {
  const result = removeAllChasesByUserStmt.run(userId);
  return result.changes;
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
    guildId?: string;
    listingTitle?: string;
    listingPrice?: number;
    listingCurrency?: string;
    priceDelta?: number;
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
      details.guildId ?? null,
      details.listingTitle ?? null,
      details.listingPrice ?? null,
      details.listingCurrency ?? null,
      details.priceDelta ?? null,
      details.listingUrl ?? null,
      details.matchScore ?? null
    );
    return true;
  } catch {
    return false;
  }
}

export function recordAlertFeedback(
  userId: string,
  chaseId: string,
  listingId: string,
  feedback: 'GOOD_MATCH' | 'NOT_FOR_ME'
): void {
  upsertAlertFeedbackStmt.run(userId, chaseId, listingId, feedback, new Date().toISOString());
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

export function listGuildCommandChannels(): Array<{ guildId: string; channelId: string }> {
  const rows = listGuildCommandChannelsStmt.all() as Array<{ guild_id: string; channel_id: string }>;
  return rows.map((row) => ({ guildId: row.guild_id, channelId: row.channel_id }));
}

export type CommunityFeedMode = 'OFF' | 'PULSE' | 'MILESTONES';

export function setGuildCommunityFeedMode(guildId: string, mode: CommunityFeedMode): void {
  const normalized = mode === 'OFF' ? 'OFF' : mode;
  upsertGuildCommunityFeedStmt.run(guildId, normalized === 'OFF' ? 0 : 1, normalized, new Date().toISOString());
}

export function isGuildCommunityFeedEnabled(guildId: string): boolean {
  const row = getGuildCommunityFeedStmt.get(guildId) as { enabled: number; mode: CommunityFeedMode | null } | undefined;
  return (row?.enabled ?? 0) === 1;
}

export function getGuildCommunityFeedMode(guildId: string): CommunityFeedMode {
  const row = getGuildCommunityFeedStmt.get(guildId) as { enabled: number; mode: CommunityFeedMode | null } | undefined;
  if (!row) return 'PULSE';
  if (row.enabled === 0) return 'OFF';
  if (row.mode === 'MILESTONES' || row.mode === 'PULSE') return row.mode;
  return 'PULSE';
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
        show_images: number;
        compact_mode: number;
        quiet_hours_start: number | null;
        quiet_hours_end: number | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    upsertUserAlertSettingsStmt.run(userId, 60, 10, 30, 'USD', 1, 0, null, null, now);
    return {
      userId,
      minScore: 60,
      maxAlertsPerHour: 10,
      chaseCooldownMinutes: 30,
      alertCurrency: 'USD',
      showImages: true,
      compactMode: false,
      updatedAt: now
    };
  }

  return {
    userId: row.user_id,
    minScore: row.min_score,
    maxAlertsPerHour: row.max_alerts_per_hour,
    chaseCooldownMinutes: row.chase_cooldown_minutes,
    alertCurrency: row.alert_currency ?? 'USD',
    showImages: (row.show_images ?? 1) === 1,
    compactMode: (row.compact_mode ?? 0) === 1,
    quietHoursStart: row.quiet_hours_start ?? undefined,
    quietHoursEnd: row.quiet_hours_end ?? undefined,
    updatedAt: row.updated_at
  };
}

export function setUserAlertSettings(
  userId: string,
  patch: Partial<
    Pick<
      UserAlertSettings,
      'minScore' | 'maxAlertsPerHour' | 'chaseCooldownMinutes' | 'alertCurrency' | 'showImages' | 'compactMode' | 'quietHoursStart' | 'quietHoursEnd'
    >
  >
): UserAlertSettings {
  const current = getUserAlertSettings(userId);
  const next: UserAlertSettings = {
    userId,
    minScore: patch.minScore ?? current.minScore,
    maxAlertsPerHour: patch.maxAlertsPerHour ?? current.maxAlertsPerHour,
    chaseCooldownMinutes: patch.chaseCooldownMinutes ?? current.chaseCooldownMinutes,
    alertCurrency: patch.alertCurrency ?? current.alertCurrency,
    showImages: patch.showImages ?? current.showImages,
    compactMode: patch.compactMode ?? current.compactMode,
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
    next.showImages ? 1 : 0,
    next.compactMode ? 1 : 0,
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
  upsertUserAlertSettingsStmt.run(userId, 60, 10, 30, 'USD', 1, 0, null, null, now);
  return {
    userId,
    minScore: 60,
    maxAlertsPerHour: 10,
    chaseCooldownMinutes: 30,
    alertCurrency: 'USD',
    showImages: true,
    compactMode: false,
    updatedAt: now
  };
}

function inferFamilyFromText(values: string[]): string | null {
  const text = values.join(' ').toLowerCase();
  const families = [
    'umbreon',
    'espeon',
    'pikachu',
    'charizard',
    'rayquaza',
    'gengar',
    'mewtwo',
    'mew',
    'lugia',
    'darkrai',
    'eevee',
    'squirtle',
    'bulbasaur',
    'charmander'
  ];
  let best: { name: string; count: number } | null = null;
  for (const name of families) {
    const count = text.split(name).length - 1;
    if (count <= 0) continue;
    if (!best || count > best.count) best = { name, count };
  }
  if (!best) return null;
  return `${best.name.charAt(0).toUpperCase()}${best.name.slice(1)} line`;
}

function inferThemeFromText(values: string[]): string | null {
  const text = values.join(' ').toLowerCase();
  const themes: Array<{ label: string; keywords: string[] }> = [
    { label: 'dark atmospheric artwork', keywords: ['dark', 'night', 'moon', 'shadow'] },
    { label: 'vintage-era cards', keywords: ['vintage', '1st edition', 'wotc', 'neo', 'ex', 'base set', 'fossil'] },
    { label: 'Japanese exclusives', keywords: ['japanese', 'jp', 'promo', 'poncho', 'vending', 'web series'] },
    { label: 'full-art chase cards', keywords: ['alt art', 'full art', 'illustration', 'special art', 'sar', 'sir'] },
    { label: 'graded slab targets', keywords: ['psa', 'bgs', 'cgc', 'gem mint', 'mint 10'] },
    { label: 'starter-era nostalgia', keywords: ['squirtle', 'bulbasaur', 'charmander', 'pikachu', 'base set'] }
  ];
  let best: { label: string; count: number } | null = null;
  for (const theme of themes) {
    const count = theme.keywords.reduce((sum, keyword) => sum + (text.split(keyword).length - 1), 0);
    if (count <= 0) continue;
    if (!best || count > best.count) best = { label: theme.label, count };
  }
  return best?.label ?? null;
}
