import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db.js';
import { upsertAlertEvent } from '../chase-store.js';
import {
  ebayListingContentFreshness,
  __ebayListingVerificationTestHooks,
  getEbayListingVerificationState,
  processExplicitEbayListingVerification,
  processEbayListingVerificationQueue,
  scheduleUnverifiedEbayListings,
  startHistoricalEbayVerificationWorker
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
  __ebayListingVerificationTestHooks.stopWorker();
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
  it('verifies only the explicitly selected registered RESTful listing', async () => {
    delete process.env.EBAY_HISTORICAL_VERIFICATION_ENABLED;
    const target = 'v1|267838869947|0';
    const unrelated = `v1|unrelated-${Date.now()}|0`;
    listingIds.add(target);
    listingIds.add(unrelated);
    seedAlert(target, 'explicit-target-user');
    seedAlert(unrelated, 'explicit-unrelated-user');
    const verify = vi.fn().mockResolvedValue({
      kind: 'AVAILABLE',
      httpStatus: 200,
      availabilityStatus: 'IN_STOCK'
    });

    await expect(processExplicitEbayListingVerification({
      listingId: target,
      now: new Date('2026-11-17T12:00:00.000Z'),
      verify
    })).resolves.toMatchObject({
      listingId: target,
      outcome: 'SUCCEEDED',
      availabilityState: 'AVAILABLE',
      attempted: 1
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(target, expect.any(Object));
    expect(getEbayListingVerificationState(unrelated)).toMatchObject({
      availabilityState: 'UNVERIFIED',
      attemptCount: 0,
      nextVerificationAt: undefined
    });
  });

  it('rejects unknown, numeric legacy, and malformed explicit listing IDs', async () => {
    const verify = vi.fn();
    await expect(processExplicitEbayListingVerification({ listingId: '267838869947', verify }))
      .rejects.toThrow('Numeric legacy');
    await expect(processExplicitEbayListingVerification({ listingId: 'not-an-ebay-id', verify }))
      .rejects.toThrow('valid RESTful');
    await expect(processExplicitEbayListingVerification({ listingId: 'v1|999999999999|0', verify }))
      .rejects.toThrow('not registered');
    expect(verify).not.toHaveBeenCalled();
  });

  it('enforces the hourly attempt budget for explicit verification', async () => {
    process.env.EBAY_HISTORICAL_VERIFICATION_HOURLY_LIMIT = '1';
    const target = `v1|hourly-${Date.now()}|0`;
    listingIds.add(target);
    seedAlert(target, 'explicit-hourly-user');
    db.prepare('INSERT INTO ebay_listing_verification_attempts (listing_id, attempted_at) VALUES (?, ?)')
      .run(target, '2026-11-17T11:30:00.000Z');
    const verify = vi.fn();

    await expect(processExplicitEbayListingVerification({
      listingId: target,
      now: new Date('2026-11-17T12:00:00.000Z'),
      verify
    })).resolves.toMatchObject({ outcome: 'DEFERRED', reason: 'HOURLY_LIMIT', attempted: 0 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('preserves lease ownership when explicit verification overlaps', async () => {
    const target = `v1|leased-${Date.now()}|0`;
    listingIds.add(target);
    seedAlert(target, 'explicit-lease-user');
    const now = new Date('2026-11-17T12:00:00.000Z');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const firstVerify = vi.fn(async () => {
      await blocked;
      return { kind: 'AVAILABLE' as const, httpStatus: 200, availabilityStatus: 'IN_STOCK' };
    });
    const secondVerify = vi.fn();

    const first = processExplicitEbayListingVerification({ listingId: target, now, workerId: 'explicit-a', verify: firstVerify });
    await vi.waitFor(() => expect(firstVerify).toHaveBeenCalledTimes(1));
    await expect(processExplicitEbayListingVerification({ listingId: target, now, workerId: 'explicit-b', verify: secondVerify }))
      .resolves.toMatchObject({ outcome: 'DEFERRED', reason: 'NOT_DUE_OR_LEASED', attempted: 0 });
    expect(secondVerify).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toMatchObject({ outcome: 'SUCCEEDED', attempted: 1 });
  });

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
    expect(ebayListingContentFreshness(id, retryAt)).toMatchObject({
      state: 'AVAILABLE',
      availabilityFresh: true,
      contentFresh: false,
      availabilityVerifiedAt: retryAt.toISOString()
    });
  });

  it('does not treat availability verification as a refresh of stored listing content', async () => {
    const id = listingId('content-freshness');
    const alertId = seedAlert(id);
    const before = db.prepare('SELECT listing_title, listing_price, listing_currency, listing_image_url FROM alert_events WHERE id = ?')
      .get(alertId);
    const now = new Date('2026-11-16T12:00:00.000Z');

    await processEbayListingVerificationQueue({
      now,
      verify: vi.fn().mockResolvedValue({
        kind: 'AVAILABLE',
        httpStatus: 200,
        itemEndAt: '2026-11-17T12:00:00.000Z',
        availabilityStatus: 'IN_STOCK'
      })
    });

    expect(ebayListingContentFreshness(id, now)).toEqual({
      state: 'AVAILABLE',
      availabilityFresh: true,
      contentFresh: false,
      availabilityVerifiedAt: now.toISOString(),
      contentRefreshedAt: undefined
    });
    expect(db.prepare('SELECT listing_title, listing_price, listing_currency, listing_image_url FROM alert_events WHERE id = ?')
      .get(alertId)).toEqual(before);
  });

  it('prevents concurrent workers from verifying the same listing', async () => {
    const id = listingId('concurrent');
    seedAlert(id);
    const now = new Date('2026-11-16T12:00:00.000Z');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const verify = vi.fn(async () => {
      await blocked;
      return { kind: 'AVAILABLE' as const, httpStatus: 200 };
    });

    const first = processEbayListingVerificationQueue({ now, workerId: 'worker-a', verify });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    const second = await processEbayListingVerificationQueue({ now, workerId: 'worker-b', verify });
    expect(second.attempted).toBe(0);
    release();
    await expect(first).resolves.toMatchObject({ attempted: 1, succeeded: 1 });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('prevents a stale worker from overwriting the result of a new lease owner', async () => {
    process.env.EBAY_HISTORICAL_VERIFICATION_LEASE_SECONDS = '1';
    const id = listingId('stale-owner');
    seedAlert(id);
    let currentMs = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = () => new Date(currentMs);
    let releaseA!: () => void;
    const blockedA = new Promise<void>((resolve) => { releaseA = resolve; });
    const verifyA = vi.fn(async (_id: string, options?: { onRequestStart?: () => void }) => {
      options?.onRequestStart?.();
      await blockedA;
      return { kind: 'ENDED_PUBLIC' as const, httpStatus: 200, availabilityStatus: 'OUT_OF_STOCK' };
    });

    const workerA = processEbayListingVerificationQueue({ clock, workerId: 'worker-a', verify: verifyA });
    await vi.waitFor(() => expect(verifyA).toHaveBeenCalledTimes(1));
    currentMs = Date.parse('2026-11-16T12:02:00.000Z');
    const workerB = await processEbayListingVerificationQueue({
      clock,
      workerId: 'worker-b',
      verify: vi.fn(async (_listingId, options) => {
        options.onRequestStart?.();
        return { kind: 'AVAILABLE' as const, httpStatus: 200, availabilityStatus: 'IN_STOCK' };
      })
    });
    const stateAfterB = getEbayListingVerificationState(id);
    expect(workerB).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(stateAfterB).toMatchObject({
      availabilityState: 'AVAILABLE',
      lastSuccessfulVerificationAt: '2026-11-16T12:02:00.000Z',
      nextVerificationAt: '2026-11-16T18:02:00.000Z',
      availabilityStatus: 'IN_STOCK'
    });

    currentMs = Date.parse('2026-11-16T12:03:00.000Z');
    releaseA();
    await expect(workerA).resolves.toMatchObject({ attempted: 1, succeeded: 0, failed: 0 });
    expect(getEbayListingVerificationState(id)).toEqual(stateAfterB);
  });

  it('uses per-item claim, attempt, completion, and retry timestamps in a long-running batch', async () => {
    const first = listingId('timing-a');
    const second = listingId('timing-b');
    seedAlert(first, 'timing-user-a');
    seedAlert(second, 'timing-user-b');
    let currentMs = Date.parse('2026-11-16T12:00:00.000Z');
    const clock = () => new Date(currentMs);
    const leaseExpirations: string[] = [];
    const verify = vi.fn(async (id: string, options?: { onRequestStart?: () => void }) => {
      currentMs += 4 * 60_000;
      options?.onRequestStart?.();
      leaseExpirations.push(getEbayListingVerificationState(id)!.leaseExpiresAt!);
      currentMs += 30_000;
      return { kind: 'TEMPORARY_FAILURE' as const, httpStatus: 503 };
    });

    const result = await processEbayListingVerificationQueue({ clock, workerId: 'timing-worker', verify });

    expect(result.attempted).toBe(2);
    expect(getEbayListingVerificationState(first)).toMatchObject({
      lastAttemptedAt: '2026-11-16T12:00:00.000Z',
      nextVerificationAt: '2026-11-16T12:14:30.000Z'
    });
    expect(getEbayListingVerificationState(second)).toMatchObject({
      lastAttemptedAt: '2026-11-16T12:04:30.000Z',
      nextVerificationAt: '2026-11-16T12:19:00.000Z'
    });
    expect(leaseExpirations).toEqual([
      '2026-11-16T12:09:00.000Z',
      '2026-11-16T12:13:30.000Z'
    ]);
  });

  it('turns unexpected verifier exceptions into durable retries and releases the lease', async () => {
    const id = listingId('exception');
    seedAlert(id);
    const result = await processEbayListingVerificationQueue({
      now: new Date('2026-11-16T12:00:00.000Z'),
      workerId: 'exception-worker',
      verify: vi.fn().mockRejectedValue(new Error('unexpected test failure'))
    });

    expect(result).toMatchObject({ attempted: 1, failed: 1 });
    expect(getEbayListingVerificationState(id)).toMatchObject({
      availabilityState: 'VERIFICATION_FAILED',
      lastErrorClass: 'TEMPORARY_FAILURE',
      attemptCount: 1
    });
    expect(getEbayListingVerificationState(id)?.leaseOwner).toBeUndefined();
  });

  it('runs historical verification on an independent non-overlapping timer', async () => {
    vi.useFakeTimers();
    process.env.EBAY_HISTORICAL_VERIFICATION_INTERVAL_SECONDS = '1';
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const processor = vi.fn(async () => {
      await blocked;
      return { attempted: 1 };
    });

    startHistoricalEbayVerificationWorker(processor);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(processor).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(processor).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
