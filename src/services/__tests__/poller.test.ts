import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../types.js';
import {
  alertEbaySearchOptions,
  chaseTuningNoticeLines,
  didFetchRequiredListingSource,
  discordDeliveryRetryPlan,
  enrichSelectedAlertListing,
  effectiveListingSourceMode,
  isDueForPollInterval,
  listingSourceFailureReason,
  orderAlertCandidatesForSending,
  orderGroupMembersForRun,
  processPendingDiscordAlertDeliveries,
  resetDiscordDeliveryConfigurationWarningForTests,
  shouldSendChaseTuningNotice,
  orderGroupsForRun,
  listingSourceDiagnosticSummary,
  sourceQueryKey,
  shippingDestinationFromSettings,
  shouldSuppressForDestinationShipping,
  shouldApplyEbayBackoff
} from '../poller.js';
import { getEntitlementsForTier } from '../entitlements.js';
import {
  enqueueAlertEventDelivery,
  getAlertDeliveryById,
  getAlertEventById,
  getSentAlertByKey,
  getUserAlertSettings,
  resetUserAlertSettings,
  setUserAlertSettings,
  upsertAlertEvent
} from '../chase-store.js';
import { createUser, linkIdentity } from '../accounts.js';
import { setDiscordCardAlertsEnabled } from '../notification-settings.js';
import { DiscordRestDeliveryError } from '../discord-rest-delivery.js';
import { db } from '../db.js';
import { matchChaseToListing } from '../matcher.js';
import { getPollerState, markPollerRunStart, setPollerCoverageSnapshot } from '../poller-state.js';
import { activePlanChases, activePlanTier, getRuntimePollIntervalSeconds, monitoringPlanChases, pausedPlanChases, PLAN_LIMITS } from '../plans.js';
import type { Chase } from '../../types.js';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

function baseChase(overrides: Partial<Chase> = {}): Chase {
  return {
    id: 'poller-chase-1',
    userId: 'poller-user-1',
    cardName: 'Mew CoroCoro Promo 151',
    queryName: 'CoroCoro Shining Mew',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetDiscordDeliveryConfigurationWarningForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  resetDiscordDeliveryConfigurationWarningForTests();
});

describe('orderGroupsForRun', () => {
  it('orders due Plus work before due Free work without dropping Free work', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'free-overdue',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-20T00:00:00.000Z', oldestDueAtMs: 100, monitoringPriority: 'STANDARD' }
      },
      {
        queryKey: 'plus-due',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-21T00:00:00.000Z', oldestDueAtMs: 200, monitoringPriority: 'PRIORITY' }
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['plus-due', 'free-overdue']);
  });

  it('orders Plus members first inside one shared source group', () => {
    const ordered = orderGroupMembersForRun([
      { id: 'free', monitoringPriority: 'STANDARD' as const },
      { id: 'plus', monitoringPriority: 'PRIORITY' as const }
    ]);

    expect(ordered.map((member) => member.id)).toEqual(['plus', 'free']);
  });

  it('prioritizes the most overdue group before process-local source history', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'squirtle',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T20:59:39.622Z', oldestDueAtMs: 1_000 },
        lastSourceFetchAtMs: 100
      },
      {
        queryKey: 'mew',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-28T04:12:00.729Z', oldestDueAtMs: 100 },
        lastSourceFetchAtMs: 200
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['mew', 'squirtle']);
  });

  it('prioritizes groups that have never consumed a source fetch', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T23:25:23.575Z', oldestDueAtMs: 0 },
        lastSourceFetchAtMs: 100
      },
      {
        queryKey: 'squirtle',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T20:59:39.622Z', oldestDueAtMs: 0 }
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });

  it('prioritizes the least recently serviced group', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T23:25:23.575Z', oldestDueAtMs: 0 },
        lastSourceFetchAtMs: 200
      },
      {
        queryKey: 'squirtle',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T20:59:39.622Z', oldestDueAtMs: 0 },
        lastSourceFetchAtMs: 100
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });

  it('breaks ties with the oldest chase creation time', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T23:25:23.575Z', oldestDueAtMs: 0 }
      },
      {
        queryKey: 'squirtle',
        group: { members: [], sourceMode: 'EBAY', oldestCreatedAt: '2026-05-24T20:59:39.622Z', oldestDueAtMs: 0 }
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });
});

describe('effectiveListingSourceMode', () => {
  it('keeps Free users on eBay when storefront monitoring is configured globally', () => {
    expect(effectiveListingSourceMode('EBAY_SHOPIFY', 'FREE')).toBe('EBAY');
    expect(effectiveListingSourceMode('SHOPIFY', 'FREE')).toBe('EBAY');
  });

  it('uses eBay as the default source mode', () => {
    expect(effectiveListingSourceMode('EBAY_SHOPIFY', 'PRO')).toBe('EBAY');
    expect(effectiveListingSourceMode('SHOPIFY', 'PRO')).toBe('EBAY');
  });

  it('lets Pro users override the default source preference', () => {
    expect(effectiveListingSourceMode('EBAY', 'PRO', 'EBAY_SHOPIFY')).toBe('EBAY_SHOPIFY');
    expect(effectiveListingSourceMode('EBAY_SHOPIFY', 'PRO', 'SHOPIFY')).toBe('SHOPIFY');
    expect(effectiveListingSourceMode('SHOPIFY', 'PRO', 'EBAY')).toBe('EBAY');
  });

  it('keeps Free user storefront preferences on eBay', () => {
    expect(effectiveListingSourceMode('EBAY', 'FREE', 'EBAY_SHOPIFY')).toBe('EBAY');
    expect(effectiveListingSourceMode('EBAY', 'FREE', 'SHOPIFY')).toBe('EBAY');
  });

  it('leaves mock mode available for local testing', () => {
    expect(effectiveListingSourceMode('MOCK', 'FREE', 'SHOPIFY')).toBe('MOCK');
  });
});

describe('plan access', () => {
  it('uses Free 3 and Pro 50 chase limits', () => {
    expect(PLAN_LIMITS.FREE.maxActiveChases).toBe(3);
    expect(PLAN_LIMITS.PRO.maxActiveChases).toBe(50);
  });

  it('exposes standard Free and priority Plus monitoring without changing intervals', () => {
    expect(getEntitlementsForTier('FREE')).toMatchObject({ monitoringPriority: 'STANDARD', pollIntervalSeconds: 1800 });
    expect(getEntitlementsForTier('PRO')).toMatchObject({ monitoringPriority: 'PRIORITY', pollIntervalSeconds: 900 });
  });

  it('treats inactive Pro subscriptions as Free access', () => {
    expect(activePlanTier({ tier: 'PRO', status: 'ACTIVE' })).toBe('PRO');
    expect(activePlanTier({ tier: 'PRO', status: 'PAST_DUE' })).toBe('FREE');
    expect(activePlanTier({ tier: 'PRO', status: 'CANCELED' })).toBe('FREE');
    expect(activePlanTier({ tier: 'FREE', status: 'ACTIVE' })).toBe('FREE');
  });

  it('keeps only the Free allowance active when Pro access is paused', () => {
    const chases = [
      { id: 'normal-old', priority: 'NORMAL' as const, createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 'grail-new', priority: 'GRAIL' as const, createdAt: '2026-06-04T00:00:00.000Z' },
      { id: 'high', priority: 'HIGH' as const, createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'normal-new', priority: 'NORMAL' as const, createdAt: '2026-06-05T00:00:00.000Z' }
    ];

    expect(activePlanChases(chases, { tier: 'PRO', status: 'PAST_DUE' }).map((chase) => chase.id)).toEqual(['grail-new', 'high', 'normal-old']);
    expect(pausedPlanChases(chases, { tier: 'PRO', status: 'PAST_DUE' }).map((chase) => chase.id)).toEqual(['normal-new']);
    expect(activePlanChases(chases, { tier: 'PRO', status: 'ACTIVE' }).map((chase) => chase.id)).toEqual(['grail-new', 'high', 'normal-old', 'normal-new']);
  });

  it('excludes user-paused Chases from monitoring without removing them from collector eligibility', () => {
    const chases = [
      { id: 'paused-grail', priority: 'GRAIL' as const, pausedAt: '2026-10-10T12:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 'watching-high', priority: 'HIGH' as const, createdAt: '2026-06-02T00:00:00.000Z' }
    ];

    expect(monitoringPlanChases(chases, { tier: 'FREE', status: 'ACTIVE' }).map((chase) => chase.id)).toEqual(['watching-high']);
    expect(activePlanChases(chases, { tier: 'FREE', status: 'ACTIVE' }).map((chase) => chase.id)).toEqual(['paused-grail', 'watching-high']);
  });
});

describe('isDueForPollInterval', () => {
  it('keeps runtime wake cadence separate from plan eligibility windows', () => {
    expect(getRuntimePollIntervalSeconds()).toBe(300);
    expect(PLAN_LIMITS.PRO.pollIntervalSeconds).toBe(900);
    expect(PLAN_LIMITS.FREE.pollIntervalSeconds).toBe(1800);
  });

  it('treats uninitialized chases as due immediately', () => {
    expect(isDueForPollInterval(undefined, 900, 1_000)).toBe(true);
  });

  it('blocks checks until the interval window has elapsed', () => {
    expect(isDueForPollInterval(1_000, 1800, 1_000 + 1_799_000)).toBe(false);
  });

  it('does not make Free work due when the Plus interval elapses', () => {
    const nowMs = 1_000 + 900_000;
    expect(isDueForPollInterval(1_000, PLAN_LIMITS.PRO.pollIntervalSeconds, nowMs)).toBe(true);
    expect(isDueForPollInterval(1_000, PLAN_LIMITS.FREE.pollIntervalSeconds, nowMs)).toBe(false);
  });

  it('allows checks once the interval window has elapsed', () => {
    expect(isDueForPollInterval(1_000, 900, 1_000 + 900_000)).toBe(true);
  });
});

describe('orderAlertCandidatesForSending', () => {
  it('keeps a Trusted Shops candidate ahead of eBay when both sources match', () => {
    const ordered = orderAlertCandidatesForSending([
      { listing: { source: 'EBAY', listingId: 'ebay-1' }, rankScore: 70_000 },
      { listing: { source: 'EBAY', listingId: 'ebay-2' }, rankScore: 69_000 },
      { listing: { source: 'SHOPIFY', listingId: 'shopify-1' }, rankScore: 60_000 }
    ] as never);

    expect(ordered.map((candidate) => candidate.listing.listingId)).toEqual(['shopify-1', 'ebay-1', 'ebay-2']);
  });

  it('does not let blocked custom or unofficial listings reach alert-candidate ranking', () => {
    const chase = baseChase({ maxPrice: 300 });
    const listing: Listing = {
      source: 'EBAY',
      listingId: 'blocked-custom-1',
      title: 'Shining Mew Corocoro Promotional Cards Holo (Japanese)(art by me)',
      price: 80,
      currency: 'CAD',
      url: 'https://example.com/blocked-custom-1',
      region: 'CA',
      sellerFeedbackPercent: 100,
      sellerFeedbackScore: 5000
    };

    const match = matchChaseToListing(chase, listing);
    const candidates = match.isMatch
      ? orderAlertCandidatesForSending([{
          listing,
          normalizedListing: listing,
          match,
          targetCurrency: 'CAD',
          listingFingerprint: 'blocked-custom-1',
          rankScore: match.score * 1000
        } as never])
      : [];

    expect(match).toEqual({
      isMatch: false,
      score: 0,
      reasons: ['custom_or_unofficial_item_block']
    });
    expect(candidates).toEqual([]);
  });

  it('does not let an exact-identity art-display accessory reach alert-candidate ranking', () => {
    const chase = baseChase({
      cardName: 'Sylveon EX Generations RC32',
      queryName: 'Sylveon EX RC32',
      grade: 'UNGRADED',
      maxPrice: 300
    });
    const listing: Listing = {
      source: 'EBAY',
      listingId: '336740538287',
      title: 'Sylveon EX RC32 Case | Pokemon Generations | Art Guard (Ungraded)',
      price: 40,
      currency: 'CAD',
      url: 'https://www.ebay.ca/itm/336740538287',
      region: 'CA',
      condition: 'Ungraded',
      sellerFeedbackPercent: 100,
      sellerFeedbackScore: 5000
    };

    const match = matchChaseToListing(chase, listing);
    const candidates = match.isMatch
      ? orderAlertCandidatesForSending([{
          listing,
          normalizedListing: listing,
          match,
          targetCurrency: 'CAD',
          listingFingerprint: '336740538287',
          rankScore: match.score * 1000
        } as never])
      : [];

    expect(match).toEqual({
      isMatch: false,
      score: 0,
      reasons: ['default_exclusion_block', 'default_exclusion:display accessory']
    });
    expect(candidates).toEqual([]);
  });
});

describe('alert eBay search options', () => {
  it('counts cached and empty provider success while retaining partial and deferred coverage', () => {
    expect(didFetchRequiredListingSource({
      listings: [],
      complete: true,
      providers: [{ provider: 'EBAY', status: 'EMPTY', listingCount: 0 }]
    })).toBe(true);
    const partial = {
      listings: [{ source: 'SHOPIFY', listingId: 'shop-1' } as Listing],
      complete: false,
      providers: [
        { provider: 'EBAY' as const, status: 'DEFERRED' as const, listingCount: 0, reason: 'Backoff' },
        { provider: 'SHOPIFY' as const, status: 'SUCCESS' as const, listingCount: 1 }
      ]
    };
    expect(didFetchRequiredListingSource(partial)).toBe(false);
    expect(listingSourceDiagnosticSummary(partial)).toBe('EBAY:DEFERRED:0,SHOPIFY:SUCCESS:1');
  });

  it('does not share provider results across request-affecting query, budget, or currency inputs', () => {
    const settings = { ...getUserAlertSettings('poller-query-key'), alertCurrency: 'CAD' as const };
    const base = sourceQueryKey(baseChase({ maxPrice: 100 }), settings, 'EBAY_SHOPIFY');

    expect(sourceQueryKey(baseChase({ queryName: 'Mew RC24', maxPrice: 100 }), settings, 'EBAY_SHOPIFY')).not.toBe(base);
    expect(sourceQueryKey(baseChase({ maxPrice: 200 }), settings, 'EBAY_SHOPIFY')).not.toBe(base);
    expect(sourceQueryKey(baseChase({ maxPrice: 100 }), { ...settings, alertCurrency: 'USD' }, 'EBAY_SHOPIFY')).not.toBe(base);
  });

  it('keeps plan priority out of shared source request identity', () => {
    const settings = { ...getUserAlertSettings('poller-shared-priority-key'), alertCurrency: 'CAD' as const };
    const free = sourceQueryKey(baseChase({ userId: 'free-user', maxPrice: 100 }), settings, 'EBAY');
    const plus = sourceQueryKey(baseChase({ userId: 'plus-user', maxPrice: 100 }), settings, 'EBAY');

    expect(plus).toBe(free);
  });

  it('keeps poller eBay searches lightweight so broad chases do not block alert delivery on shipping enrichment', () => {
    expect(alertEbaySearchOptions()).toEqual({ enrichMissingShipping: false });
  });

  it('passes chase max price into poller eBay searches when available', () => {
    expect(alertEbaySearchOptions({ maxPrice: 550 } as never, 'CAD')).toEqual({
      enrichMissingShipping: false,
      maxPrice: 550,
      maxPriceCurrency: 'CAD'
    });
  });

  it('classifies source failures for poller coverage without failing the whole run', () => {
    expect(listingSourceFailureReason(new Error('Listing source timeout'))).toBe('Source timeout');
    expect(listingSourceFailureReason(new Error('eBay rate limit exceeded: 429'))).toBe('Rate limit');
    expect(listingSourceFailureReason(new Error('socket hang up'))).toBe('Source error');
    expect(shouldApplyEbayBackoff(new Error('Listing source timeout'))).toBe(false);
    expect(shouldApplyEbayBackoff(new Error('eBay rate limit exceeded: 429'))).toBe(true);
  });

  it('nudges chase tune-outs only when one chase has more eligible alerts than the per-poll cap', () => {
    expect(shouldSendChaseTuningNotice(3, 8, 3)).toBe(true);
    expect(shouldSendChaseTuningNotice(2, 8, 3)).toBe(false);
    expect(shouldSendChaseTuningNotice(3, 3, 3)).toBe(false);
  });

  it('keeps high-volume chase guidance within Free controls while softly pointing to Pro', () => {
    const text = chaseTuningNoticeLines({ cardName: 'blastoise 002' }, 'FREE', 3, 8).join('\n');

    expect(text).toContain('tighten the chase name');
    expect(text).toContain('lower the max price');
    expect(text).toContain('/upgrade');
    expect(text).toContain('explains KeepSeek Plus');
    expect(text).not.toContain(['negative', 'keywords'].join(' '));
    expect(text).not.toContain('condition or grade');
  });

  it('keeps Pro high-volume chase guidance focused on advanced custom exclusion controls', () => {
    const text = chaseTuningNoticeLines({ cardName: 'blastoise 002' }, 'PRO', 3, 8).join('\n');

    expect(text).toContain('condition or grade');
    expect(text).toContain('custom exclusions');
    expect(text).toContain('/alerts settings');
    expect(text).not.toContain('/upgrade');
  });
});

describe('pending Discord alert deliveries', () => {
  function clearAlertRows(userId: string): void {
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sent_alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_notification_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_identities WHERE user_id = ? OR provider_user_id = ?').run(userId, userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  it('sends pending Discord DM deliveries through the linked Discord identity and records sent alert details', async () => {
    const discordUserId = `discord-pending-delivery-${Date.now()}`;
    clearAlertRows(discordUserId);
    const account = createUser({ displayName: 'Pending Collector' });
    const userId = account.id;
    linkIdentity({
      userId,
      provider: 'DISCORD',
      providerUserId: discordUserId,
      username: 'pending-collector'
    });
    setDiscordCardAlertsEnabled(userId, true);
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.VAULTR_WEB_BASE_URL = 'https://keepseek.test';
    const sender = vi.fn(async () => ({ messageId: 'discord-message-1' }));

    const { deliveryId } = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-1',
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
      now: '2026-08-19T12:00:00.000Z'
    });

    const result = await processPendingDiscordAlertDeliveries(5, sender);

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ discordUserId, token: 'test-token' }));
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({
      status: 'SENT',
      attempts: 1,
      externalMessageId: 'discord-message-1'
    });
    expect(getSentAlertByKey(userId, 'chase-1', 'listing-1', 'EBAY')).toMatchObject({
      userId,
      chaseId: 'chase-1',
      listingId: 'listing-1',
      listingTitle: 'Pikachu 26/83 Toys R Us Promo NM',
      listingPrice: 79.99,
      listingCurrency: 'CAD',
      matchScore: 94
    });

    clearAlertRows(userId);
    clearAlertRows(discordUserId);
  });

  it('preserves queued Inbox deliveries through missing Discord configuration and resumes once restored', async () => {
    const account = createUser({ displayName: 'Configuration Recovery Collector' });
    const userId = account.id;
    const discordUserId = `discord-config-recovery-${Date.now()}`;
    linkIdentity({ userId, provider: 'DISCORD', providerUserId: discordUserId });
    setDiscordCardAlertsEnabled(userId, true);
    const { alertId, deliveryId } = enqueueAlertEventDelivery({
      userId, chaseId: 'config-chase', listingId: 'config-listing', source: 'EBAY', channel: 'DISCORD_DM',
      listingTitle: 'Configuration recovery listing', listingUrl: 'https://example.test/config-recovery'
    });
    const sender = vi.fn(async () => ({ messageId: 'configuration-recovery-message' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    delete process.env.DISCORD_TOKEN;
    process.env.VAULTR_WEB_BASE_URL = 'https://keepseek.test';
    expect(await processPendingDiscordAlertDeliveries(5, sender)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await processPendingDiscordAlertDeliveries(5, sender)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(warn).toHaveBeenCalledTimes(1);

    process.env.DISCORD_TOKEN = 'test-token';
    delete process.env.VAULTR_WEB_BASE_URL;
    expect(await processPendingDiscordAlertDeliveries(5, sender)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({ status: 'PENDING', attempts: 0, nextAttemptAt: undefined });
    expect(getAlertEventById(alertId)).toMatchObject({ status: 'DELIVERY_PENDING', listingTitle: 'Configuration recovery listing' });
    expect(sender).not.toHaveBeenCalled();

    process.env.VAULTR_WEB_BASE_URL = 'https://keepseek.test';
    expect(await processPendingDiscordAlertDeliveries(5, sender)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(getAlertEventById(alertId)).toMatchObject({ status: 'DELIVERED' });
    clearAlertRows(userId);
    clearAlertRows(discordUserId);
  });

  it('suppresses pending Discord delivery when card alerts are not opted in while preserving the Inbox event', async () => {
    const account = createUser({ displayName: 'Inbox Only Collector' });
    const userId = account.id;
    const discordUserId = `discord-inbox-only-${Date.now()}`;
    linkIdentity({ userId, provider: 'DISCORD', providerUserId: discordUserId });
    const { alertId, deliveryId } = enqueueAlertEventDelivery({
      userId,
      chaseId: 'chase-opt-out',
      listingId: 'listing-opt-out',
      source: 'EBAY',
      channel: 'DISCORD_DM',
      listingTitle: 'Mew RC24 raw',
      listingUrl: 'https://example.test/opt-out'
    });
    const sender = vi.fn();

    expect(await processPendingDiscordAlertDeliveries(5, sender)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sender).not.toHaveBeenCalled();
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({ status: 'SUPPRESSED', attempts: 0 });
    expect(getAlertEventById(alertId)).toMatchObject({ userId, listingTitle: 'Mew RC24 raw' });
    clearAlertRows(userId);
    clearAlertRows(discordUserId);
  });

  it('respects durable Discord rate-limit scheduling without consuming retry attempts', async () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.VAULTR_WEB_BASE_URL = 'https://keepseek.test';
    const account = createUser({ displayName: 'Retry Collector' });
    const userId = account.id;
    const discordUserId = `discord-retry-${Date.now()}`;
    linkIdentity({ userId, provider: 'DISCORD', providerUserId: discordUserId });
    setDiscordCardAlertsEnabled(userId, true);
    const { alertId, deliveryId } = enqueueAlertEventDelivery({
      userId, chaseId: 'retry-chase', listingId: 'retry-listing', source: 'EBAY', channel: 'DISCORD_DM',
      listingTitle: 'Retry listing', listingUrl: 'https://example.test/retry'
    });
    const sender = vi.fn()
      .mockRejectedValueOnce(new DiscordRestDeliveryError('Discord rate limited', 429, 120_000))
      .mockResolvedValueOnce({ messageId: 'retry-message' });
    const startedAt = new Date('2026-11-06T12:00:00.000Z');

    expect(await processPendingDiscordAlertDeliveries(5, sender, startedAt)).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({ status: 'FAILED', attempts: 0, nextAttemptAt: '2026-11-06T12:02:00.000Z' });
    expect(getAlertEventById(alertId)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(await processPendingDiscordAlertDeliveries(5, sender, new Date('2026-11-06T12:01:59.000Z'))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await processPendingDiscordAlertDeliveries(5, sender, new Date('2026-11-06T12:02:00.000Z'))).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(getAlertDeliveryById(deliveryId)).toMatchObject({ status: 'SENT', attempts: 1, externalMessageId: 'retry-message', nextAttemptAt: undefined });
    clearAlertRows(userId);
    clearAlertRows(discordUserId);
  });

  it('backs off transient DM failures and does not retry permanent Discord failures', () => {
    expect(discordDeliveryRetryPlan(new Error('network timeout'), 1, Date.parse('2026-11-06T12:00:00.000Z'))).toEqual({
      incrementAttempt: true,
      nextAttemptAt: '2026-11-06T12:01:00.000Z'
    });
    expect(discordDeliveryRetryPlan(new DiscordRestDeliveryError('Forbidden', 403), 0, Date.parse('2026-11-06T12:00:00.000Z'))).toEqual({
      incrementAttempt: true
    });
    expect(discordDeliveryRetryPlan(new DiscordRestDeliveryError('Rate limited', 429, 90_000), 4, Date.parse('2026-11-06T12:00:00.000Z'))).toEqual({
      incrementAttempt: false,
      nextAttemptAt: '2026-11-06T12:01:30.000Z'
    });
  });

  it('allows an account without Discord to own an alert event without a delivery row', () => {
    const account = createUser({ displayName: 'Web Only Collector' });
    const userId = account.id;
    clearAlertRows(userId);

    const { alertId } = upsertAlertEvent({
      userId,
      chaseId: 'web-only-chase',
      listingId: 'web-only-listing',
      source: 'EBAY',
      chaseName: 'Mew RC24',
      listingTitle: 'Mew RC24 raw',
      listingUrl: 'https://example.test/web-only-listing',
      now: '2026-08-19T12:00:00.000Z'
    });

    expect(getAlertEventById(alertId)).toMatchObject({
      userId,
      status: 'MATCHED',
      chaseName: 'Mew RC24',
      listingTitle: 'Mew RC24 raw'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM alert_deliveries WHERE alert_id = ?').get(alertId)).toMatchObject({ count: 0 });

    clearAlertRows(userId);
  });
});

describe('selected alert shipping enrichment', () => {
  it('rechecks eBay shipping for the configured destination even when search returned default shipping', async () => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    process.env.EBAY_APP_ID = 'app-id';
    process.env.ALERT_LISTING_ENRICHMENT_TIMEOUT_MS = '5000';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: [{ shippingCost: { value: '18.50', currency: 'CAD' } }]
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const listing: Listing = {
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      shippingCost: 7.5,
      shippingCurrency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US'
    };

    const enriched = await enrichSelectedAlertListing(listing, { country: 'CA' });
    const itemDetailsHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(itemDetailsHeaders['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country=CA');
    expect(enriched.shippingCost).toBe(18.5);
    expect(enriched.shippingCurrency).toBe('CAD');
    expect(enriched.shippingDestinationCountry).toBe('CA');
  });

  it('does not keep default shipping when eBay returns no destination shipping options', async () => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    process.env.EBAY_APP_ID = 'app-id';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/identity/v1/oauth2/token')) return jsonResponse({ access_token: 'token', expires_in: 7200 });
      if (url.includes('/buy/browse/v1/item/')) return jsonResponse({ shippingOptions: [] });
      return jsonResponse({ Item: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    const listing: Listing = {
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      shippingCost: 7.5,
      shippingCurrency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US'
    };

    const enriched = await enrichSelectedAlertListing(listing, { country: 'CA' });

    expect(enriched.shippingCost).toBeUndefined();
    expect(enriched.shippingCurrency).toBeUndefined();
    expect(enriched.shippingEligibility).toBe('MAY_NOT_SHIP');
    expect(shouldSuppressForDestinationShipping(enriched, { country: 'CA' })).toBe(true);
  });

  it('suppresses listings that eBay says may not ship to the configured destination', () => {
    const listing: Listing = {
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      shippingEligibility: 'MAY_NOT_SHIP',
      shippingEligibilityMessage: 'May not ship to CA',
      url: 'https://example.com/item/1234567890',
      region: 'US'
    };

    expect(shouldSuppressForDestinationShipping(listing, { country: 'CA' })).toBe(true);
    expect(shouldSuppressForDestinationShipping(listing)).toBe(false);
  });

  it('keeps destination alerts when eBay shipping is available', () => {
    const baseListing: Listing = {
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US'
    };

    expect(shouldSuppressForDestinationShipping({ ...baseListing, shippingEligibility: 'AVAILABLE' }, { country: 'CA' })).toBe(false);
    expect(shouldSuppressForDestinationShipping({ ...baseListing, shippingCost: 12.5, shippingCurrency: 'USD' }, { country: 'CA' })).toBe(false);
  });

  it('suppresses eBay listings when destination shipping stays unknown after enrichment', () => {
    const listing: Listing = {
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US'
    };

    expect(shouldSuppressForDestinationShipping({ ...listing, shippingEligibility: 'UNKNOWN' }, { country: 'CA' })).toBe(true);
    expect(shouldSuppressForDestinationShipping(listing, { country: 'CA' })).toBe(true);
  });

  it('does not suppress non-eBay listings for destination shipping', () => {
    const listing: Listing = {
      source: 'SHOPIFY',
      listingId: 'shop-1',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/shop-1',
      region: 'US'
    };

    expect(shouldSuppressForDestinationShipping(listing, { country: 'CA' })).toBe(false);
  });
});

describe('shipping destination settings', () => {
  it('stores only postal region and passes it to eBay destinations', () => {
    const userId = `shipping-postal-${Date.now()}`;
    resetUserAlertSettings(userId);
    const settings = setUserAlertSettings(userId, { shippingCountry: 'CA', shippingPostalCode: 'M5V 2T6' });

    expect(getUserAlertSettings(userId).shippingPostalCode).toBe('M5V');
    expect(shippingDestinationFromSettings(settings)).toEqual({ country: 'CA', postalCode: 'M5V' });
  });

  it('stores only five-digit US ZIP when ZIP+4 is provided', () => {
    const userId = `shipping-zip-${Date.now()}`;
    resetUserAlertSettings(userId);
    const settings = setUserAlertSettings(userId, { shippingCountry: 'US', shippingPostalCode: '90210-1234' });

    expect(settings.shippingPostalCode).toBe('90210');
    expect(getUserAlertSettings(userId).shippingPostalCode).toBe('90210');
  });

  it('clears postal region when it does not match the ship-to country', () => {
    const userId = `shipping-mismatch-${Date.now()}`;
    resetUserAlertSettings(userId);

    expect(setUserAlertSettings(userId, { shippingCountry: 'CA', shippingPostalCode: '90210' }).shippingPostalCode).toBeUndefined();
    expect(setUserAlertSettings(userId, { shippingCountry: 'US', shippingPostalCode: 'M5V' }).shippingPostalCode).toBeUndefined();
  });

  it('does not retain postal region for unsupported ship-to countries', () => {
    const userId = `shipping-unsupported-${Date.now()}`;
    resetUserAlertSettings(userId);
    const settings = setUserAlertSettings(userId, { shippingCountry: 'GB', shippingPostalCode: 'SW1A 1AA' });

    expect(settings.shippingCountry).toBe('GB');
    expect(settings.shippingPostalCode).toBeUndefined();
  });

  it('clears postal code when ship-to country is cleared', () => {
    const userId = `shipping-clear-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserAlertSettings(userId, { shippingCountry: 'US', shippingPostalCode: '90210' });
    const settings = setUserAlertSettings(userId, { shippingCountry: null });

    expect(settings.shippingCountry).toBeUndefined();
    expect(settings.shippingPostalCode).toBeUndefined();
    expect(shippingDestinationFromSettings(settings)).toBeUndefined();
  });
});

describe('poller coverage state', () => {
  it('stores a defensive copy of the last source coverage snapshot', () => {
    const snapshot = {
      dueGroups: 3,
      dueChases: 5,
      checkedGroups: 2,
      checkedChases: 4,
      deferredGroups: 1,
      deferredChases: 1,
      rateLimitedGroups: 1,
      backoffGroups: 0,
      sourceTimeoutGroups: 0,
      sourceErrorGroups: 0,
      oldestDue: { queryKey: 'moltres zapdos articuno', chaseCount: 1, overdueSeconds: 1860 },
      oldestDeferred: { queryKey: 'moltres zapdos articuno', chaseCount: 1, overdueSeconds: 1860, reason: 'Rate limit' }
    };

    setPollerCoverageSnapshot(snapshot);
    snapshot.oldestDeferred.reason = 'Changed';

    expect(getPollerState().lastRunCoverage).toMatchObject({
      dueGroups: 3,
      checkedGroups: 2,
      deferredGroups: 1,
      oldestDeferred: { reason: 'Rate limit' }
    });
  });

  it('clears last run coverage when a new run starts', () => {
    setPollerCoverageSnapshot({
      dueGroups: 1,
      dueChases: 1,
      checkedGroups: 0,
      checkedChases: 0,
      deferredGroups: 1,
      deferredChases: 1,
      rateLimitedGroups: 1,
      backoffGroups: 0,
      sourceTimeoutGroups: 0,
      sourceErrorGroups: 0
    });

    markPollerRunStart();

    expect(getPollerState().lastRunCoverage).toMatchObject({
      dueGroups: 0,
      checkedGroups: 0,
      deferredGroups: 0
    });
  });
});
