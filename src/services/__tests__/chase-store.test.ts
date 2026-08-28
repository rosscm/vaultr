import { describe, expect, it } from 'vitest';
import {
  addChase,
  __chaseStoreTestHooks,
  enqueueAlertEventDelivery,
  getAlertDeliveryById,
  getAlertEventById,
  getAlertEventForUser,
  getChaseLastPollAttemptAt,
  getChaseLastPollCheckAt,
  listCompletedChases,
  listAlertDeliveriesForEvent,
  listAlertEventsForUser,
  markAlertDeliveryFailed,
  markAlertDeliverySent,
  markChasesPollAttempted,
  markChasesPollChecked,
  removeAllChases,
  resolveChaseRemoval,
} from '../chase-store.js';
import { db } from '../db.js';

describe('chase poll state', () => {
  it('records a poll attempt separately from the last successful check', () => {
    const userId = 'poll-state-user';
    removeAllChases(userId);
    const chase = addChase({ userId, cardName: 'Mew-EX Legendary Treasures RC24' });

    markChasesPollChecked([chase.id], '2026-07-05T16:00:00.000Z');
    markChasesPollAttempted([chase.id], '2026-07-05T16:05:00.000Z');

    expect(getChaseLastPollCheckAt(chase.id)).toBe('2026-07-05T16:00:00.000Z');
    expect(getChaseLastPollAttemptAt(chase.id)).toBe('2026-07-05T16:05:00.000Z');

    removeAllChases(userId);
  });

  it('falls back to the last successful check when no separate attempt exists', () => {
    const userId = 'poll-state-fallback-user';
    removeAllChases(userId);
    const chase = addChase({ userId, cardName: 'Umbreon ex Terastal Festival 217/187' });

    markChasesPollChecked([chase.id], '2026-07-05T16:10:00.000Z');

    expect(getChaseLastPollAttemptAt(chase.id)).toBe('2026-07-05T16:10:00.000Z');

    removeAllChases(userId);
  });
});

describe('completed chase history', () => {
  function clearCompleted(userId: string): void {
    db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(userId);
  }

  it('initializes completed chase schema and user ordering index', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'completed_chases'").get();
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_completed_chases_user_completed'").get();
    expect(table).toBeTruthy();
    expect(index).toBeTruthy();
  });

  it('snapshots completed removals atomically and clears active polling', () => {
    const userId = 'completed-history-user';
    removeAllChases(userId);
    clearCompleted(userId);
    const chase = addChase({
      userId,
      cardName: 'Mew RC24',
      cardImageUrl: 'https://images.example/mew.png',
      cardImageIdentity: 'Mew RC24',
      cardImageSourceName: 'Pokemon TCG',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: 'bw11-RC24',
      priority: 'GRAIL',
      targetNote: 'clean',
      maxPrice: 120,
      grade: 'PSA 10',
      condition: 'NM',
      listingType: 'BUY_IT_NOW',
      negativeKeywords: ['proxy']
    });
    markChasesPollChecked([chase.id], '2026-08-01T00:00:00.000Z');

    const result = resolveChaseRemoval(userId, chase.id, 'COMPLETED');

    expect(result.removed).toBe(true);
    expect(getChaseLastPollCheckAt(chase.id)).toBeUndefined();
    expect(listCompletedChases(userId)[0]).toMatchObject({
      id: chase.id,
      cardName: 'Mew RC24',
      cardImageUrl: 'https://images.example/mew.png',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: 'bw11-RC24',
      priority: 'GRAIL',
      maxPrice: 120,
      listingType: 'BUY_IT_NOW',
      negativeKeywords: ['proxy']
    });
  });

  it('rolls back completed snapshot, active removal, and poll clearing on failure', () => {
    const userId = 'completed-history-rollback-user';
    removeAllChases(userId);
    clearCompleted(userId);
    const chase = addChase({ userId, cardName: 'Pichu Expedition 22/165' });
    markChasesPollChecked([chase.id], '2026-08-01T00:00:00.000Z');

    __chaseStoreTestHooks.failNextResolvedRemoval();
    expect(() => resolveChaseRemoval(userId, chase.id, 'COMPLETED')).toThrow('Simulated resolved chase removal failure');

    expect(listCompletedChases(userId)).toEqual([]);
    expect(getChaseLastPollCheckAt(chase.id)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not archive no-longer-interested or mistake removals', () => {
    const userId = 'completed-history-non-completed-user';
    removeAllChases(userId);
    clearCompleted(userId);
    const uninterested = addChase({ userId, cardName: 'Zapdos Expedition 48' });
    const mistake = addChase({ userId, cardName: 'Random Bulk Card' });

    expect(resolveChaseRemoval(userId, uninterested.id, 'NO_LONGER_INTERESTED').removed).toBe(true);
    expect(resolveChaseRemoval(userId, mistake.id, 'ADDED_BY_MISTAKE').removed).toBe(true);

    expect(listCompletedChases(userId)).toEqual([]);
  });

  it('orders completed history newest first and allows rechasing the same card', () => {
    const userId = 'completed-history-plan-user';
    removeAllChases(userId);
    clearCompleted(userId);
    const first = addChase({ userId, cardName: 'Mew RC24' });
    resolveChaseRemoval(userId, first.id, 'COMPLETED');
    const second = addChase({ userId, cardName: 'Mew RC24' });
    resolveChaseRemoval(userId, second.id, 'COMPLETED');

    expect(listCompletedChases(userId).map((item) => item.id)).toEqual([second.id, first.id]);
  });
});

describe('alert event delivery persistence', () => {
  function clearAlertRows(userId: string): void {
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sent_alerts WHERE user_id = ?').run(userId);
  }

  it('persists a durable alert event with a pending Discord delivery', () => {
    const userId = 'alert-event-user';
    clearAlertRows(userId);

    const persisted = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-1',
      guildId: 'guild-1',
      listingId: 'listing-1',
      source: 'EBAY',
      channel: 'DISCORD_DM',
      chaseName: 'Pikachu 26/83',
      chasePriority: 'HIGH',
      listingTitle: 'Pikachu 26/83 Toys R Us Promo NM',
      listingPrice: 79.99,
      listingCurrency: 'CAD',
      listingUrl: 'https://example.test/listing-1',
      matchScore: 94,
      payload: { sourceLabel: 'eBay', matchReasons: ['card_name_match_exact'] },
      now: '2026-08-19T12:00:00.000Z'
    });

    const event = getAlertEventById(persisted.alertId);
    const delivery = getAlertDeliveryById(persisted.deliveryId);

    expect(event).toMatchObject({
      id: persisted.alertId,
      userId,
      chaseId: 'chase-1',
      listingId: 'listing-1',
      source: 'EBAY',
      status: 'DELIVERY_PENDING',
      chaseName: 'Pikachu 26/83',
      chasePriority: 'HIGH',
      listingTitle: 'Pikachu 26/83 Toys R Us Promo NM',
      listingPrice: 79.99,
      listingCurrency: 'CAD',
      matchScore: 94,
      payload: { sourceLabel: 'eBay', matchReasons: ['card_name_match_exact'] }
    });
    expect(delivery).toMatchObject({
      id: persisted.deliveryId,
      alertId: persisted.alertId,
      userId,
      channel: 'DISCORD_DM',
      status: 'PENDING',
      attempts: 0
    });

    clearAlertRows(userId);
  });

  it('updates the same alert event and delivery for repeated enqueue attempts', () => {
    const userId = 'alert-event-idempotent-user';
    clearAlertRows(userId);

    const first = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-1',
      listingId: 'listing-1',
      source: 'EBAY',
      channel: 'DISCORD_DM',
      listingTitle: 'First title',
      now: '2026-08-19T12:00:00.000Z'
    });
    const second = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-1',
      listingId: 'listing-1',
      source: 'EBAY',
      channel: 'DISCORD_DM',
      listingTitle: 'Updated title',
      now: '2026-08-19T12:01:00.000Z'
    });

    expect(second).toEqual(first);
    expect(getAlertEventById(first.alertId)?.listingTitle).toBe('Updated title');
    expect(listAlertDeliveriesForEvent(first.alertId)).toHaveLength(1);

    clearAlertRows(userId);
  });

  it('marks Discord deliveries sent or failed without deleting alert history', () => {
    const userId = 'alert-event-status-user';
    clearAlertRows(userId);

    const sent = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-sent',
      listingId: 'listing-sent',
      source: 'EBAY',
      channel: 'DISCORD_DM',
      now: '2026-08-19T12:00:00.000Z'
    });
    expect(markAlertDeliverySent(sent.deliveryId, { externalMessageId: 'discord-message-1', now: '2026-08-19T12:02:00.000Z' })).toBe(true);
    expect(getAlertEventById(sent.alertId)?.status).toBe('DELIVERED');
    expect(getAlertDeliveryById(sent.deliveryId)).toMatchObject({
      status: 'SENT',
      attempts: 1,
      externalMessageId: 'discord-message-1',
      sentAt: '2026-08-19T12:02:00.000Z'
    });

    const failed = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-failed',
      listingId: 'listing-failed',
      source: 'SHOPIFY',
      channel: 'DISCORD_DM',
      now: '2026-08-19T12:03:00.000Z'
    });
    expect(markAlertDeliveryFailed(failed.deliveryId, new Error('DM blocked'), '2026-08-19T12:04:00.000Z')).toBe(true);
    expect(getAlertEventById(failed.alertId)?.status).toBe('DELIVERY_FAILED');
    expect(getAlertDeliveryById(failed.deliveryId)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'DM blocked'
    });

    clearAlertRows(userId);
  });
});

describe('user alert history read model', () => {
  function clearAlertRows(userId: string): void {
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sent_alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM chases WHERE user_id = ?').run(userId);
  }

  function seedAlert(
    userId: string,
    index: number,
    overrides: Partial<Parameters<typeof enqueueAlertEventDelivery>[0]> = {}
  ): ReturnType<typeof enqueueAlertEventDelivery> {
    const createdAt = new Date(Date.UTC(2026, 7, 19, 12, 0, 0, 0) + index * 60_000).toISOString();
    const postedAt = new Date(Date.UTC(2026, 7, 19, 10, 0, 0, 0) + index * 60_000).toISOString();
    return enqueueAlertEventDelivery({
      userId,
      chaseId: `chase-${index}`,
      listingId: `listing-${index}`,
      source: 'EBAY',
      channel: 'DISCORD_DM',
      chaseName: `Pikachu ${index}/83`,
      chasePriority: 'NORMAL',
      listingTitle: `Pikachu listing ${index}`,
      listingPrice: 50 + index,
      listingCurrency: 'CAD',
      priceDelta: index,
      listingUrl: `https://example.test/listing-${index}`,
      matchScore: 80 + index,
      listingPostedAt: postedAt,
      alertLatencySeconds: index * 60,
      payload: { internalOnly: true },
      now: createdAt,
      ...overrides
    });
  }

  it('returns newest alerts first and supports single-alert ownership lookup', () => {
    const userId = 'alert-history-order-user';
    const otherUserId = 'alert-history-order-other';
    clearAlertRows(userId);
    clearAlertRows(otherUserId);
    const older = seedAlert(userId, 1, { now: '2026-08-19T12:00:00.000Z' });
    const newer = seedAlert(userId, 2, { now: '2026-08-19T12:05:00.000Z' });
    const other = seedAlert(otherUserId, 3, { now: '2026-08-19T12:10:00.000Z' });

    const page = listAlertEventsForUser(userId);

    expect(page.items.map((item) => item.id)).toEqual([newer.alertId, older.alertId]);
    expect(getAlertEventForUser(userId, newer.alertId)?.listingTitle).toBe('Pikachu listing 2');
    expect(getAlertEventForUser(userId, other.alertId)).toBeNull();
    expect(listAlertEventsForUser(otherUserId).items.map((item) => item.id)).toEqual([other.alertId]);

    clearAlertRows(userId);
    clearAlertRows(otherUserId);
  });

  it('filters by chase, priority snapshot, and listing source', () => {
    const userId = 'alert-history-filter-user';
    clearAlertRows(userId);
    const grail = seedAlert(userId, 1, { chaseId: 'target-chase', chasePriority: 'GRAIL', source: 'EBAY' });
    const high = seedAlert(userId, 2, { chaseId: 'other-chase', chasePriority: 'HIGH', source: 'SHOPIFY' });
    const normal = seedAlert(userId, 3, { chaseId: 'target-chase', chasePriority: 'NORMAL', source: 'SHOPIFY' });

    expect(listAlertEventsForUser(userId, { chaseId: 'target-chase' }).items.map((item) => item.id)).toEqual([
      normal.alertId,
      grail.alertId
    ]);
    expect(listAlertEventsForUser(userId, { chasePriority: 'GRAIL' }).items.map((item) => item.id)).toEqual([grail.alertId]);
    expect(listAlertEventsForUser(userId, { chasePriority: 'HIGH' }).items.map((item) => item.id)).toEqual([high.alertId]);
    expect(listAlertEventsForUser(userId, { chasePriority: 'NORMAL' }).items.map((item) => item.id)).toEqual([normal.alertId]);
    expect(listAlertEventsForUser(userId, { source: 'SHOPIFY' }).items.map((item) => item.id)).toEqual([normal.alertId, high.alertId]);

    clearAlertRows(userId);
  });

  it('uses default and maximum limit clamping', () => {
    const userId = 'alert-history-limit-user';
    clearAlertRows(userId);
    for (let index = 1; index <= 105; index += 1) seedAlert(userId, index);

    expect(listAlertEventsForUser(userId).items).toHaveLength(25);
    expect(listAlertEventsForUser(userId, { limit: 500 }).items).toHaveLength(100);
    expect(listAlertEventsForUser(userId, { limit: 0 }).items).toHaveLength(1);

    clearAlertRows(userId);
  });

  it('paginates by createdAt and id without duplicates when timestamps match', () => {
    const userId = 'alert-history-cursor-user';
    clearAlertRows(userId);
    for (let index = 1; index <= 6; index += 1) {
      seedAlert(userId, index, { now: '2026-08-19T12:00:00.000Z' });
    }

    const first = listAlertEventsForUser(userId, { limit: 2 });
    const second = listAlertEventsForUser(userId, { limit: 2, cursor: first.nextCursor });
    const third = listAlertEventsForUser(userId, { limit: 2, cursor: second.nextCursor });
    const combined = [...first.items, ...second.items, ...third.items];

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(third.items).toHaveLength(2);
    expect(new Set(combined.map((item) => item.id)).size).toBe(6);
    expect(combined.map((item) => `${item.createdAt}:${item.id}`)).toEqual(
      [...combined].map((item) => `${item.createdAt}:${item.id}`).sort().reverse()
    );

    clearAlertRows(userId);
  });

  it('returns an empty history cleanly', () => {
    const userId = 'alert-history-empty-user';
    clearAlertRows(userId);

    expect(listAlertEventsForUser(userId)).toEqual({ items: [], nextCursor: undefined });
    expect(getAlertEventForUser(userId, 'missing-alert')).toBeNull();
  });

  it('returns historical snapshots without exposing arbitrary payload', () => {
    const userId = 'alert-history-snapshot-user';
    clearAlertRows(userId);
    const chase = addChase({ userId, cardName: 'Umbreon ex 217/187', priority: 'HIGH' });
    const alert = seedAlert(userId, 1, {
      chaseId: chase.id,
      chaseName: chase.cardName,
      chasePriority: 'HIGH',
      listingImageUrl: 'https://example.test/listing-image.jpg',
      payload: { internalOnly: true, shouldNotLeak: 'secret' }
    });
    db.prepare('UPDATE chases SET priority = ? WHERE id = ?').run('GRAIL', chase.id);

    const item = getAlertEventForUser(userId, alert.alertId);
    const rawEvent = getAlertEventById(alert.alertId);

    expect(item).toMatchObject({
      chaseId: chase.id,
      chaseName: 'Umbreon ex 217/187',
      chasePriority: 'HIGH',
      imageUrl: 'https://example.test/listing-image.jpg'
    });
    expect(rawEvent?.payload).toEqual({ internalOnly: true, shouldNotLeak: 'secret' });
    expect(item).not.toHaveProperty('payload');

    clearAlertRows(userId);
  });
});
