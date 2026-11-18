import * as webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../accounts.js';
import { upsertAlertEvent } from '../chase-store.js';
import { db } from '../db.js';
import {
  enqueueWebPushForAlert,
  getWebPushStatus,
  processPendingWebPushDeliveries,
  registerWebPushSubscription,
  removeWebPushSubscription,
  validateWebPushSubscription
} from '../web-push-notifications.js';

const originalEnv = { ...process.env };
const userIds = new Set<string>();

function subscription(label: string) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${label}`,
    keys: {
      p256dh: Buffer.alloc(65, label.charCodeAt(0) || 1).toString('base64url'),
      auth: Buffer.alloc(16, 2).toString('base64url')
    }
  };
}

function user(label: string): string {
  const account = createUser({ displayName: `Push ${label}` });
  userIds.add(account.id);
  return account.id;
}

function alert(userId: string, label: string): string {
  return upsertAlertEvent({
    userId,
    chaseId: `push-chase-${label}`,
    listingId: `push-listing-${label}`,
    source: 'EBAY',
    listingTitle: 'Private marketplace content must not enter push payloads',
    listingUrl: `https://example.test/${label}`
  }).alertId;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  const keys = webPush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:push-tests@keepseek.test';
});

afterEach(() => {
  for (const userId of userIds) {
    db.prepare('DELETE FROM web_push_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM web_push_subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
  userIds.clear();
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('web push subscriptions and delivery', () => {
  it('validates supported push services and rejects arbitrary endpoints', () => {
    expect(validateWebPushSubscription(subscription('valid')).endpoint).toContain('fcm.googleapis.com');
    expect(() => validateWebPushSubscription({ ...subscription('bad'), endpoint: 'https://127.0.0.1/push' }))
      .toThrow('UNSUPPORTED_PUSH_ENDPOINT');
    expect(() => validateWebPushSubscription({ ...subscription('bad'), endpoint: 'https://example.com/push' }))
      .toThrow('UNSUPPORTED_PUSH_ENDPOINT');
  });

  it('supports multiple devices, enforces endpoint ownership, and removes only the owning device', () => {
    const firstUser = user('owner');
    const secondUser = user('other');
    const first = subscription('owner-a');
    const second = subscription('owner-b');

    registerWebPushSubscription(firstUser, first);
    registerWebPushSubscription(firstUser, second);
    expect(getWebPushStatus(firstUser)).toMatchObject({ available: true, deviceCount: 2 });
    expect(() => registerWebPushSubscription(secondUser, first)).toThrow('SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT');
    expect(removeWebPushSubscription(secondUser, first.endpoint)).toBe(false);
    expect(removeWebPushSubscription(firstUser, first.endpoint)).toBe(true);
    expect(getWebPushStatus(firstUser).deviceCount).toBe(1);
  });

  it('deduplicates each match per device and sends a private exact Inbox deep link', async () => {
    const userId = user('delivery');
    registerWebPushSubscription(userId, subscription('delivery-a'));
    registerWebPushSubscription(userId, subscription('delivery-b'));
    const alertId = alert(userId, 'delivery');

    expect(enqueueWebPushForAlert(alertId, userId)).toBe(2);
    expect(enqueueWebPushForAlert(alertId, userId)).toBe(0);
    const sender = vi.fn().mockResolvedValue({ statusCode: 201 });
    expect(await processPendingWebPushDeliveries({ sender })).toMatchObject({ sent: 2, failed: 0 });

    const payload = JSON.parse(sender.mock.calls[0]?.[1] as string) as Record<string, string>;
    expect(payload).toEqual({
      title: 'New Watchlist match!',
      body: 'KeepSeek found a new match for one of your Watchlist cards.',
      path: `/app#alerts?alertId=${alertId}`
    });
    expect(JSON.stringify(payload)).not.toContain('Private marketplace content');
  });

  it('backs off transient failures and removes definitively expired subscriptions', async () => {
    const userId = user('retry');
    registerWebPushSubscription(userId, subscription('retry'));
    const alertId = alert(userId, 'retry');
    enqueueWebPushForAlert(alertId, userId, new Date('2026-11-17T12:00:00.000Z'));
    const rateLimited = Object.assign(new Error('rate limited'), { statusCode: 429, headers: { 'retry-after': '120' } });

    expect(await processPendingWebPushDeliveries({
      now: new Date('2026-11-17T12:00:00.000Z'),
      sender: vi.fn().mockRejectedValue(rateLimited)
    })).toMatchObject({ failed: 1 });
    expect(db.prepare('SELECT status, attempts, next_attempt_at FROM web_push_deliveries WHERE alert_id = ?').get(alertId))
      .toEqual({ status: 'FAILED', attempts: 1, next_attempt_at: '2026-11-17T12:02:00.000Z' });

    const sender = vi.fn().mockResolvedValue({ statusCode: 201 });
    expect(await processPendingWebPushDeliveries({ now: new Date('2026-11-17T12:01:59.000Z'), sender })).toMatchObject({ sent: 0 });
    expect(await processPendingWebPushDeliveries({ now: new Date('2026-11-17T12:02:00.000Z'), sender })).toMatchObject({ sent: 1 });

    registerWebPushSubscription(userId, subscription('expired'));
    const expiredAlertId = alert(userId, 'expired');
    enqueueWebPushForAlert(expiredAlertId, userId, new Date('2026-11-17T13:00:00.000Z'));
    const expired = Object.assign(new Error('gone'), { statusCode: 410 });
    const expirySender = vi.fn(async (pushSubscription: { endpoint: string }) => {
      if (pushSubscription.endpoint.endsWith('/expired')) throw expired;
      return { statusCode: 201 };
    });
    expect(await processPendingWebPushDeliveries({
      now: new Date('2026-11-17T13:00:00.000Z'),
      sender: expirySender
    })).toMatchObject({ removed: 1 });
    expect(getWebPushStatus(userId).deviceCount).toBe(1);
  });

  it('prevents overlapping workers from double-sending and suppresses permanent failures', async () => {
    const userId = user('concurrency');
    registerWebPushSubscription(userId, subscription('concurrency'));
    const alertId = alert(userId, 'concurrency');
    enqueueWebPushForAlert(alertId, userId, new Date('2026-11-17T14:00:00.000Z'));
    let release: (() => void) | undefined;
    const firstSender = vi.fn(() => new Promise((resolve) => { release = () => resolve({ statusCode: 201 }); }));
    const first = processPendingWebPushDeliveries({ now: new Date('2026-11-17T14:00:00.000Z'), sender: firstSender });
    await vi.waitFor(() => expect(firstSender).toHaveBeenCalledOnce());
    const secondSender = vi.fn();
    expect(await processPendingWebPushDeliveries({ now: new Date('2026-11-17T14:00:01.000Z'), sender: secondSender }))
      .toMatchObject({ sent: 0, failed: 0 });
    expect(secondSender).not.toHaveBeenCalled();
    release?.();
    expect(await first).toMatchObject({ sent: 1 });

    const permanentAlertId = alert(userId, 'permanent');
    enqueueWebPushForAlert(permanentAlertId, userId, new Date('2026-11-17T15:00:00.000Z'));
    const permanent = Object.assign(new Error('bad request'), { statusCode: 400 });
    expect(await processPendingWebPushDeliveries({
      now: new Date('2026-11-17T15:00:00.000Z'), sender: vi.fn().mockRejectedValue(permanent)
    })).toMatchObject({ failed: 1 });
    expect(db.prepare('SELECT status, attempts FROM web_push_deliveries WHERE alert_id = ?').get(permanentAlertId))
      .toEqual({ status: 'SUPPRESSED', attempts: 1 });
  });

  it('leaves Inbox events and queued work intact while VAPID configuration is missing', async () => {
    const userId = user('disabled');
    registerWebPushSubscription(userId, subscription('disabled'));
    const alertId = alert(userId, 'disabled');
    enqueueWebPushForAlert(alertId, userId);
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;

    expect(await processPendingWebPushDeliveries()).toEqual({ disabled: true, sent: 0, failed: 0, removed: 0 });
    expect(db.prepare('SELECT status, attempts FROM web_push_deliveries WHERE alert_id = ?').get(alertId))
      .toEqual({ status: 'PENDING', attempts: 0 });
    expect(db.prepare('SELECT id FROM alert_events WHERE id = ?').get(alertId)).toEqual({ id: alertId });
    expect(() => registerWebPushSubscription(userId, subscription('new-disabled'))).toThrow('PUSH_UNAVAILABLE');
  });

  it('creates no delivery when an account has no subscribed devices', () => {
    const userId = user('inbox-only');
    const alertId = alert(userId, 'inbox-only');
    expect(enqueueWebPushForAlert(alertId, userId)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) count FROM web_push_deliveries WHERE alert_id = ?').get(alertId)).toEqual({ count: 0 });
  });
});
