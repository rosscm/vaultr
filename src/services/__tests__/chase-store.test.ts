import { describe, expect, it } from 'vitest';
import {
  addChase,
  enqueueAlertEventDelivery,
  getAlertDeliveryById,
  getAlertEventById,
  getChaseLastPollAttemptAt,
  getChaseLastPollCheckAt,
  listAlertDeliveriesForEvent,
  markAlertDeliveryFailed,
  markAlertDeliverySent,
  markChasesPollAttempted,
  markChasesPollChecked,
  removeAllChases
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
