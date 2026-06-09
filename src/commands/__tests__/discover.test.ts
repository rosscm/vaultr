import { describe, expect, it } from 'vitest';
import {
  candidatesFromDiscoveryMarketCache,
  discover,
  discoveryActionRows,
  discoveryCardEmbeds,
  discoveryEmbed,
  discoveryTasteProfileChases,
  discoveryVisibleCountForPlan,
  isUsableDiscoveryExample,
  isActiveChaseEchoSuggestion,
  isActiveChaseEchoText,
  looksLikeRawCardListing,
  looksLikeVisualDiscoveryListing,
  mergeFreshDiscoveryCandidates,
  orderCandidatesFromPersistedState,
  preserveLanguageSignalFallbackSuggestions,
  selectVisibleCandidates,
  selectVisibleCandidatesForCount,
  type DiscoveryCandidate
} from '../discover.js';
import { selectDiscoverySuggestions } from '../../services/discovery-catalog.js';
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

  it('balances the seven-card shelf across production-facing trails when alternatives exist', () => {
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

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why This Card', 'Taste Cue']);
  });

  it('shows market read for full Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', true).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why This Card', 'Taste Cue', 'Market Read']);
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

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
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

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
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

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
    expect(marketRead).toBe('Market refresh queued; Vaultr will attach pricing once the source responds.');
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

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
    expect(marketRead).toBe('Market refresh queued; Vaultr will attach image and pricing once the source responds.');
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

    const why = embed.fields?.find((field) => field.name === 'Why This Card')?.value;
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

    const why = embed.fields?.find((field) => field.name === 'Why This Card')?.value;
    const signal = embed.fields?.find((field) => field.name === 'Taste Cue')?.value;
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

    const why = embed.fields?.find((field) => field.name === 'Why This Card')?.value;
    const signal = embed.fields?.find((field) => field.name === 'Taste Cue')?.value;
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

    const signal = embed.fields?.find((field) => field.name === 'Taste Cue')?.value;
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

    const signal = embed.fields?.find((field) => field.name === 'Taste Cue')?.value;
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

    const englishSignal = englishEmbed.fields?.find((field) => field.name === 'Taste Cue')?.value;
    const englishWhy = englishEmbed.fields?.find((field) => field.name === 'Why This Card')?.value;
    const japaneseSignal = japaneseEmbed.fields?.find((field) => field.name === 'Taste Cue')?.value;
    expect(englishSignal).not.toContain('Japanese Prints');
    expect(englishWhy).not.toContain('Japanese print path');
    expect(japaneseSignal).toContain('Japanese Prints');
  });

  it('uses cooldown language for active eBay throttle states', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        sourceStatus: 'RATE_LIMITED'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
    expect(marketRead).toContain('cooling down');
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
  it('uses a three-card Free preview and a seven-card Pro shelf', () => {
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
});

describe('discover command', () => {
  it('does not expose mode or focus options', () => {
    const options = discover.data.toJSON().options ?? [];

    expect(options).toEqual([]);
  });

  it('shows Market Read on Pro response cards and hides it for Free response cards', () => {
    const candidates = [candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2)];

    const freeCard = discoveryCardEmbeds(candidates, 'CAD', false)[0]?.toJSON();
    const proCard = discoveryCardEmbeds(candidates, 'CAD', true)[0]?.toJSON();

    expect(freeCard?.fields?.map((field) => field.name)).toEqual(['Why This Card', 'Taste Cue']);
    expect(proCard?.fields?.map((field) => field.name)).toEqual(['Why This Card', 'Taste Cue', 'Market Read']);
  });
});