import { describe, expect, it } from 'vitest';
import {
  discover,
  discoveryActionRows,
  discoveryEmbed,
  isUsableDiscoveryExample,
  isActiveChaseEchoSuggestion,
  isActiveChaseEchoText,
  looksLikeVisualDiscoveryListing,
  mergeFreshDiscoveryCandidates,
  preserveLanguageSignalFallbackSuggestions,
  selectVisibleCandidates,
  type DiscoveryCandidate
} from '../discover.js';
import { selectDiscoverySuggestions } from '../../services/discovery-catalog.js';
import type { Listing } from '../../types.js';

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

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Pikachu Japanese SV2a 025']);
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

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Resonates', 'Next Threads']);
  });

  it('shows market read for full Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', true).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Resonates', 'Market Read', 'Next Threads']);
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

    const why = embed.fields?.find((field) => field.name === 'Why It Resonates')?.value;
    expect(why).toContain('e-reader era thread');
    expect(why).toContain('Zapdos appears in your taste profile');
    expect(why).not.toContain('active chase');
    expect(why).not.toContain('patterns emerging');
    expect(embed.fields?.some((field) => field.name === 'Image Source')).toBe(false);
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

    expect(embed.title).toContain('2.');
  });

  it('does not show the internal collection thread field', () => {
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

    expect(embed.fields?.some((field) => field.name === 'Collection Thread')).toBe(false);
    expect(embed.fields?.find((field) => field.name === 'Next Threads')?.value).toContain('Ancient Mew Promo');
  });
});

describe('discoveryActionRows', () => {
  it('uses one compact select menu for mobile-friendly actions', () => {
    const rows = discoveryActionRows('user-1', [
      candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
      candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
      candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
    ]);
    const json = rows[0]?.toJSON() as any;

    expect(rows).toHaveLength(1);
    expect(json.components).toHaveLength(1);
    expect(json.components[0].options).toHaveLength(9);
  });
});

describe('discover command', () => {
  it('uses collector-friendly mode names with stable internal values', () => {
    const options = discover.data.toJSON().options ?? [];
    const modeOption = options.find((option: any) => option.name === 'mode') as any;

    expect(modeOption.choices).toEqual([
      { name: 'Close Match', value: 'similar' },
      { name: 'Side Quest', value: 'adjacent' },
      { name: 'Deep Cut', value: 'wildcard' },
      { name: 'Smart Value', value: 'budget' }
    ]);
    expect(options.some((option: any) => option.name === 'focus')).toBe(false);
  });
});