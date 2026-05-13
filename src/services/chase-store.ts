import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import type { Chase } from '../types.js';

type ChaseRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  card_name: string;
  max_price: number | null;
  grade: string | null;
  condition: string | null;
  region: 'CA' | 'US' | 'ANY';
  created_at: string;
};

function mapRow(row: ChaseRow): Chase {
  return {
    id: row.id,
    userId: row.user_id,
    guildId: row.guild_id ?? undefined,
    cardName: row.card_name,
    maxPrice: row.max_price ?? undefined,
    grade: row.grade ?? undefined,
    condition: row.condition ?? undefined,
    region: row.region,
    createdAt: row.created_at
  };
}

const insertChaseStmt = db.prepare(`
  INSERT INTO chases (id, user_id, guild_id, card_name, max_price, grade, condition, region, created_at)
  VALUES (@id, @user_id, @guild_id, @card_name, @max_price, @grade, @condition, @region, @created_at)
`);

const listChasesStmt = db.prepare(`
  SELECT id, user_id, guild_id, card_name, max_price, grade, condition, region, created_at
  FROM chases
  WHERE user_id = ?
  ORDER BY created_at DESC
`);

const listAllChasesStmt = db.prepare(`
  SELECT id, user_id, guild_id, card_name, max_price, grade, condition, region, created_at
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
      max_price = @max_price,
      grade = @grade,
      condition = @condition,
      region = @region
  WHERE user_id = @user_id AND id = @id
`);

const insertSentAlertStmt = db.prepare(`
  INSERT INTO sent_alerts (chase_id, listing_id, source, sent_at)
  VALUES (?, ?, ?, ?)
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
    max_price: chase.maxPrice ?? null,
    grade: chase.grade ?? null,
    condition: chase.condition ?? null,
    region: chase.region ?? 'ANY',
    created_at: chase.createdAt
  });

  return chase;
}

export function listChases(userId: string): Chase[] {
  const rows = listChasesStmt.all(userId) as ChaseRow[];
  return rows.map(mapRow);
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
    maxPrice: patch.maxPrice ?? current.maxPrice,
    grade: patch.grade ?? current.grade,
    condition: patch.condition ?? current.condition,
    region: patch.region ?? current.region
  };

  const result = updateChaseStmt.run({
    id: chaseId,
    user_id: userId,
    card_name: next.cardName,
    max_price: next.maxPrice ?? null,
    grade: next.grade ?? null,
    condition: next.condition ?? null,
    region: next.region ?? 'ANY'
  });

  return result.changes > 0 ? next : null;
}

export function markAlertSentIfNew(chaseId: string, listingId: string, source: 'EBAY'): boolean {
  try {
    insertSentAlertStmt.run(chaseId, listingId, source, new Date().toISOString());
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
