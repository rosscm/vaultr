import { describe, expect, it } from 'vitest';
import {
  buildDailyPulseMessage,
  buildWeeklyReflectionEmbed,
  effectiveListingSourceMode,
  isDueForPollInterval,
  orderAlertCandidatesForSending,
  orderGroupsForRun
} from '../poller.js';
import { getPollerState, markPollerRunStart, setPollerCoverageSnapshot } from '../poller-state.js';
import { getRuntimePollIntervalSeconds, PLAN_LIMITS } from '../plans.js';

describe('orderGroupsForRun', () => {
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

  it('allows Pro users to use storefront source modes', () => {
    expect(effectiveListingSourceMode('EBAY_SHOPIFY', 'PRO')).toBe('EBAY_SHOPIFY');
    expect(effectiveListingSourceMode('SHOPIFY', 'PRO')).toBe('SHOPIFY');
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
  it('keeps a trusted shop candidate ahead of eBay when both sources match', () => {
    const ordered = orderAlertCandidatesForSending([
      { listing: { source: 'EBAY', listingId: 'ebay-1' }, rankScore: 70_000 },
      { listing: { source: 'EBAY', listingId: 'ebay-2' }, rankScore: 69_000 },
      { listing: { source: 'SHOPIFY', listingId: 'shopify-1' }, rankScore: 60_000 }
    ] as never);

    expect(ordered.map((candidate) => candidate.listing.listingId)).toEqual(['shopify-1', 'ebay-1', 'ebay-2']);
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
      backoffGroups: 0
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
  it('frames the weekly DM as a learned collector profile update', () => {
    const embed = buildWeeklyReflectionEmbed({
      alertsReceived: 4,
      grailsSurfaced: 1,
      newChasesAdded: 2,
      topTasteFamily: 'Eeveelution cards',
      topTasteTheme: 'moonlit alt art',
      recentDiscovery: 'Umbreon VMAX Alt Art PSA 10'
    });
    const data = embed.toJSON();

    expect(data.title).toBe('🗝️ Vaultr Weekly');
    expect(data.description).toContain('4 sightings');
    expect(data.description).toContain('collector profile');
    expect(data.fields?.map((field) => field.name)).toEqual([
      'Collector Thread',
      'Taste Signals',
      'Discovery Thread',
      'Next Week'
    ]);
    expect(data.fields?.[0].value).toBe('moonlit alt art • Eeveelution cards');
    expect(data.fields?.[1].value).toContain('2 new chases added new signal');
    expect(data.fields?.[1].value).toContain('1 grail surfaced');
    expect(data.fields?.[3].value).toContain('Tune Out');
    expect(data.footer?.text).toBe('Vaultr • Weekly collector profile');
  });
});

describe('buildDailyPulseMessage', () => {
  it('formats an active community day as a collector heartbeat', () => {
    const message = buildDailyPulseMessage({
      newVaultrs: 2,
      usersAlerted: 3,
      matches: 5,
      grailsSurfaced: 1,
      topTrackedFamily: 'Eeveelution cards',
      topTrackedTheme: 'moonlit alt art',
      hiddenDiscovery: 'Umbreon VMAX Alt Art PSA 10'
    });

    expect(message).toContain('🗝️ **Vault Pulse**');
    expect(message).toContain('2 collectors opened a Vault');
    expect(message).toContain('3 collectors received a sighting');
    expect(message).toContain('1 grail surfaced');
    expect(message).toContain('**Collector Current**');
    expect(message).toContain('• Thread: moonlit alt art');
    expect(message).toContain('• Family: Eeveelution cards');
    expect(message).toContain("**Today's Spotlight**");
    expect(message).toContain('Umbreon VMAX Alt Art PSA 10');
    expect(message).not.toContain('received a match');
  });

  it('keeps quiet days calm and collector-first', () => {
    const message = buildDailyPulseMessage({
      newVaultrs: 0,
      usersAlerted: 0,
      matches: 0,
      grailsSurfaced: 0,
      topTrackedFamily: 'Mixed collections',
      topTrackedTheme: 'Varied styles',
      hiddenDiscovery: 'A quiet spotlight. Chases are still watching.'
    });

    expect(message).toContain('A quiet day in the Vault. Chases kept watching in the background.');
    expect(message).toContain('• Thread: Varied styles');
    expect(message).toContain('• Family: Mixed collections');
  });
});