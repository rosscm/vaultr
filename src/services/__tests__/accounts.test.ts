import { describe, expect, it } from 'vitest';
import {
  createUser,
  getIdentitiesForUser,
  getIdentity,
  getIdentityForUser,
  resolveDiscordUserId,
  resolveOrCreateDiscordUser
} from '../accounts.js';
import { db, migrateLegacyDiscordUserIdsToAccounts } from '../db.js';

function cleanupUserIds(userIds: string[]): void {
  for (const userId of userIds) {
    db.prepare('DELETE FROM discovery_scheduled_drop_items WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM discovery_scheduled_drops WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_alert_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM chases WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_identities WHERE user_id = ? OR provider_user_id = ?').run(userId, userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
}

function seedLegacyUser(discordUserId: string, suffix: string): void {
  db.prepare(
    `INSERT INTO web_sessions (
      token_hash, user_id, discord_username, discord_global_name, discord_avatar, created_at, expires_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `legacy-token-${suffix}`,
    discordUserId,
    `collector-${suffix}`,
    `Collector ${suffix}`,
    `avatar-${suffix}`,
    '2026-08-20T10:00:00.000Z',
    '2026-09-20T10:00:00.000Z',
    '2026-08-21T10:00:00.000Z'
  );
  db.prepare(
    `INSERT INTO chases (id, user_id, guild_id, card_name, priority, created_at)
     VALUES (?, ?, ?, ?, 'NORMAL', ?)`
  ).run(`legacy-chase-${suffix}`, discordUserId, `guild-${suffix}`, `Mew ${suffix}`, '2026-08-20T10:00:00.000Z');
  db.prepare(
    `INSERT INTO user_plans (user_id, tier, status, updated_at)
     VALUES (?, 'PRO', 'ACTIVE', ?)`
  ).run(discordUserId, '2026-08-20T10:00:00.000Z');
  db.prepare(
    `INSERT INTO user_alert_settings (user_id, min_score, max_alerts_per_hour, alert_currency, listing_source_mode, updated_at)
     VALUES (?, 70, 10, 'CAD', 'EBAY_SHOPIFY', ?)`
  ).run(discordUserId, '2026-08-20T10:00:00.000Z');
  db.prepare(
    `INSERT INTO alert_events (
      id, user_id, chase_id, listing_id, source, status, listing_title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'EBAY', 'MATCHED', ?, ?, ?)`
  ).run(`legacy-alert-${suffix}`, discordUserId, `legacy-chase-${suffix}`, `listing-${suffix}`, `Listing ${suffix}`, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z');
  db.prepare(
    `INSERT INTO alert_deliveries (id, alert_id, user_id, channel, status, created_at, updated_at)
     VALUES (?, ?, ?, 'DISCORD_DM', 'PENDING', ?, ?)`
  ).run(`legacy-delivery-${suffix}`, `legacy-alert-${suffix}`, discordUserId, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z');
  db.prepare(
    `INSERT INTO discovery_scheduled_drops (
      user_id, drop_type, period_key, status, title, currency, available_at, generated_at, updated_at
    ) VALUES (?, 'WEEKLY_DISCOVERY', ?, 'READY', 'Weekly Shelf', 'CAD', ?, ?, ?)`
  ).run(discordUserId, `2026-W${suffix}`, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z');
}

describe('accounts', () => {
  it('creates opaque internal IDs and links Discord identities without duplicates', () => {
    const discordUserId = `discord-account-${Date.now()}`;
    cleanupUserIds([discordUserId]);

    const first = resolveOrCreateDiscordUser({
      discordUserId,
      username: 'collector',
      displayName: 'Collector',
      avatarUrl: 'https://example.test/avatar.png'
    });
    const second = resolveOrCreateDiscordUser({
      discordUserId,
      username: 'collector-renamed',
      displayName: 'Collector Renamed',
      avatarUrl: 'https://example.test/avatar-2.png'
    });

    expect(first.id).toMatch(/^usr_/);
    expect(second.id).toBe(first.id);
    expect(getIdentity('DISCORD', discordUserId)).toMatchObject({
      userId: first.id,
      providerUserId: discordUserId,
      username: 'collector-renamed',
      displayName: 'Collector Renamed',
      avatarUrl: 'https://example.test/avatar-2.png'
    });
    expect(getIdentitiesForUser(first.id)).toHaveLength(1);
    expect(getIdentityForUser(first.id, 'DISCORD')?.providerUserId).toBe(discordUserId);
    expect(resolveDiscordUserId(first.id)).toBe(discordUserId);

    cleanupUserIds([discordUserId, first.id]);
  });

  it('allows a Vaultr account without a Discord identity', () => {
    const user = createUser({ displayName: 'Web Collector' });
    expect(user.id).toMatch(/^usr_/);
    expect(resolveDiscordUserId(user.id)).toBeNull();
    expect(getIdentitiesForUser(user.id)).toEqual([]);
    cleanupUserIds([user.id]);
  });

  it('migrates legacy Discord-owned rows to one internal account and preserves profile metadata', () => {
    const discordUserId = `legacy-discord-${Date.now()}`;
    cleanupUserIds([discordUserId]);
    seedLegacyUser(discordUserId, '41');

    migrateLegacyDiscordUserIdsToAccounts();

    const identity = getIdentity('DISCORD', discordUserId);
    expect(identity?.userId).toMatch(/^usr_/);
    expect(identity).toMatchObject({
      username: 'collector-41',
      displayName: 'Collector 41',
      avatarUrl: `https://cdn.discordapp.com/avatars/${discordUserId}/avatar-41.png?size=80`
    });
    const vaultrUserId = identity!.userId;
    expect(db.prepare('SELECT user_id FROM chases WHERE id = ?').get('legacy-chase-41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM user_plans WHERE user_id = ?').get(vaultrUserId)).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM user_alert_settings WHERE user_id = ?').get(vaultrUserId)).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM web_sessions WHERE token_hash = ?').get('legacy-token-41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM alert_events WHERE id = ?').get('legacy-alert-41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM alert_deliveries WHERE id = ?').get('legacy-delivery-41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM discovery_scheduled_drops WHERE period_key = ?').get('2026-W41')).toMatchObject({ user_id: vaultrUserId });

    migrateLegacyDiscordUserIdsToAccounts();
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM user_identities WHERE provider = 'DISCORD' AND provider_user_id = ?`).get(discordUserId)
    ).toMatchObject({ count: 1 });

    cleanupUserIds([discordUserId, vaultrUserId]);
  });

  it('migrates multiple legacy Discord users without cross-user mixing', () => {
    const firstDiscordId = `legacy-discord-a-${Date.now()}`;
    const secondDiscordId = `legacy-discord-b-${Date.now()}`;
    cleanupUserIds([firstDiscordId, secondDiscordId]);
    seedLegacyUser(firstDiscordId, '42');
    seedLegacyUser(secondDiscordId, '43');

    migrateLegacyDiscordUserIdsToAccounts();

    const firstIdentity = getIdentity('DISCORD', firstDiscordId);
    const secondIdentity = getIdentity('DISCORD', secondDiscordId);
    expect(firstIdentity?.userId).toMatch(/^usr_/);
    expect(secondIdentity?.userId).toMatch(/^usr_/);
    expect(firstIdentity?.userId).not.toBe(secondIdentity?.userId);
    expect(db.prepare('SELECT user_id FROM chases WHERE id = ?').get('legacy-chase-42')).toMatchObject({ user_id: firstIdentity?.userId });
    expect(db.prepare('SELECT user_id FROM chases WHERE id = ?').get('legacy-chase-43')).toMatchObject({ user_id: secondIdentity?.userId });

    cleanupUserIds([firstDiscordId, secondDiscordId, firstIdentity!.userId, secondIdentity!.userId]);
  });
});
