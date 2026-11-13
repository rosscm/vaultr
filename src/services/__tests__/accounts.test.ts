import { beforeEach, describe, expect, it } from 'vitest';
import {
  createUser,
  getIdentitiesForUser,
  getIdentity,
  getIdentityForUser,
  resolveDiscordUserId,
  resolveOrCreateDiscordUser,
  resolveOrCreateGoogleUser
} from '../accounts.js';
import { db, migrateLegacyDiscordUserIdsToAccounts } from '../db.js';

beforeEach(() => {
  db.pragma('foreign_keys = ON');
});

function cleanupUserIds(userIds: string[]): void {
  for (const userId of userIds) {
    db.prepare('DELETE FROM discovery_training_examples WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_discovery_feedback WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_discovery_seen WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_discovery_preferences WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM discovery_scheduled_drop_items WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM discovery_scheduled_drops WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_alert_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_notification_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_display_case_views WHERE user_id = ?').run(userId);
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
  db.prepare(
    `INSERT INTO discovery_scheduled_drop_items (
      user_id, drop_type, period_key, position, suggestion_name, suggestion_json, market_status,
      market_currency, created_at, updated_at
    ) VALUES (?, 'WEEKLY_DISCOVERY', ?, 1, ?, '{}', 'READY', 'CAD', ?, ?)`
  ).run(discordUserId, `2026-W${suffix}`, `Mew ${suffix}`, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z');
}

function seedBrokenLegacyScheduledDropItem(discordUserId: string, suffix: string): void {
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare(
      `INSERT INTO discovery_scheduled_drop_items (
        user_id, drop_type, period_key, position, suggestion_name, suggestion_json, market_status,
        market_currency, created_at, updated_at
      ) VALUES (?, 'WEEKLY_DISCOVERY', ?, 1, ?, '{}', 'READY', 'CAD', ?, ?)`
    ).run(discordUserId, `2026-W${suffix}`, `Broken Mew ${suffix}`, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z');
  } finally {
    db.pragma('foreign_keys = ON');
  }
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

  it('creates and reuses one account for a stable Google subject', () => {
    const googleUserId = `google-account-${Date.now()}`;
    const first = resolveOrCreateGoogleUser({
      googleUserId,
      displayName: 'Google Collector',
      email: 'collector@example.test'
    });
    const second = resolveOrCreateGoogleUser({
      googleUserId,
      displayName: 'Updated Collector',
      email: 'updated@example.test'
    });

    expect(second.id).toBe(first.id);
    expect(getIdentity('GOOGLE', googleUserId)).toMatchObject({
      userId: first.id,
      providerUserId: googleUserId,
      displayName: 'Updated Collector',
      email: 'updated@example.test'
    });
    expect(getIdentitiesForUser(first.id)).toHaveLength(1);
    cleanupUserIds([first.id]);
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
    expect(db.prepare('SELECT user_id FROM discovery_scheduled_drop_items WHERE period_key = ?').get('2026-W41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);

    migrateLegacyDiscordUserIdsToAccounts();
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM user_identities WHERE provider = 'DISCORD' AND provider_user_id = ?`).get(discordUserId)
    ).toMatchObject({ count: 1 });
    expect(db.prepare('SELECT user_id FROM discovery_scheduled_drops WHERE period_key = ?').get('2026-W41')).toMatchObject({ user_id: vaultrUserId });
    expect(db.prepare('SELECT user_id FROM discovery_scheduled_drop_items WHERE period_key = ?').get('2026-W41')).toMatchObject({ user_id: vaultrUserId });

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

  it('preserves canonical singleton account rows when legacy duplicates exist', () => {
    const discordUserId = `legacy-collision-${Date.now()}`;
    cleanupUserIds([discordUserId]);
    const account = resolveOrCreateDiscordUser({ discordUserId, username: 'canonical-collector' });
    db.prepare(`INSERT INTO user_plans (user_id, tier, status, updated_at) VALUES (?, 'PRO', 'ACTIVE', ?)`).run(
      account.id,
      '2026-08-21T10:00:00.000Z'
    );
    db.prepare(
      `INSERT INTO user_alert_settings (user_id, min_score, max_alerts_per_hour, alert_currency, listing_source_mode, updated_at)
       VALUES (?, 50, 20, 'CAD', 'EBAY_SHOPIFY', ?)`
    ).run(account.id, '2026-08-21T10:00:00.000Z');
    seedLegacyUser(discordUserId, '45');
    db.prepare(`INSERT INTO user_discovery_seen VALUES (?, 'Mew', ?, ?, 2)`).run(
      account.id, '2026-08-10T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO user_discovery_seen VALUES (?, 'Mew', ?, ?, 3)`).run(
      discordUserId, '2026-08-01T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO user_discovery_preferences VALUES (?, 'PROMO', ?)`).run(account.id, '2026-08-20T00:00:00.000Z');
    db.prepare(`INSERT INTO user_discovery_preferences VALUES (?, 'PROMO', ?)`).run(discordUserId, '2026-08-25T00:00:00.000Z');
    db.prepare(`INSERT INTO user_discovery_feedback (
      user_id, suggestion_name, lane, feedback, interaction_count, first_interacted_at, last_interacted_at, version, active
    ) VALUES (?, 'Mew', 'CORE_MATCH', 'MORE_LIKE_THIS', 2, ?, ?, 2, 1)`).run(
      account.id, '2026-08-10T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO user_discovery_feedback (
      user_id, suggestion_name, lane, feedback, interaction_count, first_interacted_at, last_interacted_at, version, active
    ) VALUES (?, 'Mew', 'ADJACENT_DISCOVERY', 'NOT_FOR_ME', 3, ?, ?, 4, 1)`).run(
      discordUserId, '2026-08-05T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO user_taste_memory VALUES (?, 'mew', 'DISCOVERY', 'Mew', 100, 1, 2, ?, ?)`).run(
      account.id, '2026-08-10T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO user_taste_memory VALUES (?, 'mew', 'DISCOVERY', 'Mew promo', 120, -1, 3, ?, ?)`).run(
      discordUserId, '2026-08-05T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO discovery_training_examples (
      user_id, surface, period_key, suggestion_name, lane, position, ranker_version, feature_json, score_json,
      outcome, shown_at, updated_at, outcome_at
    ) VALUES (?, 'WEB', '2026-W45', 'Mew', 'CORE_MATCH', 1, 'v1', '{}', '{}', NULL, ?, ?, NULL)`).run(
      account.id, '2026-08-10T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    );
    db.prepare(`INSERT INTO discovery_training_examples (
      user_id, surface, period_key, suggestion_name, lane, position, ranker_version, feature_json, score_json,
      outcome, shown_at, updated_at, outcome_at
    ) VALUES (?, 'WEB', '2026-W45', 'Mew', 'ADJACENT_DISCOVERY', 2, 'v2', '{"promo":true}', '{}', 'MORE_LIKE_THIS', ?, ?, ?)`).run(
      discordUserId, '2026-08-05T00:00:00.000Z', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'
    );

    migrateLegacyDiscordUserIdsToAccounts();

    expect(db.prepare('SELECT tier, status FROM user_plans WHERE user_id = ?').get(account.id)).toEqual({ tier: 'PRO', status: 'ACTIVE' });
    expect(db.prepare('SELECT min_score, alert_currency FROM user_alert_settings WHERE user_id = ?').get(account.id)).toEqual({
      min_score: 50,
      alert_currency: 'CAD'
    });
    expect(db.prepare('SELECT user_id FROM chases WHERE id = ?').get('legacy-chase-45')).toEqual({ user_id: account.id });
    expect(db.prepare('SELECT 1 FROM user_plans WHERE user_id = ?').get(discordUserId)).toBeUndefined();
    expect(db.prepare(`SELECT first_seen_at, last_seen_at, times_seen FROM user_discovery_seen WHERE user_id = ? AND suggestion_name = 'Mew'`).get(account.id)).toEqual({
      first_seen_at: '2026-08-01T00:00:00.000Z', last_seen_at: '2026-08-25T00:00:00.000Z', times_seen: 5
    });
    expect(db.prepare(`SELECT feedback, lane, interaction_count, version FROM user_discovery_feedback WHERE user_id = ? AND suggestion_name = 'Mew'`).get(account.id)).toEqual({
      feedback: 'NOT_FOR_ME', lane: 'ADJACENT_DISCOVERY', interaction_count: 3, version: 4
    });
    expect(db.prepare(`SELECT card_name, weight, interaction_count FROM user_taste_memory WHERE user_id = ? AND signal_id = 'mew'`).get(account.id)).toEqual({
      card_name: 'Mew promo', weight: -1, interaction_count: 3
    });
    expect(db.prepare(`SELECT lane, position, ranker_version, outcome, shown_at, updated_at FROM discovery_training_examples WHERE user_id = ?`).get(account.id)).toEqual({
      lane: 'ADJACENT_DISCOVERY', position: 2, ranker_version: 'v2', outcome: 'MORE_LIKE_THIS',
      shown_at: '2026-08-05T00:00:00.000Z', updated_at: '2026-08-25T00:00:00.000Z'
    });
    expect(db.prepare(`SELECT updated_at FROM user_discovery_preferences WHERE user_id = ? AND focus = 'PROMO'`).get(account.id)).toEqual({
      updated_at: '2026-08-25T00:00:00.000Z'
    });

    migrateLegacyDiscordUserIdsToAccounts();
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_plans WHERE user_id = ?').get(account.id)).toEqual({ count: 1 });

    cleanupUserIds([discordUserId, account.id]);
  });

  it('rolls back ownership rewrites when final foreign key validation fails', () => {
    const discordUserId = `legacy-broken-fk-${Date.now()}`;
    cleanupUserIds([discordUserId]);
    seedBrokenLegacyScheduledDropItem(discordUserId, '44');

    expect(db.prepare('PRAGMA foreign_key_check;').all()).not.toEqual([]);
    expect(() => migrateLegacyDiscordUserIdsToAccounts()).toThrow(/Foreign key violations after legacy account migration/);
    expect(db.prepare('SELECT user_id FROM discovery_scheduled_drop_items WHERE period_key = ?').get('2026-W44')).toMatchObject({ user_id: discordUserId });
    expect(getIdentity('DISCORD', discordUserId)).toBeNull();

    db.pragma('foreign_keys = OFF');
    try {
      cleanupUserIds([discordUserId]);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  });
});
