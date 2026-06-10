import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { makeAlertFeedbackToken } from './alert-feedback-token.js';
import { normalizePlanTier } from './plans.js';
import type { Chase, ListingSource, ListingSourceModePreference, SentAlert, UserAlertSettings, UserPlan } from '../types.js';

type TasteMemorySource = NonNullable<Chase['tasteSource']>;

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

export type DiscoveryVaultAction = {
  token: string;
  userId: string;
  cardName: string;
  lane: string;
  maxPrice?: number;
  createdAt: string;
  expiresAt: string;
};

type DiscoveryVaultActionRow = {
  token: string;
  user_id: string;
  card_name: string;
  lane: string;
  max_price: number | null;
  created_at: string;
  expires_at: string;
};

type UserTasteMemoryRow = {
  user_id: string;
  signal_id: string;
  source: TasteMemorySource;
  card_name: string;
  max_price: number | null;
  weight: number;
  interaction_count: number;
  first_interacted_at: string;
  last_interacted_at: string;
};

export type UserDiscoveryFeedback = 'MORE_LIKE_THIS' | 'NOT_FOR_ME';

type UserDiscoveryFeedbackRow = {
  suggestion_name: string;
  lane: string;
  feedback: UserDiscoveryFeedback;
  interaction_count: number;
  last_interacted_at: string;
};

export type UserDiscoveryState = {
  userId: string;
  mode: string;
  profileFingerprint: string;
  suggestionNames: string[];
  updatedAt: string;
};

type UserDiscoveryStateRow = {
  user_id: string;
  mode: string;
  profile_fingerprint: string;
  suggestion_names_json: string;
  updated_at: string;
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
  SELECT user_id, min_score, max_alerts_per_hour, alert_currency, shipping_country, shipping_postal_code, listing_source_mode, updated_at
  FROM user_alert_settings
  WHERE user_id = ?
`);

const upsertUserAlertSettingsStmt = db.prepare(`
  INSERT INTO user_alert_settings (user_id, min_score, max_alerts_per_hour, alert_currency, shipping_country, shipping_postal_code, listing_source_mode, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    min_score = excluded.min_score,
    max_alerts_per_hour = excluded.max_alerts_per_hour,
    alert_currency = excluded.alert_currency,
    shipping_country = excluded.shipping_country,
    shipping_postal_code = excluded.shipping_postal_code,
    listing_source_mode = excluded.listing_source_mode,
    updated_at = excluded.updated_at
`);

function normalizeStoredShippingPostalCode(value: string | undefined, country: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (country === 'CA') {
    const compact = normalized.replace(/[\s-]+/g, '');
    const match = /^([A-Z]\d[A-Z])(?:\d[A-Z]\d)?$/.exec(compact);
    return match?.[1];
  }
  if (country === 'US') {
    const match = /^(\d{5})(?:[- ]?\d{4})?$/.exec(normalized);
    return match?.[1];
  }
  return undefined;
}

const listRecentUserDiscoverySeenStmt = db.prepare(`
  SELECT suggestion_name
  FROM user_discovery_seen
  WHERE user_id = ?
  ORDER BY last_seen_at DESC
  LIMIT ?
`);

const upsertUserDiscoverySeenStmt = db.prepare(`
  INSERT INTO user_discovery_seen (user_id, suggestion_name, first_seen_at, last_seen_at, times_seen)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(user_id, suggestion_name) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    times_seen = user_discovery_seen.times_seen + 1
`);

const upsertUserDiscoveryFeedbackStmt = db.prepare(`
  INSERT INTO user_discovery_feedback (user_id, suggestion_name, lane, feedback, interaction_count, first_interacted_at, last_interacted_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(user_id, suggestion_name) DO UPDATE SET
    lane = excluded.lane,
    feedback = excluded.feedback,
    interaction_count = user_discovery_feedback.interaction_count + 1,
    last_interacted_at = excluded.last_interacted_at
`);

const listRecentUserDiscoveryFeedbackStmt = db.prepare(`
  SELECT suggestion_name, lane, feedback, interaction_count, last_interacted_at
  FROM user_discovery_feedback
  WHERE user_id = ? AND feedback = ?
  ORDER BY last_interacted_at DESC
  LIMIT ?
`);

const getUserDiscoveryFeedbackStmt = db.prepare(`
  SELECT suggestion_name, lane, feedback, interaction_count, last_interacted_at
  FROM user_discovery_feedback
  WHERE user_id = ? AND suggestion_name = ?
  LIMIT 1
`);

const deleteUserDiscoveryFeedbackStmt = db.prepare(`
  DELETE FROM user_discovery_feedback
  WHERE user_id = ? AND suggestion_name = ?
`);

const getUserDiscoveryStateStmt = db.prepare(`
  SELECT user_id, mode, profile_fingerprint, suggestion_names_json, updated_at
  FROM user_discovery_state
  WHERE user_id = ? AND mode = ?
  LIMIT 1
`);

const upsertUserDiscoveryStateStmt = db.prepare(`
  INSERT INTO user_discovery_state (user_id, mode, profile_fingerprint, suggestion_names_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, mode) DO UPDATE SET
    profile_fingerprint = excluded.profile_fingerprint,
    suggestion_names_json = excluded.suggestion_names_json,
    updated_at = excluded.updated_at
`);

function mapUserDiscoveryState(row: UserDiscoveryStateRow): UserDiscoveryState {
  let suggestionNames: string[] = [];
  try {
    const parsed = JSON.parse(row.suggestion_names_json) as unknown;
    if (Array.isArray(parsed)) suggestionNames = parsed.filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  } catch {
    suggestionNames = [];
  }
  return {
    userId: row.user_id,
    mode: row.mode,
    profileFingerprint: row.profile_fingerprint,
    suggestionNames,
    updatedAt: row.updated_at
  };
}

function normalizeListingSourceModePreference(value: string | null | undefined): ListingSourceModePreference {
  if (value === 'EBAY' || value === 'EBAY_SHOPIFY' || value === 'SHOPIFY') return value;
  return 'EBAY';
}

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
  SELECT sa.chase_id, ch.card_name, sa.user_id, sa.listing_id, sa.source, sa.sent_at,
         sa.listing_title, sa.listing_price, sa.listing_currency, sa.listing_url, sa.match_score
  FROM sent_alerts sa
  LEFT JOIN chases ch ON ch.id = sa.chase_id AND ch.user_id = sa.user_id
  WHERE sa.user_id = ?
  ORDER BY sa.sent_at DESC
  LIMIT ?
`);

const getSentAlertByKeyStmt = db.prepare(`
  SELECT chase_id, user_id, listing_id, source, sent_at, listing_title, listing_price, listing_currency, listing_url, match_score
  FROM sent_alerts
  WHERE user_id = ? AND chase_id = ? AND listing_id = ? AND source = ?
  LIMIT 1
`);

const listSentAlertsByChaseStmt = db.prepare(`
  SELECT chase_id, user_id, listing_id, source, sent_at, listing_title, listing_price, listing_currency, listing_url, match_score
  FROM sent_alerts
  WHERE user_id = ? AND chase_id = ?
  ORDER BY sent_at DESC
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
  INSERT INTO alert_feedback (user_id, chase_id, listing_id, feedback, feedback_reason, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, chase_id, listing_id) DO UPDATE SET
    feedback = excluded.feedback,
    feedback_reason = excluded.feedback_reason,
    created_at = excluded.created_at
`);

const listAlertFeedbackSummarySinceStmt = db.prepare(`
  SELECT feedback, feedback_reason, COUNT(*) AS count
  FROM alert_feedback
  WHERE user_id = ? AND created_at >= ?
  GROUP BY feedback, feedback_reason
  ORDER BY count DESC
`);

const listTopFeedbackChasesSinceStmt = db.prepare(`
  SELECT af.chase_id, ch.card_name, af.feedback_reason, COUNT(*) AS count
  FROM alert_feedback af
  LEFT JOIN chases ch ON ch.id = af.chase_id AND ch.user_id = af.user_id
  WHERE af.user_id = ?
    AND af.created_at >= ?
    AND af.feedback = 'TUNE_OUT'
    AND af.feedback_reason IS NOT NULL
  GROUP BY af.chase_id, ch.card_name, af.feedback_reason
  ORDER BY count DESC
  LIMIT ?
`);

const getChasePollStateStmt = db.prepare(`
  SELECT last_checked_at
  FROM chase_poll_state
  WHERE chase_id = ?
`);

const upsertChasePollStateStmt = db.prepare(`
  INSERT INTO chase_poll_state (chase_id, last_checked_at)
  VALUES (?, ?)
  ON CONFLICT(chase_id) DO UPDATE SET
    last_checked_at = excluded.last_checked_at
`);

const deleteChasePollStateStmt = db.prepare(`
  DELETE FROM chase_poll_state
  WHERE chase_id = ?
`);

const deleteChasePollStateByUserStmt = db.prepare(`
  DELETE FROM chase_poll_state
  WHERE chase_id IN (
    SELECT id FROM chases WHERE user_id = ?
  )
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

const insertDiscoveryVaultActionStmt = db.prepare(`
  INSERT INTO discovery_vault_actions (token, user_id, card_name, lane, max_price, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getDiscoveryVaultActionStmt = db.prepare(`
  SELECT token, user_id, card_name, lane, max_price, created_at, expires_at
  FROM discovery_vault_actions
  WHERE token = ? AND user_id = ? AND expires_at > ?
  LIMIT 1
`);

const deleteExpiredDiscoveryVaultActionsStmt = db.prepare(`
  DELETE FROM discovery_vault_actions
  WHERE expires_at <= ?
`);

const upsertUserTasteMemoryStmt = db.prepare(`
  INSERT INTO user_taste_memory (user_id, signal_id, source, card_name, max_price, weight, interaction_count, first_interacted_at, last_interacted_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(user_id, signal_id, source) DO UPDATE SET
    card_name = excluded.card_name,
    max_price = COALESCE(excluded.max_price, user_taste_memory.max_price),
    weight = MAX(user_taste_memory.weight, excluded.weight),
    interaction_count = user_taste_memory.interaction_count + 1,
    last_interacted_at = excluded.last_interacted_at
`);

const listUserTasteMemoryStmt = db.prepare(`
  SELECT user_id, signal_id, source, card_name, max_price, weight, interaction_count, first_interacted_at, last_interacted_at
  FROM user_taste_memory
  WHERE user_id = ?
  ORDER BY weight DESC, interaction_count DESC, last_interacted_at DESC
  LIMIT ?
`);

const deleteUserTasteMemoryStmt = db.prepare(`
  DELETE FROM user_taste_memory
  WHERE user_id = ? AND signal_id = ? AND source = ?
`);

function mapDiscoveryVaultAction(row: DiscoveryVaultActionRow): DiscoveryVaultAction {
  return {
    token: row.token,
    userId: row.user_id,
    cardName: row.card_name,
    lane: row.lane,
    maxPrice: row.max_price ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function tasteMemoryWeight(source: TasteMemorySource): number {
  if (source === 'GOOD_ALERT') return 0.85;
  if (source === 'BOUGHT_OR_SEEN') return 0.8;
  if (source === 'DISCOVERY_ADD') return 0.8;
  if (source === 'DISCOVERY_LIKE') return 0.65;
  if (source === 'REMOVED_CHASE') return 0.35;
  return 1;
}

function reinforcedTasteMemoryWeight(row: UserTasteMemoryRow): number {
  if (row.source === 'REMOVED_CHASE') return row.weight;
  const reinforcement = Math.min(0.6, Math.max(0, row.interaction_count - 1) * 0.15);
  const cap = row.source === 'DISCOVERY_LIKE' ? 1.25 : 1.4;
  return Math.min(cap, row.weight + reinforcement);
}

function rememberTasteSignal(input: {
  userId: string;
  signalId: string;
  source: TasteMemorySource;
  cardName: string;
  maxPrice?: number;
  weight?: number;
}): void {
  const now = new Date().toISOString();
  const cardName = input.cardName.trim();
  if (!cardName) return;
  upsertUserTasteMemoryStmt.run(
    input.userId,
    input.signalId,
    input.source,
    cardName,
    input.maxPrice ?? null,
    input.weight ?? tasteMemoryWeight(input.source),
    now,
    now
  );
}

function discoveryTasteSignalId(cardName: string): string {
  return cardName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function currentChaseForTaste(userId: string, chaseId: string): Chase | undefined {
  return listChases(userId).find((chase) => chase.id === chaseId);
}

function mapTasteMemoryRow(row: UserTasteMemoryRow): Chase {
  return {
    id: `taste:${row.source}:${row.signal_id}`,
    userId: row.user_id,
    cardName: row.card_name,
    maxPrice: row.max_price ?? undefined,
    priority: 'NORMAL',
    createdAt: row.first_interacted_at,
    tasteWeight: reinforcedTasteMemoryWeight(row),
    tasteSource: row.source
  };
}

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

export function createDiscoveryVaultAction(input: {
  token: string;
  userId: string;
  cardName: string;
  lane: string;
  maxPrice?: number;
  expiresAt: string;
}): DiscoveryVaultAction {
  const createdAt = new Date().toISOString();
  insertDiscoveryVaultActionStmt.run(
    input.token,
    input.userId,
    input.cardName,
    input.lane,
    input.maxPrice ?? null,
    createdAt,
    input.expiresAt
  );
  return {
    token: input.token,
    userId: input.userId,
    cardName: input.cardName,
    lane: input.lane,
    maxPrice: input.maxPrice,
    createdAt,
    expiresAt: input.expiresAt
  };
}

export function getDiscoveryVaultAction(userId: string, token: string): DiscoveryVaultAction | null {
  const row = getDiscoveryVaultActionStmt.get(token, userId, new Date().toISOString()) as DiscoveryVaultActionRow | undefined;
  return row ? mapDiscoveryVaultAction(row) : null;
}

export function deleteExpiredDiscoveryVaultActions(): number {
  const result = deleteExpiredDiscoveryVaultActionsStmt.run(new Date().toISOString());
  return result.changes;
}

export function listChases(userId: string): Chase[] {
  const rows = listChasesStmt.all(userId) as ChaseRow[];
  return rows.map(mapRow);
}

export function listUserTasteMemoryChases(userId: string, limit = 24): Chase[] {
  const rows = listUserTasteMemoryStmt.all(userId, limit) as UserTasteMemoryRow[];
  return rows.map(mapTasteMemoryRow);
}

export function recordDiscoveryAddTaste(userId: string, cardName: string, maxPrice?: number): void {
  rememberTasteSignal({
    userId,
    signalId: discoveryTasteSignalId(cardName),
    source: 'DISCOVERY_ADD',
    cardName,
    maxPrice
  });
}

export function recordDiscoveryFeedback(input: {
  userId: string;
  cardName: string;
  lane: string;
  feedback: UserDiscoveryFeedback;
  maxPrice?: number;
}): void {
  const now = new Date().toISOString();
  upsertUserDiscoveryFeedbackStmt.run(input.userId, input.cardName, input.lane, input.feedback, now, now);
  if (input.feedback === 'MORE_LIKE_THIS') {
    rememberTasteSignal({
      userId: input.userId,
      signalId: discoveryTasteSignalId(input.cardName),
      source: 'DISCOVERY_LIKE',
      cardName: input.cardName,
      maxPrice: input.maxPrice
    });
  } else {
    deleteUserTasteMemoryStmt.run(input.userId, discoveryTasteSignalId(input.cardName), 'DISCOVERY_LIKE');
  }
}

export function undoDiscoveryFeedback(input: {
  userId: string;
  cardName: string;
}): { suggestionName: string; lane: string; feedback: UserDiscoveryFeedback; interactionCount: number; lastInteractedAt: string } | null {
  const undo = db.transaction(() => {
    const row = getUserDiscoveryFeedbackStmt.get(input.userId, input.cardName) as UserDiscoveryFeedbackRow | undefined;
    if (!row) return null;
    deleteUserDiscoveryFeedbackStmt.run(input.userId, input.cardName);
    if (row.feedback === 'MORE_LIKE_THIS') {
      deleteUserTasteMemoryStmt.run(input.userId, discoveryTasteSignalId(input.cardName), 'DISCOVERY_LIKE');
    }
    return {
      suggestionName: row.suggestion_name,
      lane: row.lane,
      feedback: row.feedback,
      interactionCount: row.interaction_count,
      lastInteractedAt: row.last_interacted_at
    };
  });
  return undo();
}

export function listRecentUserDiscoveryFeedback(
  userId: string,
  feedback: UserDiscoveryFeedback,
  limit = 24
): Array<{ suggestionName: string; lane: string; feedback: UserDiscoveryFeedback; interactionCount: number; lastInteractedAt: string }> {
  const rows = listRecentUserDiscoveryFeedbackStmt.all(userId, feedback, limit) as UserDiscoveryFeedbackRow[];
  return rows.map((row) => ({
    suggestionName: row.suggestion_name,
    lane: row.lane,
    feedback: row.feedback,
    interactionCount: row.interaction_count,
    lastInteractedAt: row.last_interacted_at
  }));
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
    topTrackedFamily: inferFamilyFromText(collectorText, 2) ?? 'Mixed collections',
    topTrackedTheme: inferThemeFromText(collectorText) ?? 'Varied styles',
    hiddenDiscovery: alertTitles[0] ?? 'Quiet spotlight: chases are still watching'
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
  const chase = currentChaseForTaste(userId, chaseId);
  const result = db.transaction(() => {
    if (chase) {
      rememberTasteSignal({
        userId,
        signalId: chase.id,
        source: 'REMOVED_CHASE',
        cardName: chase.cardName,
        maxPrice: chase.maxPrice
      });
    }
    const removed = removeChaseStmt.run(userId, chaseId);
    if (removed.changes > 0) deleteChasePollStateStmt.run(chaseId);
    return removed;
  })();
  return result.changes > 0;
}

export function removeAllChases(userId: string): number {
  const chases = listChases(userId);
  const result = db.transaction(() => {
    for (const chase of chases) {
      rememberTasteSignal({
        userId,
        signalId: chase.id,
        source: 'REMOVED_CHASE',
        cardName: chase.cardName,
        maxPrice: chase.maxPrice
      });
    }
    deleteChasePollStateByUserStmt.run(userId);
    return removeAllChasesByUserStmt.run(userId);
  })();
  return result.changes;
}

export function getChaseLastPollCheckAt(chaseId: string): string | undefined {
  const row = getChasePollStateStmt.get(chaseId) as { last_checked_at: string } | undefined;
  return row?.last_checked_at;
}

export function markChasesPollChecked(chaseIds: string[], checkedAtIso = new Date().toISOString()): void {
  if (chaseIds.length === 0) return;
  const uniqueChaseIds = [...new Set(chaseIds)];
  const persist = db.transaction((ids: string[], timestamp: string) => {
    for (const chaseId of ids) {
      upsertChasePollStateStmt.run(chaseId, timestamp);
    }
  });
  persist(uniqueChaseIds, checkedAtIso);
}

export function updateChase(
  userId: string,
  chaseId: string,
  patch: Partial<Omit<Chase, 'id' | 'userId' | 'createdAt' | 'targetNote' | 'maxPrice' | 'grade' | 'condition' | 'negativeKeywords'>> & {
    targetNote?: string | null;
    maxPrice?: number | null;
    grade?: string | null;
    condition?: string | null;
    negativeKeywords?: string[] | null;
  }
): Chase | null {
  const current = listChases(userId).find((c) => c.id === chaseId);
  if (!current) return null;

  const next: Chase = {
    ...current,
    cardName: patch.cardName ?? current.cardName,
    priority: patch.priority ?? current.priority ?? 'NORMAL',
    targetNote: patch.targetNote === null ? undefined : patch.targetNote ?? current.targetNote,
    maxPrice: patch.maxPrice === null ? undefined : patch.maxPrice ?? current.maxPrice,
    grade: patch.grade === null ? undefined : patch.grade ?? current.grade,
    condition: patch.condition === null ? undefined : patch.condition ?? current.condition,
    listingType: patch.listingType ?? current.listingType ?? 'ANY',
    negativeKeywords: patch.negativeKeywords === null ? undefined : patch.negativeKeywords ?? current.negativeKeywords
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

export function hasAlertBeenSent(chaseId: string, listingId: string, source: ListingSource): boolean {
  const row = hasSentAlertStmt.get(chaseId, listingId, source) as { 1: number } | undefined;
  return !!row;
}

export function markAlertSent(chaseId: string, userId: string, listingId: string, source: ListingSource): boolean {
  return markAlertSentWithDetails(chaseId, userId, listingId, source, {});
}

export function markAlertSentWithDetails(
  chaseId: string,
  userId: string,
  listingId: string,
  source: ListingSource,
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
  feedback: 'GOOD_ALERT' | 'TUNE_OUT',
  reason?: string
): void {
  upsertAlertFeedbackStmt.run(userId, chaseId, listingId, feedback, reason ?? null, new Date().toISOString());
  const chase = currentChaseForTaste(userId, chaseId);
  if (!chase) return;
  if (feedback === 'GOOD_ALERT') {
    rememberTasteSignal({
      userId,
      signalId: chaseId,
      source: 'GOOD_ALERT',
      cardName: chase.cardName,
      maxPrice: chase.maxPrice
    });
  } else if (reason === 'ALREADY_SEEN_BOUGHT') {
    rememberTasteSignal({
      userId,
      signalId: chaseId,
      source: 'BOUGHT_OR_SEEN',
      cardName: chase.cardName,
      maxPrice: chase.maxPrice
    });
  }
}

export type AlertFeedbackReason =
  | 'WRONG_CARD'
  | 'WRONG_GRADE_TYPE'
  | 'CONDITION_ISSUE'
  | 'PRICE_SHIPPING'
  | 'SELLER_CONCERN'
  | 'ALREADY_SEEN_BOUGHT'
  | 'JUST_NOT_INTERESTED';

export type AlertFeedbackInsights = {
  sinceIso: string;
  goodAlerts: number;
  tuneOuts: number;
  reasons: Array<{ reason: AlertFeedbackReason; count: number }>;
  topChases: Array<{
    chaseId: string;
    chaseName: string;
    reason: AlertFeedbackReason;
    count: number;
  }>;
};

export function getAlertFeedbackInsights(userId: string, days = 30): AlertFeedbackInsights {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const summaryRows = listAlertFeedbackSummarySinceStmt.all(userId, sinceIso) as Array<{
    feedback: 'GOOD_ALERT' | 'TUNE_OUT';
    feedback_reason: AlertFeedbackReason | null;
    count: number;
  }>;
  const topChaseRows = listTopFeedbackChasesSinceStmt.all(userId, sinceIso, 3) as Array<{
    chase_id: string;
    card_name: string | null;
    feedback_reason: AlertFeedbackReason;
    count: number;
  }>;

  return {
    sinceIso,
    goodAlerts: summaryRows
      .filter((row) => row.feedback === 'GOOD_ALERT')
      .reduce((total, row) => total + Number(row.count), 0),
    tuneOuts: summaryRows
      .filter((row) => row.feedback === 'TUNE_OUT')
      .reduce((total, row) => total + Number(row.count), 0),
    reasons: summaryRows
      .filter((row) => row.feedback === 'TUNE_OUT' && row.feedback_reason)
      .map((row) => ({ reason: row.feedback_reason as AlertFeedbackReason, count: Number(row.count) })),
    topChases: topChaseRows.map((row) => ({
      chaseId: row.chase_id,
      chaseName: row.card_name ?? row.chase_id,
      reason: row.feedback_reason,
      count: Number(row.count)
    }))
  };
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
        alert_currency: 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY';
        shipping_country: string | null;
        shipping_postal_code: string | null;
        listing_source_mode: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    upsertUserAlertSettingsStmt.run(userId, 60, 10, 'USD', null, null, 'EBAY', now);
    return {
      userId,
      minScore: 60,
      maxAlertsPerHour: 10,
      alertCurrency: 'USD',
      listingSourceMode: 'EBAY',
      updatedAt: now
    };
  }

  return {
    userId: row.user_id,
    minScore: row.min_score,
    maxAlertsPerHour: row.max_alerts_per_hour,
    alertCurrency: row.alert_currency ?? 'USD',
    shippingCountry: row.shipping_country ?? undefined,
    shippingPostalCode: row.shipping_postal_code ?? undefined,
    listingSourceMode: normalizeListingSourceModePreference(row.listing_source_mode),
    updatedAt: row.updated_at
  };
}

export function setUserAlertSettings(
  userId: string,
  patch: Partial<
    Pick<
      UserAlertSettings,
      | 'minScore'
      | 'maxAlertsPerHour'
      | 'alertCurrency'
      | 'listingSourceMode'
    >
  > & { shippingCountry?: string | null; shippingPostalCode?: string | null }
): UserAlertSettings {
  const current = getUserAlertSettings(userId);
  const next: UserAlertSettings = {
    userId,
    minScore: patch.minScore ?? current.minScore,
    maxAlertsPerHour: patch.maxAlertsPerHour ?? current.maxAlertsPerHour,
    alertCurrency: patch.alertCurrency ?? current.alertCurrency,
    shippingCountry: patch.shippingCountry === null ? undefined : patch.shippingCountry ?? current.shippingCountry,
    shippingPostalCode:
      patch.shippingCountry === null || patch.shippingPostalCode === null
        ? undefined
        : normalizeStoredShippingPostalCode(patch.shippingPostalCode ?? current.shippingPostalCode, patch.shippingCountry ?? current.shippingCountry),
    listingSourceMode: patch.listingSourceMode ?? current.listingSourceMode,
    updatedAt: new Date().toISOString()
  };

  upsertUserAlertSettingsStmt.run(
    userId,
    next.minScore,
    next.maxAlertsPerHour,
    next.alertCurrency,
    next.shippingCountry ?? null,
    next.shippingPostalCode ?? null,
    next.listingSourceMode,
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
    card_name: string | null;
    user_id: string;
    listing_id: string;
    source: ListingSource;
    sent_at: string;
    listing_title: string | null;
    listing_price: number | null;
    listing_currency: string | null;
    listing_url: string | null;
    match_score: number | null;
  }>;

  return rows.map((row) => ({
    chaseId: row.chase_id,
    chaseName: row.card_name ?? undefined,
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
  source: ListingSource
): SentAlert | null {
  const row = getSentAlertByKeyStmt.get(userId, chaseId, listingId, source) as
    | {
        chase_id: string;
        user_id: string;
        listing_id: string;
        source: ListingSource;
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

export function getSentAlertByFeedbackToken(userId: string, chaseId: string, feedbackToken: string): SentAlert | null {
  const rows = listSentAlertsByChaseStmt.all(userId, chaseId) as Array<{
    chase_id: string;
    user_id: string;
    listing_id: string;
    source: ListingSource;
    sent_at: string;
    listing_title: string | null;
    listing_price: number | null;
    listing_currency: string | null;
    listing_url: string | null;
    match_score: number | null;
  }>;
  const row = rows.find((candidate) => makeAlertFeedbackToken(candidate.chase_id, candidate.listing_id) === feedbackToken);
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
  upsertUserAlertSettingsStmt.run(userId, 60, 10, 'USD', null, null, 'EBAY', now);
  return {
    userId,
    minScore: 60,
    maxAlertsPerHour: 10,
    alertCurrency: 'USD',
    listingSourceMode: 'EBAY',
    updatedAt: now
  };
}

export function listRecentUserDiscoverySeenNames(userId: string, limit = 24): string[] {
  const rows = listRecentUserDiscoverySeenStmt.all(userId, limit) as Array<{ suggestion_name: string }>;
  return rows.map((row) => row.suggestion_name);
}

export function markUserDiscoverySuggestionsSeen(userId: string, suggestionNames: string[]): void {
  const now = new Date().toISOString();
  const uniqueSuggestionNames = [...new Set(suggestionNames.map((name) => name.trim()).filter(Boolean))];
  for (const suggestionName of uniqueSuggestionNames) upsertUserDiscoverySeenStmt.run(userId, suggestionName, now, now);
}

export function getUserDiscoveryState(userId: string, mode: string): UserDiscoveryState | null {
  const row = getUserDiscoveryStateStmt.get(userId, mode) as UserDiscoveryStateRow | undefined;
  return row ? mapUserDiscoveryState(row) : null;
}

export function upsertUserDiscoveryState(input: { userId: string; mode: string; profileFingerprint: string; suggestionNames: string[] }): void {
  const now = new Date().toISOString();
  const suggestionNames = [...new Set(input.suggestionNames.map((name) => name.trim()).filter(Boolean))];
  upsertUserDiscoveryStateStmt.run(input.userId, input.mode, input.profileFingerprint, JSON.stringify(suggestionNames), now);
}

function inferFamilyFromText(values: string[], minimumMentions = 1): string | null {
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
    if (count < minimumMentions) continue;
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
