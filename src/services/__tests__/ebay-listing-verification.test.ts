import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db.js';
import { upsertAlertEvent } from '../chase-store.js';
import {
  ebayListingContentFreshness,
  getEbayListingVerificationState,
  processEbayListingVerificationQueue,
  scheduleUnverifiedEbayListings
} from '../ebay-listing-verification.js';

const ORIGINAL_ENV = { ...process.env };
const listingIds = new Set<string>();

function listingId(label: string): string {
  const value = `verification-test-${label}-${Date.now()}-${Math.random()}`;
  listingIds.add(value);
  return value;
}

function seedAlert(id: string, user = 'verification-user'): string {
  return upsertAlertEvent({
    userId: user,
    chaseId: `chase-${user}`,
    listingId: id,
    source: 'EBAY',
    listingTitle: 'Preserved listing title',
    listingPrice: 42,
    listingCurrency: 'CAD',
    listingUrl: 'https://www.ebay.ca/itm/test',
    listingImageUrl: 'https://i.ebayimg.com/test.jpg',
    now: '2026-11-16T10:00:00.000Z'
  }).alertId;
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    EBAY_HISTORICAL_VERIFICATION_ENABLED: 'true',
    EBAY_HISTORICAL_VERIFICATION_BATCH_SIZE: '10',
    EBAY_HISTORICAL_VERIFICATION_HOURLY_LIMIT: '100'
  };
});

afterEach(() => {
  for (const id of listingIds) {
    db.prepare('DELETE FROM alert_events WHERE listing_id = ?').run(id);
    db.prepare('DELETE FROM sent_alerts WHERE listing_id = ?').run(id);
    db.prepare('DELETE FROM ebay_listing_verifications WHERE listing_id = ?').run(id);
  }
  listingIds.clear();
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('eBay listing verification persistence', () => {
  it('initializes the schema idempotently and deduplicates one listing shared by multiple users', async () => {
    const id = listingId('schema');
    seedAlert(id, 'user-a');
    seedAlert(id, 'user-b');

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ebay_listing_verifications'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='register_ebay_alert_verification'").get()).toBeTruthy();
    expect(getEbayListingVerificationState(id)).toMatchObject({
      listingId: id,
      availabilityState: 'UNVERIFIED',
      attemptCount: 0
    });
    expect(db.prepare('SELECT COUNT(*) count FROM ebay_listing_verifications WHERE listing_id = ?').get(id)).toMatchObject({ count: 1 });
    const verify = vi.fn().mockResolvedValue({ kind: 'AVAILABLE', httpStatus: 200 });
    expect((await processEbayListingVerificationQueue({ now: new Date('2026-11-16T12:00:00.000Z'), verify })).attempted).toBe(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('remains disabled by default without scheduling or claiming historical work', async () => {
    const id = listingId('disabled');
    seedAlert(id);
    delete process.env.EBAY_HISTORICAL_VERIFICATION_ENABLED;
    const verify = vi.fn();

    expect(scheduleUnverifiedEbayListings(new Date('2026-11-16T12:00:00.000Z'))).toBe(0);
    await expect(processEbayListingVerificationQueue({ verify })).resolves.toEqual({
      disabled: true, attempted: 0, succeeded: 0, failed: 0, deferred: 0
    });
    expect(verify).not.toHaveBeenCalled();
    expect(getEbayListingVerificationState(id)?.nextVerificationAt).toBeUndefined();
  });

  it('records available, ended-public, unavailable, and failed outcomes without changing Inbox data', async () => {
    const cases = [
      ['available', { kind: 'AVAILABLE' as const, httpStatus: 200, availabilityStatus: 'IN_STOCK' }, 'AVAILABLE'],
      ['ended', { kind: 'ENDED_PUBLIC' as const, httpStatus: 200, itemEndAt: '2026-11-15T00:00:00.000Z' }, 'ENDED_PUBLIC'],
      ['unavailable', { kind: 'UNAVAILABLE' as const, httpStatus: 410 }, 'UNAVAILABLE'],
      ['ambiguous', { kind: 'AMBIGUOUS_NOT_FOUND' as const, httpStatus: 404 }, 'VERIFICATION_FAILED']
    ] as const;

    for (const [label, result, expectedState] of cases) {
      const id = listingId(label);
      const alertId = seedAlert(id, `user-${label}`);
      const before = db.prepare('SELECT listing_title, listing_price, listing_url, listing_image_url, reviewed_at, dismissed_at FROM alert_events WHERE id = ?').get(alertId);
      scheduleUnverifiedEbayListings(new Date('2026-11-16T12:00:00.000Z'));
      await processEbayListingVerificationQueue({
        now: new Date('2026-11-16T12:00:00.000Z'),
        verify: vi.fn().mockResolvedValue(result)
      });

      expect(getEbayListingVerificationState(id)?.availabilityState).toBe(expectedState);
      expect(db.prepare('SELECT listing_title, listing_price, listing_url, listing_image_url, reviewed_at, dismissed_at FROM alert_events WHERE id = ?').get(alertId)).toEqual(before);
    }
  });

  it('recovers expired leases and durable retries after a simulated restart', async () => {
    const id = listingId('restart');
    seedAlert(id);
    const firstAt = new Date('2026-11-16T12:00:00.000Z');
    scheduleUnverifiedEbayListings(firstAt);
    db.prepare(`UPDATE ebay_listing_verifications SET lease_owner='dead-worker', lease_expires_at=? WHERE listing_id=?`)
      .run('2026-11-16T12:01:00.000Z', id);

    const verify = vi.fn().mockResolvedValue({ kind: 'TEMPORARY_FAILURE', httpStatus: 503 });
    expect((await processEbayListingVerificationQueue({ now: new Date('2026-11-16T12:00:30.000Z'), verify })).attempted).toBe(0);
    expect((await processEbayListingVerificationQueue({ now: new Date('2026-11-16T12:02:00.000Z'), verify })).attempted).toBe(1);
    const failed = getEbayListingVerificationState(id);
    expect(failed).toMatchObject({ availabilityState: 'VERIFICATION_FAILED', attemptCount: 1, lastErrorClass: 'TEMPORARY_FAILURE' });

    verify.mockResolvedValue({ kind: 'AVAILABLE', httpStatus: 200, availabilityStatus: 'IN_STOCK' });
    const retryAt = new Date(failed!.nextVerificationAt!);
    expect((await processEbayListingVerificationQueue({ now: retryAt, verify })).succeeded).toBe(1);
    expect(ebayListingContentFreshness(id, retryAt)).toMatchObject({ state: 'AVAILABLE', fresh: true });
  });

  it('enforces a durable hourly request limit', async () => {
    process.env.EBAY_HISTORICAL_VERIFICATION_HOURLY_LIMIT = '1';
    const first = listingId('rate-a');
    const second = listingId('rate-b');
    seedAlert(first, 'rate-user-a');
    seedAlert(second, 'rate-user-b');
    const now = new Date('2026-11-16T12:00:00.000Z');
    const verify = vi.fn().mockResolvedValue({ kind: 'AVAILABLE', httpStatus: 200 });

    expect((await processEbayListingVerificationQueue({ now, verify })).attempted).toBe(1);
    expect((await processEbayListingVerificationQueue({ now: new Date('2026-11-16T12:30:00.000Z'), verify })).attempted).toBe(0);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
