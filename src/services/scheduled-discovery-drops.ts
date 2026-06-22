import { db } from './db.js';
import type { SupportedCurrency } from './currency.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';

export type ScheduledDiscoveryDropType = 'WEEKLY_DISCOVERY' | 'MARKET_RADAR' | 'RELEASE_WATCH';
export type ScheduledDiscoveryDropStatus = 'PREPARING' | 'READY' | 'PARTIAL' | 'STALE' | 'FAILED';

export type ScheduledDiscoveryDropItem = {
  position: number;
  suggestion: DiscoverySuggestion;
  imageUrl?: string;
  imageSourceName?: string;
  market: {
    status: string;
    currency: SupportedCurrency;
    askingTotal?: number;
    askingSampleSize?: number;
    soldTotal?: number;
    soldSampleSize?: number;
    listing?: {
      id: string;
      title: string;
      url: string;
    };
    updatedAt?: string;
  };
};

export type ScheduledDiscoveryDrop = {
  userId: string;
  dropType: ScheduledDiscoveryDropType;
  periodKey: string;
  status: ScheduledDiscoveryDropStatus;
  title: string;
  summary?: string;
  currency: SupportedCurrency;
  availableAt: string;
  expiresAt?: string;
  generatedAt: string;
  updatedAt: string;
  sourceStateUpdatedAt?: string;
  marketReadyCount: number;
  imageReadyCount: number;
  itemCount: number;
  items: ScheduledDiscoveryDropItem[];
};

type ScheduledDiscoveryDropRow = {
  user_id: string;
  drop_type: ScheduledDiscoveryDropType;
  period_key: string;
  status: ScheduledDiscoveryDropStatus;
  title: string;
  summary: string | null;
  currency: SupportedCurrency;
  available_at: string;
  expires_at: string | null;
  generated_at: string;
  updated_at: string;
  source_state_updated_at: string | null;
  market_ready_count: number;
  image_ready_count: number;
  item_count: number;
};

type ScheduledDiscoveryDropItemRow = {
  position: number;
  suggestion_name: string;
  suggestion_json: string;
  image_url: string | null;
  image_source_name: string | null;
  market_status: string;
  market_currency: SupportedCurrency;
  asking_total: number | null;
  asking_sample_size: number | null;
  sold_total: number | null;
  sold_sample_size: number | null;
  listing_id: string | null;
  listing_title: string | null;
  listing_url: string | null;
  market_updated_at: string | null;
};

type UpsertScheduledDiscoveryDropInput = {
  userId: string;
  dropType: ScheduledDiscoveryDropType;
  periodKey: string;
  status: ScheduledDiscoveryDropStatus;
  title: string;
  summary?: string;
  currency: SupportedCurrency;
  availableAt: string;
  expiresAt?: string;
  sourceStateUpdatedAt?: string;
  items: ScheduledDiscoveryDropItem[];
};

const upsertScheduledDiscoveryDropStmt = db.prepare(`
  INSERT INTO discovery_scheduled_drops (
    user_id, drop_type, period_key, status, title, summary, currency, available_at, expires_at,
    generated_at, updated_at, source_state_updated_at, market_ready_count, image_ready_count, item_count
  )
  VALUES (
    @user_id, @drop_type, @period_key, @status, @title, @summary, @currency, @available_at, @expires_at,
    @generated_at, @updated_at, @source_state_updated_at, @market_ready_count, @image_ready_count, @item_count
  )
  ON CONFLICT(user_id, drop_type, period_key) DO UPDATE SET
    status = excluded.status,
    title = excluded.title,
    summary = excluded.summary,
    currency = excluded.currency,
    available_at = excluded.available_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at,
    source_state_updated_at = excluded.source_state_updated_at,
    market_ready_count = excluded.market_ready_count,
    image_ready_count = excluded.image_ready_count,
    item_count = excluded.item_count
`);

const deleteScheduledDiscoveryDropItemsStmt = db.prepare(`
  DELETE FROM discovery_scheduled_drop_items
  WHERE user_id = ? AND drop_type = ? AND period_key = ?
`);

const insertScheduledDiscoveryDropItemStmt = db.prepare(`
  INSERT INTO discovery_scheduled_drop_items (
    user_id, drop_type, period_key, position, suggestion_name, suggestion_json, image_url, image_source_name,
    market_status, market_currency, asking_total, asking_sample_size, sold_total, sold_sample_size,
    listing_id, listing_title, listing_url, market_updated_at, created_at, updated_at
  )
  VALUES (
    @user_id, @drop_type, @period_key, @position, @suggestion_name, @suggestion_json, @image_url, @image_source_name,
    @market_status, @market_currency, @asking_total, @asking_sample_size, @sold_total, @sold_sample_size,
    @listing_id, @listing_title, @listing_url, @market_updated_at, @created_at, @updated_at
  )
`);

const getScheduledDiscoveryDropStmt = db.prepare(`
  SELECT user_id, drop_type, period_key, status, title, summary, currency, available_at, expires_at,
         generated_at, updated_at, source_state_updated_at, market_ready_count, image_ready_count, item_count
  FROM discovery_scheduled_drops
  WHERE user_id = ? AND drop_type = ? AND period_key = ?
`);

const getLatestScheduledDiscoveryDropStmt = db.prepare(`
  SELECT user_id, drop_type, period_key, status, title, summary, currency, available_at, expires_at,
         generated_at, updated_at, source_state_updated_at, market_ready_count, image_ready_count, item_count
  FROM discovery_scheduled_drops
  WHERE user_id = ?
    AND drop_type = ?
    AND status IN ('READY', 'PARTIAL')
    AND available_at <= ?
    AND (expires_at IS NULL OR expires_at > ?)
  ORDER BY available_at DESC, updated_at DESC
  LIMIT 1
`);

const listScheduledDiscoveryDropItemsStmt = db.prepare(`
  SELECT position, suggestion_name, suggestion_json, image_url, image_source_name, market_status, market_currency,
         asking_total, asking_sample_size, sold_total, sold_sample_size, listing_id, listing_title, listing_url, market_updated_at
  FROM discovery_scheduled_drop_items
  WHERE user_id = ? AND drop_type = ? AND period_key = ?
  ORDER BY position ASC
`);

const deleteScheduledDiscoveryDropStmt = db.prepare(`
  DELETE FROM discovery_scheduled_drops
  WHERE user_id = ? AND drop_type = ? AND period_key = ?
`);

const countScheduledDiscoveryDropsStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM discovery_scheduled_drops
  WHERE drop_type = ?
    AND period_key = ?
    AND status IN ('READY', 'PARTIAL')
    AND item_count > 0
`);

const countAnnounceableScheduledDiscoveryDropsStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM discovery_scheduled_drops
  WHERE drop_type = ?
    AND period_key = ?
    AND status IN ('READY', 'PARTIAL')
    AND market_ready_count >= ?
`);

const hasScheduledDiscoveryDropAnnouncementStmt = db.prepare(`
  SELECT 1
  FROM discovery_scheduled_drop_announcements
  WHERE guild_id = ? AND drop_type = ? AND period_key = ?
  LIMIT 1
`);

const insertScheduledDiscoveryDropAnnouncementStmt = db.prepare(`
  INSERT OR IGNORE INTO discovery_scheduled_drop_announcements (guild_id, drop_type, period_key, channel_id, message_id, posted_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const deleteScheduledDiscoveryDropAnnouncementStmt = db.prepare(`
  DELETE FROM discovery_scheduled_drop_announcements
  WHERE guild_id = ? AND drop_type = ? AND period_key = ?
`);

function isoWeekStartUtc(date: Date): Date {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc;
}

function isoWeekNumber(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedTime = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return zonedTime - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const localAsUtc = Date.UTC(year, monthIndex, day, hour, minute, second);
  const firstPass = new Date(localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone));
  return new Date(localAsUtc - timeZoneOffsetMs(firstPass, timeZone));
}

function weeklyDiscoveryAvailableAt(weekStart: Date): Date {
  return zonedDateTimeToUtc(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate(), 8, 0, 0, 'America/New_York');
}

function mapScheduledDiscoveryDropItemRow(row: ScheduledDiscoveryDropItemRow): ScheduledDiscoveryDropItem {
  let suggestion: DiscoverySuggestion;
  try {
    suggestion = JSON.parse(row.suggestion_json) as DiscoverySuggestion;
  } catch {
    suggestion = {
      name: row.suggestion_name,
      lane: 'Collector Compass',
      laneWhy: 'prepared weekly collector drop',
      why: 'prepared weekly collector drop',
      nearby: []
    };
  }
  return {
    position: row.position,
    suggestion,
    imageUrl: row.image_url ?? undefined,
    imageSourceName: row.image_source_name ?? undefined,
    market: {
      status: row.market_status,
      currency: row.market_currency,
      askingTotal: row.asking_total ?? undefined,
      askingSampleSize: row.asking_sample_size ?? undefined,
      soldTotal: row.sold_total ?? undefined,
      soldSampleSize: row.sold_sample_size ?? undefined,
      listing:
        row.listing_id && row.listing_title && row.listing_url
          ? {
              id: row.listing_id,
              title: row.listing_title,
              url: row.listing_url
            }
          : undefined,
      updatedAt: row.market_updated_at ?? undefined
    }
  };
}

function mapScheduledDiscoveryDropRow(row: ScheduledDiscoveryDropRow): ScheduledDiscoveryDrop {
  const itemRows = listScheduledDiscoveryDropItemsStmt.all(row.user_id, row.drop_type, row.period_key) as ScheduledDiscoveryDropItemRow[];
  return {
    userId: row.user_id,
    dropType: row.drop_type,
    periodKey: row.period_key,
    status: row.status,
    title: row.title,
    summary: row.summary ?? undefined,
    currency: row.currency,
    availableAt: row.available_at,
    expiresAt: row.expires_at ?? undefined,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    sourceStateUpdatedAt: row.source_state_updated_at ?? undefined,
    marketReadyCount: row.market_ready_count,
    imageReadyCount: row.image_ready_count,
    itemCount: row.item_count,
    items: itemRows.map(mapScheduledDiscoveryDropItemRow)
  };
}

export function scheduledDiscoveryPeriodKey(dropType: ScheduledDiscoveryDropType, date = new Date()): string {
  const { year, week } = isoWeekNumber(date);
  if (dropType === 'WEEKLY_DISCOVERY') return `${year}-W${String(week).padStart(2, '0')}`;
  if (dropType === 'MARKET_RADAR') return `${year}-W${String(week).padStart(2, '0')}-FRI`;
  return `${year}-W${String(week).padStart(2, '0')}-RELEASE`;
}

export function scheduledDiscoveryAvailability(dropType: ScheduledDiscoveryDropType, date = new Date()): { availableAt: string; expiresAt: string } {
  const weekStart = isoWeekStartUtc(date);
  const available = dropType === 'WEEKLY_DISCOVERY'
    ? weeklyDiscoveryAvailableAt(weekStart)
    : dropType === 'MARKET_RADAR'
      ? addDays(weekStart, 4)
      : weekStart;
  const expires = dropType === 'WEEKLY_DISCOVERY' ? addDays(available, 7) : addDays(weekStart, 7);
  return { availableAt: available.toISOString(), expiresAt: expires.toISOString() };
}

export function upsertScheduledDiscoveryDrop(input: UpsertScheduledDiscoveryDropInput, now = new Date().toISOString()): ScheduledDiscoveryDrop {
  const marketReadyCount = input.items.filter((item) => item.market.status === 'READY').length;
  const imageReadyCount = input.items.filter((item) => !!item.imageUrl).length;
  const itemCount = input.items.length;
  const write = db.transaction(() => {
    upsertScheduledDiscoveryDropStmt.run({
      user_id: input.userId,
      drop_type: input.dropType,
      period_key: input.periodKey,
      status: input.status,
      title: input.title,
      summary: input.summary ?? null,
      currency: input.currency,
      available_at: input.availableAt,
      expires_at: input.expiresAt ?? null,
      generated_at: now,
      updated_at: now,
      source_state_updated_at: input.sourceStateUpdatedAt ?? null,
      market_ready_count: marketReadyCount,
      image_ready_count: imageReadyCount,
      item_count: itemCount
    });
    deleteScheduledDiscoveryDropItemsStmt.run(input.userId, input.dropType, input.periodKey);
    for (const item of input.items) {
      insertScheduledDiscoveryDropItemStmt.run({
        user_id: input.userId,
        drop_type: input.dropType,
        period_key: input.periodKey,
        position: item.position,
        suggestion_name: item.suggestion.name,
        suggestion_json: JSON.stringify(item.suggestion),
        image_url: item.imageUrl ?? null,
        image_source_name: item.imageSourceName ?? null,
        market_status: item.market.status,
        market_currency: item.market.currency,
        asking_total: item.market.askingTotal ?? null,
        asking_sample_size: item.market.askingSampleSize ?? null,
        sold_total: item.market.soldTotal ?? null,
        sold_sample_size: item.market.soldSampleSize ?? null,
        listing_id: item.market.listing?.id ?? null,
        listing_title: item.market.listing?.title ?? null,
        listing_url: item.market.listing?.url ?? null,
        market_updated_at: item.market.updatedAt ?? null,
        created_at: now,
        updated_at: now
      });
    }
  });
  write();
  const saved = getScheduledDiscoveryDrop(input.userId, input.dropType, input.periodKey);
  if (!saved) throw new Error('Scheduled Discovery drop was not saved');
  return saved;
}

export function getScheduledDiscoveryDrop(userId: string, dropType: ScheduledDiscoveryDropType, periodKey: string): ScheduledDiscoveryDrop | null {
  const row = getScheduledDiscoveryDropStmt.get(userId, dropType, periodKey) as ScheduledDiscoveryDropRow | undefined;
  return row ? mapScheduledDiscoveryDropRow(row) : null;
}

export function getLatestAvailableScheduledDiscoveryDrop(userId: string, dropType: ScheduledDiscoveryDropType, now = new Date().toISOString()): ScheduledDiscoveryDrop | null {
  const row = getLatestScheduledDiscoveryDropStmt.get(userId, dropType, now, now) as ScheduledDiscoveryDropRow | undefined;
  return row ? mapScheduledDiscoveryDropRow(row) : null;
}

export function deleteScheduledDiscoveryDrop(userId: string, dropType: ScheduledDiscoveryDropType, periodKey: string): void {
  deleteScheduledDiscoveryDropStmt.run(userId, dropType, periodKey);
}

export function countPreparedScheduledDiscoveryDrops(dropType: ScheduledDiscoveryDropType, periodKey: string): number {
  const row = countScheduledDiscoveryDropsStmt.get(dropType, periodKey) as { count: number };
  return Number(row?.count ?? 0);
}

export function countAnnounceableScheduledDiscoveryDrops(dropType: ScheduledDiscoveryDropType, periodKey: string, minMarketReadyItems: number): number {
  const row = countAnnounceableScheduledDiscoveryDropsStmt.get(dropType, periodKey, minMarketReadyItems) as { count: number };
  return Number(row?.count ?? 0);
}

export function hasScheduledDiscoveryDropAnnouncement(guildId: string, dropType: ScheduledDiscoveryDropType, periodKey: string): boolean {
  const row = hasScheduledDiscoveryDropAnnouncementStmt.get(guildId, dropType, periodKey) as { 1: number } | undefined;
  return !!row;
}

export function markScheduledDiscoveryDropAnnouncement(input: {
  guildId: string;
  dropType: ScheduledDiscoveryDropType;
  periodKey: string;
  channelId: string;
  messageId?: string;
  postedAt?: string;
}): boolean {
  const result = insertScheduledDiscoveryDropAnnouncementStmt.run(
    input.guildId,
    input.dropType,
    input.periodKey,
    input.channelId,
    input.messageId ?? null,
    input.postedAt ?? new Date().toISOString()
  );
  return result.changes > 0;
}

export function deleteScheduledDiscoveryDropAnnouncement(guildId: string, dropType: ScheduledDiscoveryDropType, periodKey: string): void {
  deleteScheduledDiscoveryDropAnnouncementStmt.run(guildId, dropType, periodKey);
}