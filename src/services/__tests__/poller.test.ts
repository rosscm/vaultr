import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../types.js';
import {
  buildDailyPulseEmbed,
  buildWeeklyReflectionEmbed,
  alertEbaySearchOptions,
  chaseTuningNoticeLines,
  didFetchRequiredListingSource,
  enrichSelectedAlertListing,
  effectiveListingSourceMode,
  isDueForPollInterval,
  listingSourceFailureReason,
  orderAlertCandidatesForSending,
  shouldSendChaseTuningNotice,
  orderGroupsForRun,
  shippingDestinationFromSettings,
  shouldSuppressForDestinationShipping,
  shouldPostDailyPulse
} from '../poller.js';
import { getUserAlertSettings, resetUserAlertSettings, setUserAlertSettings } from '../chase-store.js';
import { getPollerState, markPollerRunStart, setPollerCoverageSnapshot } from '../poller-state.js';
import { activePlanChases, activePlanTier, getRuntimePollIntervalSeconds, pausedPlanChases, PLAN_LIMITS } from '../plans.js';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe('orderGroupsForRun', () => {
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
});

describe('alert eBay search options', () => {
  it('does not count eBay plus shops as checked when the eBay source was skipped', () => {
    expect(didFetchRequiredListingSource('EBAY_SHOPIFY', 2, 2)).toBe(false);
    expect(didFetchRequiredListingSource('EBAY_SHOPIFY', 2, 3)).toBe(true);
    expect(didFetchRequiredListingSource('EBAY', 2, 2)).toBe(false);
    expect(didFetchRequiredListingSource('SHOPIFY', 2, 2)).toBe(true);
    expect(didFetchRequiredListingSource('MOCK', 2, 2)).toBe(true);
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
    expect(text).toContain('opens the Full Vault');
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

describe('buildWeeklyReflectionEmbed', () => {
  it('frames the weekly DM as a concise collector recap', () => {
    const embed = buildWeeklyReflectionEmbed({
      alertsReceived: 4,
      grailsSurfaced: 1,
      newChasesAdded: 2,
      topTasteFamily: 'Eeveelution cards',
      topTasteTheme: 'moonlit alt art',
      recentDiscovery: 'Umbreon VMAX Alt Art PSA 10'
    });
    const data = embed.toJSON();

    expect(data.title).toBe('📬 Vaultr Weekly');
    expect(data.description).toContain('4 alerts');
    expect(data.description).toContain('1 grail');
    expect(data.fields?.map((field) => field.name)).toEqual([
      '📨 Alerts',
      '💎 Grails',
      '➕ New Chases',
      '🧭 Current Read',
      '🎯 Next Step'
    ]);
    expect(data.fields?.[0].value).toBe('**4**\nsent');
    expect(data.fields?.[0].inline).toBe(true);
    expect(data.fields?.[1].value).toBe('**1**\nhigh-priority hits');
    expect(data.fields?.[2].value).toBe('**2**\nadded taste');
    expect(data.fields?.[3].value).toBe('moonlit alt art around Eeveelution cards');
    expect(data.fields?.[4].value).toContain('new chases now shape future Discovery recommendations');
    expect(data.footer?.text).toBe('Vaultr • Weekly');
  });

  it('nudges noisy weeks toward chase tune-outs', () => {
    const embed = buildWeeklyReflectionEmbed({
      alertsReceived: 36,
      grailsSurfaced: 7,
      newChasesAdded: 5,
      topTasteFamily: 'Mew line',
      topTasteTheme: 'Japanese exclusives',
      recentDiscovery: 'Mewtwo Vending Series'
    });
    const data = embed.toJSON();

    expect(data.description).toBe('**36 alerts sent** this week, including 7 grails.');
    expect(data.fields?.[0].value).toBe('**36**\nsent');
    expect(data.fields?.[1].value).toBe('**7**\nhigh-priority hits');
    expect(data.fields?.[4].value).toContain('If this felt noisy');
    expect(data.fields?.[4].value).toContain('custom exclusions');
  });
});

describe('buildDailyPulseEmbed', () => {
  it('posts only when the daily pulse has real activity', () => {
    expect(
      shouldPostDailyPulse({
        newVaultrs: 0,
        usersAlerted: 0,
        matches: 0,
        grailsSurfaced: 0,
        activeVaults: 0,
        activeChases: 0,
        topTrackedFamily: 'Mixed collections',
        topTrackedTheme: 'Varied styles',
        activeTrackedFamily: 'Mixed collections',
        todayAlertFamily: 'Mixed finds',
        todayAlertTheme: 'Fresh listings',
        hiddenDiscovery: 'Quiet spotlight: chases are still watching'
      })
    ).toBe(false);
    expect(
      shouldPostDailyPulse({
        newVaultrs: 0,
        usersAlerted: 1,
        matches: 1,
        grailsSurfaced: 0,
        activeVaults: 1,
        activeChases: 3,
        topTrackedFamily: 'Mixed collections',
        topTrackedTheme: 'Varied styles',
        activeTrackedFamily: 'Mixed collections',
        todayAlertFamily: 'Mixed finds',
        todayAlertTheme: 'Fresh listings',
        hiddenDiscovery: 'A listing moved through the Vault'
      })
    ).toBe(true);
  });

  it('formats an active community day as a collector heartbeat', () => {
    const data = buildDailyPulseEmbed({
      newVaultrs: 2,
      usersAlerted: 3,
      matches: 5,
      grailsSurfaced: 1,
      activeVaults: 4,
      activeChases: 18,
      topTrackedFamily: 'Eeveelution cards',
      topTrackedTheme: 'moonlit alt art',
      activeTrackedFamily: 'Eeveelution cards',
      todayAlertFamily: 'Umbreon line',
      todayAlertTheme: 'moonlit alt art',
      hiddenDiscovery: 'Umbreon VMAX Alt Art PSA 10'
    }).toJSON();

    expect(data.title).toBe('💓 Vault Pulse');
    expect(data.description).toContain('2 new Vaults opened');
    expect(data.description).toContain('5 chase alerts reached 3 collectors');
    expect(data.description).toContain('1 grail surfaced');
    expect(data.description).toContain("The day's sharpest movement centered on moonlit alt art");
    expect(data.fields?.[0]).toMatchObject({ name: 'Today’s Movement' });
    expect(data.fields?.[0].value).toContain('• New Vaults: 2 collectors joined');
    expect(data.fields?.[0].value).toContain('• Alerts delivered: 5 listings reached 3 collectors');
    expect(data.fields?.[0].value).toContain('• Grail watch: 1 grail surfaced');
    expect(data.fields?.[0].value).toContain('• Active watchlist: 18 chases across 4 Vaults');
    expect(data.fields?.[1]).toMatchObject({ name: 'Collector Signal' });
    expect(data.fields?.[1].value).toContain("Today's alerts leaned moonlit alt art in Umbreon line; active watchlist centers on Eeveelution cards");
    expect(data.fields?.[2]).toMatchObject({ name: 'Spotlight', value: 'Umbreon VMAX Alt Art PSA 10' });
    expect(data.footer?.text).toBe('Vaultr • Pulse');
    expect(JSON.stringify(data)).not.toContain('📡');
    expect(JSON.stringify(data)).not.toContain('received a match');
    expect(JSON.stringify(data)).not.toContain('peeked out');
    expect(JSON.stringify(data)).not.toContain('pings');
  });

  it('keeps quiet days calm and collector-first', () => {
    const data = buildDailyPulseEmbed({
      newVaultrs: 0,
      usersAlerted: 0,
      matches: 0,
      grailsSurfaced: 0,
      activeVaults: 3,
      activeChases: 11,
      topTrackedFamily: 'Mixed collections',
      topTrackedTheme: 'Varied styles',
      activeTrackedFamily: 'Mixed collections',
      todayAlertFamily: 'Mixed finds',
      todayAlertTheme: 'Fresh listings',
      hiddenDiscovery: 'Quiet spotlight: chases are still watching'
    }).toJSON();

    expect(data.description).toContain('Quiet day: active chases kept watching');
    expect(data.description).toContain('No major movement today, but active chases kept watch');
    expect(data.fields?.[0].value).toContain('• Active watchlist: 11 chases across 3 Vaults');
    expect(data.fields?.[1].value).toContain('Mixed collector interest today; no single path led the board');
  });

  it('does not frame broad tracked families as today-specific alert activity', () => {
    const data = buildDailyPulseEmbed({
      newVaultrs: 0,
      usersAlerted: 1,
      matches: 1,
      grailsSurfaced: 0,
      activeVaults: 1,
      activeChases: 4,
      topTrackedFamily: 'Mew line',
      topTrackedTheme: 'Japanese exclusives',
      activeTrackedFamily: 'Mew line',
      todayAlertFamily: 'Blastoise line',
      todayAlertTheme: 'Base Set / starter-era cards',
      hiddenDiscovery: 'A listing moved through the Vault'
    }).toJSON();

    expect(data.description).toContain('1 chase alert reached 1 collector');
    expect(data.description).toContain('Fresh listings moved through the watchlist');
    expect(data.fields?.[0].value).toContain('• Active watchlist: 4 chases across 1 Vault');
    expect(data.fields?.[1].value).toContain("Today's alerts leaned Base Set / starter-era cards in Blastoise line; active watchlist centers on Mew line");
    expect(JSON.stringify(data)).not.toContain('starter-era nostalgia across Mew line');
    expect(JSON.stringify(data)).not.toContain('Mew line collectors had something to inspect today.');
  });
});
