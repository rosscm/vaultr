import { describe, expect, it } from 'vitest';
import {
  attachReferenceImages,
  backfillSourceBackedDiscoverySuggestions,
  candidatesFromDiscoveryMarketCache,
  concreteDiscoveryFallbackSuggestions,
  discoveryActionRows,
  discoveryCardEmbeds,
  discoveryEmbed,
  discoveryMarketRangeFromChases,
  discoveryTasteProfileChases,
  discoveryVisibleCountForPlan,
  isUsableDiscoveryExample,
  isUsableDiscoveryMarketSample,
  isActiveChaseEchoSuggestion,
  isActiveChaseEchoText,
  looksLikeRawCardListing,
  looksLikeVisualDiscoveryListing,
  mergeFreshDiscoveryCandidates,
  orderConcreteDiscoveryFallbackSuggestionsForMarket,
  orderCandidatesFromPersistedState,
  preserveLanguageSignalFallbackSuggestions,
  selectVisibleCandidates,
  selectVisibleCandidatesForCount,
  weeklyDiscoveryShelfSizeForPlan,
  type DiscoveryCandidate
} from '../discover.js';
import { selectDiscoverySuggestions } from '../../services/discovery-catalog.js';
import { deleteDiscoveryReferenceCache, discoveryReferenceCacheKey, upsertDiscoveryReferenceCache } from '../../services/discovery-reference-cache.js';
import { deleteDiscoveryMarketCache, discoveryMarketCacheKey, upsertDiscoveryMarketCache } from '../../services/discovery-market-cache.js';
import type { Chase, Listing } from '../../types.js';

function candidate(name: string, lane: string, selectionIndex: number, marketSampleSize?: number): DiscoveryCandidate {
  return {
    selectionIndex,
    suggestion: {
      name,
      lane,
      laneWhy: `${lane} because it matches the profile`,
      why: `try ${name}`,
      nearby: []
    },
    typicalRawAskingTotal: marketSampleSize === undefined ? undefined : 50,
    marketSampleSize
  };
}

function sourceCandidate(name: string, sourceName: string, selectionIndex: number): DiscoveryCandidate {
  return {
    selectionIndex,
    suggestion: {
      name,
      lane: 'Promo Trail',
      laneWhy: 'profile source match',
      why: `try ${name}`,
      nearby: [],
      referenceSourceName: sourceName,
      requiredEvidenceTokens: sourceName.includes('Japanese') ? ['japanese'] : ['promo']
    },
    image: {
      name,
      url: 'https://images.example/card.png',
      sourceName,
      sourceKind: 'CARD_REFERENCE'
    }
  };
}

function listing(overrides: Partial<Listing>): Listing {
  return {
    source: 'EBAY',
    listingId: 'listing-1',
    title: 'Mew Southern Islands 1999 Holo No.151 Japanese Pokemon',
    price: 45,
    currency: 'CAD',
    url: 'https://www.ebay.example/item/listing-1',
    imageUrl: 'https://i.ebayimg.example/mew.jpg',
    sellerFeedbackPercent: 99.8,
    sellerFeedbackScore: 1200,
    region: 'OTHER',
    condition: 'Ungraded',
    listingType: 'BUY_IT_NOW',
    ...overrides
  };
}

const southernIslandsSuggestion = {
  name: 'Mew Southern Islands Promo',
  lane: 'mythical display cards',
  laneWhy: 'soft mythical cards with strong binder presence',
  why: 'branches from a Mew chase',
  nearby: [],
  evidenceAliases: ['Mew Southern Islands', 'Mew No.151 Southern Island'],
  requiredEvidenceTokens: ['mew']
};

describe('selectVisibleCandidates', () => {
  it('keeps Discord pages compact while preparing a Spotify-sized Pro shelf', () => {
    expect(discoveryVisibleCountForPlan('FREE')).toBe(3);
    expect(discoveryVisibleCountForPlan('PRO')).toBe(7);
    expect(weeklyDiscoveryShelfSizeForPlan('FREE')).toBe(3);
    expect(weeklyDiscoveryShelfSizeForPlan('PRO')).toBe(20);
  });

  it('falls back to taste-ranked candidates when market enrichment is thin', () => {
    const visible = selectVisibleCandidates(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
        candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Totodile McDonalds Promo',
      'Houndoom Aquapolis H11/H32'
    ]);
  });

  it('still prefers usable market examples before market-thin fallbacks', () => {
    const visible = selectVisibleCandidates(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 1, 2),
        candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Totodile McDonalds Promo',
      'Mew Southern Islands Promo',
      'Houndoom Aquapolis H11/H32'
    ]);
  });

  it('prioritizes Japanese source cards over English Black Star promos for Japanese-weighted grails', () => {
    const visible = selectVisibleCandidates(
      [
        sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 0),
        sourceCandidate('Pikachu & Zekrom-GX SM Black Star Promos SM168', 'Pokemon TCG (SM Black Star Promos)', 1),
        sourceCandidate('ピカチュウ ポケモンカード151 025', 'TCGdex Japanese (ポケモンカード151)', 2)
      ],
      [
        {
          id: 'c1',
          userId: 'u1',
          cardName: 'Mario Pikachu XY-P 294',
          priority: 'GRAIL',
          createdAt: '2026-06-03T00:00:00.000Z'
        }
      ]
    );

    expect(visible[0]?.suggestion.name).toBe('ピカチュウ ポケモンカード151 025');
  });

  it('leaves room for English profile matches when Japanese is strong but not exclusive', () => {
    const visible = selectVisibleCandidates(
      [
        sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 0),
        {
          ...sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 1),
          suggestion: {
            ...sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 1).suggestion,
            requiredEvidenceTokens: ['mew-s12a-183', 'japanese']
          }
        },
        {
          ...sourceCandidate('Pikachu Japanese SV2a 025', 'TCGdex Japanese (SV2a)', 2),
          suggestion: {
            ...sourceCandidate('Pikachu Japanese SV2a 025', 'TCGdex Japanese (SV2a)', 2).suggestion,
            requiredEvidenceTokens: ['pikachu-sv2a-025', 'japanese']
          }
        },
        sourceCandidate('Pikachu-GX SM Black Star Promos SM232', 'Pokemon TCG (SM Black Star Promos)', 3),
        sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 4)
      ],
      [
        {
          id: 'c1',
          userId: 'u1',
          cardName: 'Corocoro Shining Mew',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        {
          id: 'c2',
          userId: 'u1',
          cardName: 'Mew RC24',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        {
          id: 'c3',
          userId: 'u1',
          cardName: 'Pikachu 26/83 promo',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        {
          id: 'c4',
          userId: 'u1',
          cardName: 'Squirtle 007/018',
          priority: 'GRAIL',
          createdAt: '2026-06-03T00:00:00.000Z'
        }
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(
      expect.arrayContaining([
        'Mew Japanese S12a 052',
        'Pikachu Japanese SV2a 025',
        'Mew Japanese S12a 183',
        'Mewtwo & Mew-GX SM Black Star Promos SM191',
        'Pikachu-GX SM Black Star Promos SM232'
      ])
    );
    expect(visible.some((item) => !/japanese|tcgdex japanese/i.test([item.suggestion.name, item.suggestion.referenceSourceName].filter(Boolean).join(' ')))).toBe(true);
  });

  it('backfills visible slots with distinct source-backed cards when subject diversity is sparse', () => {
    const visible = selectVisibleCandidates(
      [
        sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 0),
        sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 1),
        sourceCandidate('Pikachu-GX SM Black Star Promos SM232', 'Pokemon TCG (SM Black Star Promos)', 2),
        sourceCandidate('Pikachu & Zekrom-GX SM Black Star Promos SM168', 'Pokemon TCG (SM Black Star Promos)', 3)
      ],
      [
        {
          id: 'c1',
          userId: 'u1',
          cardName: 'Pikachu 26/83 promo',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        {
          id: 'c2',
          userId: 'u1',
          cardName: 'Mew RC24',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        }
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toHaveLength(4);
    expect(new Set(visible.map((item) => item.suggestion.name)).size).toBe(4);
  });

  it('balances visible Discovery cards across production-facing trails when alternatives exist', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 0),
        sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 1),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 2),
        sourceCandidate('Articuno Skyridge H3', 'Pokemon TCG (Skyridge)', 3),
        sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 4),
        sourceCandidate('Moltres XY Black Star Promos XY127', 'Pokemon TCG (XY Black Star Promos)', 5),
        sourceCandidate('Mew ex Paldean Fates 232', 'Pokemon TCG (Paldean Fates)', 6),
        sourceCandidate('Charizard VMAX SWSH Black Star Promos SWSH261', 'Pokemon TCG (SWSH Black Star Promos)', 7)
      ].map((item) => ({
        ...item,
        suggestion: {
          ...item.suggestion,
          lane: item.suggestion.name.includes('Japanese')
            ? 'Special Release Trail'
            : /Black Star Promos/.test(item.suggestion.name)
              ? 'Special Release Trail'
              : /Paldean Fates/.test(item.suggestion.name)
                ? 'Collector Compass'
                : 'Vintage Era Trail',
          evidenceSearchTerm: `${item.suggestion.name} Pokemon card`,
          sourceTasteTokens: ['mew', 'promo', 'e-reader']
        }
      })),
      [],
      7
    );
    const descriptions = visible.map((item) => discoveryEmbed(item, 'CAD', false).toJSON().description);

    expect(descriptions.filter((description) => description?.includes('Vintage Era Trail')).length).toBeLessThanOrEqual(3);
    expect(descriptions.some((description) => description?.includes('Japanese Collector Trail'))).toBe(true);
    expect(descriptions.some((description) => description?.includes('Special Release Trail'))).toBe(true);
    expect(descriptions.some((description) => description?.includes('Collector Compass'))).toBe(true);
  });

  it('does not let one Pokemon subject dominate the shelf when other subjects exist', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 0),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 1),
        sourceCandidate('Mew Wizards Black Star Promos 8', 'Pokemon TCG (Wizards Black Star Promos)', 2),
        sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 3),
        sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 4),
        sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 5),
        sourceCandidate('Moltres Wizards Black Star Promos 21', 'Pokemon TCG (Wizards Black Star Promos)', 6),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 7),
        sourceCandidate('Articuno Skyridge H3', 'Pokemon TCG (Skyridge)', 8)
      ].map((item) => ({
        ...item,
        suggestion: {
          ...item.suggestion,
          lane: item.suggestion.name.includes('Japanese')
            ? 'Special Release Trail'
            : /Expedition|Aquapolis/.test(item.suggestion.name)
              ? 'Vintage Era Trail'
              : 'Special Release Trail',
          evidenceSearchTerm: `${item.suggestion.name} Pokemon card`,
          sourceTasteTokens: ['mew', 'promo', 'e-reader']
        }
      })),
      [],
      7
    );
    const visibleNames = visible.map((item) => item.suggestion.name);
    const mewFamilyCount = visibleNames.filter((name) => /\bmew\b/i.test(name)).length;

    expect(mewFamilyCount).toBeLessThanOrEqual(2);
    expect(visibleNames).toEqual(expect.arrayContaining(['Squirtle Expedition Base Set 132', 'Special Delivery Pikachu SWSH Black Star Promos SWSH074']));
  });
});

describe('mergeFreshDiscoveryCandidates', () => {
  it('does not let fallback refill visible slots with recently seen source cards', () => {
    const merged = mergeFreshDiscoveryCandidates(
      [candidate('ピカチュウ ポケモンカード151 025', 'Promo Trail', 0)],
      [
        candidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'source-backed matches', 1),
        candidate('Pikachu & Zekrom-GX SM Black Star Promos SM168', 'source-backed matches', 2),
        candidate('Mew ex Scarlet & Violet Black Star Promos 53', 'source-backed matches', 3),
        candidate('Mew Southern Islands Promo', 'mythical display cards', 4)
      ],
      [
        'Mewtwo & Mew-GX SM Black Star Promos SM191',
        'Pikachu & Zekrom-GX SM Black Star Promos SM168',
        'Mew ex Scarlet & Violet Black Star Promos 53'
      ],
      3
    );

    expect(merged.map((item) => item.suggestion.name)).toEqual(['ピカチュウ ポケモンカード151 025', 'Mew Southern Islands Promo']);
  });
});

describe('orderCandidatesFromPersistedState', () => {
  it('keeps same-mode Discovery cards stable while the profile fingerprint still matches', () => {
    const ranked = [
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 0),
      candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 1),
      candidate('Squirtle Expedition Base Set 132', 'Vintage Era Trail', 2),
      candidate('Mew Expedition Base Set 55', 'Vintage Era Trail', 3)
    ];

    const ordered = orderCandidatesFromPersistedState(
      ranked,
      ['Mew Japanese S12a 052', 'Squirtle Expedition Base Set 132', 'Mew Expedition Base Set 55'],
      3
    );

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Squirtle Expedition Base Set 132', 'Mew Expedition Base Set 55']);
  });

  it('fills missing persisted cards from the current ranked pool', () => {
    const ranked = [candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 0), candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 1)];

    const ordered = orderCandidatesFromPersistedState(ranked, ['Missing Source Card', 'Mew Japanese S12a 052'], 2);

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Pikachu Skyridge 84']);
  });

  it('keeps persisted cards even when they were recently seen', () => {
    const ranked = [
      candidate('Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123', 'Promo Trail', 0),
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1),
      candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 2)
    ];

    const ordered = orderCandidatesFromPersistedState(
      ranked,
      ['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123', 'Pikachu Skyridge 84'],
      2,
      { softAvoidNames: ['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123'] }
    );

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123', 'Pikachu Skyridge 84']);
  });

  it('uses recently seen cards only as a last-resort fresh refill', () => {
    const ranked = [
      candidate('Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123', 'Promo Trail', 0),
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1)
    ];

    const ordered = orderCandidatesFromPersistedState(
      ranked,
      [],
      2,
      { softAvoidNames: ['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123'] }
    );

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Pikachu Skyridge 84', 'Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123']);
  });

  it('keeps feedback exclusions out of persisted and refill slots', () => {
    const ranked = [
      candidate('Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123', 'Promo Trail', 0),
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1)
    ];

    const ordered = orderCandidatesFromPersistedState(
      ranked,
      ['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123'],
      2,
      { hardExcludedNames: ['Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123'] }
    );

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Pikachu Skyridge 84']);
  });

  it('can refill a Pro shelf when an older persisted state only has three cards', () => {
    const ranked = [
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 0),
      candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 1),
      candidate('Squirtle Expedition Base Set 132', 'Vintage Era Trail', 2),
      candidate('Mew Expedition Base Set 55', 'Vintage Era Trail', 3),
      candidate('Zapdos Aquapolis 44', 'E-Reader Era Trail', 4),
      candidate('Articuno Skyridge H3', 'E-Reader Era Trail', 5),
      candidate('Moltres Wizards Black Star Promos 21', 'Promo Trail', 6)
    ];

    const ordered = orderCandidatesFromPersistedState(ranked, ['Mew Japanese S12a 052', 'Squirtle Expedition Base Set 132', 'Mew Expedition Base Set 55'], 7);

    expect(ordered.map((item) => item.suggestion.name)).toHaveLength(7);
  });
});

describe('preserveLanguageSignalFallbackSuggestions', () => {
  it('keeps one Japanese source candidate when seen filtering would erase a Japanese-weighted profile', () => {
    const japaneseSuggestion = {
      name: 'Mew Japanese S12a 052',
      lane: 'Promo Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      referenceSourceName: 'TCGdex Japanese (S12a)',
      requiredEvidenceTokens: ['mew-s12a-052', 'japanese']
    };

    const englishSuggestion = {
      name: 'Pikachu Scarlet & Violet Black Star Promos 101',
      lane: 'Promo Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      referenceSourceName: 'Pokemon TCG (Scarlet & Violet Black Star Promos)',
      requiredEvidenceTokens: ['promo']
    };

    const preserved = preserveLanguageSignalFallbackSuggestions(
      [japaneseSuggestion, englishSuggestion],
      [englishSuggestion],
      [
        {
          id: 'c1',
          userId: 'u1',
          cardName: 'Corocoro Shining Mew',
          priority: 'HIGH',
          createdAt: '2026-06-03T00:00:00.000Z'
        }
      ]
    );

    expect(preserved.map((suggestion) => suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Pikachu Scarlet & Violet Black Star Promos 101']);
  });
});

describe('backfillSourceBackedDiscoverySuggestions', () => {
  it('keeps a first-use Pro shelf full when source-backed resolution returns only a few cards', () => {
    const sourceBacked = [
      sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 0).suggestion,
      sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 1).suggestion
    ];
    const fallback = [
      sourceBacked[0],
      sourceBacked[1],
      candidate('Pokemon promo cards', 'promo trail', 2).suggestion,
      candidate('Pikachu Skyridge 84', 'e-reader atmosphere', 3).suggestion,
      candidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'promo trail', 4).suggestion,
      candidate('Articuno Skyridge H3', 'legendary birds', 5).suggestion,
      candidate('Moltres Skyridge H20', 'legendary birds', 6).suggestion,
      candidate('Mew ex Paldean Fates 232', 'modern texture', 7).suggestion
    ];

    const backfilled = backfillSourceBackedDiscoverySuggestions(sourceBacked, fallback, 7);

    expect(backfilled.map((suggestion) => suggestion.name)).toEqual([
      'Mew Japanese S12a 052',
      'Squirtle Expedition Base Set 132',
      'Pikachu Skyridge 84',
      'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
      'Articuno Skyridge H3',
      'Moltres Skyridge H20',
      'Mew ex Paldean Fates 232'
    ]);
  });

  it('builds concrete fallbacks from seen card names without keeping generic Discovery titles', () => {
    const fallbacks = concreteDiscoveryFallbackSuggestions([
      'Pokemon special release cards',
      'vintage Pokemon cards',
      'Pikachu Skyridge raw card',
      'Pikachu Skyridge 84',
      'Mew ex Paldean Fates 232',
      'Lt. Surge\'s Pikachu Gym Challenge 84'
    ], ["Lt. Surge's Pikachu Gym Challenge 84"]);

    expect(fallbacks.map((suggestion) => suggestion.name)).toEqual(['Pikachu Skyridge 84', 'Mew ex Paldean Fates 232']);
  });

  it('can rebuild a stable shelf from concrete history before using fresh random source cards', () => {
    const historical = concreteDiscoveryFallbackSuggestions([
      'Mew Japanese S12a 052',
      'Articuno Skyridge H3',
      'Squirtle Expedition Base Set 132',
      'Pikachu Skyridge 84',
      'Mew ex Paldean Fates 232',
      'Moltres Skyridge H20',
      'Zapdos Aquapolis 44'
    ]);
    const freshRandom = [
      sourceCandidate('Ledian Skyridge H14', 'Pokemon TCG (Skyridge)', 0).suggestion,
      sourceCandidate('Xatu Skyridge H32', 'Pokemon TCG (Skyridge)', 1).suggestion
    ];

    const rebuilt = backfillSourceBackedDiscoverySuggestions(historical, freshRandom, 7);

    expect(rebuilt.map((suggestion) => suggestion.name)).toEqual([
      'Mew Japanese S12a 052',
      'Articuno Skyridge H3',
      'Squirtle Expedition Base Set 132',
      'Pikachu Skyridge 84',
      'Mew ex Paldean Fates 232',
      'Moltres Skyridge H20',
      'Zapdos Aquapolis 44'
    ]);
  });

  it('uses concrete history as backfill instead of letting stale random cards lead a fresh shelf', () => {
    const sourceBacked = [
      sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 0).suggestion,
      sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 1).suggestion,
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 2).suggestion,
      sourceCandidate('Moltres XY Black Star Promos XY127', 'Pokemon TCG (XY Black Star Promos)', 3).suggestion,
      sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 4).suggestion,
      sourceCandidate('Pikachu XY Black Star Promos XY202', 'Pokemon TCG (XY Black Star Promos)', 5).suggestion,
      sourceCandidate('Mew ex Paldean Fates 232', 'Pokemon TCG (Paldean Fates)', 6).suggestion
    ];
    const staleHistory = concreteDiscoveryFallbackSuggestions([
      'Xatu Skyridge H32',
      'Ledian Skyridge H14',
      'Articuno Skyridge H3'
    ]);

    const rebuilt = backfillSourceBackedDiscoverySuggestions(sourceBacked, staleHistory, 7);

    expect(rebuilt.map((suggestion) => suggestion.name)).toEqual(sourceBacked.map((suggestion) => suggestion.name));
  });

  it('keeps stale concrete-history fallback cards behind profile-connected source cards', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Xatu Skyridge H32', 'Pokemon TCG (Skyridge)', 0),
        sourceCandidate('Ledian Skyridge H14', 'Pokemon TCG (Skyridge)', 1),
        sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 2),
        sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 3),
        sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 4)
      ].map((item, index) => {
        if (item.suggestion.name.includes('Xatu')) {
          return {
            ...item,
            selectionIndex: index,
            suggestion: {
              ...item.suggestion,
              lane: 'Collector Compass',
              why: 'A concrete card Vaultr has already connected to this profile, kept as a fallback while fresh sources resolve.'
            }
          };
        }
        if (item.suggestion.name.includes('Ledian')) {
          return {
            ...item,
            selectionIndex: index,
            suggestion: {
              ...item.suggestion,
              lane: 'Collector Compass',
              why: 'A concrete card Vaultr has already connected to this profile, kept as a fallback while fresh sources resolve.'
            }
          };
        }
        return {
          ...item,
          selectionIndex: index,
          suggestion: {
            ...item.suggestion,
            sourceTasteTokens: ['mew', 'pikachu', 'promo', 'e-reader']
          }
        };
      }),
      [
        { id: 'c1', userId: 'u1', cardName: 'Mew Japanese Promo', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c2', userId: 'u1', cardName: 'Pikachu Skyridge 84', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
      ],
      3
    );

    expect(visible.map((candidate) => candidate.suggestion.name)).toEqual([
      'Mew Japanese S12a 052',
      'Pikachu Skyridge 84',
      'Squirtle Expedition Base Set 132'
    ]);
  });

  it('orders concrete history with market-ready cards before timeout rows', () => {
    const timedOutName = `Mew Japanese S12a 183 ${Date.now()}`;
    const marketReadyName = `Moltres Skyridge H20 ${Date.now()}`;
    const timedOutCacheKey = discoveryMarketCacheKey(timedOutName, 'CAD', 'CA');
    const marketReadyCacheKey = discoveryMarketCacheKey(marketReadyName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(timedOutCacheKey);
    deleteDiscoveryMarketCache(marketReadyCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: timedOutCacheKey,
      suggestionName: timedOutName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      sourceStatus: 'TIMEOUT',
      fetchedAt: new Date().toISOString()
    });
    upsertDiscoveryMarketCache({
      cacheKey: marketReadyCacheKey,
      suggestionName: marketReadyName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 305,
      marketSampleSize: 3,
      fetchedAt: new Date().toISOString()
    });

    const ordered = orderConcreteDiscoveryFallbackSuggestionsForMarket(
      concreteDiscoveryFallbackSuggestions([timedOutName, marketReadyName]),
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' }
    );

    expect(ordered.map((suggestion) => suggestion.name)).toEqual([marketReadyName, timedOutName]);
    deleteDiscoveryMarketCache(timedOutCacheKey);
    deleteDiscoveryMarketCache(marketReadyCacheKey);
  });
});

describe('Discovery listing enrichment eligibility', () => {
  it('uses strong suggestion matches for market and image data even when titles omit generic card terms', () => {
    const matchedListing = listing({});

    expect(isUsableDiscoveryExample(southernIslandsSuggestion, matchedListing, undefined, 'CAD')).toBe(true);
    expect(looksLikeVisualDiscoveryListing(southernIslandsSuggestion, matchedListing)).toBe(true);
  });

  it('still rejects obvious non-card listings even when they contain the suggestion tokens', () => {
    const plushListing = listing({ title: 'Mew Southern Islands plush toy Pokemon', imageUrl: 'https://i.ebayimg.example/plush.jpg' });

    expect(isUsableDiscoveryExample(southernIslandsSuggestion, plushListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(southernIslandsSuggestion, plushListing)).toBe(false);
  });

  it('rejects display case accessories that include an exact card name', () => {
    const paldeanMewSuggestion = {
      name: 'Mew ex Paldean Fates 232',
      lane: 'Collector Compass',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
      evidenceAliases: ['Mew ex Paldean Fates 232'],
      requiredEvidenceTokens: ['mew', 'paldean', '232']
    };
    const caseListing = listing({
      title: 'POKEMON TCG EXTENDED ART ACRYLIC MAGNETIC CASE CARD MEW EX 232 SIR PALDEAN FATES',
      price: 26.13
    });

    expect(isUsableDiscoveryExample(paldeanMewSuggestion, caseListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(paldeanMewSuggestion, caseListing)).toBe(false);
  });

  it('rejects extended art case accessories from Paldean Fates market samples', () => {
    const paldeanMewSuggestion = {
      name: 'Mew ex Paldean Fates 232',
      lane: 'Collector Compass',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
      evidenceAliases: ['Mew ex Paldean Fates 232'],
      requiredEvidenceTokens: ['mew', 'paldean', '232']
    };
    const caseListing = listing({
      title: 'Pokemon TCG EXTENDED ART CASE Mew ex 232 SIR Paldean Fates CCG Card Game',
      price: 108.1,
      imageUrl: 'https://i.ebayimg.example/mew-case.jpg'
    });

    expect(isUsableDiscoveryExample(paldeanMewSuggestion, caseListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(paldeanMewSuggestion, caseListing)).toBe(false);
  });

  it('allows Bubble Mew raw market samples when eBay returns zero seller metadata', () => {
    const paldeanMewSuggestion = {
      name: 'Mew ex Paldean Fates 232',
      lane: 'Collector Compass',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
      evidenceAliases: ['Mew ex Paldean Fates 232'],
      requiredEvidenceTokens: ['mew', 'paldean']
    };
    const rawListing = listing({
      title: 'Mew ex - 232/091 - Pokemon Paldean Fates Special Illustration Rare Card NM',
      price: 110,
      sellerFeedbackPercent: 0,
      sellerFeedbackScore: 0,
      condition: 'Ungraded'
    });

    expect(isUsableDiscoveryExample(paldeanMewSuggestion, rawListing, { min: 0, max: 1200 }, 'CAD')).toBe(true);
  });

  it('rejects merchandise and custom art listings that borrow exact card identifiers', () => {
    const paldeanMewSuggestion = {
      name: 'Mew ex Paldean Fates 232',
      lane: 'Collector Compass',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
      evidenceAliases: ['Mew ex Paldean Fates 232'],
      requiredEvidenceTokens: ['mew', 'paldean', '232']
    };
    const noisyListings = [
      listing({ title: 'Bubble Mew EX 232/091 Card Rug 24x36 Pokemon Paldean Fates Anime Room Carpet', price: 101.9 }),
      listing({ title: 'Mew Ex 232/091 SIR Bubble Mew Paldean Fates Pokemon Tcg Card Blanket 50x60', price: 75 }),
      listing({ title: 'Mew ex 232/091 Pokemon Paldean Fates Holo Hand Drawn Art Card Sketch Full Art', price: 80 })
    ];

    for (const noisyListing of noisyListings) {
      expect(isUsableDiscoveryExample(paldeanMewSuggestion, noisyListing, undefined, 'CAD')).toBe(false);
      expect(looksLikeVisualDiscoveryListing(paldeanMewSuggestion, noisyListing)).toBe(false);
    }
  });

  it('rejects gold foil promo lookalikes from raw market samples', () => {
    const specialDeliverySuggestion = {
      name: 'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
      lane: 'Promo Trail',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Special Delivery Pikachu SWSH Black Star Promos SWSH074 Pokemon card',
      evidenceAliases: ['Special Delivery Pikachu SWSH074'],
      requiredEvidenceTokens: ['special', 'delivery', 'pikachu', 'swsh074']
    };
    const goldFoilListing = listing({
      title: 'Pikachu Special Delivery Gold Foil Card SWSH074 Black Star Promos',
      price: 20
    });

    expect(isUsableDiscoveryExample(specialDeliverySuggestion, goldFoilListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(specialDeliverySuggestion, goldFoilListing)).toBe(false);
  });

  it('rejects compact graded labels from raw market samples', () => {
    const gradedListing = listing({
      title: 'Pokemon Card PSA10 Mew s12a 183/172 AR 2022 Japanese',
      price: 565.55
    });

    expect(looksLikeRawCardListing(gradedListing)).toBe(false);
  });

  it('allows broad discovery trait threads to become raw-market ready from required evidence tokens', () => {
    const broadSuggestion = {
      name: 'RC era Pokemon cards',
      lane: 'set-code discovery',
      laneWhy: 'set code trait',
      why: 'set code trait',
      nearby: [],
      evidenceSearchTerm: 'RC era Pokemon cards',
      evidenceAliases: ['RC era Pokemon cards'],
      requiredEvidenceTokens: ['rc']
    };

    expect(isUsableDiscoveryExample(broadSuggestion, listing({ title: 'Pokemon Radiant Collection RC24 Card Raw' }), undefined, 'CAD')).toBe(true);
  });

  it('uses the user market range to reject listings above the selected max price', () => {
    const matchingListing = listing({ title: 'Mew Southern Islands 1999 Holo No.151 Japanese Pokemon', price: 125 });

    expect(isUsableDiscoveryExample(southernIslandsSuggestion, matchingListing, { min: 0, max: 150 }, 'CAD')).toBe(true);
    expect(isUsableDiscoveryExample(southernIslandsSuggestion, matchingListing, { min: 0, max: 100 }, 'CAD')).toBe(false);
  });

  it('keeps above-range Bubble Mew raw listings as market comps for valuation', () => {
    const paldeanMewSuggestion = {
      name: 'Mew ex Paldean Fates 232',
      lane: 'Collector Compass',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
      evidenceAliases: ['Mew ex Paldean Fates 232'],
      requiredEvidenceTokens: ['mew', 'paldean']
    };
    const rawListing = listing({
      title: 'Mew ex - 232/091 - Pokemon Paldean Fates Special Illustration Rare Card NM',
      price: 1306,
      sellerFeedbackPercent: 99.3,
      sellerFeedbackScore: 41237,
      condition: 'Ungraded'
    });

    expect(isUsableDiscoveryExample(paldeanMewSuggestion, rawListing, { min: 0, max: 1200 }, 'CAD')).toBe(false);
    expect(isUsableDiscoveryMarketSample(paldeanMewSuggestion, rawListing, 'CAD')).toBe(true);
  });

  it('does not mistake Toys R Us promo cards for toy merchandise', () => {
    const retailSuggestion = {
      name: 'retail promo Pokemon cards',
      lane: 'retail-promo discovery',
      laneWhy: 'retail promo trait',
      why: 'retail promo trait',
      nearby: [],
      evidenceSearchTerm: 'retail promo Pokemon cards',
      evidenceAliases: ['retail promo Pokemon cards'],
      requiredEvidenceTokens: ['promo']
    };

    expect(isUsableDiscoveryExample(retailSuggestion, listing({ title: 'Pokemon Toys R Us Promo Card Pikachu Raw' }), undefined, 'CAD')).toBe(true);
  });
});

describe('active chase echo guard', () => {
  it('rejects source-backed suggestions that repeat active chase cards', () => {
    expect(
      isActiveChaseEchoSuggestion(
        {
          name: 'Mew Lp Mp It RC24 trading card',
          lane: 'source-backed matches',
          laneWhy: 'exact chase language',
          why: 'exact chase language',
          nearby: [],
          evidenceSearchTerm: 'Mew Lp Mp It RC24 trading card',
          requiredEvidenceTokens: ['mew', 'rc24']
        },
        [
          {
            id: 'c1',
            userId: 'u1',
            cardName: 'Mew LP MP it RC24',
            createdAt: '2026-06-03T00:00:00.000Z'
          }
        ]
      )
    ).toBe(true);
  });

  it('allows broad trait recommendations from active chase signals', () => {
    expect(
      isActiveChaseEchoSuggestion(
        {
          name: 'RC era Pokemon cards',
          lane: 'set-code discovery',
          laneWhy: 'set code trait',
          why: 'set code trait',
          nearby: [],
          evidenceSearchTerm: 'RC era Pokemon cards',
          requiredEvidenceTokens: ['rc']
        },
        [
          {
            id: 'c1',
            userId: 'u1',
            cardName: 'Mew LP MP it RC24',
            createdAt: '2026-06-03T00:00:00.000Z'
          }
        ]
      )
    ).toBe(false);
  });

  it('keeps real generated profile recommendations broad and non-card-specific', () => {
    const activeChases = [
      {
        id: 'c1',
        userId: 'u1',
        cardName: 'Mew LP MP it RC24',
        createdAt: '2026-06-03T00:00:00.000Z',
        tasteSource: 'ACTIVE_CHASE' as const,
        priority: 'GRAIL' as const
      },
      {
        id: 'c2',
        userId: 'u1',
        cardName: 'Pikachu Toys R Us 26/83',
        createdAt: '2026-06-03T00:00:00.000Z',
        tasteSource: 'ACTIVE_CHASE' as const,
        priority: 'GRAIL' as const
      },
      {
        id: 'c3',
        userId: 'u1',
        cardName: 'Moltres Zapdos Articuno SM210',
        createdAt: '2026-06-03T00:00:00.000Z',
        tasteSource: 'ACTIVE_CHASE' as const,
        priority: 'GRAIL' as const
      }
    ];
    const selection = selectDiscoverySuggestions(null, activeChases, 8);

    expect(selection.suggestions.map((suggestion) => suggestion.name)).toEqual(['Pokemon promo cards', 'Pokemon special release cards', 'Pokemon collector cards']);
    expect(selection.suggestions.filter((suggestion) => !isActiveChaseEchoSuggestion(suggestion, activeChases)).length).toBeGreaterThanOrEqual(3);
  });

  it('rejects market evidence that points back to active chase cards', () => {
    const activeChases = [
      {
        id: 'c1',
        userId: 'u1',
        cardName: 'Mew LP MP it RC24',
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      {
        id: 'c2',
        userId: 'u1',
        cardName: 'Pikachu Toys R Us 26/83',
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      {
        id: 'c3',
        userId: 'u1',
        cardName: 'Moltres Zapdos Articuno SM210',
        createdAt: '2026-06-03T00:00:00.000Z'
      }
    ];

    expect(isActiveChaseEchoText('Pokemon Radiant Collection RC24 Card Raw', activeChases)).toBe(true);
    expect(isActiveChaseEchoText('Pokemon Toys R Us Promo Card Pikachu Raw', activeChases)).toBe(true);
    expect(isActiveChaseEchoText('Moltres Zapdos Articuno SM210 Black Star Promo Raw', activeChases)).toBe(true);
    expect(isActiveChaseEchoText('Aegislash Scarlet Violet Promo 26 Raw', activeChases)).toBe(false);
    expect(isActiveChaseEchoText('Pokemon Black Star Promo Eevee Raw', activeChases)).toBe(false);
  });
});

describe('discoveryEmbed', () => {
  it('hides market read for limited Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Fits', 'Collector Cue']);
  });

  it('shows market read for full Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', true).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Fits', 'Collector Cue', 'Market Snapshot']);
  });

  it('prefers sold comps in full Discovery market read', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2),
        typicalRawSoldTotal: 44,
        soldSampleSize: 5,
        displayCurrency: 'CAD'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toContain('40 CAD recent raw sold (5 comps)');
    expect(marketRead).toContain('50 CAD raw ask');
  });

  it('rounds market read values to nearest ten-dollar display values', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2),
        typicalRawSoldTotal: 457,
        soldSampleSize: 5,
        typicalRawAskingTotal: 334,
        marketSampleSize: 4,
        displayCurrency: 'CAD'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toContain('460 CAD recent raw sold (5 comps)');
    expect(marketRead).toContain('330 CAD raw ask');
  });

  it('does not mention attaching images when pending market cards already have one', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        sourceStatus: 'PENDING',
        image: {
          name: 'Mew Southern Islands Promo',
          url: 'https://example.com/mew.jpg',
          sourceName: 'Pokemon TCG',
          sourceKind: 'CARD_REFERENCE'
        }
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Market data is updating; pricing will appear once the source responds.');
  });

  it('mentions image attachment only when pending market cards have no image yet', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        sourceStatus: 'PENDING'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Market data is updating; image and pricing will appear once the source responds.');
  });

  it('does not describe no-sample popular cards as thin market data', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew ex Paldean Fates 232', 'modern texture', 0),
        typicalRawAskingTotal: undefined,
        marketSampleSize: 0,
        typicalRawSoldTotal: undefined,
        soldSampleSize: 0
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Market data is still being gathered; Vaultr will keep checking.');
  });

  it('explains concrete profile signals instead of internal source details', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate('Zapdos Aquapolis H32', 'Pokemon TCG (Aquapolis)', 0),
        suggestion: {
          ...sourceCandidate('Zapdos Aquapolis H32', 'Pokemon TCG (Aquapolis)', 0).suggestion,
          lane: 'E-Reader Era Trail',
          evidenceSearchTerm: 'Zapdos Aquapolis H32 Pokemon card',
          sourceTasteTokens: ['e-reader', 'vintage'],
          requiredEvidenceTokens: ['zapdos', 'h32']
        }
      },
      'CAD',
      false
    ).toJSON();

    const why = embed.fields?.find((field) => field.name === 'Why It Fits')?.value;
    expect(why).toContain('concrete early-2000s set identity');
    expect(why).toContain('clearer collecting shape');
    expect(why).not.toContain('appears in your taste profile');
    expect(embed.fields?.some((field) => field.name === 'Image Source')).toBe(false);
  });

  it('explains surfaced taste cues without pretending the recommended card is already a chase', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 0),
        suggestion: {
          ...sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 0).suggestion,
          evidenceSearchTerm: 'Special Delivery Pikachu SWSH Black Star Promos SWSH074 Pokemon card',
          sourceTasteTokens: ['japanese', 'promo', 'special']
        }
      },
      'CAD',
      false
    ).toJSON();

    const why = embed.fields?.find((field) => field.name === 'Why It Fits')?.value;
    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(why).toContain('collector milestone');
    expect(signal).toContain('Promo Releases');
    expect(signal).not.toContain('Special Delivery Pikachu interest');
    expect(signal).not.toContain('appears in your taste profile');
    expect(signal).not.toContain('Japanese Prints');
  });

  it('uses collector-facing fallback copy instead of internal resolver language', () => {
    const embed = discoveryEmbed(
      {
        selectionIndex: 0,
        suggestion: {
          name: 'Mew POP Series 4 4',
          lane: 'Collector Compass',
          laneWhy: 'profile source match',
          why: 'try Mew POP Series 4 4',
          nearby: [],
          referenceSourceName: 'Pokemon TCG',
          evidenceSearchTerm: 'Mew POP Series 4 4 Pokemon card',
          sourceTasteTokens: ['collector'],
          requiredEvidenceTokens: []
        },
        image: {
          name: 'Mew POP Series 4 4',
          url: 'https://images.example/card.png',
          sourceName: 'Pokemon TCG',
          sourceKind: 'CARD_REFERENCE'
        }
      },
      'CAD',
      false
    ).toJSON();

    const why = embed.fields?.find((field) => field.name === 'Why It Fits')?.value;
    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(why).toContain('nearby card to compare');
    expect(why).toContain('artwork, set feel, and release story');
    expect(why).not.toContain('source-backed');
    expect(why).not.toContain('follows your profile');
    expect(why).not.toContain('out of the result');
    expect(signal).toBe('Profile Path');
    expect(signal).not.toBe('Collector Fit');
  });

  it('uses actual taste tokens instead of overstating surfaced card adjacency', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 0),
        suggestion: {
          ...sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 0).suggestion,
          evidenceSearchTerm: 'Mewtwo & Mew-GX SM Black Star Promos SM191 Pokemon card',
          sourceTasteTokens: ['mew', 'promo', 'gx', 'tag', 'team']
        }
      },
      'CAD',
      false
    ).toJSON();

    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(signal).toContain('Mew Family');
    expect(signal).toContain('Promo Releases');
    expect(signal).toContain('GX/Tag Team Format');
    expect(signal).not.toContain('Mewtwo & Mew-GX adjacency');
  });

  it('does not repeat broad profile chips on unrelated source-backed cards', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0),
        suggestion: {
          ...sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0).suggestion,
          lane: 'Vintage Era Trail',
          evidenceSearchTerm: 'Zapdos Aquapolis 44 Pokemon card',
          sourceTasteTokens: ['mew', 'promo', 'e-reader'],
          requiredEvidenceTokens: ['zapdos', '44']
        }
      },
      'CAD',
      false
    ).toJSON();

    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(signal).toBe('E-Reader Era');
    expect(signal).not.toContain('Mew Thread');
    expect(signal).not.toContain('Promo Releases');
  });

  it('only mentions Japanese curiosity when the returned card is Japanese', () => {
    const englishEmbed = discoveryEmbed(
      {
        ...sourceCandidate('Moltres Wizards Black Star Promos 21', 'Pokemon TCG (Wizards Black Star Promos)', 0),
        suggestion: {
          ...sourceCandidate('Moltres Wizards Black Star Promos 21', 'Pokemon TCG (Wizards Black Star Promos)', 0).suggestion,
          evidenceSearchTerm: 'Moltres Wizards Black Star Promos 21 Pokemon card',
          sourceTasteTokens: ['japanese', 'promo']
        }
      },
      'CAD',
      false
    ).toJSON();
    const japaneseEmbed = discoveryEmbed(
      {
        ...sourceCandidate('Pikachu Japanese SV2a 025', 'TCGdex Japanese (SV2a)', 1),
        suggestion: {
          ...sourceCandidate('Pikachu Japanese SV2a 025', 'TCGdex Japanese (SV2a)', 1).suggestion,
          evidenceSearchTerm: 'Pikachu Japanese Pokemon card SV2a 025',
          sourceTasteTokens: ['japanese', 'promo']
        }
      },
      'CAD',
      false
    ).toJSON();

    const englishSignal = englishEmbed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    const englishWhy = englishEmbed.fields?.find((field) => field.name === 'Why It Fits')?.value;
    const japaneseSignal = japaneseEmbed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(englishSignal).not.toContain('Japanese Prints');
    expect(englishWhy).not.toContain('Japanese print path');
    expect(japaneseSignal).toContain('Japanese Prints');
  });

  it('uses product-facing retry language for active eBay throttle states', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        sourceStatus: 'RATE_LIMITED'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Market data is temporarily limited by eBay; Vaultr will retry automatically.');
  });

  it('can number visible cards for feedback buttons', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false, 2).toJSON();

    expect(embed.title).toBe('2. Mew Southern Islands Promo');
    expect(embed.description).toBe('✧ Collector Compass');
  });

  it('normalizes internal lanes into production-facing trails', () => {
    const promoEmbed = discoveryEmbed(sourceCandidate('Special Delivery Pikachu SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 0), 'CAD', false).toJSON();
    const artworkEmbed = discoveryEmbed(candidate('Gardevoir full art', 'visual-format discovery', 1), 'CAD', false).toJSON();
    const formatEmbed = discoveryEmbed(candidate('Mewtwo & Mew-GX SM191', 'Tag Team Trail', 2), 'CAD', false).toJSON();

    expect(promoEmbed.description).toBe('◆ Promo Trail');
    expect(artworkEmbed.description).toBe('◇ Artwork Trail');
    expect(formatEmbed.description).toBe('◇ Format Trail');
  });

  it('does not include per-card next threads', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2),
        suggestion: {
          ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2).suggestion,
          why: 'branches from a Mew chase',
          nearby: ['Ancient Mew Promo', 'Mew Black Star Promo 040']
        }
      },
      'CAD',
      false
    ).toJSON();

    expect(embed.fields?.some((field) => field.name === 'Next Threads')).toBe(false);
    expect(JSON.stringify(embed.fields)).not.toContain('Ancient Mew Promo');
    expect(JSON.stringify(embed.fields)).not.toContain('Mew Black Star Promo 040');
  });
});

describe('candidatesFromDiscoveryMarketCache', () => {
  it('attaches cached market values to visible Discovery cards', () => {
    const name = `Mew Southern Islands Promo ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 48,
      marketSampleSize: 4,
      typicalRawSoldTotal: 42,
      soldSampleSize: 3,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [candidate(name, 'mythical display cards', 0)],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'CAD'
      }
    );

    expect(attached?.typicalRawAskingTotal).toBe(48);
    expect(attached?.marketSampleSize).toBe(4);
    expect(attached?.typicalRawSoldTotal).toBe(42);
    expect(attached?.soldSampleSize).toBe(3);
    expect(attached?.sourceStatus).toBeUndefined();
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('uses country-level cached market values when a postal region is configured', () => {
    const name = `Mew Postal Cache ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 52,
      marketSampleSize: 4,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [candidate(name, 'mythical display cards', 0)],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA', postalCode: 'M5V' },
        targetCurrency: 'CAD'
      }
    );

    expect(attached?.typicalRawAskingTotal).toBe(52);
    expect(attached?.marketSampleSize).toBe(4);
    expect(attached?.sourceStatus).toBeUndefined();
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('preserves card API image sources when cached eBay market data has a listing image', () => {
    const name = `Pikachu Black Star Promo ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: listing({
        listingId: 'ebay-market-image',
        title: `${name} raw card`,
        imageUrl: 'https://i.ebayimg.example/market-card.jpg'
      }),
      imageUrl: 'https://i.ebayimg.example/cached-market-card.jpg',
      typicalRawAskingTotal: 31,
      marketSampleSize: 5,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [sourceCandidate(name, 'Pokemon TCG (Wizards Black Star Promos)', 0)],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'CAD'
      }
    );

    expect(attached?.typicalRawAskingTotal).toBe(31);
    expect(attached?.image?.url).toBe('https://images.example/card.png');
    expect(attached?.image?.sourceName).toBe('Pokemon TCG (Wizards Black Star Promos)');
    expect(attached?.image?.sourceKind).toBe('CARD_REFERENCE');
    expect(attached?.listing).toBeUndefined();
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('ignores stale cached accessory listings when attaching market data', () => {
    const name = 'Mew ex Paldean Fates 232';
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: listing({
        listingId: 'case-1',
        title: 'Pokemon TCG EXTENDED ART CASE Mew ex 232 SIR Paldean Fates CCG Card Game',
        price: 108.1,
        url: 'https://example.com/case-1'
      }),
      typicalRawAskingTotal: 108.1,
      marketSampleSize: 4,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [
        {
          suggestion: {
            name,
            lane: 'Collector Compass',
            laneWhy: 'specific card source match',
            why: 'specific card source match',
            nearby: [],
            evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card',
            evidenceAliases: ['Mew ex Paldean Fates 232'],
            requiredEvidenceTokens: ['mew', 'paldean', '232']
          },
          selectionIndex: 0
        }
      ],
      { userId: 'user-1', activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' }
    );

    expect(attached?.typicalRawAskingTotal).toBeUndefined();
    expect(attached?.marketSampleSize).toBeUndefined();
    expect(attached?.sourceStatus).toBe('PENDING');
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('keeps market cache entries separate for different user price ranges', () => {
    const name = `Mew Budget Cache ${Date.now()}`;
    const lowRange = { min: 0, max: 75 };
    const highRange = { min: 0, max: 250 };
    const lowCacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA', undefined, lowRange);
    const highCacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA', undefined, highRange);
    deleteDiscoveryMarketCache(lowCacheKey);
    deleteDiscoveryMarketCache(highCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: lowCacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 70,
      marketSampleSize: 3,
      fetchedAt: new Date().toISOString()
    });
    upsertDiscoveryMarketCache({
      cacheKey: highCacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 220,
      marketSampleSize: 3,
      fetchedAt: new Date().toISOString()
    });

    const [lowAttached] = candidatesFromDiscoveryMarketCache([candidate(name, 'mythical display cards', 0)], {
      userId: 'user-1',
      activeChases: [],
      destination: { country: 'CA' },
      targetCurrency: 'CAD',
      range: lowRange
    });
    const [highAttached] = candidatesFromDiscoveryMarketCache([candidate(name, 'mythical display cards', 0)], {
      userId: 'user-1',
      activeChases: [],
      destination: { country: 'CA' },
      targetCurrency: 'CAD',
      range: highRange
    });

    expect(lowCacheKey).not.toBe(highCacheKey);
    expect(lowAttached?.typicalRawAskingTotal).toBe(70);
    expect(highAttached?.typicalRawAskingTotal).toBe(220);
    deleteDiscoveryMarketCache(lowCacheKey);
    deleteDiscoveryMarketCache(highCacheKey);
  });

  it('retries old zero-sample market cache rows instead of treating thin data as settled', () => {
    const name = `Special Delivery Pikachu Thin Cache ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: undefined,
      marketSampleSize: 0,
      typicalRawSoldTotal: undefined,
      soldSampleSize: 0,
      fetchedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache([candidate(name, 'promo trail', 0)], {
      userId: 'user-1',
      activeChases: [],
      destination: { country: 'CA' },
      targetCurrency: 'CAD'
    });

    expect(attached?.marketSampleSize).toBe(0);
    expect(attached?.soldSampleSize).toBe(0);
    expect(attached?.sourceStatus).toBe('PENDING');
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('treats fresh zero-sample Bubble Mew cache rows as updating instead of thin', () => {
    const name = `Mew ex Paldean Fates 232 Bubble Mew ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: undefined,
      marketSampleSize: 0,
      typicalRawSoldTotal: undefined,
      soldSampleSize: 0,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache([candidate(name, 'modern texture', 0)], {
      userId: 'user-1',
      activeChases: [],
      destination: { country: 'CA' },
      targetCurrency: 'CAD'
    });

    expect(attached?.marketSampleSize).toBe(0);
    expect(attached?.soldSampleSize).toBe(0);
    expect(attached?.sourceStatus).toBe('PENDING');
    deleteDiscoveryMarketCache(cacheKey);
  });
});

describe('attachReferenceImages', () => {
  it('replaces eBay listing thumbnails with clean card reference images when available', async () => {
    const name = `Pikachu ex Surging Sparks 238 ${Date.now()}`;
    const referenceCacheKey = discoveryReferenceCacheKey(name);
    deleteDiscoveryReferenceCache(referenceCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceCacheKey,
      suggestionName: name,
      imageUrl: 'https://images.pokemontcg.io/sv8/238_hires.png',
      sourceName: 'Pokemon TCG (Surging Sparks)',
      sourceCardId: 'sv8-238',
      fetchedAt: new Date().toISOString()
    });

    const [attached] = await attachReferenceImages([
      {
        ...candidate(name, 'modern texture', 0, 4),
        image: {
          name,
          url: 'https://i.ebayimg.com/images/g/hand-photo/s-l225.jpg',
          sourceName: 'eBay listing image',
          sourceKind: 'MARKET_LISTING'
        }
      }
    ]);

    expect(attached?.image?.url).toBe('https://images.pokemontcg.io/sv8/238_hires.png');
    expect(attached?.image?.sourceName).toBe('Pokemon TCG (Surging Sparks)');
    expect(attached?.image?.sourceKind).toBe('CARD_REFERENCE');
    deleteDiscoveryReferenceCache(referenceCacheKey);
  });
});

describe('discoveryActionRows', () => {
  it('uses direct Add buttons for Free Discovery', () => {
    const rows = discoveryActionRows('user-1', [
      candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
      candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
      candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
    ]);
    const json = rows[0]?.toJSON() as any;

    expect(rows).toHaveLength(1);
    expect(json.components).toHaveLength(3);
    expect(json.components[0].label).toBe('Add 1 to Vault');
  });

  it('keeps action numbering aligned with the full shelf offset', () => {
    const rows = discoveryActionRows('user-1', [
      candidate('Pikachu Skyridge 84', 'e-reader atmosphere', 7),
      candidate('Zapdos Aquapolis 44', 'legendary bird thread', 8)
    ], true, 7);
    const json = rows[0]?.toJSON() as any;

    expect(json.components[0].options[0].label).toBe('8. Pikachu Skyridge 84');
    expect(json.components[0].options[1].label).toBe('9. Zapdos Aquapolis 44');
  });

  it('uses one compact card picker for Pro Discovery actions', () => {
    const rows = discoveryActionRows('user-1', [
      candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
      candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
      candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2),
      candidate('Pikachu Skyridge 84', 'e-reader atmosphere', 3),
      candidate('Zapdos Aquapolis 44', 'legendary bird thread', 4),
      candidate('Articuno Skyridge H3', 'legendary bird thread', 5),
      candidate('Moltres Wizards Black Star Promos 21', 'promo bird thread', 6)
    ], true);
    const json = rows[0]?.toJSON() as any;

    expect(rows).toHaveLength(1);
    expect(json.components).toHaveLength(1);
    expect(json.components[0].placeholder).toBe('Choose a Discovery card');
    expect(json.components[0].options).toHaveLength(7);
  });
});

describe('Discovery plan scaling', () => {
  it('keeps Free previews smaller than Pro Discovery pages', () => {
    expect(discoveryVisibleCountForPlan('FREE')).toBe(3);
    expect(discoveryVisibleCountForPlan('PRO')).toBe(7);
  });

  it('keeps Free Discovery on active Vault signals while Pro can blend taste memory', () => {
    const activeChases: Chase[] = [
      { id: 'c1', userId: 'u1', cardName: 'Pikachu 26/83 promo', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const tasteMemory: Chase[] = [{ id: 'taste:1', userId: 'u1', cardName: 'Corocoro Shining Mew', createdAt: '2026-06-03T00:00:00.000Z', tasteSource: 'DISCOVERY_ADD' }];

    expect(discoveryTasteProfileChases(activeChases, tasteMemory, false).map((chase) => chase.cardName)).toEqual(['Pikachu 26/83 promo', 'Mew RC24']);
    expect(discoveryTasteProfileChases(activeChases, tasteMemory, true).map((chase) => chase.cardName)).toEqual(['Pikachu 26/83 promo', 'Mew RC24', 'Corocoro Shining Mew']);
  });

  it('builds a dynamic market range from saved max prices', () => {
    const chases: Chase[] = [
      { id: 'c1', userId: 'u1', cardName: 'Mew RC24', maxPrice: 80, createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Bubble Mew', maxPrice: 300, createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c3', userId: 'u1', cardName: 'Pikachu', createdAt: '2026-06-03T00:00:00.000Z' }
    ];

    expect(discoveryMarketRangeFromChases(chases)).toEqual({ min: 0, max: 300 });
  });

  it('leaves market data uncapped when no max price has been selected', () => {
    expect(discoveryMarketRangeFromChases([{ id: 'c1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-06-03T00:00:00.000Z' }])).toBeUndefined();
  });
});

describe('Discovery response cards', () => {
  it('shows Market Snapshot on Pro response cards and hides it for Free response cards', () => {
    const candidates = [candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2)];

    const freeCard = discoveryCardEmbeds(candidates, 'CAD', false)[0]?.toJSON();
    const proCard = discoveryCardEmbeds(candidates, 'CAD', true)[0]?.toJSON();

    expect(freeCard?.fields?.map((field) => field.name)).toEqual(['Why It Fits', 'Collector Cue']);
    expect(proCard?.fields?.map((field) => field.name)).toEqual(['Why It Fits', 'Collector Cue', 'Market Snapshot']);
  });

  it('keeps card numbering aligned with the full shelf offset', () => {
    const cards = discoveryCardEmbeds([
      candidate('Pikachu Skyridge 84', 'e-reader atmosphere', 7),
      candidate('Zapdos Aquapolis 44', 'legendary bird thread', 8)
    ], 'CAD', true, 7).map((embed) => embed.toJSON());

    expect(cards[0].title).toBe('8. Pikachu Skyridge 84');
    expect(cards[1].title).toBe('9. Zapdos Aquapolis 44');
  });
});