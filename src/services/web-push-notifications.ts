import { createHash, randomUUID } from 'node:crypto';
import * as webPush from 'web-push';
import type { PushSubscription } from 'web-push';
import { db } from './db.js';

export type WebPushSubscriptionInput = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  endpoint_hash: string;
  p256dh: string;
  auth: string;
};

type DeliveryRow = {
  id: string;
  alert_id: string | null;
  subscription_id: string;
  user_id: string;
  kind: 'MATCH' | 'TEST';
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type WebPushSender = (
  subscription: PushSubscription,
  payload: string,
  options: Parameters<typeof webPush.sendNotification>[2]
) => Promise<unknown>;

const allowedPushHosts = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com'
];

function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function base64UrlBytes(value: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return 0;
  try { return Buffer.from(value, 'base64url').length; } catch { return 0; }
}

export function validateWebPushSubscription(value: unknown): WebPushSubscriptionInput {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SUBSCRIPTION');
  const input = value as Partial<WebPushSubscriptionInput>;
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw new Error('INVALID_SUBSCRIPTION');
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new Error('INVALID_SUBSCRIPTION'); }
  const hostAllowed = allowedPushHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    || url.hostname.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostAllowed) throw new Error('UNSUPPORTED_PUSH_ENDPOINT');
  if (!input.keys || typeof input.keys.p256dh !== 'string' || typeof input.keys.auth !== 'string') throw new Error('INVALID_SUBSCRIPTION');
  if (base64UrlBytes(input.keys.p256dh) !== 65 || base64UrlBytes(input.keys.auth) !== 16) throw new Error('INVALID_SUBSCRIPTION');
  return { endpoint: url.toString(), expirationTime: input.expirationTime ?? null, keys: input.keys };
}

export function webPushConfiguration(): { enabled: false } | { enabled: true; publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { enabled: true, publicKey, privateKey, subject } : { enabled: false };
}

export function getWebPushStatus(userId: string, endpoint?: string, knownHash?: string): { available: boolean; publicKey?: string; subscribed: boolean; subscriptionId?: string; deviceCount: number } {
  const config = webPushConfiguration();
  const deviceCount = (db.prepare('SELECT COUNT(*) count FROM web_push_subscriptions WHERE user_id = ?').get(userId) as { count: number }).count;
  const hash = endpoint ? endpointHash(endpoint) : knownHash;
  const subscription = hash && /^[a-f0-9]{64}$/.test(hash)
    ? db.prepare('SELECT id FROM web_push_subscriptions WHERE user_id = ? AND endpoint_hash = ?').get(userId, hash) as { id: string } | undefined
    : undefined;
  return { available: config.enabled, publicKey: config.enabled ? config.publicKey : undefined, subscribed: Boolean(subscription), subscriptionId: subscription?.id, deviceCount };
}

export function registerWebPushSubscription(userId: string, value: unknown, userAgent?: string): { id: string; endpointHash: string } {
  if (!webPushConfiguration().enabled) throw new Error('PUSH_UNAVAILABLE');
  const input = validateWebPushSubscription(value);
  const hash = endpointHash(input.endpoint);
  const existing = db.prepare('SELECT id, user_id FROM web_push_subscriptions WHERE endpoint_hash = ?').get(hash) as { id: string; user_id: string } | undefined;
  if (existing && existing.user_id !== userId) throw new Error('SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT');
  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO web_push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth, user_agent, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_hash) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth,
      user_agent=excluded.user_agent, updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at
  `).run(id, userId, input.endpoint, hash, input.keys.p256dh, input.keys.auth, userAgent?.slice(0, 300) ?? null, now, now, now);
  return { id, endpointHash: hash };
}

export function removeWebPushSubscription(userId: string, endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  return db.prepare('DELETE FROM web_push_subscriptions WHERE user_id = ? AND endpoint_hash = ?').run(userId, endpointHash(endpoint)).changes > 0;
}

export function removeWebPushSubscriptionByHash(userId: string, hash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  return db.prepare('DELETE FROM web_push_subscriptions WHERE user_id = ? AND endpoint_hash = ?').run(userId, hash).changes > 0;
}

export function enqueueWebPushForAlert(alertId: string, userId: string, now = new Date()): number {
  const subscriptions = db.prepare('SELECT id FROM web_push_subscriptions WHERE user_id = ?').all(userId) as Array<{ id: string }>;
  const insert = db.prepare(`INSERT OR IGNORE INTO web_push_deliveries
    (id, alert_id, subscription_id, user_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'MATCH', 'PENDING', 0, ?, ?, ?)`);
  return db.transaction(() => subscriptions.reduce((count, subscription) => count + insert.run(
    randomUUID(), alertId, subscription.id, userId, now.toISOString(), now.toISOString(), now.toISOString()
  ).changes, 0))();
}

export function enqueueWebPushTest(userId: string, subscriptionId: string, now = new Date()): boolean {
  const owned = db.prepare('SELECT 1 FROM web_push_subscriptions WHERE id = ? AND user_id = ?').get(subscriptionId, userId);
  if (!owned) return false;
  db.prepare(`INSERT INTO web_push_deliveries
    (id, alert_id, subscription_id, user_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, NULL, ?, ?, 'TEST', 'PENDING', 0, ?, ?, ?)`)
    .run(randomUUID(), subscriptionId, userId, now.toISOString(), now.toISOString(), now.toISOString());
  return true;
}

function retryAt(attempts: number, now: Date, retryAfterMs?: number): string {
  const delay = retryAfterMs ?? Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts));
  return new Date(now.getTime() + Math.max(1_000, delay)).toISOString();
}

function claimDeliveries(owner: string, now: Date, limit: number): DeliveryRow[] {
  const leaseExpires = new Date(now.getTime() + 60_000).toISOString();
  return db.transaction(() => {
    const rows = db.prepare(`SELECT d.id FROM web_push_deliveries d
      WHERE d.status IN ('PENDING','FAILED') AND d.next_attempt_at <= ? AND d.attempts < 5
        AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ?)
      ORDER BY d.next_attempt_at, d.created_at LIMIT ?`).all(now.toISOString(), now.toISOString(), limit) as Array<{ id: string }>;
    const result: DeliveryRow[] = [];
    for (const row of rows) {
      const claimed = db.prepare(`UPDATE web_push_deliveries SET lease_owner=?, lease_expires_at=?, updated_at=?
        WHERE id=? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
        .run(owner, leaseExpires, now.toISOString(), row.id, now.toISOString());
      if (!claimed.changes) continue;
      const delivery = db.prepare(`SELECT d.id, d.alert_id, d.subscription_id, d.user_id, d.kind, d.attempts,
        s.endpoint, s.p256dh, s.auth FROM web_push_deliveries d JOIN web_push_subscriptions s ON s.id=d.subscription_id WHERE d.id=?`)
        .get(row.id) as DeliveryRow | undefined;
      if (delivery) result.push(delivery);
    }
    return result;
  })();
}

export async function processPendingWebPushDeliveries(options: {
  now?: Date;
  limit?: number;
  sender?: WebPushSender;
} = {}): Promise<{ disabled: boolean; sent: number; failed: number; removed: number }> {
  const config = webPushConfiguration();
  if (!config.enabled) return { disabled: true, sent: 0, failed: 0, removed: 0 };
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const now = options.now ?? new Date();
  const owner = randomUUID();
  const deliveries = claimDeliveries(owner, now, Math.max(1, Math.min(25, options.limit ?? 10)));
  let sent = 0; let failed = 0; let removed = 0;
  for (const delivery of deliveries) {
    const path = delivery.alert_id ? `/app#alerts?alertId=${encodeURIComponent(delivery.alert_id)}` : '/app#settings';
    const payload = delivery.kind === 'MATCH'
      ? { title: 'New Watchlist match!', body: 'KeepSeek found a new match for one of your Watchlist cards.', path }
      : { title: 'KeepSeek notifications are on', body: 'This device is ready for browser notifications.', path };
    try {
      await (options.sender ?? webPush.sendNotification)({
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth }
      } as PushSubscription, JSON.stringify(payload), { TTL: 300, urgency: 'normal', timeout: 10_000 });
      db.prepare(`UPDATE web_push_deliveries SET status='SENT', attempts=attempts+1, sent_at=?, last_error=NULL,
        lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?`)
        .run(now.toISOString(), now.toISOString(), delivery.id, owner);
      sent += 1;
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : undefined;
      if (statusCode === 404 || statusCode === 410) {
        db.transaction(() => {
          db.prepare(`UPDATE web_push_deliveries SET status='SUPPRESSED', attempts=attempts+1, last_error=?, lease_owner=NULL,
            lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?`).run(`Push endpoint expired (${statusCode})`, now.toISOString(), delivery.id, owner);
          db.prepare('DELETE FROM web_push_subscriptions WHERE id=?').run(delivery.subscription_id);
        })();
        removed += 1;
        continue;
      }
      const retryable = statusCode === 429 || statusCode === 408 || statusCode === undefined || statusCode >= 500;
      const attempts = delivery.attempts + 1;
      const status = retryable && attempts < 5 ? 'FAILED' : 'SUPPRESSED';
      const retryAfter = Number((error as { headers?: Record<string, string> }).headers?.['retry-after']);
      db.prepare(`UPDATE web_push_deliveries SET status=?, attempts=?, next_attempt_at=?, last_error=?, lease_owner=NULL,
        lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?`).run(
        status, attempts, retryable ? retryAt(delivery.attempts, now, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined) : now.toISOString(),
        (error instanceof Error ? error.message : String(error)).slice(0, 500), now.toISOString(), delivery.id, owner
      );
      failed += 1;
    }
  }
  return { disabled: false, sent, failed, removed };
}

let workerTimer: NodeJS.Timeout | undefined;
let workerRunning = false;
export function startWebPushDeliveryWorker(): void {
  if (workerTimer || !webPushConfiguration().enabled) return;
  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try { await processPendingWebPushDeliveries(); } catch (error) { console.error('[web-push] delivery worker failed', error); }
    finally { workerRunning = false; }
  };
  workerTimer = setInterval(() => void run(), 60_000);
  workerTimer.unref?.();
  void run();
}

export const __webPushTestHooks = {
  stopWorker() { if (workerTimer) clearInterval(workerTimer); workerTimer = undefined; workerRunning = false; },
  endpointHash
};
