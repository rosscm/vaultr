import { afterEach, describe, expect, it } from 'vitest';
import {
  attachReferenceImages,
  backfillMarketReadyDiscoveryCandidates,
  backfillScheduledDiscoveryShelfCandidates,
  backfillDiscoverySuggestions,
  backfillSourceBackedDiscoverySuggestions,
  blendWeeklyTasteLaneCandidates,
  candidatesFromDiscoveryMarketCache,
  compactDiscoveryPathSummary,
  concreteDiscoveryFallbackSuggestions,
  collectorDiscoveryFeatures,
  collectorDiscoveryRankScore,
  discoveryCandidateSelectionCount,
  discoveryActionRows,
  discoveryCardEmbeds,
  discoveryCardClickUrl,
  discoveryEmbed,
  discoveryMarketRangeFromChases,
  getDiscoveryMarketRefreshThrottleState,
  discoveryNegativeProfile,
  discoveryProfileConfidence,
  discoveryShelfMarketCheckNote,
  discoveryShelfTighteningNote,
  discoveryTasteProfileChases,
  discoveryVisibleCountForPlan,
  isUsableDiscoveryExample,
  isUsableDiscoveryMarketSample,
  isActiveChaseEchoSuggestion,
  isActiveChaseEchoText,
  isBroadCollectorShelfFillerCandidate,
  isScheduledProfileRelevantCandidate,
  looksLikeRawCardListing,
  looksLikeBaselineRawMarketListing,
  looksLikeVisualDiscoveryListing,
  marketReadyShelfCandidates,
  marketReadyShelfCandidatesWithOptions,
  mergeFreshDiscoveryCandidates,
  composeWeeklyShelfCandidates,
  orderConcreteDiscoveryFallbackSuggestionsForMarket,
  orderCandidatesForMarketConfidence,
  orderCandidatesFromPersistedState,
  preferFreshWeeklyCandidatesAgainstRecentShelves,
  selectNovelWeeklyCandidates,
  profileSubjectMatchedReliableDiscoveryCandidates,
  profileVariantSourceBackfillParents,
  preserveLanguageSignalFallbackSuggestions,
  repairScheduledDiscoveryShelfImages,
  resetDiscoveryMarketRefreshThrottleState,
  selectFreshVisibleCandidatesForCount,
  selectVisibleCandidates,
  selectVisibleCandidatesForCount,
  shouldShowDiscoveryShelfTighteningNote,
  typicalMarketTotal,
  weeklyDiscoveryShelfSizeForPlan,
  __discoveryLearningTestHooks,
  __discoveryPersistenceTestHooks,
  type DiscoveryCandidate
} from '../discover.js';
import { selectDiscoverySuggestions } from '../../services/discovery-catalog.js';
import { deleteDiscoveryReferenceCache, discoveryReferenceCacheKey, upsertDiscoveryReferenceCache } from '../../services/discovery-reference-cache.js';
import { deleteDiscoveryMarketCache, discoveryMarketCacheKey, upsertDiscoveryMarketCache } from '../../services/discovery-market-cache.js';
import { deleteDiscoveryMarketRefreshJob, getDiscoveryMarketRefreshJob } from '../../services/discovery-market-jobs.js';
import { deleteDiscoveryUniverseCards, upsertDiscoveryUniverseCard } from '../../services/discovery-card-universe.js';
import { deleteScheduledDiscoveryDrop, getScheduledDiscoveryDrop } from '../../services/scheduled-discovery-drops.js';
import type { DiscoveryUserUniverseCard } from '../../services/discovery-user-universe.js';
import type { Chase, Listing } from '../../types.js';
import type { ScheduledDiscoveryDrop } from '../../services/scheduled-discovery-drops.js';

afterEach(() => {
  resetDiscoveryMarketRefreshThrottleState();
  deleteDiscoveryUniverseCards();
});

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

function chase(cardName: string, index: number): Chase {
  return { id: `c${index}`, userId: 'u1', cardName, priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' };
}

const usableProfileConfidence = discoveryProfileConfidence([
  'Pikachu Skyridge 84',
  'Mew Expedition Base Set 55',
  'Articuno Skyridge H3',
  'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
  'Mew Japanese S12a 052',
  'Squirtle Expedition Base Set 132'
].map(chase));

const strongProfileConfidence = discoveryProfileConfidence([
  'Pikachu Skyridge 84',
  'Mew Expedition Base Set 55',
  'Articuno Skyridge H3',
  'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
  'Mew Japanese S12a 052',
  'Squirtle Expedition Base Set 132',
  'Mew ex Paldean Fates 232',
  'Zapdos Aquapolis 44',
  'Pikachu ex Surging Sparks 238',
].map(chase));

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

function userUniverseCard(name: string, score: number, updatedAt: string, sourceName: string): DiscoveryUserUniverseCard {
  return {
    userId: 'u1',
    cardKey: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    canonicalName: name,
    score,
    scoreComponents: { total: score },
    suggestion: {
      name,
      lane: 'Promo Trail',
      laneWhy: 'profile source match',
      why: `try ${name}`,
      nearby: [],
      referenceSourceName: sourceName
    },
    imageUrl: 'https://images.example/card.png',
    imageSourceName: sourceName,
    sourceCardId: `ref-${score}`,
    marketTotal: 120,
    marketCurrency: 'CAD',
    createdAt: updatedAt,
    updatedAt
  };
}

function publishableCandidate(name: string, canonicalId: string, selectionIndex: number): DiscoveryCandidate {
  return {
    selectionIndex,
    suggestion: {
      name,
      lane: 'Collector Compass',
      laneWhy: 'profile source match',
      why: `try ${name}`,
      nearby: [],
      referenceImageUrl: `https://images.example/${canonicalId}.png`,
      referenceSourceName: 'Pokemon TCG API',
      referenceSourceCardId: canonicalId
    },
    image: {
      name,
      url: `https://images.example/${canonicalId}.png`,
      sourceName: 'Pokemon TCG API',
      sourceCardId: canonicalId,
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
    expect(discoveryCandidateSelectionCount(true, weeklyDiscoveryShelfSizeForPlan('PRO'))).toBeGreaterThanOrEqual(60);
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

  it('does not treat three asking-only comps as strong market data', () => {
    const visible = selectVisibleCandidates(
      [
        candidate('Pikachu ex Surging Sparks 238', 'modern chase texture', 0, 3),
        candidate('Mew Southern Islands Promo', 'mythical display cards', 1, 4),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Pikachu ex Surging Sparks 238',
      'Totodile McDonalds Promo'
    ]);
  });

  it('does not treat a single sold comp as strong market data', () => {
    const visible = selectVisibleCandidates(
      [
        {
          ...candidate('Pikachu ex Surging Sparks 238', 'modern chase texture', 0),
          typicalRawSoldTotal: 460,
          soldSampleSize: 1
        },
        candidate('Mew Southern Islands Promo', 'mythical display cards', 1, 4),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Pikachu ex Surging Sparks 238',
      'Totodile McDonalds Promo'
    ]);
  });

  it('orders current shelf candidates by market confidence before low-comp exploration', () => {
    const ordered = orderCandidatesForMarketConfidence([
      candidate('Mew Japanese S12a 052', 'Special Release Trail', 0, 3),
      {
        ...candidate('Pikachu ex Surging Sparks 238', 'Collector Compass', 1, 12),
        typicalRawAskingTotal: 469.225
      },
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 2),
        typicalRawSoldTotal: 120,
        soldSampleSize: 3
      },
      candidate('Totodile McDonalds Promo', 'starter promo side paths', 3)
    ]);

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Pikachu ex Surging Sparks 238',
      'Mew Japanese S12a 052',
      'Totodile McDonalds Promo'
    ]);
  });

  it('prefers proper card reference images when market confidence is tied', () => {
    const ordered = orderCandidatesForMarketConfidence([
      candidate('Mew Evolutions 53', 'market ready path', 0, 12),
      {
        ...candidate('Mew VMAX Fusion Strike 269', 'market ready path', 1, 12),
        image: {
          name: 'Mew VMAX Fusion Strike 269',
          url: 'https://images.pokemontcg.io/swsh8/269_hires.png',
          sourceName: 'Pokemon TCG (Fusion Strike)',
          sourceKind: 'CARD_REFERENCE' as const
        }
      },
      {
        ...candidate('Mewtwo & Mew-GX Unified Minds 222', 'market ready path', 2, 12),
        image: {
          name: 'Mewtwo & Mew-GX Unified Minds 222',
          url: 'https://i.ebayimg.com/images/g/listing/s-l225.jpg',
          sourceName: 'eBay listing image',
          sourceKind: 'MARKET_LISTING' as const
        }
      }
    ]);

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Mew VMAX Fusion Strike 269',
      'Mew Evolutions 53',
      'Mewtwo & Mew-GX Unified Minds 222'
    ]);
  });

  it('keeps stronger market evidence ahead of image quality polish', () => {
    const ordered = orderCandidatesForMarketConfidence([
      {
        ...candidate('Pikachu VMAX Vivid Voltage 188', 'market ready path', 0, 12),
        image: {
          name: 'Pikachu VMAX Vivid Voltage 188',
          url: 'https://images.pokemontcg.io/swsh4/188_hires.png',
          sourceName: 'Pokemon TCG (Vivid Voltage)',
          sourceKind: 'CARD_REFERENCE' as const
        }
      },
      {
        ...candidate('Mew Southern Islands Promo', 'market ready path', 1, 1),
        typicalRawSoldTotal: 120,
        soldSampleSize: 3
      }
    ]);

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Pikachu VMAX Vivid Voltage 188'
    ]);
  });

  it('extracts collector-shaped features for ML-ready Discovery ranking', () => {
    const raichuIntroPack = {
      ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0, 12),
      suggestion: {
        ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0).suggestion,
        evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
        evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
        requiredEvidenceTokens: ['raichu', '026', 'bulbasaur']
      }
    } satisfies DiscoveryCandidate;
    const profile = [{ id: 'c1', userId: 'u1', cardName: 'Raichu Japanese promo oddball releases', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }];

    const features = collectorDiscoveryFeatures(raichuIntroPack, profile);

    expect(features.directSubjectSupport).toBe(1);
    expect(features.japaneseSignal).toBe(true);
    expect(features.nicheExclusiveSignal).toBe(true);
    expect(features.exactNicheIdentity).toBe(true);
    expect(features.ordinaryFormatPenalty).toBe(false);
    expect(features.collectorTerms).toEqual(expect.arrayContaining(['bulbasaur deck', 'intro pack', 'japanese']));
    expect(features.collectorTraits).toMatchObject({
      subject: ['raichu'],
      region: ['japanese'],
      releaseShape: ['intro pack'],
      identifierShape: ['collector-number']
    });
    expect(features.marketEvidence).toBeGreaterThanOrEqual(2);
  });

  it('gives collector-shaped graph signals more rank than ordinary format filler', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Raichu Japanese promo oddball releases', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const nicheRelease = {
      ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0, 12),
      suggestion: {
        ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0).suggestion,
        evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
        evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
        requiredEvidenceTokens: ['raichu', '026', 'bulbasaur']
      }
    } satisfies DiscoveryCandidate;
    const ordinaryFormat = candidate('Raichu VMAX Standard Set 051', 'Collector Compass', 1, 12);

    expect(collectorDiscoveryRankScore(nicheRelease, profile)).toBeGreaterThan(collectorDiscoveryRankScore(ordinaryFormat, profile));
  });

  it('applies bounded learned feature nudges from feedback traces', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Japanese promo binder cards', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const japanesePromo = candidate('Pikachu 010/018 Holo McDonalds Promo e-Reader 2002 Japanese', 'Japanese Collector Trail', 0, 12);
    const neutralScore = collectorDiscoveryRankScore(japanesePromo, profile);
    const learnedScore = collectorDiscoveryRankScore(japanesePromo, profile, undefined, {
      exampleCount: 4,
      likedCount: 3,
      rejectedCount: 1,
      featureWeights: { japaneseSignal: 24, promoSignal: 18 },
      termWeights: { japanese: 12, promo: 8 },
      termEdgeWeights: {},
      typedTraitEdgeWeights: {}
    });

    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('applies learned collector taxonomy term nudges without manual subject steering', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Mew gallery cards', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const galleryCandidate = candidate('Mew VMAX Lost Origin Trainer Gallery TG30', 'Artwork Trail', 0, 12);
    const neutralScore = collectorDiscoveryRankScore(galleryCandidate, profile);
    const learnedScore = collectorDiscoveryRankScore(galleryCandidate, profile, undefined, {
      exampleCount: 4,
      likedCount: 3,
      rejectedCount: 1,
      featureWeights: {},
      termWeights: { 'trainer gallery': 24 },
      termEdgeWeights: {},
      typedTraitEdgeWeights: {}
    });

    expect(collectorDiscoveryFeatures(galleryCandidate, profile).collectorTerms).toContain('trainer gallery');
    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('applies learned collector term graph nudges from co-occurring taste traits', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Corocoro Shining Mew', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const coroCoroCandidate = {
      ...candidate('Pikachu CoroCoro promo Pokemon cards', 'Japanese Collector Trail', 0, 12),
      suggestion: {
        ...candidate('Pikachu CoroCoro promo Pokemon cards', 'Japanese Collector Trail', 0).suggestion,
        requiredEvidenceTokens: ['pikachu', 'corocoro'],
        sourceTasteTokens: ['pikachu', 'japanese', 'promo', 'corocoro', 'magazine']
      }
    } satisfies DiscoveryCandidate;
    const neutralScore = collectorDiscoveryRankScore(coroCoroCandidate, profile);
    const learnedScore = collectorDiscoveryRankScore(coroCoroCandidate, profile, undefined, {
      exampleCount: 4,
      likedCount: 3,
      rejectedCount: 1,
      featureWeights: {},
      termWeights: {},
      termEdgeWeights: { 'corocoro|magazine': 18 },
      typedTraitEdgeWeights: {}
    });

    expect(collectorDiscoveryFeatures(coroCoroCandidate, profile).collectorTerms).toEqual(expect.arrayContaining(['corocoro', 'magazine']));
    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('applies learned typed collector graph nudges between trait families', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Corocoro Shining Mew', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const coroCoroCandidate = {
      ...candidate('Pikachu CoroCoro promo Pokemon cards', 'Japanese Collector Trail', 0, 12),
      suggestion: {
        ...candidate('Pikachu CoroCoro promo Pokemon cards', 'Japanese Collector Trail', 0).suggestion,
        requiredEvidenceTokens: ['pikachu', 'corocoro'],
        sourceTasteTokens: ['pikachu', 'japanese', 'promo', 'corocoro', 'magazine']
      }
    } satisfies DiscoveryCandidate;
    const neutralScore = collectorDiscoveryRankScore(coroCoroCandidate, profile);
    const learnedScore = collectorDiscoveryRankScore(coroCoroCandidate, profile, undefined, {
      exampleCount: 4,
      likedCount: 3,
      rejectedCount: 1,
      featureWeights: {},
      termWeights: {},
      termEdgeWeights: {},
      typedTraitEdgeWeights: { 'channel:corocoro|releaseShape:promo': 16 }
    });

    expect(collectorDiscoveryFeatures(coroCoroCandidate, profile).collectorTraits).toMatchObject({
      channel: ['corocoro', 'magazine'],
      releaseShape: ['promo'],
      region: ['japanese']
    });
    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('applies lower-capped global collector grammar without personal subject learning', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: 'Japanese promo binder cards', priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const japanesePromo = candidate('Pikachu 010/018 Holo McDonalds Promo e-Reader 2002 Japanese', 'Japanese Collector Trail', 0, 12);
    const neutralScore = collectorDiscoveryRankScore(japanesePromo, profile);
    const learnedScore = collectorDiscoveryRankScore(japanesePromo, profile, undefined, {
      exampleCount: 0,
      likedCount: 0,
      rejectedCount: 0,
      featureWeights: {},
      termWeights: {},
      termEdgeWeights: {},
      typedTraitEdgeWeights: {},
      globalExampleCount: 12,
      globalTypedTraitEdgeWeights: { 'region:japanese|releaseShape:promo': 12 }
    });

    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('captures reusable set-family and lane-shape traits for learned discovery signals', () => {
    const candidateWithStructuredSource = sourceCandidate('Umbreon ex SAR Terastal Festival Japanese 217/187', 'TCGdex Japanese (SV8a)', 0);
    candidateWithStructuredSource.suggestion.lane = 'Set Companion Trail';
    candidateWithStructuredSource.suggestion.requiredEvidenceTokens = ['umbreon', 'japanese', 'Terastal Festival', 'special set'];

    const features = collectorDiscoveryFeatures(candidateWithStructuredSource, ['Umbreon ex SAR Terastal Festival Japanese 217/187'].map(chase));

    expect(features.collectorTraits).toMatchObject({
      setFamily: ['terastal-festival'],
      laneShape: ['set-companion-trail'],
      region: ['japanese']
    });
  });

  it('applies vault-derived trait priors before explicit Discovery feedback exists', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: "Squirtle 007/018 McDonald's Promo e-Reader 2002 Japanese", priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Pikachu xy95', priority: 'HIGH' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const retailEReaderCandidate = candidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'Japanese Collector Trail', 0, 12);
    const neutralScore = collectorDiscoveryRankScore(retailEReaderCandidate, profile);
    const learnedScore = collectorDiscoveryRankScore(retailEReaderCandidate, profile, undefined, {
      exampleCount: 0,
      likedCount: 0,
      rejectedCount: 0,
      featureWeights: {},
      termWeights: {},
      termEdgeWeights: {},
      typedTraitEdgeWeights: {},
      vaultTypedTraitEdgeWeights: {
        'era:e-reader|identifierShape:compact-fraction': 10,
        'era:e-reader|releaseShape:promo': 10,
        'identifierShape:compact-fraction|releaseShape:promo': 10
      }
    });

    expect(collectorDiscoveryFeatures(retailEReaderCandidate, profile).collectorTraits).toMatchObject({
      era: ['e-reader'],
      releaseShape: ['promo'],
      identifierShape: ['compact-fraction']
    });
    expect(learnedScore).toBeGreaterThan(neutralScore);
  });

  it('derives graph priors from common collector shapes in saved chases', () => {
    const profile = [
      { id: 'c1', userId: 'u1', cardName: "Squirtle 007/018 McDonald's Promo e-Reader 2002 Japanese", priority: 'GRAIL' as const, createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: "Pikachu 010/018 McDonald's Promo e-Reader 2002 Japanese", priority: 'HIGH' as const, createdAt: '2026-06-03T00:00:00.000Z' }
    ];

    const weights = __discoveryLearningTestHooks.vaultTypedTraitEdgeWeights(profile);

    expect(weights['era:e-reader|releaseShape:promo']).toBe(10);
    expect(weights['identifierShape:compact-fraction|releaseShape:promo']).toBe(10);
    expect(weights['region:japanese|releaseShape:promo']).toBe(10);
  });

  it('explains Discovery path summaries for shelf headers', () => {
    expect(compactDiscoveryPathSummary(['Japanese Collector Trail', 'E-Reader Era Trail', 'Collector Compass'])).toBe('Japanese variants, E-reader era, Profile-adjacent picks');
    expect(compactDiscoveryPathSummary([])).toBe('No fresh Discovery threads right now');
  });

  it('hides sparse low-data trailing shelf pages until enough picks are market-ready', () => {
    const readyCandidates = Array.from({ length: 12 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const lowDataCandidates = Array.from({ length: 8 }, (_, index) => candidate(`Low Data Pick ${index + 1}`, 'exploration path', index + 12, index % 3));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...lowDataCandidates], true);

    expect(visible).toHaveLength(10);
    expect(visible.map((item) => item.suggestion.name)).toEqual(readyCandidates.slice(0, 10).map((item) => item.suggestion.name));
  });

  it('uses statistically bounded profile confidence tiers for Pro shelf exposure', () => {
    const seed = discoveryProfileConfidence(['Gardevoir ex Scarlet & Violet 245'].map(chase));
    const emerging = discoveryProfileConfidence(['Gardevoir ex Scarlet & Violet 245', 'Mew RC24', 'Pikachu 151 173'].map(chase));
    const diverseNineCardVault = discoveryProfileConfidence([
      'Squirtle 007/018',
      'Moltres Zapdos Articuno SM210',
      'Corocoro Shining Mew',
      'Mew RC24/RC25',
      'Mew 347/190',
      'Mega Gardevoir 087/063',
      'Pikachu 26/83 Toys R Us promo',
      'Umbreon 217/187 Japanese',
      'Pikachu xy95'
    ].map(chase));

    expect(seed).toMatchObject({ tier: 'SEED', minShelfSize: 5, maxShelfSize: 10 });
    expect(emerging).toMatchObject({ tier: 'EMERGING', minShelfSize: 10, maxShelfSize: 14 });
    expect(diverseNineCardVault).toMatchObject({ tier: 'STRONG', minShelfSize: 20, maxShelfSize: 20 });
    expect(usableProfileConfidence).toMatchObject({ tier: 'USABLE', minShelfSize: 14, maxShelfSize: 20 });
    expect(strongProfileConfidence).toMatchObject({ tier: 'STRONG', minShelfSize: 20, maxShelfSize: 20 });
  });

  it('uses curation copy for tighter Pro shelves without calling usable profiles light', () => {
    expect(discoveryShelfTighteningNote()).toBe('🔮 **Reading:** Vaultr is still learning from your chases, feedback, and collector patterns');
    expect(discoveryShelfTighteningNote()).not.toContain('smaller shelf');
    expect(discoveryShelfTighteningNote()).not.toContain('Light Vault');
  });

  it('explains hidden low-comp shelf rows without implying repeated opens will unlock packed picks', () => {
    const note = discoveryShelfMarketCheckNote(12);

    expect(note).toBe('🧪 **Market Check:** showing 12 picks with cleaner live market checks. Thinner comp rows will keep refreshing automatically');
    expect(note).not.toContain('extra picks are packed');
    expect(note).not.toContain('waiting on cleaner market checks');
  });

  it('does not explain near-full Pro shelves as smaller shelves', () => {
    expect(shouldShowDiscoveryShelfTighteningNote(true, 14, 20)).toBe(true);
    expect(shouldShowDiscoveryShelfTighteningNote(true, 15, 20)).toBe(false);
    expect(shouldShowDiscoveryShelfTighteningNote(true, 18, 20)).toBe(false);
    expect(shouldShowDiscoveryShelfTighteningNote(true, 19, 20)).toBe(false);
    expect(shouldShowDiscoveryShelfTighteningNote(false, 3, 20)).toBe(false);
  });

  it('keeps a one-card Pro seed profile broader than one nearby card but capped to one page', () => {
    const seedProfileConfidence = discoveryProfileConfidence(['Gardevoir ex Scarlet & Violet 245'].map(chase));
    const readyCandidates = Array.from({ length: 2 }, (_, index) => candidate(`Gardevoir Pick ${index + 1}`, 'market ready path', index, 4));
    const lowDataCandidates = Array.from({ length: 8 }, (_, index) => candidate(`Safe Nearby Pick ${index + 1}`, 'exploration path', index + 2, index % 2));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...lowDataCandidates], true, seedProfileConfidence);

    expect(visible).toHaveLength(10);
    expect(visible.map((item) => item.suggestion.name)).toEqual([...readyCandidates, ...lowDataCandidates].map((item) => item.suggestion.name));
  });

  it('allows a second shelf page once enough market-ready picks exist', () => {
    const readyCandidates = Array.from({ length: 17 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const lowDataCandidates = Array.from({ length: 3 }, (_, index) => candidate(`Low Data Pick ${index + 1}`, 'exploration path', index + 17, index));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...lowDataCandidates], true, usableProfileConfidence);

    expect(visible).toHaveLength(17);
    expect(visible.at(-1)?.suggestion.name).toBe('Ready Pick 17');
  });

  it('does not cap a healthy shelf at ten when a market-ready extras page exists', () => {
    const readyCandidates = Array.from({ length: 14 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const lowDataCandidates = Array.from({ length: 6 }, (_, index) => candidate(`Low Data Pick ${index + 1}`, 'exploration path', index + 14, index % 3));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...lowDataCandidates], true, usableProfileConfidence);

    expect(visible).toHaveLength(14);
    expect(visible.at(-1)?.suggestion.name).toBe('Ready Pick 14');
  });

  it('keeps strong profiles at a full shelf with concrete cards while market data catches up', () => {
    const readyCandidates = Array.from({ length: 12 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const pendingCandidates = Array.from({ length: 8 }, (_, index) => candidate(`Pending Pick ${index + 1} SWSH${200 + index}`, 'exploration path', index + 12));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...pendingCandidates], true, strongProfileConfidence);

    expect(visible).toHaveLength(20);
    expect(visible.map((item) => item.suggestion.name)).toEqual([...readyCandidates, ...pendingCandidates].map((item) => item.suggestion.name));
  });

  it('fills a Pro shelf with concrete cards when clean market data is still catching up', () => {
    const readyCandidates = Array.from({ length: 5 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const concretePendingCandidates = Array.from({ length: 15 }, (_, index) => candidate(`Concrete Pick ${index + 1} SWSH${100 + index}`, 'exploration path', index + 5));

    const visible = marketReadyShelfCandidates([...readyCandidates, ...concretePendingCandidates], true, strongProfileConfidence);

    expect(visible).toHaveLength(20);
    expect(visible.map((item) => item.suggestion.name)).toEqual([
      ...readyCandidates.map((item) => item.suggestion.name),
      ...concretePendingCandidates.map((item) => item.suggestion.name)
    ]);
  });

  it('does not fill strong shelves with thin low-comp market estimates', () => {
    const readyCandidates = Array.from({ length: 13 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const thinCandidates = [
      candidate('Thin Ask Pick 1', 'exploration path', 13, 1),
      {
        ...candidate('Thin Ask Pick 2', 'exploration path', 14),
        marketSampleSize: 2,
        sourceStatus: 'PENDING' as const
      }
    ];

    const visible = marketReadyShelfCandidates([...readyCandidates, ...thinCandidates], true, strongProfileConfidence);

    expect(visible).toHaveLength(13);
    expect(visible.map((item) => item.suggestion.name)).toEqual(readyCandidates.map((item) => item.suggestion.name));
  });

  it('allows exact Japanese unique releases onto scheduled shelves with one specific market comp', () => {
    const readyCandidates = Array.from({ length: 13 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const raichuIntroPack = {
      ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 13, 1),
      suggestion: {
        ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 13, 1).suggestion,
        laneWhy: 'Japanese exclusiveness and unusual-release signals',
        evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
        evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
        requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
        sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
      }
    } satisfies DiscoveryCandidate;

    const visible = marketReadyShelfCandidates([...readyCandidates, raichuIntroPack], true, strongProfileConfidence);

    expect(visible.map((item) => item.suggestion.name)).toContain('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
  });

  it('keeps scheduled delivery shelves to market-ready picks instead of pending filler', () => {
    const readyCandidates = Array.from({ length: 5 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const pendingCandidates = Array.from({ length: 10 }, (_, index) => candidate(`Pending Pick ${index + 1} SWSH${200 + index}`, 'exploration path', index + 5));

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, ...pendingCandidates],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(readyCandidates.map((item) => item.suggestion.name));
  });

  it('does not count low-value ordinary modern format promos as weekly chase picks', () => {
    const lowValuePromo = sourceCandidate('Zapdos ex Scarlet & Violet Black Star Promos 49', 'Pokemon TCG (Scarlet & Violet Black Star Promos)', 0);
    lowValuePromo.typicalRawAskingTotal = 5.68;
    lowValuePromo.marketSampleSize = 12;
    const collectorPick = candidate('Mew Expedition Base Set 19', 'Vintage Era Trail', 1, 4);

    const visible = marketReadyShelfCandidatesWithOptions(
      [lowValuePromo, collectorPick],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Mew Expedition Base Set 19']);
  });

  it('does not count low-value ordinary modern set cards as weekly chase picks', () => {
    const lowValueJapaneseV = sourceCandidate('Mew V RR 053/172 S12a VSTAR Universe - Pokemon Card Japanese - NM', 'TCGdex Japanese (S12a)', 0);
    lowValueJapaneseV.typicalRawAskingTotal = 11.87;
    lowValueJapaneseV.marketSampleSize = 12;
    const lowValueModernHolo = sourceCandidate('Mew S12a 052 trading card', 'TCGdex Japanese (S12a)', 1);
    lowValueModernHolo.typicalRawAskingTotal = 13.92;
    lowValueModernHolo.marketSampleSize = 12;
    const lowValueModernArtRare = sourceCandidate('Paldean Tauros AR 084/073 Triplet Beat SV1a Pokemon Card Japanese [Near Mint]', 'TCGdex Japanese (SV1a)', 2);
    lowValueModernArtRare.typicalRawAskingTotal = 13.4;
    lowValueModernArtRare.marketSampleSize = 12;
    const collectorPick = candidate('Mew Expedition Base Set 19', 'Vintage Era Trail', 2, 4);

    const visible = marketReadyShelfCandidatesWithOptions(
      [lowValueJapaneseV, lowValueModernHolo, lowValueModernArtRare, collectorPick],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Mew Expedition Base Set 19']);
  });

  it('does not count low-value ordinary non-premium cards as weekly chase picks', () => {
    const cheapJapaneseZapdos = sourceCandidate('Zapdos Japanese SVLN 002/022', 'TCGdex Japanese (SVLN)', 0);
    cheapJapaneseZapdos.typicalRawAskingTotal = 8.02;
    cheapJapaneseZapdos.marketSampleSize = 7;

    const cheapGiovanniMeowth = sourceCandidate("Giovanni's Meowth Gym Challenge 74", 'Pokemon TCG (Gym Challenge)', 1);
    cheapGiovanniMeowth.typicalRawAskingTotal = 7.34;
    cheapGiovanniMeowth.marketSampleSize = 12;

    const premiumPromo = sourceCandidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'TCGdex Japanese (McDonalds Collection)', 2);
    premiumPromo.typicalRawAskingTotal = 11.5;
    premiumPromo.marketSampleSize = 2;
    premiumPromo.suggestion.sourceTasteTokens = ['pikachu', 'promo', 'e-reader', 'mcdonalds', 'japanese'];

    expect(isBroadCollectorShelfFillerCandidate(cheapJapaneseZapdos, ['Zapdos Aquapolis 44'].map(chase))).toBe(false);
    expect(isBroadCollectorShelfFillerCandidate(cheapGiovanniMeowth, ['Pikachu XY95'].map(chase))).toBe(false);
    expect(isBroadCollectorShelfFillerCandidate(premiumPromo, ["Squirtle 007/018 McDonald's Promo e-Reader 2002 Japanese"].map(chase))).toBe(true);
  });

  it('keeps low-value modern cards with explicit collector context', () => {
    const specialDelivery = sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 0);
    specialDelivery.typicalRawAskingTotal = 18.5;
    specialDelivery.marketSampleSize = 12;
    const trainerGallery = sourceCandidate('Mew VMAX Lost Origin Trainer Gallery TG30', 'Pokemon TCG (Lost Origin)', 1);
    trainerGallery.typicalRawAskingTotal = 14.25;
    trainerGallery.marketSampleSize = 12;

    const visible = marketReadyShelfCandidatesWithOptions(
      [specialDelivery, trainerGallery],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
      'Mew VMAX Lost Origin Trainer Gallery TG30'
    ]);
  });

  it('keeps source-backed priced collector rows while scheduled market status catches up', () => {
    const pricedCollectorPick = sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 0);
    pricedCollectorPick.typicalRawAskingTotal = 194.49;
    pricedCollectorPick.marketSampleSize = 3;
    pricedCollectorPick.sourceStatus = 'PENDING';
    const cheapModernPromo = sourceCandidate('Zapdos ex Scarlet & Violet Black Star Promos 49', 'Pokemon TCG (Scarlet & Violet Black Star Promos)', 1);
    cheapModernPromo.typicalRawAskingTotal = 5.68;
    cheapModernPromo.marketSampleSize = 12;
    cheapModernPromo.sourceStatus = 'PENDING';
    const noDataGeneric = candidate('Umbreon Japanese unique release Pokemon cards', 'Japanese Collector Trail', 2);

    const visible = marketReadyShelfCandidatesWithOptions(
      [pricedCollectorPick, cheapModernPromo, noDataGeneric],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Mew Expedition Base Set 19']);
  });

  it('tops off a prepared scheduled shelf with source-backed priced collector rows instead of shrinking it', () => {
    const readyCandidates = Array.from({ length: 16 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const fallbackCandidates = Array.from({ length: 4 }, (_, index) => {
      const item = sourceCandidate(`Fallback Collector Pick ${index + 1} Expedition Base Set ${40 + index}`, 'Pokemon TCG (Expedition Base Set)', 16 + index);
      item.typicalRawAskingTotal = 120 + index;
      item.marketSampleSize = 3;
      item.sourceStatus = 'PENDING';
      return item;
    });

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, ...fallbackCandidates],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible).toHaveLength(20);
    expect(visible.slice(0, 16).map((item) => item.suggestion.name)).toEqual(readyCandidates.map((item) => item.suggestion.name));
    expect(visible.slice(16).map((item) => item.suggestion.name)).toEqual(fallbackCandidates.map((item) => item.suggestion.name));
  });

  it('keeps a thin Japanese-language signal when a Japanese-weighted scheduled shelf has no ready Japanese row', () => {
    const readyCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Ready English Pick ${index + 1}`, 'market ready path', index, 4));
    const japaneseCandidate = candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 20, 2);

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, japaneseCandidate],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false, allowLanguageSignalFallback: true }
    );

    expect(visible).toHaveLength(20);
    expect(visible[0].suggestion.name).toBe('Mew Japanese S12a 052');
  });

  it('can keep multiple thin Japanese-language rows for a Japanese-heavy scheduled shelf', () => {
    const readyCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Ready English Pick ${index + 1}`, 'market ready path', index, 4));
    const japaneseCandidates = [
      candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 20, 2),
      candidate('Pikachu Japanese SV2a 025', 'Japanese Collector Trail', 21, 2),
      candidate('Umbreon Japanese SV8a 092', 'Japanese Collector Trail', 22, 2)
    ];

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, ...japaneseCandidates],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false, allowLanguageSignalFallback: true, languageSignalTargetCount: 4 }
    );

    expect(visible).toHaveLength(20);
    expect(visible.slice(0, 3).map((item) => item.suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Pikachu Japanese SV2a 025', 'Umbreon Japanese SV8a 092']);
  });

  it('does not pad scheduled shelves with no-data Japanese rows once ready Japanese picks exist', () => {
    const readyCandidates = Array.from({ length: 16 }, (_, index) => candidate(`Ready English Pick ${index + 1}`, 'market ready path', index, 4));
    const readyJapaneseCandidate = candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 16, 1);
    const noDataJapaneseCandidate = {
      ...sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 17),
      typicalRawAskingTotal: undefined,
      marketSampleSize: undefined,
      sourceStatus: 'PENDING' as const
    };

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, readyJapaneseCandidate, noDataJapaneseCandidate],
      true,
      { ...strongProfileConfidence, maxShelfSize: 18 },
      { allowPendingExploration: false, allowLanguageSignalFallback: true, languageSignalTargetCount: 4 }
    );

    expect(visible.map((item) => item.suggestion.name)).toContain('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
    expect(visible.map((item) => item.suggestion.name)).not.toContain('Mew Japanese S12a 183');
  });

  it('can keep source-backed Japanese rows while market data catches up', () => {
    const readyCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Ready English Pick ${index + 1}`, 'market ready path', index, 4));
    const japaneseCandidate = {
      ...sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 20),
      typicalRawAskingTotal: undefined,
      marketSampleSize: undefined,
      sourceStatus: 'PENDING' as const
    };

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, japaneseCandidate],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false, allowLanguageSignalFallback: true, languageSignalTargetCount: 3 }
    );

    expect(visible[0].suggestion.name).toBe('Mew Japanese S12a 183');
  });

  it('does not keep retail e-reader promo rows without market data or card reference data', () => {
    const readyCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Ready English Pick ${index + 1}`, 'market ready path', index, 4));
    const retailPromoCandidate = {
      ...candidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'Retail Promo Trail', 20),
      typicalRawAskingTotal: undefined,
      marketSampleSize: undefined,
      sourceStatus: 'PENDING' as const,
      suggestion: {
        ...candidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'Retail Promo Trail', 20).suggestion,
        evidenceSearchTerm: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Pokemon card",
        evidenceAliases: ['Pikachu 010/018'],
        requiredEvidenceTokens: ['pikachu', '010', '018']
      }
    } satisfies DiscoveryCandidate;

    const visible = marketReadyShelfCandidatesWithOptions(
      [...readyCandidates, retailPromoCandidate],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false, allowSourceBackedRetailEReaderFallback: true }
    );

    expect(visible.map((item) => item.suggestion.name)).not.toContain("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese");
  });

  it('does not blank prepared scheduled shelves just because ready picks were seen before', () => {
    const repeated = candidate('Moltres Skyridge H20', 'market ready path', 0, 4);
    const anotherReadyPick = candidate('Zapdos Wizards Black Star Promos 23', 'market ready path', 1, 4);

    const visible = marketReadyShelfCandidatesWithOptions(
      [repeated, anotherReadyPick],
      true,
      strongProfileConfidence,
      { allowPendingExploration: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([repeated.suggestion.name, anotherReadyPick.suggestion.name]);
  });

  it('prefers reliable cards tied to concrete chase subjects over era-only reliable filler', () => {
    const concreteSubjectCandidates = Array.from({ length: 10 }, (_, index) =>
      candidate(`Mew Profile Match ${index + 1}`, 'market ready path', index, 12)
    );
    const eraOnlyCandidates = [
      candidate('Xatu Skyridge H32', 'market ready path', 20, 12),
      candidate('Zubat Skyridge 117', 'market ready path', 21, 12),
      candidate('Magneton Skyridge H19', 'market ready path', 22, 12)
    ];

    const pool = profileSubjectMatchedReliableDiscoveryCandidates(
      [...eraOnlyCandidates, ...concreteSubjectCandidates],
      ['Mew RC24/RC25'].map(chase),
      20
    );
    const selected = selectVisibleCandidatesForCount(pool, ['Mew RC24/RC25'].map(chase), 20);

    expect(selected.map((item) => item.suggestion.name)).toEqual(concreteSubjectCandidates.map((item) => item.suggestion.name));
  });

  it('does not use removed chases as positive subjects for reliable filler', () => {
    const activeMatches = Array.from({ length: 10 }, (_, index) => candidate(`Mew Profile Match ${index + 1}`, 'market ready path', index, 12));
    const removedSubjectCandidate = candidate('Meowth VMAX SWSH Black Star Promos SWSH005', 'market ready path', 20, 12);
    const removedMeowth = { ...chase('Meowth 18/53', 1), tasteSource: 'REMOVED_CHASE' as const };

    const pool = profileSubjectMatchedReliableDiscoveryCandidates(
      [removedSubjectCandidate, ...activeMatches],
      [chase('Mew RC24/RC25', 0), removedMeowth],
      20
    );
    const selected = selectVisibleCandidatesForCount(pool, [chase('Mew RC24/RC25', 0), removedMeowth], 20);

    expect(selected.map((item) => item.suggestion.name)).toEqual(activeMatches.map((item) => item.suggestion.name));
  });

  it('does not show broad Discovery category titles as finished shelf cards', () => {
    const readyCandidates = Array.from({ length: 6 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index, 4));
    const broadCandidates = [
      candidate('Pokemon promo cards', 'Promo Trail', 6, 4),
      candidate('Pokemon collector cards', 'Collector Compass', 7, 4),
      candidate('Pikachu Skyridge illustration rare cards', 'Artwork Trail', 8, 4),
      candidate('Pokemon special release cards', 'Special Release Trail', 9, 4),
      candidate('EX Pokemon cards', 'Format Trail', 10, 4)
    ];

    const visible = marketReadyShelfCandidates([...readyCandidates, ...broadCandidates], true, strongProfileConfidence);

    expect(visible.map((item) => item.suggestion.name)).toEqual(readyCandidates.map((item) => item.suggestion.name));
  });

  it('does not schedule broad Japanese unique-release bucket titles as shelf cards', () => {
    const backfilled = backfillScheduledDiscoveryShelfCandidates(
      [
        candidate('Sar Japanese unique release Pokemon cards', 'Japanese Collector Trail', 0),
        candidate('Umbreon Japanese unique release Pokemon cards', 'Japanese Collector Trail', 1),
        candidate('Squirtle Japanese special set Pokemon cards', 'Japanese Collector Trail', 2),
        candidate('Mew Expedition Base Set 19', 'Vintage Era Trail', 3, 3)
      ],
      null,
      3
    );

    expect(backfilled.map((item) => item.suggestion.name)).toEqual(['Mew Expedition Base Set 19']);
  });

  it('does not keep generic thread titles when backfilling a finished weekly shelf', () => {
    const backfilled = backfillScheduledDiscoveryShelfCandidates(
      [
        sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 0),
        candidate('Squirtle Expedition Base Set raw card', 'Collector Compass', 1, 4),
        candidate('Mew S12a Japanese cards', 'Japanese Collector Trail', 2, 4),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 3)
      ],
      null,
      20
    );

    expect(backfilled.map((item) => item.suggestion.name)).toEqual([
      'Squirtle Expedition Base Set 132',
      'Zapdos Aquapolis 44'
    ]);
  });

  it('does not show duplicate card picks that only differ by generic card suffixes', () => {
    const visible = marketReadyShelfCandidates(
      [candidate('Pikachu Skyridge 84', 'E-Reader Era Trail', 0, 4), candidate('Pikachu Skyridge 84 trading card', 'Collector Compass', 1, 4)],
      true,
      strongProfileConfidence
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Pikachu Skyridge 84']);
  });

  it('fills a full Pro shelf from deeper market-ready alternatives', () => {
    const lowDataCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Low Data Pick ${index + 1}`, 'exploration path', index, index % 3));
    const readyCandidates = Array.from({ length: 20 }, (_, index) => candidate(`Ready Pick ${index + 1}`, 'market ready path', index + 20, 4));

    const selected = selectVisibleCandidatesForCount([...lowDataCandidates, ...readyCandidates], [], 20);
    const visible = marketReadyShelfCandidates(selected, true, strongProfileConfidence);

    expect(selected).toHaveLength(20);
    expect(visible).toHaveLength(20);
    expect(visible.map((item) => item.suggestion.name)).toEqual(readyCandidates.map((item) => item.suggestion.name));
  });

  it('rebalances weekly shelves away from one repeated subject when alternatives exist', () => {
    const selected = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 0),
        sourceCandidate('Squirtle Expedition Base Set 131', 'Pokemon TCG (Expedition Base Set)', 1),
        sourceCandidate('Squirtle 151 170', 'Pokemon TCG (151)', 2),
        sourceCandidate('Squirtle McDonalds Promo 007/018 Japanese', 'TCGdex Japanese (McDonalds Collection)', 3),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 4),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 5),
        sourceCandidate('Articuno Wizards Black Star Promos 48', 'Pokemon TCG (Wizards Black Star Promos)', 6),
        sourceCandidate('Umbreon BW Black Star Promos BW93', 'Pokemon TCG (BW Black Star Promos)', 7),
        sourceCandidate('Moltres Skyridge 21', 'Pokemon TCG (Skyridge)', 8),
        sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 9)
      ],
      ['Squirtle 007/018', 'Mew RC24', 'Umbreon 217/187', 'Pikachu xy95', 'Moltres Zapdos Articuno SM210'].map(chase),
      10
    );

    expect(selected.filter((item) => /squirtle/i.test(item.suggestion.name))).toHaveLength(3);
    expect(selected.map((item) => item.suggestion.name)).toEqual(expect.arrayContaining([
      'Mew Expedition Base Set 55',
      'Zapdos Aquapolis 44',
      'Umbreon BW Black Star Promos BW93',
      'Pikachu Skyridge 84'
    ]));
  });

  it('holds back VMAX and GX cards when the profile has no format affinity', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 0),
        sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 1),
        sourceCandidate('Pikachu-GX SM Black Star Promos SM232', 'Pokemon TCG (SM Black Star Promos)', 2),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 3),
        sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 4),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 5),
        sourceCandidate('Mew Wizards Black Star Promos 8', 'Pokemon TCG (Wizards Black Star Promos)', 6)
      ],
      [
        { id: 'c1', userId: 'u1', cardName: 'Mew RC24', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c2', userId: 'u1', cardName: 'Pikachu 26/83 promo', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
      ],
      4
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Mew Expedition Base Set 55',
      'Special Delivery Pikachu SWSH Black Star Promos SWSH074',
      'Mew Wizards Black Star Promos 8',
      'Zapdos Aquapolis 44'
    ]);
  });

  it('keeps ordinary VMAX held back even when the profile has a premium VMAX chase', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 0),
        sourceCandidate('Umbreon VMAX Alt Art Evolving Skies 215', 'Pokemon TCG (Evolving Skies)', 1),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 2)
      ],
      [{ id: 'c1', userId: 'u1', cardName: 'Umbreon VMAX Alt Art Evolving Skies 215', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' }],
      2
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Umbreon VMAX Alt Art Evolving Skies 215',
      'Mew Expedition Base Set 55'
    ]);
  });

  it('demotes ordinary VMAX below niche grail-style picks', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 0),
        sourceCandidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'eBay vetted marketplace image', 1),
        sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 2),
        sourceCandidate('Pikachu Crown Zenith 160', 'Pokemon TCG (Crown Zenith)', 3)
      ],
      [
        { id: 'c1', userId: 'u1', cardName: 'Pikachu Skyridge 84', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c2', userId: 'u1', cardName: 'Pikachu Japanese promo', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
      ],
      3
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese",
      'Pikachu Expedition Base Set 124',
      'Pikachu Crown Zenith 160'
    ]);
  });

  it('prefers direct-subject premium VMAX over off-subject related-family VMAX', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate("Gardevoir VMAX Champion's Path 76", "Pokemon TCG (Champion's Path)", 0),
        sourceCandidate('Sylveon VMAX Alt Art Evolving Skies 212', 'Pokemon TCG (Evolving Skies)', 1),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 2)
      ],
      [{ id: 'c1', userId: 'u1', cardName: 'Sylveon VMAX Alt Art Evolving Skies 212', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' }],
      2
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Sylveon VMAX Alt Art Evolving Skies 212',
      'Mew Expedition Base Set 55'
    ]);
  });

  it('does not turn a single non-VMAX subject signal into a premium VMAX recommendation', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate("Gardevoir VMAX Champion's Path Secret Rare 76", "Pokemon TCG (Champion's Path)", 0),
        sourceCandidate('Mew VMAX Lost Origin Trainer Gallery TG30', 'Pokemon TCG (Lost Origin)', 1),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 2),
        sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 3)
      ],
      [
        { id: 'c1', userId: 'u1', cardName: 'Mega Gardevoir 087/063', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c2', userId: 'u1', cardName: 'Corocoro Shining Mew', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c3', userId: 'u1', cardName: 'Mew RC24/RC25', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
      ],
      3
    );

    expect(visible.map((item) => item.suggestion.name)).toContain('Mew VMAX Lost Origin Trainer Gallery TG30');
    expect(visible.map((item) => item.suggestion.name)).not.toContain("Gardevoir VMAX Champion's Path Secret Rare 76");
  });

  it('downranks rejected subjects without suppressing positively supported shared eras', () => {
    const chases = [chase('Pikachu Skyridge 84', 1), chase('Zapdos Aquapolis 44', 2)];
    const negativeProfile = discoveryNegativeProfile(
      [
        {
          suggestionName: 'Ledian Skyridge H14',
          lane: 'Collector Compass',
          feedback: 'NOT_FOR_ME',
          interactionCount: 1,
          lastInteractedAt: '2026-06-11T21:00:21.489Z'
        }
      ],
      chases
    );
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Ledian Skyridge H14', 'Pokemon TCG (Skyridge)', 0),
        sourceCandidate('Articuno Skyridge H3', 'Pokemon TCG (Skyridge)', 1),
        sourceCandidate('Moltres Skyridge H20', 'Pokemon TCG (Skyridge)', 2),
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 3)
      ],
      chases,
      3,
      negativeProfile
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Zapdos Aquapolis 44',
      'Articuno Skyridge H3',
      'Moltres Skyridge H20'
    ]);
  });

  it('keeps weak single-bird surfaces behind premium picks when the only bird signal is a trio chase', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Zapdos Generations 29', 'Pokemon TCG (Generations)', 0),
        sourceCandidate('Zapdos Wizards Black Star Promos 23', 'Pokemon TCG (Wizards Black Star Promos)', 4),
        sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 1),
        sourceCandidate('Moltres Skyridge H20', 'Pokemon TCG (Skyridge)', 2),
        sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 3)
      ],
      [
        { id: 'c1', userId: 'u1', cardName: 'Moltres Zapdos Articuno SM210', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' },
        { id: 'c2', userId: 'u1', cardName: 'Pikachu Skyridge 84', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
      ],
      3,
      discoveryNegativeProfile(
        [{ suggestionName: 'Zapdos Generations 29', lane: 'Collector Compass', feedback: 'NOT_FOR_ME', interactionCount: 1, lastInteractedAt: '2026-06-24T03:06:03.789Z' }],
        [{ id: 'c1', userId: 'u1', cardName: 'Moltres Zapdos Articuno SM210', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' }]
      )
    );

    expect(visible.map((item) => item.suggestion.name)).toHaveLength(3);
    expect(visible.map((item) => item.suggestion.name)).not.toContain('Zapdos Generations 29');
    expect(visible.map((item) => item.suggestion.name)).not.toContain('Zapdos Wizards Black Star Promos 23');
    expect(visible.map((item) => item.suggestion.name)).toEqual(expect.arrayContaining([
      'Pikachu Expedition Base Set 124',
      'Moltres Skyridge H20',
      'Mew Japanese S12a 183'
    ]));
  });

  it('does not schedule ordinary common or holo set filler from subject overlap alone', () => {
    const plainSourceCandidate = (name: string, sourceName: string, selectionIndex: number): DiscoveryCandidate => ({
      ...sourceCandidate(name, sourceName, selectionIndex),
      suggestion: {
        ...sourceCandidate(name, sourceName, selectionIndex).suggestion,
        lane: 'Collector Compass',
        requiredEvidenceTokens: []
      }
    });
    const chases: Chase[] = [
      { id: 'c1', userId: 'u1', cardName: 'Moltres Zapdos Articuno SM210', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Corocoro Shining Mew', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c3', userId: 'u1', cardName: 'Mewtwo promo cards', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c4', userId: 'u1', cardName: 'Pikachu VMAX promo cards', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
    ];

    expect(isScheduledProfileRelevantCandidate(plainSourceCandidate('Moltres Legendary Treasures 22', 'Pokemon TCG (Legendary Treasures)', 0), chases)).toBe(false);
    expect(isScheduledProfileRelevantCandidate(plainSourceCandidate('Zapdos Legendary Treasures 46', 'Pokemon TCG (Legendary Treasures)', 1), chases)).toBe(false);
    expect(isScheduledProfileRelevantCandidate(plainSourceCandidate('Mew Evolutions 53', 'Pokemon TCG (Evolutions)', 2), chases)).toBe(false);
    expect(isScheduledProfileRelevantCandidate(plainSourceCandidate('Mew VMAX Fusion Strike 269', 'Pokemon TCG (Fusion Strike)', 4), chases)).toBe(false);
    expect(isScheduledProfileRelevantCandidate(plainSourceCandidate('Team Rocket\'s Moltres ex Destined Rivals 229', 'Pokemon TCG (Destined Rivals)', 3), chases)).toBe(true);
    expect(isScheduledProfileRelevantCandidate(sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 6), chases)).toBe(true);
    expect(isScheduledProfileRelevantCandidate(sourceCandidate('Moltres Skyridge H20', 'Pokemon TCG (Skyridge)', 2), chases)).toBe(true);
    expect(isScheduledProfileRelevantCandidate(sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 4), chases)).toBe(true);
    expect(isScheduledProfileRelevantCandidate(sourceCandidate('Mew ex Paldean Fates 232 Full Art', 'Pokemon TCG (Paldean Fates)', 5), chases)).toBe(true);
    expect(isScheduledProfileRelevantCandidate(sourceCandidate('Pikachu VMAX Special Delivery SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 7), chases)).toBe(true);
  });

  it('prefers adjacent-theme novelty over another direct-subject callback when collector fit is similar', () => {
    const chases: Chase[] = [
      { id: 'c1', userId: 'u1', cardName: 'Corocoro Shining Mew', priority: 'GRAIL', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Pikachu 26/83 Toys R Us promo', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c3', userId: 'u1', cardName: 'Umbreon 217/187 Japanese', priority: 'HIGH', createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const directCallback = sourceCandidate('Mew VMAX Lost Origin Trainer Gallery TG30', 'Pokemon TCG (Lost Origin)', 0);
    directCallback.typicalRawAskingTotal = 49;
    directCallback.marketSampleSize = 12;
    const adjacentNovelty = sourceCandidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Pokemon TCG (SM Black Star Promos)', 1);
    adjacentNovelty.typicalRawAskingTotal = 95;
    adjacentNovelty.marketSampleSize = 12;

    const ranked = orderCandidatesForMarketConfidence([directCallback, adjacentNovelty], chases);

    expect(ranked[0]?.suggestion.name).toBe('Mewtwo & Mew-GX SM Black Star Promos SM191');
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

    const visibleNames = visible.map((item) => item.suggestion.name);

    expect(visibleNames).toEqual(
      expect.arrayContaining([
        'Mew Japanese S12a 052',
        'Pikachu Japanese SV2a 025',
        'Mewtwo & Mew-GX SM Black Star Promos SM191',
        'Pikachu-GX SM Black Star Promos SM232'
      ])
    );
    expect(visibleNames.filter((name) => /^Mew Japanese S12a/i.test(name))).toHaveLength(1);
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
        sourceCandidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Pokemon TCG (SWSH Black Star Promos)', 7)
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

  it('does not show same-subject same-set source variants together', () => {
    const visible = selectVisibleCandidatesForCount(
      [
        sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0),
        sourceCandidate('Zapdos Aquapolis H32', 'Pokemon TCG (Aquapolis)', 1),
        sourceCandidate('Articuno Skyridge 4', 'Pokemon TCG (Skyridge)', 2),
        sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 3)
      ],
      [],
      3
    );
    const visibleNames = visible.map((item) => item.suggestion.name);

    expect(visibleNames).toHaveLength(3);
    expect(visibleNames.filter((name) => /^Zapdos Aquapolis/i.test(name))).toHaveLength(1);
    expect(visibleNames).toEqual(expect.arrayContaining(['Articuno Skyridge 4', 'Mew Expedition Base Set 55']));
  });

  it('prefers image-backed compact Japanese set variants over slash-total market duplicates', () => {
    const slashTotalMarketCandidate = candidate('Mew Japanese S12a 052/172', 'Japanese Collector Trail', 0, 3);
    const sourceImageCandidate = sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 1);

    const visible = selectVisibleCandidatesForCount([slashTotalMarketCandidate, sourceImageCandidate], [], 1);

    expect(visible).toHaveLength(1);
    expect(visible[0].suggestion.name).toBe('Mew Japanese S12a 052');
    expect(visible[0].image?.sourceName).toBe('TCGdex Japanese (S12a)');
  });

  it('does not show compact Japanese source cards beside slash-total marketplace duplicates', () => {
    const slashTotalMarketCandidate = candidate('Mew Japanese S12a 052/172', 'Japanese Collector Trail', 0, 3);
    const sourceImageCandidate = sourceCandidate('Mew Japanese S12a 052', 'TCGdex Japanese (S12a)', 1);
    const freshCandidate = sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 2);

    const visible = selectVisibleCandidatesForCount([slashTotalMarketCandidate, sourceImageCandidate, freshCandidate], [], 2);

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Mew Japanese S12a 052', 'Squirtle Expedition Base Set 132']);
  });

  it('prefers image-backed Black Star Promo variants over shorthand marketplace duplicates', () => {
    const shorthandMarketCandidate = candidate('Umbreon Darkrai-gx Sm Promos SM241 trading card', 'Promo Trail', 0, 3);
    const sourceImageCandidate = sourceCandidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Pokemon TCG (SM Black Star Promos)', 1);

    const visible = selectVisibleCandidatesForCount([shorthandMarketCandidate, sourceImageCandidate], [], 1);

    expect(visible).toHaveLength(1);
    expect(visible[0].suggestion.name).toBe('Umbreon & Darkrai-GX SM Black Star Promos SM241');
    expect(visible[0].image?.sourceName).toBe('Pokemon TCG (SM Black Star Promos)');
  });

  it('does not show source-backed promo cards beside shorthand marketplace duplicates', () => {
    const shorthandMarketCandidate = candidate('Umbreon Darkrai-gx Sm Promos SM241 trading card', 'Promo Trail', 0, 3);
    const sourceImageCandidate = sourceCandidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Pokemon TCG (SM Black Star Promos)', 1);
    const freshCandidate = sourceCandidate('Umbreon XY Black Star Promos XY96', 'Pokemon TCG (XY Black Star Promos)', 2);

    const visible = selectVisibleCandidatesForCount([shorthandMarketCandidate, sourceImageCandidate, freshCandidate], [], 2);

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Umbreon XY Black Star Promos XY96']);
  });

  it('treats holo and promo-shorthand title variants of the same tag team promo as one display card', () => {
    const sourceImageCandidate = sourceCandidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Pokemon TCG (SM Black Star Promos)', 0);
    const shorthandHoloCandidate = candidate('Umbreon & Darkrai GX SM241 Sm Holo', 'Promo Trail', 1, 4);

    const visible = selectVisibleCandidatesForCount([sourceImageCandidate, shorthandHoloCandidate], [], 1);

    expect(visible).toHaveLength(1);
    expect(visible[0].suggestion.name).toBe('Umbreon & Darkrai-GX SM Black Star Promos SM241');
  });

  it('prefers fresh weekly candidates before repeating previous shelf names', () => {
    const visible = selectFreshVisibleCandidatesForCount(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 4),
        candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1, 4),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 2, 4),
        candidate('Squirtle Expedition Base Set 132', 'Vintage Era Trail', 3, 4)
      ],
      [],
      3,
      undefined,
      ['Mew Southern Islands Promo', 'Pikachu Skyridge 84']
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Totodile McDonalds Promo',
      'Squirtle Expedition Base Set 132',
      'Mew Southern Islands Promo'
    ]);
  });

  it('uses previous shelf repeats only as weekly filler when fresh candidates run short', () => {
    const visible = selectFreshVisibleCandidatesForCount(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 4),
        candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1, 4),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 2, 4)
      ],
      [],
      3,
      undefined,
      ['Mew Southern Islands Promo', 'Pikachu Skyridge 84']
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Totodile McDonalds Promo',
      'Mew Southern Islands Promo',
      'Pikachu Skyridge 84'
    ]);
  });

  it('can keep scheduled weekly shelves smaller instead of padding with recent repeats', () => {
    const visible = selectFreshVisibleCandidatesForCount(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 4),
        candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1, 4),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 2, 4)
      ],
      [],
      3,
      undefined,
      ['Mew Southern Islands Promo', 'Pikachu Skyridge 84'],
      { allowAvoidedFiller: false }
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual(['Totodile McDonalds Promo']);
  });

  it('reserves weekly slots for supported Japanese promo and e-reader taste lanes', () => {
    const baseSelection = Array.from({ length: 20 }, (_, index) => candidate(`Reliable Modern Pick ${index + 1}`, 'Value Watch', index, 4));
    const pool = [
      ...baseSelection,
      {
        ...sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 20),
        sourceStatus: 'PENDING' as const
      },
      candidate('Special Delivery Pikachu SWSH Black Star Promos SWSH074', 'Promo Trail', 21, 4),
      candidate('Mew Wizards Black Star Promos 8', 'Promo Trail', 22, 4),
      candidate('Moltres Wizards Black Star Promos 21', 'Promo Trail', 23, 4),
      candidate('Zapdos Aquapolis 44', 'E-Reader Era Trail', 24, 4),
      candidate('Articuno Skyridge 4', 'E-Reader Era Trail', 25, 4),
      candidate('Squirtle Expedition Base Set 132', 'E-Reader Era Trail', 26, 4)
    ];

    const blended = blendWeeklyTasteLaneCandidates(
      baseSelection,
      pool,
      ['Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Squirtle Expedition Base Set 132', 'Umbreon 217/187 Japanese'].map(chase),
      20,
      ['Mew Expedition Base Set 55']
    );
    const names = blended.map((item) => item.suggestion.name);

    expect(names).not.toContain('Mew Expedition Base Set 55');
    expect(names.filter((name) => /japanese/i.test(name)).length).toBeGreaterThanOrEqual(1);
    expect(names.filter((name) => /promo|black star/i.test(name)).length).toBeGreaterThanOrEqual(3);
    expect(names.filter((name) => /aquapolis|skyridge|expedition/i.test(name)).length).toBeGreaterThanOrEqual(3);
  });

  it('surfaces market-backed retail e-reader promo variants for matching profiles', () => {
    const baseSelection = Array.from({ length: 20 }, (_, index) => candidate(`Reliable Modern Pick ${index + 1}`, 'Value Watch', index, 4));
    const pikachuRetailPromo = {
      ...candidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'Retail Promo Trail', 20, 4),
      suggestion: {
        ...candidate("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese", 'Retail Promo Trail', 20, 4).suggestion,
        lane: 'Retail Promo Trail',
        laneWhy: 'same-subject retail e-reader promo variants',
        evidenceSearchTerm: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Pokemon card",
        evidenceAliases: ['Pikachu 010/018'],
        requiredEvidenceTokens: ['pikachu', '010', '018']
      }
    } satisfies DiscoveryCandidate;

    const blended = blendWeeklyTasteLaneCandidates(
      baseSelection,
      [...baseSelection, pikachuRetailPromo],
      ["Squirtle 007/018 McDonald's e-Reader Promo", 'Pikachu xy95', 'Pikachu 26/83 Toys R Us promo'].map(chase),
      20
    );

    expect(blended.map((item) => item.suggestion.name)).toContain("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese");
  });

  it('surfaces market-backed Japanese unique releases for Japanese grail-shaped profiles', () => {
    const baseSelection = Array.from({ length: 20 }, (_, index) => candidate(`Reliable Modern Pick ${index + 1}`, 'Value Watch', index, 4));
    const raichuIntroPack = {
      ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 20, 4),
      suggestion: {
        ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 20, 4).suggestion,
        lane: 'Japanese Collector Trail',
        laneWhy: 'Japanese exclusiveness and unusual-release signals',
        evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
        evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
        requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
        sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
      }
    } satisfies DiscoveryCandidate;

    const blended = blendWeeklyTasteLaneCandidates(
      baseSelection,
      [...baseSelection, raichuIntroPack],
      ['Umbreon 217/187 Japanese', 'Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Squirtle 007/018'].map(chase),
      20
    );

    expect(blended.map((item) => item.suggestion.name)).toContain('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
  });

  it('ranks exact Japanese unique releases ahead of ordinary ready promo rows', () => {
    const ranked = orderCandidatesForMarketConfidence(
      [
        candidate('Umbreon-GX SM Black Star Promos SM36', 'Promo Trail', 0, 12),
        candidate('Pikachu-GX SM Black Star Promos SM232', 'Promo Trail', 1, 12),
        {
          ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 2, 1),
          suggestion: {
            ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 2, 1).suggestion,
            laneWhy: 'Japanese exclusiveness and unusual-release signals',
            evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
            evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
            requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
            sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
          }
        }
      ],
      ['Umbreon 217/187 Japanese', 'Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Squirtle 007/018'].map(chase)
    );

    expect(ranked[0]?.suggestion.name).toBe('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
  });

  it('does not let exact niche Japanese grail cards with only thin market data displace reliable rows', () => {
    const raichuIntroPackBase = candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 8, 1);
    const raichuIntroPack = {
      ...raichuIntroPackBase,
      suggestion: {
        ...raichuIntroPackBase.suggestion,
        laneWhy: 'Japanese exclusiveness and unusual-release signals',
        evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
        evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
        requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
        sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
      }
    } satisfies DiscoveryCandidate;

    const visible = selectVisibleCandidatesForCount(
      [
        candidate('Mewtwo & Mew-GX Unified Minds 222', 'Format Trail', 0, 12),
        candidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Promo Trail', 1, 12),
        candidate('Umbreon-GX SM Black Star Promos SM36', 'Promo Trail', 2, 12),
        candidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Promo Trail', 3, 12),
        candidate('Pikachu & Zekrom-GX SM Black Star Promos SM168', 'Promo Trail', 4, 12),
        candidate('Pikachu-GX SM Black Star Promos SM232', 'Promo Trail', 5, 12),
        sourceCandidate('Pikachu ex Surging Sparks 238', 'Pokemon TCG (Surging Sparks)', 6),
        sourceCandidate('Mew VMAX Fusion Strike 269', 'Pokemon TCG (Fusion Strike)', 7),
        raichuIntroPack
      ],
      ['Umbreon 217/187 Japanese', 'Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Pikachu xy95', 'Squirtle 007/018'].map(chase),
      5
    );

    expect(visible.map((item) => item.suggestion.name)).not.toContain('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
    expect(visible.map((item) => item.suggestion.name)).not.toContain('Mew VMAX Fusion Strike 269');
  });

  it('backfills a short strong shelf from prior ready weekly cards without same-set variants', () => {
    const current = [
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0),
      sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 1)
    ];
    const backfilled = backfillScheduledDiscoveryShelfCandidates(
      current,
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W24',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        generatedAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-06-10T00:00:00.000Z',
        itemCount: 3,
        imageReadyCount: 3,
        marketReadyCount: 3,
        items: [
          {
            position: 1,
            suggestion: sourceCandidate('Zapdos Aquapolis H32', 'Pokemon TCG (Aquapolis)', 2).suggestion,
            imageUrl: 'https://images.example/zapdos-h32.png',
            imageSourceName: 'Pokemon TCG (Aquapolis)',
            market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 }
          },
          {
            position: 2,
            suggestion: sourceCandidate('Articuno Skyridge 4', 'Pokemon TCG (Skyridge)', 3).suggestion,
            imageUrl: 'https://images.example/articuno.png',
            imageSourceName: 'Pokemon TCG (Skyridge)',
            market: {
              status: 'READY',
              currency: 'CAD',
              askingTotal: 90,
              askingSampleSize: 4,
              listing: { id: 'articuno-listing', title: 'Articuno Skyridge 4 raw card', url: 'https://www.ebay.ca/itm/articuno-listing' }
            }
          },
          {
            position: 3,
            suggestion: sourceCandidate('Mew XY Black Star Promos XY110', 'Pokemon TCG (XY Black Star Promos)', 4).suggestion,
            imageUrl: 'https://images.example/mew-xy110.png',
            imageSourceName: 'Pokemon TCG (XY Black Star Promos)',
            market: { status: 'READY', currency: 'CAD', askingTotal: 80, askingSampleSize: 4 }
          }
        ]
      },
      4,
      [{ id: 'taste:removed-zapdos', userId: 'u1', cardName: 'Zapdos Aquapolis H32', createdAt: '2026-06-03T00:00:00.000Z', tasteSource: 'REMOVED_CHASE' }]
    );
    const names = backfilled.map((candidate) => candidate.suggestion.name);

    expect(names).toEqual(['Zapdos Aquapolis 44', 'Mew Expedition Base Set 55', 'Articuno Skyridge 4', 'Mew XY Black Star Promos XY110']);
    expect(backfilled[2]?.listing?.url).toBe('https://www.ebay.ca/itm/articuno-listing');
  });

  it('caps immediate previous-week carryovers during scheduled shelf fallback', () => {
    const backfilled = backfillScheduledDiscoveryShelfCandidates(
      [sourceCandidate('Umbreon Neo Discovery 13', 'Pokemon TCG (Neo Discovery)', 0)],
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        expiresAt: '2026-07-14T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-07-07T00:00:00.000Z',
        itemCount: 4,
        imageReadyCount: 4,
        marketReadyCount: 4,
        items: [
          { position: 1, suggestion: sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 1).suggestion, imageUrl: 'https://images.example/p1.png', imageSourceName: 'Pokemon TCG (Expedition Base Set)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 2, suggestion: sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 2).suggestion, imageUrl: 'https://images.example/g1.png', imageSourceName: 'Pokemon TCG (Paldean Fates)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 3, suggestion: sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 3).suggestion, imageUrl: 'https://images.example/m1.png', imageSourceName: 'TCGdex Japanese (S12a)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 4, suggestion: sourceCandidate('Blaine\'s Moltres Gym Heroes 1', 'Pokemon TCG (Gym Heroes)', 4).suggestion, imageUrl: 'https://images.example/b1.png', imageSourceName: 'Pokemon TCG (Gym Heroes)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } }
        ]
      },
      4,
      [],
      [],
      { maxImmediateNameCarryovers: 2 }
    );

    expect(backfilled.map((candidate) => candidate.suggestion.name)).toEqual([
      'Umbreon Neo Discovery 13',
      'Pikachu Expedition Base Set 124',
      'Gardevoir ex Paldean Fates 233'
    ]);
  });

  it('can still refill a shelf after a capped carryover pass would otherwise leave it undersized', () => {
    const capped = backfillScheduledDiscoveryShelfCandidates(
      [sourceCandidate('Umbreon Neo Discovery 13', 'Pokemon TCG (Neo Discovery)', 0)],
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        expiresAt: '2026-07-14T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-07-07T00:00:00.000Z',
        itemCount: 4,
        imageReadyCount: 4,
        marketReadyCount: 4,
        items: [
          { position: 1, suggestion: sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 1).suggestion, imageUrl: 'https://images.example/p1.png', imageSourceName: 'Pokemon TCG (Expedition Base Set)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 2, suggestion: sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 2).suggestion, imageUrl: 'https://images.example/g1.png', imageSourceName: 'Pokemon TCG (Paldean Fates)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 3, suggestion: sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 3).suggestion, imageUrl: 'https://images.example/m1.png', imageSourceName: 'TCGdex Japanese (S12a)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 4, suggestion: sourceCandidate('Blaine\'s Moltres Gym Heroes 1', 'Pokemon TCG (Gym Heroes)', 4).suggestion, imageUrl: 'https://images.example/b1.png', imageSourceName: 'Pokemon TCG (Gym Heroes)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } }
        ]
      },
      4,
      [],
      [],
      { maxImmediateNameCarryovers: 2 }
    );

    const refilled = backfillScheduledDiscoveryShelfCandidates(
      capped,
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        expiresAt: '2026-07-14T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-07-07T00:00:00.000Z',
        itemCount: 4,
        imageReadyCount: 4,
        marketReadyCount: 4,
        items: [
          { position: 1, suggestion: sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 1).suggestion, imageUrl: 'https://images.example/p1.png', imageSourceName: 'Pokemon TCG (Expedition Base Set)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 2, suggestion: sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 2).suggestion, imageUrl: 'https://images.example/g1.png', imageSourceName: 'Pokemon TCG (Paldean Fates)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 3, suggestion: sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 3).suggestion, imageUrl: 'https://images.example/m1.png', imageSourceName: 'TCGdex Japanese (S12a)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } },
          { position: 4, suggestion: sourceCandidate('Blaine\'s Moltres Gym Heroes 1', 'Pokemon TCG (Gym Heroes)', 4).suggestion, imageUrl: 'https://images.example/b1.png', imageSourceName: 'Pokemon TCG (Gym Heroes)', market: { status: 'READY', currency: 'CAD', askingTotal: 120, askingSampleSize: 4 } }
        ]
      },
      4
    );

    expect(capped).toHaveLength(3);
    expect(refilled).toHaveLength(4);
  });

  it('rehydrates vetted marketplace images from scheduled niche promo rows', () => {
    const name = `Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Scheduled ${Date.now()}`;
    const backfilled = backfillScheduledDiscoveryShelfCandidates(
      [],
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W25',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-06-15T00:00:00.000Z',
        expiresAt: '2026-06-22T00:00:00.000Z',
        generatedAt: '2026-06-17T00:00:00.000Z',
        updatedAt: '2026-06-17T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-06-17T00:00:00.000Z',
        itemCount: 1,
        imageReadyCount: 1,
        marketReadyCount: 1,
        items: [
          {
            position: 1,
            suggestion: {
              name,
              lane: 'Retail Promo Trail',
              laneWhy: 'same-subject retail e-reader promo variants',
              why: 'try a Japanese McDonalds e-reader promo variant',
              nearby: [],
              evidenceSearchTerm: `${name} Pokemon card`,
              requiredEvidenceTokens: ['pikachu', '010', '018'],
              sourceTasteTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds', 'japanese']
            },
            imageUrl: 'https://i.ebayimg.com/images/g/clean-card/s-l1600.jpg',
            imageSourceName: 'eBay vetted marketplace image',
            market: {
              status: 'READY',
              currency: 'CAD',
              askingTotal: 1355,
              askingSampleSize: 12,
              listing: { id: 'vetted-pikachu-010', title: "Pokemon Card Game Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Nintendo", url: 'https://www.ebay.ca/itm/vetted-pikachu-010' }
            }
          }
        ]
      },
      1
    );

    expect(backfilled[0]?.image).toMatchObject({
      url: 'https://i.ebayimg.com/images/g/clean-card/s-l1600.jpg',
      sourceName: 'eBay vetted marketplace image',
      sourceKind: 'MARKET_LISTING'
    });
  });

  it('treats removed chase taste profile memory as an exact-repeat guard', () => {
    const removedChases: Chase[] = [{ id: 'taste:removed-meowth', userId: 'u1', cardName: 'Meowth 18/53', createdAt: '2026-06-14T02:26:37.266Z', tasteSource: 'REMOVED_CHASE' }];

    expect(isActiveChaseEchoText('Meowth 18/53 trading card', removedChases)).toBe(true);
    expect(isActiveChaseEchoText('Meowth character collection', removedChases)).toBe(false);
  });

  it('treats completed chase taste profile memory as an exact-repeat guard', () => {
    const completedChases: Chase[] = [{ id: 'taste:completed-meowth', userId: 'u1', cardName: 'Meowth 18/53', createdAt: '2026-06-14T02:26:37.266Z', tasteSource: 'BOUGHT_OR_SEEN' }];

    expect(isActiveChaseEchoText('Meowth 18/53 trading card', completedChases)).toBe(true);
    expect(isActiveChaseEchoText('Meowth character collection', completedChases)).toBe(false);
  });

  it('recognizes profile-aligned broad collector shelf filler while rejecting ordinary modern set filler', () => {
    const broadCollector = sourceCandidate('Sylveon ex Terastal Festival 205/187 Japanese', 'TCGdex Japanese (SV8a)', 0);
    broadCollector.typicalRawAskingTotal = 210;
    broadCollector.marketSampleSize = 12;
    broadCollector.displayCurrency = 'CAD';

    const ordinaryModern = sourceCandidate('Mew V RR 053/172 S12a VSTAR Universe', 'TCGdex Japanese (S12a)', 1);
    ordinaryModern.typicalRawAskingTotal = 11;
    ordinaryModern.marketSampleSize = 12;
    ordinaryModern.displayCurrency = 'CAD';

    expect(isBroadCollectorShelfFillerCandidate(broadCollector, ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Corocoro Shining Mew'].map(chase))).toBe(true);
    expect(isBroadCollectorShelfFillerCandidate(ordinaryModern, ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Corocoro Shining Mew'].map(chase))).toBe(false);
  });

  it('does not treat unverified Japanese promo-code identities as concrete discovery cards', () => {
    const candidateWithRiskyPromoIdentity = {
      ...candidate('Gardevoir Nintendo Promo 024/P Japanese', 'Promo Trail', 0),
      suggestion: {
        ...candidate('Gardevoir Nintendo Promo 024/P Japanese', 'Promo Trail', 0).suggestion,
        referenceSourceName: 'TCGdex Japanese',
        requiredEvidenceTokens: ['gardevoir', 'nintendo', '024', 'japanese']
      }
    } satisfies DiscoveryCandidate;

    expect(marketReadyShelfCandidatesWithOptions([candidateWithRiskyPromoIdentity], true, strongProfileConfidence, { allowPendingExploration: false })).toHaveLength(0);
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

describe('preferFreshWeeklyCandidatesAgainstRecentShelves', () => {
  it('prefers adjacent-theme novelty before same-subject weekly callbacks and repeats', () => {
    const fresh = sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0);
    const repeatedVariant = sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 1);
    const repeatedByName = sourceCandidate("_____'s Pikachu Celebrations: Classic Collection 24", 'Pokemon TCG (Celebrations: Classic Collection)', 2);
    const chases = ['Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Umbreon 217/187 Japanese'].map(chase);
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W26',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-06-23T00:00:00.000Z',
        generatedAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
        marketReadyCount: 2,
        imageReadyCount: 2,
        itemCount: 2,
        items: [
          {
            position: 1,
            suggestion: sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 0).suggestion,
            imageUrl: 'https://images.example/mew55.png',
            imageSourceName: 'Pokemon TCG (Expedition Base Set)',
            market: { status: 'READY', currency: 'CAD', askingTotal: 180, askingSampleSize: 12 }
          },
          {
            position: 2,
            suggestion: sourceCandidate("_____'s Pikachu Celebrations: Classic Collection 24", 'Pokemon TCG (Celebrations: Classic Collection)', 1).suggestion,
            imageUrl: 'https://images.example/pikachu24.png',
            imageSourceName: 'Pokemon TCG (Celebrations: Classic Collection)',
            market: { status: 'READY', currency: 'CAD', askingTotal: 80, askingSampleSize: 12 }
          }
        ]
      }
    ];

    const ordered = preferFreshWeeklyCandidatesAgainstRecentShelves([repeatedVariant, fresh, repeatedByName], recentDrops, chases);

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Zapdos Aquapolis 44',
      'Mew Expedition Base Set 55',
      "_____'s Pikachu Celebrations: Classic Collection 24"
    ]);
  });

  it('demotes subjects that were heavily used across recent shelves', () => {
    const mewCandidate = sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 0);
    const pikachuCandidate = sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 1);
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W26',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-06-23T00:00:00.000Z',
        generatedAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
        marketReadyCount: 3,
        imageReadyCount: 3,
        itemCount: 3,
        items: [
          { position: 1, suggestion: sourceCandidate('Mew Expedition Base Set 55', 'Pokemon TCG (Expedition Base Set)', 0).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 180, askingSampleSize: 12 } },
          { position: 2, suggestion: sourceCandidate('Mew VMAX Fusion Strike 269', 'Pokemon TCG (Fusion Strike)', 1).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 180, askingSampleSize: 12 } },
          { position: 3, suggestion: sourceCandidate('Pikachu ex Surging Sparks 238', 'Pokemon TCG (Surging Sparks)', 2).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 180, askingSampleSize: 12 } }
        ]
      }
    ];

    const ordered = preferFreshWeeklyCandidatesAgainstRecentShelves([mewCandidate, pikachuCandidate], recentDrops);

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Pikachu Expedition Base Set 124',
      'Mew Expedition Base Set 19'
    ]);
  });

  it('keeps niche same-subject promos ahead of ordinary same-subject callbacks when recent shelves already leaned on that subject', () => {
    const nichePromo = sourceCandidate('Gardevoir Nintendo Promo 024/P Japanese', 'TCGdex Japanese (Promos)', 0);
    nichePromo.suggestion.sourceTasteTokens = ['gardevoir', 'japanese', 'promo', 'exclusive'];
    const ordinaryCallback = sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 1);
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W27',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-06-30T00:00:00.000Z',
        generatedAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        marketReadyCount: 2,
        imageReadyCount: 2,
        itemCount: 2,
        items: [
          {
            position: 1,
            suggestion: sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 0).suggestion,
            market: { status: 'READY', currency: 'CAD', askingTotal: 180, askingSampleSize: 12 }
          },
          {
            position: 2,
            suggestion: sourceCandidate('Gardevoir ex Scarlet & Violet 245', 'Pokemon TCG (Scarlet & Violet)', 1).suggestion,
            market: { status: 'READY', currency: 'CAD', askingTotal: 160, askingSampleSize: 12 }
          }
        ]
      }
    ];

    const ordered = preferFreshWeeklyCandidatesAgainstRecentShelves([ordinaryCallback, nichePromo], recentDrops, ['Gardevoir ex Paldean Fates 233', 'Mew CoroCoro Promo 151'].map(chase));

    expect(ordered.map((item) => item.suggestion.name)).toEqual([
      'Gardevoir Nintendo Promo 024/P Japanese',
      'Gardevoir ex Paldean Fates 233'
    ]);
  });

  it('caps exact repeats from recent shelves when enough fresh weekly alternatives exist', () => {
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        marketReadyCount: 3,
        imageReadyCount: 3,
        itemCount: 3,
        items: [
          { position: 1, suggestion: sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 0).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 2, suggestion: sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 1).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 3, suggestion: sourceCandidate('Umbreon XY Black Star Promos XY96', 'Pokemon TCG (XY Black Star Promos)', 2).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } }
        ]
      }
    ];
    const ordered = preferFreshWeeklyCandidatesAgainstRecentShelves([
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0),
      sourceCandidate('Articuno Skyridge 4', 'Pokemon TCG (Skyridge)', 1),
      sourceCandidate('Moltres Skyridge 21', 'Pokemon TCG (Skyridge)', 2),
      sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 3),
      sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 4),
      sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 5),
      sourceCandidate('Umbreon XY Black Star Promos XY96', 'Pokemon TCG (XY Black Star Promos)', 6)
    ], recentDrops, ['Mew RC24', 'Pikachu XY95', 'Umbreon 217/187', 'Squirtle 007/018'].map(chase));

    const selected = selectNovelWeeklyCandidates(ordered, recentDrops, 4, ['Mew RC24', 'Pikachu XY95', 'Umbreon 217/187', 'Squirtle 007/018'].map(chase));

    expect(selected.map((item) => item.suggestion.name)).toEqual([
      'Zapdos Aquapolis 44',
      'Articuno Skyridge 4',
      'Moltres Skyridge 21',
      'Squirtle Expedition Base Set 132'
    ]);
  });

  it('keeps a weekly shelf full by allowing limited older callbacks only after fresh options are exhausted', () => {
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        marketReadyCount: 4,
        imageReadyCount: 4,
        itemCount: 4,
        items: [
          { position: 1, suggestion: sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 0).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 2, suggestion: sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 1).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 3, suggestion: sourceCandidate('Umbreon XY Black Star Promos XY96', 'Pokemon TCG (XY Black Star Promos)', 2).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 4, suggestion: sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 3).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } }
        ]
      }
    ];
    const ordered = preferFreshWeeklyCandidatesAgainstRecentShelves([
      sourceCandidate('Articuno Skyridge 4', 'Pokemon TCG (Skyridge)', 0),
      sourceCandidate('Moltres Skyridge 21', 'Pokemon TCG (Skyridge)', 1),
      sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 2),
      sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 3),
      sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 4),
      sourceCandidate('Umbreon XY Black Star Promos XY96', 'Pokemon TCG (XY Black Star Promos)', 5),
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 6)
    ], recentDrops, ['Mew RC24', 'Pikachu XY95', 'Umbreon 217/187', 'Squirtle 007/018'].map(chase));

    const selected = selectNovelWeeklyCandidates(ordered, recentDrops, 6, ['Mew RC24', 'Pikachu XY95', 'Umbreon 217/187', 'Squirtle 007/018'].map(chase));

    expect(selected).toHaveLength(6);
    expect(selected.map((item) => item.suggestion.name)).toEqual(expect.arrayContaining([
      'Articuno Skyridge 4',
      'Moltres Skyridge 21',
      'Squirtle Expedition Base Set 132'
    ]));
    expect(selected.filter((item) => ['Mew Expedition Base Set 19', 'Pikachu Skyridge 84', 'Umbreon XY Black Star Promos XY96', 'Zapdos Aquapolis 44'].includes(item.suggestion.name)).length).toBeLessThanOrEqual(3);
  });

  it('caps recent-subject overlap when enough fresh weekly alternatives exist', () => {
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        marketReadyCount: 4,
        imageReadyCount: 4,
        itemCount: 4,
        items: [
          { position: 1, suggestion: sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 0).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 2, suggestion: sourceCandidate('Squirtle McDonalds Promo 007/018 Japanese', 'TCGdex Japanese (McDonalds Collection)', 1).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 3, suggestion: sourceCandidate('Squirtle 151 170', 'Pokemon TCG (151)', 2).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 4, suggestion: sourceCandidate('Squirtle Expedition Base Set 131', 'Pokemon TCG (Expedition Base Set)', 3).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } }
        ]
      }
    ];

    const selected = selectNovelWeeklyCandidates([
      sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 0),
      sourceCandidate('Squirtle Expedition Base Set 131', 'Pokemon TCG (Expedition Base Set)', 1),
      sourceCandidate('Squirtle 151 170', 'Pokemon TCG (151)', 2),
      sourceCandidate('Squirtle McDonalds Promo 007/018 Japanese', 'TCGdex Japanese (McDonalds Collection)', 3),
      sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 4),
      sourceCandidate('Pikachu Skyridge 84', 'Pokemon TCG (Skyridge)', 5),
      sourceCandidate('Umbreon BW Black Star Promos BW93', 'Pokemon TCG (BW Black Star Promos)', 6),
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 7),
      sourceCandidate('Articuno Wizards Black Star Promos 48', 'Pokemon TCG (Wizards Black Star Promos)', 8),
      sourceCandidate('Moltres Skyridge 21', 'Pokemon TCG (Skyridge)', 9)
    ], recentDrops, 6, ['Squirtle 007/018', 'Mew RC24', 'Umbreon 217/187', 'Pikachu XY95'].map(chase));

    expect(selected.filter((item) => /squirtle/i.test(item.suggestion.name)).length).toBeLessThanOrEqual(2);
  });

  it('surfaces universe cards that match the collector profile instead of unrelated global cards', () => {
    upsertDiscoveryUniverseCard({
      canonicalName: 'Gardevoir Nintendo Promo 019/P Japanese',
      suggestion: {
        name: 'Gardevoir Nintendo Promo 019/P Japanese',
        lane: 'Japanese Collector Trail',
        laneWhy: 'source-backed collector promo',
        why: 'A niche Japanese promo linked by prior source-backed discovery context',
        nearby: [],
        referenceSourceName: 'TCGdex Japanese (Promos)',
        sourceTasteTokens: ['gardevoir', 'japanese', 'promo']
      },
      sourceName: 'TCGdex Japanese (Promos)',
      imageUrl: 'https://images.example/gardevoir-promo.png',
      imageSourceName: 'TCGdex Japanese (Promos)',
      subjectTokens: ['gardevoir'],
      traitTokens: ['promo', 'japanese'],
      marketTotal: 65,
      marketCurrency: 'CAD'
    });
    upsertDiscoveryUniverseCard({
      canonicalName: 'Dialga Japanese Promo 005/PPP',
      suggestion: {
        name: 'Dialga Japanese Promo 005/PPP',
        lane: 'Japanese Collector Trail',
        laneWhy: 'source-backed collector promo',
        why: 'Another niche Japanese promo',
        nearby: [],
        referenceSourceName: 'TCGdex Japanese (Promos)',
        sourceTasteTokens: ['dialga', 'japanese', 'promo']
      },
      sourceName: 'TCGdex Japanese (Promos)',
      imageUrl: 'https://images.example/dialga-promo.png',
      imageSourceName: 'TCGdex Japanese (Promos)',
      subjectTokens: ['dialga'],
      traitTokens: ['promo', 'japanese'],
      marketTotal: 70,
      marketCurrency: 'CAD'
    });

    const selected = __discoveryPersistenceTestHooks.selectDiscoveryUniverseCandidatesForProfile(
      ['Gardevoir ex Paldean Fates 233', 'Mew CoroCoro Promo 151'].map(chase),
      [],
      5
    );

    expect(selected.map((item) => item.suggestion.name)).toContain('Gardevoir Nintendo Promo 019/P Japanese');
    expect(selected.map((item) => item.suggestion.name)).not.toContain('Dialga Japanese Promo 005/PPP');
  });

  it('lets universe cards ride source-backed taste tokens beyond exact subject overlap', () => {
    upsertDiscoveryUniverseCard({
      canonicalName: 'Blastoise Classic Collection 003/025',
      suggestion: {
        name: 'Blastoise Classic Collection 003/025',
        lane: 'Set Companion Trail',
        laneWhy: 'source-backed profile companion',
        why: 'A concrete follow-up card remembered from adjacent collector context',
        nearby: [],
        referenceSourceName: 'Pokemon TCG (Celebrations: Classic Collection)',
        sourceTasteTokens: ['squirtle', 'starter', 'classic collection']
      },
      sourceName: 'Pokemon TCG (Celebrations: Classic Collection)',
      imageUrl: 'https://images.example/blastoise-classic.png',
      imageSourceName: 'Pokemon TCG (Celebrations: Classic Collection)',
      subjectTokens: ['blastoise'],
      traitTokens: ['modern'],
      marketTotal: 28,
      marketCurrency: 'CAD'
    });

    const selected = __discoveryPersistenceTestHooks.selectDiscoveryUniverseCandidatesForProfile(
      ['Squirtle 007/018 Japanese Promo', 'Mew RC24'].map(chase),
      [],
      5
    );

    expect(selected.map((item) => item.suggestion.name)).toContain('Blastoise Classic Collection 003/025');
  });

  it('builds a broad canonical-universe parent set from profile threads, Japanese signals, and global backfill parents', () => {
    const parents = __discoveryPersistenceTestHooks.canonicalUniverseSeedParents(
      [
        'Umbreon ex SAR Terastal Festival Japanese 217/187',
        'Corocoro Shining Mew',
        'Pikachu 26/83 Toys R Us promo',
        'Squirtle 007/018 McDonalds e-Reader Promo'
      ].map(chase),
      40
    );

    expect(parents.length).toBeGreaterThanOrEqual(20);
    expect(parents.map((item) => item.name)).toEqual(expect.arrayContaining([
      'Pokemon promo cards',
      'Pokemon illustration rare cards',
      'Umbreon Japanese unique release Pokemon cards',
      'Umbreon Japanese special set Pokemon cards'
    ]));
  });
});

describe('composeWeeklyShelfCandidates', () => {
  it('reserves room for adjacent and era-pivot cards while capping modern density', () => {
    const chases = ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo'].map(chase);
    const candidates = [
      sourceCandidate('Pikachu ex Surging Sparks 238', 'Pokemon TCG (Surging Sparks)', 0),
      sourceCandidate('Mew ex Paldean Fates 216', 'Pokemon TCG (Paldean Fates)', 1),
      sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 2),
      sourceCandidate('Articuno Journey Together 161', 'Pokemon TCG (Journey Together)', 3),
      sourceCandidate('Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese', 'TCGdex Japanese (S6a)', 4),
      sourceCandidate('Mew VMAX Fusion Strike 269', 'Pokemon TCG (Fusion Strike)', 5),
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 6),
      sourceCandidate('Rocket\'s Moltres Gym Heroes 12', 'Pokemon TCG (Gym Heroes)', 7),
      sourceCandidate('Sylveon Terastal Festival Pokemon cards', 'TCGdex Japanese (SV8a)', 8),
      sourceCandidate('Mew Expedition Base Set 19', 'Pokemon TCG (Expedition Base Set)', 9),
      sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 10),
      sourceCandidate('Blaine\'s Moltres Gym Heroes 1', 'Pokemon TCG (Gym Heroes)', 11)
    ];
    candidates[8] = {
      ...candidates[8],
      suggestion: {
        ...candidates[8].suggestion,
        lane: 'Set Companion Trail',
        sourceTasteTokens: ['sylveon', 'japanese', 'Terastal Festival', 'special set', 'small set', 'numbered set']
      }
    };

    const composed = composeWeeklyShelfCandidates(candidates, chases, 12);
    const names = composed.map((item) => item.suggestion.name);
    const modernCount = names.filter((name) => /surging sparks|paldean fates|journey together|fusion strike|eevee heroes/i.test(name)).length;

    expect(names).toContain('Sylveon Terastal Festival Pokemon cards');
    expect(names).toContain('Zapdos Aquapolis 44');
    expect(modernCount).toBeLessThanOrEqual(4);
  });
});

describe('selectDiscoveryUserUniverseCandidatesFromEntries', () => {
  it('diversifies a user-ranked index before taking the final shelf slice', () => {
    const chases = [
      'Squirtle 007/018 McDonalds Promo Japanese',
      'Mew RC24 Legendary Treasures',
      'Umbreon ex SAR Terastal Festival Japanese 217/187',
      'Gardevoir ex 233/091 Paldean Fates'
    ].map(chase);
    const entries = [
      userUniverseCard('Squirtle Expedition Base Set 131', 120, '2026-07-15T00:00:00.000Z', 'Pokemon TCG (Expedition Base Set)'),
      userUniverseCard('Squirtle Expedition Base Set 132', 119, '2026-07-15T00:00:01.000Z', 'Pokemon TCG (Expedition Base Set)'),
      userUniverseCard('Squirtle 007/018 McDonalds Promo Japanese', 118, '2026-07-15T00:00:02.000Z', 'Pokemon Japanese Promo'),
      userUniverseCard('Dark Blastoise Team Rocket 3', 117, '2026-07-15T00:00:03.000Z', 'Pokemon TCG (Team Rocket)'),
      userUniverseCard('Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese', 111, '2026-07-15T00:00:04.000Z', 'TCGdex Japanese (S6a)'),
      userUniverseCard('Gardevoir ex Paldean Fates 233', 110, '2026-07-15T00:00:05.000Z', 'Pokemon TCG (Paldean Fates)'),
      userUniverseCard('Mew Expedition Base Set 19', 109, '2026-07-15T00:00:06.000Z', 'Pokemon TCG (Expedition Base Set)'),
      userUniverseCard('Zapdos Aquapolis 44', 108, '2026-07-15T00:00:07.000Z', 'Pokemon TCG (Aquapolis)')
    ];

    const selected = __discoveryPersistenceTestHooks.selectDiscoveryUserUniverseCandidatesFromEntries(entries, [], 4, chases, chases);
    const names = selected.map((item) => item.suggestion.name);
    const squirtleCount = names.filter((name) => /squirtle/i.test(name)).length;

    expect(names).toHaveLength(4);
    expect(squirtleCount).toBeLessThanOrEqual(2);
    expect(names).toContain('Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese');
    expect(
      names.some((name) => /gardevoir|mew|zapdos/i.test(name))
    ).toBe(true);
  });
});

describe('buildFreshWeeklyShelfFromPool', () => {
  it('prefers a substantially fresh weekly shelf before allowing fallback repeats', () => {
    const recentDrops: ScheduledDiscoveryDrop[] = [
      {
        userId: 'u1',
        dropType: 'WEEKLY_DISCOVERY',
        periodKey: '2026-W28',
        status: 'READY',
        title: 'Weekly Shelf',
        currency: 'CAD',
        availableAt: '2026-07-07T00:00:00.000Z',
        generatedAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        marketReadyCount: 6,
        imageReadyCount: 6,
        itemCount: 6,
        items: [
          { position: 1, suggestion: sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 0).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 2, suggestion: sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 1).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 3, suggestion: sourceCandidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Pokemon TCG (SM Black Star Promos)', 2).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 4, suggestion: sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 3).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 5, suggestion: sourceCandidate('Team Rocket\'s Moltres ex Destined Rivals 229', 'Pokemon TCG (Destined Rivals)', 4).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } },
          { position: 6, suggestion: sourceCandidate('Giovanni\'s Meowth Gym Challenge 74', 'Pokemon TCG (Gym Challenge)', 5).suggestion, market: { status: 'READY', currency: 'CAD', askingTotal: 100, askingSampleSize: 12 } }
        ]
      }
    ];
    const chases = ['Mew RC24', 'Umbreon 217/187', 'Squirtle 007/018', 'Gardevoir ex 233/091'].map(chase);
    const pool = [
      sourceCandidate('Zapdos Aquapolis 44', 'Pokemon TCG (Aquapolis)', 0),
      sourceCandidate('Articuno Skyridge 4', 'Pokemon TCG (Skyridge)', 1),
      sourceCandidate('Moltres Skyridge 21', 'Pokemon TCG (Skyridge)', 2),
      sourceCandidate('Squirtle Expedition Base Set 132', 'Pokemon TCG (Expedition Base Set)', 3),
      sourceCandidate('Gardevoir 408/SM-P PROMO Limited Illustration Promo Pokemon Card Japanese', 'Pokemon Japanese Promo', 4),
      sourceCandidate('Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese', 'TCGdex Japanese (S6a)', 5),
      sourceCandidate('Team Rocket\'s Mewtwo ex Ascended Heroes 281', 'Pokemon TCG (Ascended Heroes)', 6),
      sourceCandidate('Pikachu Expedition Base Set 124', 'Pokemon TCG (Expedition Base Set)', 7),
      sourceCandidate('Gardevoir ex Paldean Fates 233', 'Pokemon TCG (Paldean Fates)', 8),
      sourceCandidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Pokemon TCG (SM Black Star Promos)', 9),
      sourceCandidate('Mew Japanese S12a 183', 'TCGdex Japanese (S12a)', 10),
      sourceCandidate('Team Rocket\'s Moltres ex Destined Rivals 229', 'Pokemon TCG (Destined Rivals)', 11)
    ];

    const selected = __discoveryPersistenceTestHooks.buildFreshWeeklyShelfFromPool([], pool, recentDrops, 6, chases);
    const names = selected.map((item) => item.suggestion.name);
    const repeatedFromW28 = names.filter((name) => recentDrops[0].items.some((item) => item.suggestion.name === name));

    expect(names).toHaveLength(6);
    expect(repeatedFromW28).toHaveLength(0);
    expect(names).toEqual(expect.arrayContaining([
      'Zapdos Aquapolis 44',
      'Articuno Skyridge 4',
      'Moltres Skyridge 21',
      'Squirtle Expedition Base Set 132'
    ]));
  });
});

describe('weeklyJapaneseSignalTargetCount', () => {
  it('keeps weekly Japanese texture as a supporting signal rather than taking over the shelf', () => {
    const chases = [
      'Umbreon ex SAR Terastal Festival Japanese 217/187',
      'Mew Japanese S12a 052',
      'Squirtle Expedition Base Set 132',
      'Gardevoir ex Paldean Fates 233'
    ].map(chase);

    expect(__discoveryPersistenceTestHooks.weeklyJapaneseSignalTargetCount(chases, 20)).toBeLessThanOrEqual(3);
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

  it('can preserve a prepared weekly shelf order even when a later ranking would reshuffle page boundaries', () => {
    const ranked = [
      candidate('Mewtwo & Mew-GX SM Black Star Promos SM191', 'Promo Trail', 0),
      candidate('Umbreon & Darkrai-GX SM Black Star Promos SM241', 'Promo Trail', 1),
      candidate('Team Rocket\'s Mewtwo ex Ascended Heroes 281', 'Format Trail', 2),
      candidate('Pikachu Expedition Base Set 124', 'Vintage Era Trail', 3),
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 4),
      candidate('Giovanni\'s Meowth Gym Challenge 74', 'Vintage Era Trail', 5),
      candidate('Articuno Japanese SV9 102/100', 'Japanese Collector Trail', 6),
      candidate('Squirtle Stellar Crown 148', 'Modern Spotlight Trail', 7),
      candidate('Gardevoir ex Paldean Fates 233', 'Modern Spotlight Trail', 8),
      candidate('Mew Japanese S12a 183', 'Japanese Collector Trail', 9),
      candidate('Blaine\'s Moltres Gym Heroes 1', 'Vintage Era Trail', 10),
      candidate('Articuno Skyridge 4', 'Vintage Era Trail', 11),
      candidate('Zapdos Aquapolis H32', 'Vintage Era Trail', 12),
      candidate('Gardevoir ex Scarlet & Violet 245', 'Modern Spotlight Trail', 13),
      candidate('Mew ex Paldean Fates 216', 'Modern Spotlight Trail', 14),
      candidate('Team Rocket\'s Moltres ex Destined Rivals 229', 'Modern Spotlight Trail', 15),
      candidate('Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese', 'Japanese Collector Trail', 16),
      candidate('Umbreon XY Black Star Promos XY96', 'Promo Trail', 17),
      candidate('Gardevoir Nintendo Promo 024/P Japanese', 'Promo Trail', 18),
      candidate('Mew Expedition Base Set 19', 'Vintage Era Trail', 19)
    ];

    const persisted = [
      'Pikachu Expedition Base Set 124',
      'Gardevoir ex Paldean Fates 233',
      'Umbreon & Darkrai-GX SM Black Star Promos SM241',
      'Mew Japanese S12a 183',
      'Team Rocket\'s Moltres ex Destined Rivals 229',
      'Giovanni\'s Meowth Gym Challenge 74',
      'Articuno Japanese SV9 102/100',
      'Squirtle Stellar Crown 148',
      'Gardevoir ex Scarlet & Violet 245',
      'Team Rocket\'s Mewtwo ex Ascended Heroes 281',
      'Gardevoir Nintendo Promo 024/P Japanese',
      'Mewtwo & Mew-GX SM Black Star Promos SM191',
      'Pikachu Skyridge 84',
      'Blaine\'s Moltres Gym Heroes 1',
      'Mew Expedition Base Set 19',
      'Articuno Skyridge 4',
      'Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese',
      'Zapdos Aquapolis H32',
      'Umbreon XY Black Star Promos XY96',
      'Mew ex Paldean Fates 216'
    ];

    const ordered = orderCandidatesFromPersistedState(ranked, persisted, 20);

    expect(ordered.slice(10, 13).map((item) => item.suggestion.name)).toEqual([
      'Gardevoir Nintendo Promo 024/P Japanese',
      'Mewtwo & Mew-GX SM Black Star Promos SM191',
      'Pikachu Skyridge 84'
    ]);
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

  it('hard-excludes seen weekly cards from persisted and refill slots', () => {
    const ranked = [
      candidate('Umbreon Skyridge 32', 'Vintage Era Trail', 0),
      candidate('Pikachu Skyridge 84', 'Vintage Era Trail', 1),
      candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 2)
    ];

    const ordered = orderCandidatesFromPersistedState(
      ranked,
      ['Umbreon Skyridge 32', 'Pikachu Skyridge 84'],
      2,
      { hardExcludedNames: ['Umbreon Skyridge 32'] }
    );

    expect(ordered.map((item) => item.suggestion.name)).toEqual(['Pikachu Skyridge 84', 'Mew Japanese S12a 052']);
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

describe('profileVariantSourceBackfillParents', () => {
  it('builds same-subject release variant parents from the taste profile', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Corocoro Shining Mew', 'Pikachu xy95', 'Umbreon 217/187 Japanese'].map(chase),
      60
    );
    const names = parents.map((suggestion) => suggestion.name);

    expect(names).toEqual(expect.arrayContaining(['Mew Pokemon promo cards', 'Pikachu e-reader Pokemon cards', 'Umbreon illustration rare Pokemon cards']));
    expect(names.some((name) => /deoxys/i.test(name))).toBe(false);
    expect(parents.every((suggestion) => suggestion.requiredEvidenceTokens && suggestion.requiredEvidenceTokens.length >= 2)).toBe(true);
  });

  it('builds cross-trait retail e-reader promo parents from grail-shaped profile signals', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Squirtle 007/018 McDonalds e-Reader Promo', 'Pikachu xy95', 'Pikachu 26/83 Toys R Us promo'].map(chase),
      80
    );

    expect(parents.map((suggestion) => suggestion.name)).toContain("Pikachu McDonald's e-Reader promo Pokemon cards");
    expect(parents.find((suggestion) => suggestion.name === "Pikachu McDonald's e-Reader promo Pokemon cards")?.requiredEvidenceTokens).toEqual(['pikachu', 'promo', 'e-reader', 'mcdonalds']);
  });

  it('builds Japanese unique release parents only from direct profile subjects', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Umbreon 217/187 Japanese'].map(chase),
      80
    );

    expect(parents.map((suggestion) => suggestion.name)).toContain('Mew Japanese unique release Pokemon cards');
    expect(parents.map((suggestion) => suggestion.name)).toContain('Pikachu Japanese unique release Pokemon cards');
    expect(parents.map((suggestion) => suggestion.name)).not.toContain('Raichu Japanese unique release Pokemon cards');
    expect(parents.find((suggestion) => suggestion.name === 'Mew Japanese unique release Pokemon cards')?.requiredEvidenceTokens).toEqual(['mew', 'japanese', 'exclusive', 'unique']);
  });

  it('builds Japanese special set parents from Japanese plus special-release signals', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Corocoro Shining Mew', 'Pikachu 26/83 Toys R Us promo', 'Umbreon 217/187 Japanese'].map(chase),
      80
    );

    expect(parents.map((suggestion) => suggestion.name)).toContain('Mew Japanese special set Pokemon cards');
    expect(parents.map((suggestion) => suggestion.name)).toContain('Pikachu Japanese special set Pokemon cards');
    expect(parents.map((suggestion) => suggestion.name)).not.toContain('Raichu Japanese special set Pokemon cards');
    expect(parents.find((suggestion) => suggestion.name === 'Mew Japanese special set Pokemon cards')?.requiredEvidenceTokens).toEqual(['mew', 'japanese', 'special set', 'small set', 'numbered set']);
  });

  it('builds same-set sibling parents for special-set collector chases', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Pikachu 26/83 Toys R Us promo'].map(chase),
      80
    );

    expect(parents.map((suggestion) => suggestion.name)).toContain('Sylveon Terastal Festival Pokemon cards');
    expect(parents.find((suggestion) => suggestion.name === 'Sylveon Terastal Festival Pokemon cards')?.requiredEvidenceTokens).toEqual([
      'sylveon',
      'japanese',
      'Terastal Festival',
      'special set',
      'small set',
      'numbered set'
    ]);
  });

  it('learns CoroCoro as a reusable publication-promo pattern across profile subjects', () => {
    const parents = profileVariantSourceBackfillParents(
      ['Corocoro Shining Mew', 'Pikachu xy95', 'Umbreon 217/187 Japanese'].map(chase),
      80
    );
    const pikachuCoroCoro = parents.find((suggestion) => suggestion.name === 'Pikachu CoroCoro promo Pokemon cards');

    expect(parents.map((suggestion) => suggestion.name)).toContain('Mew CoroCoro promo Pokemon cards');
    expect(pikachuCoroCoro?.requiredEvidenceTokens).toEqual(['pikachu', 'corocoro']);
    expect(pikachuCoroCoro?.sourceTasteTokens).toEqual(['pikachu', 'japanese', 'promo', 'corocoro', 'magazine']);
    expect(pikachuCoroCoro?.evidenceAliases).toContain('pikachu corocoro');
    expect(parents.map((suggestion) => suggestion.name)).not.toContain('Raichu CoroCoro promo Pokemon cards');
  });
});

describe('backfillSourceBackedDiscoverySuggestions', () => {
  it('fills a one-card seed shelf from safe catalog suggestions when source-backed resolution is sparse', () => {
    const sourceBacked = [sourceCandidate('Gardevoir ex Scarlet & Violet 245', 'Pokemon TCG (Scarlet & Violet)', 0).suggestion];
    const catalogSuggestions = [
      candidate('Gardevoir illustration rare cards', 'illustration rare path', 1).suggestion,
      candidate('Kirlia illustration rare cards', 'evolution line path', 2).suggestion,
      candidate('Ralts illustration rare cards', 'evolution line path', 3).suggestion,
      candidate('Psychic type full art cards', 'psychic collection path', 4).suggestion,
      candidate('Scarlet & Violet special illustration cards', 'modern texture path', 5).suggestion,
      candidate('Trainer gallery psychic cards', 'art gallery path', 6).suggestion,
      candidate('Mew illustration rare cards', 'mythical art path', 7).suggestion,
      candidate('Mimikyu illustration rare cards', 'ghost psychic path', 8).suggestion,
      candidate('Sylveon full art cards', 'soft color path', 9).suggestion
    ];

    const backfilled = backfillDiscoverySuggestions(sourceBacked, catalogSuggestions, [], 10);

    expect(backfilled).toHaveLength(10);
    expect(backfilled.at(0)?.name).toBe('Gardevoir ex Scarlet & Violet 245');
    expect(backfilled.at(-1)?.name).toBe('Sylveon full art cards');
  });

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

  it('rejects jumbo promo listings as market samples for normal cards', () => {
    const umbreonPromoSuggestion = {
      name: 'Umbreon-GX SM Black Star Promos SM36',
      lane: 'Promo Trail',
      laneWhy: 'specific card source match',
      why: 'specific card source match',
      nearby: [],
      evidenceSearchTerm: 'Umbreon-GX SM Black Star Promos SM36 Pokemon card',
      evidenceAliases: ['Umbreon-GX SM Black Star Promos SM36'],
      requiredEvidenceTokens: ['umbreon', 'sm36']
    };
    const jumboListing = listing({
      title: 'Pokemon Jumbo Card Umbreon GX SM36 Black Star Promo Oversized Card 2017',
      price: 49.7
    });

    expect(isUsableDiscoveryExample(umbreonPromoSuggestion, jumboListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(umbreonPromoSuggestion, jumboListing)).toBe(false);
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

  it('rejects damaged raw condition outliers from baseline market samples', () => {
    const damagedListing = listing({
      title: 'Pikachu ex 238/191 Surging Sparks SIR Pokemon Card Damaged Creased',
      price: 85,
      condition: 'Damaged'
    });

    expect(looksLikeRawCardListing(damagedListing)).toBe(true);
    expect(looksLikeBaselineRawMarketListing(damagedListing)).toBe(false);
  });

  it('uses a robust median that ignores extreme raw market outliers', () => {
    expect(typicalMarketTotal([440, 450, 455, 460, 465, 470, 1200])).toBe(457.5);
    expect(typicalMarketTotal([0, Number.NaN, 110, 115, 120, 125, 600])).toBe(120);
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

  it('accepts compact Pikachu 010/018 listings as McDonalds e-reader market samples', () => {
    const pikachu010Suggestion = {
      name: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese",
      lane: 'Retail Promo Trail',
      laneWhy: 'same-subject retail e-reader promo variants',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Pokemon card",
      evidenceAliases: ['Pikachu 010/018'],
      requiredEvidenceTokens: ['pikachu', '010', '018']
    };
    const compactListing = listing({
      title: "Pikachu 010/018 Holo McDonald's Promo Pokemon Card Japanese E-Series 2002",
      price: 780,
      condition: 'Ungraded'
    });

    expect(isUsableDiscoveryMarketSample(pikachu010Suggestion, compactListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryExample(pikachu010Suggestion, compactListing, { min: 0, max: 1200 }, 'CAD')).toBe(true);
  });

  it('accepts CoroCoro publication listings even when sellers omit promo and Japanese wording', () => {
    const pikachuCoroCoroSuggestion = {
      name: 'Pikachu CoroCoro promo Pokemon cards',
      lane: 'Japanese Collector Trail',
      laneWhy: 'Japanese magazine-promo publication signals',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'pikachu CoroCoro promo Pokemon card cards',
      evidenceAliases: ['pikachu Pokemon card', 'pikachu corocoro', 'pikachu CoroCoro promo Pokemon cards'],
      requiredEvidenceTokens: ['pikachu', 'corocoro'],
      sourceTasteTokens: ['pikachu', 'japanese', 'promo', 'corocoro', 'magazine']
    };
    const coroCoroListing = listing({
      title: 'Pikachu, Jigglypuff, and Clefairy CoroCoro Pokemon Card',
      price: 96,
      condition: 'Ungraded'
    });

    expect(isUsableDiscoveryMarketSample(pikachuCoroCoroSuggestion, coroCoroListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryExample(pikachuCoroCoroSuggestion, coroCoroListing, { min: 0, max: 1200 }, 'CAD')).toBe(true);
  });

  it('accepts Mew S12a 052 listings when set and number appear in either order', () => {
    const mewS12aSuggestion = {
      name: 'Mew Japanese S12a 052',
      lane: 'Japanese Collector Trail',
      laneWhy: 'Japanese-language profile signal',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'Mew Japanese Pokemon card S12a 052',
      evidenceAliases: ['Mew Japanese S12a 052'],
      requiredEvidenceTokens: ['mew-s12a-052', 'japanese']
    };
    const numberFirstListing = listing({
      title: 'Mew 052/172 Reverse Holo s12a VSTAR Universe Japanese Pokemon Card',
      price: 7,
      condition: 'Ungraded'
    });
    const setFirstListing = listing({
      title: 'Mew S12a: VSTAR Universe 052/172 Pokemon Card Holo JP',
      price: 9,
      condition: 'Ungraded'
    });
    const japaneseSetCodeListing = listing({
      title: 'Mew Holo S12A VSTAR Universe 052/172 Pokemon Card NM',
      price: 8,
      condition: 'Ungraded'
    });
    const gradedListing = listing({
      title: 'PSA 10 Gem Mint S12a 052/172 Mew VSTAR Universe Japanese JP Pokemon Card Game',
      price: 120,
      condition: 'Graded'
    });
    const wrongNumberListing = listing({
      title: 'Pokemon Card PSA10 Mew s12a 183/172 AR 2022 Japanese',
      price: 565,
      condition: 'Graded'
    });

    expect(isUsableDiscoveryMarketSample(mewS12aSuggestion, numberFirstListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(mewS12aSuggestion, setFirstListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(mewS12aSuggestion, japaneseSetCodeListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(mewS12aSuggestion, gradedListing, 'CAD')).toBe(false);
    expect(isUsableDiscoveryMarketSample(mewS12aSuggestion, wrongNumberListing, 'CAD')).toBe(false);
  });

  it('accepts Raichu No.026 Intro Pack Bulbasaur Deck listings as niche Japanese market samples', () => {
    const raichuIntroSuggestion = {
      name: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese',
      lane: 'Japanese Collector Trail',
      laneWhy: 'Japanese exclusiveness and unusual-release signals',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
      evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
      requiredEvidenceTokens: ['raichu', '026', 'bulbasaur']
    };
    const introPackListing = listing({
      title: 'Raichu No.026 - Intro pack bulbasaur deck - Japanese - MP',
      price: 515,
      condition: 'Ungraded - Very good'
    });
    const numberedIntroPackListing = listing({
      title: 'Raichu No. 026 3 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card',
      price: 430,
      condition: 'Ungraded'
    });
    const deckNumberIntroPackListing = listing({
      title: 'Raichu #3 Non-Holo VHS Promo Bulbasaur Deck 1999 Japanese Pokemon LP',
      price: 395,
      condition: 'Ungraded'
    });
    const no03IntroPackListing = listing({
      title: 'Pokemon Card Raichu VHS Intro Pack Bulbasaur Deck No.03 LP Japanese',
      price: 375,
      condition: 'Ungraded'
    });
    const modern151Listing = listing({
      title: 'Raichu 026/165 Sv2a Pokemon Card 151 Japanese Near Mint',
      price: 5,
      condition: 'Ungraded'
    });
    const wrongSpeciesListing = listing({
      title: 'Venusaur No.003 Intro Pack Bulbasaur Deck Japanese Pokemon Card',
      price: 420,
      condition: 'Ungraded'
    });
    const pairListing = listing({
      title: 'Pikachu No.025 Raichu No.026 Intro Pack 2set old back Japanese Pokemon Card 1999',
      price: 680,
      condition: 'Ungraded'
    });

    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, introPackListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, numberedIntroPackListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, deckNumberIntroPackListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, no03IntroPackListing, 'CAD')).toBe(true);
    expect(isUsableDiscoveryExample(raichuIntroSuggestion, introPackListing, { min: 0, max: 700 }, 'CAD')).toBe(true);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, modern151Listing, 'CAD')).toBe(false);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, wrongSpeciesListing, 'CAD')).toBe(false);
    expect(isUsableDiscoveryMarketSample(raichuIntroSuggestion, pairListing, 'CAD')).toBe(false);
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
  const originalAffiliateCampaignId = process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
  const originalAffiliateCustomId = process.env.EBAY_AFFILIATE_CUSTOM_ID;
  const restoreAffiliateEnv = () => {
    if (originalAffiliateCampaignId === undefined) delete process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
    else process.env.EBAY_AFFILIATE_CAMPAIGN_ID = originalAffiliateCampaignId;
    if (originalAffiliateCustomId === undefined) delete process.env.EBAY_AFFILIATE_CUSTOM_ID;
    else process.env.EBAY_AFFILIATE_CUSTOM_ID = originalAffiliateCustomId;
  };

  afterEach(restoreAffiliateEnv);

  it('hides market read for limited Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Fits', 'Collector Cue']);
  });

  it('links every shelf card title to an eBay search when no listing is attached', () => {
    delete process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false, 19).toJSON();

    expect(embed.url).toBe('https://www.ebay.ca/sch/i.html?_nkw=Mew%20Southern%20Islands%20Pokemon%20card');
  });

  it('uses an eBay search URL even when a specific listing is attached', () => {
    delete process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 4),
        listing: listing({ url: 'https://www.ebay.ca/itm/1234567890' })
      },
      'CAD',
      true,
      1
    ).toJSON();

    expect(embed.url).toBe('https://www.ebay.ca/sch/i.html?_nkw=Mew%20Southern%20Islands%20Pokemon%20card');
  });

  it('uses cleaner collector-style eBay searches for Discovery promo cards', () => {
    delete process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
    const url = new URL(discoveryCardClickUrl(candidate('Gardevoir Nintendo Promo 024/P Japanese', 'Promo Trail', 0, 4), 'CAD', 11));

    expect(url.searchParams.get('_nkw')).toBe('Gardevoir 024/P Japanese Pokemon card');
  });

  it('can decorate Discovery eBay URLs with affiliate parameters when configured', () => {
    process.env.EBAY_AFFILIATE_CAMPAIGN_ID = 'campaign-123';
    process.env.EBAY_AFFILIATE_CUSTOM_ID = 'vaultr-discovery';

    const url = new URL(discoveryCardClickUrl(candidate('Pikachu 151 173', 'Collector Compass', 0, 4), 'USD', 3));

    expect(url.hostname).toBe('www.ebay.com');
    expect(url.searchParams.get('campid')).toBe('campaign-123');
    expect(url.searchParams.get('customid')).toBe('vaultr-discovery');
    expect(url.searchParams.get('mkevt')).toBe('1');
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

  it('does not present thin asking-only comps as a reliable market read', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Articuno Wizards Black Star Promos 48', 'Special Release Trail', 0),
        typicalRawAskingTotal: 433.95,
        marketSampleSize: 2,
        soldSampleSize: 0,
        displayCurrency: 'CAD'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Low recent comps data: only 2 active ask comps found, so Vaultr is not showing a price yet');
  });

  it('labels asking-only market reads as active asks', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Pikachu ex Surging Sparks 238', 'Collector Compass', 0),
        typicalRawAskingTotal: 469.225,
        marketSampleSize: 12,
        soldSampleSize: 0,
        displayCurrency: 'CAD'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('470 CAD active raw ask');
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
    expect(marketRead).toBe('Market data is updating. Pricing will appear once the source responds');
  });

  it('shows thin comp copy instead of updating copy when pending rows already have ask data', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Japanese S12a 052', 'Japanese Collector Trail', 0),
        sourceStatus: 'PENDING',
        typicalRawAskingTotal: 25,
        marketSampleSize: 2,
        displayCurrency: 'CAD'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Snapshot')?.value;
    expect(marketRead).toBe('Low recent comps data: only 2 active ask comps found, so Vaultr is not showing a price yet');
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
    expect(marketRead).toBe('Market data is updating. Image and pricing will appear once the source responds');
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
    expect(marketRead).toBe('Market data is still being gathered. Vaultr will keep checking');
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

  it('keeps promo format fit copy compact', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 0),
        suggestion: {
          ...sourceCandidate('Pikachu VMAX SWSH Black Star Promos SWSH286', 'Pokemon TCG (SWSH Black Star Promos)', 0).suggestion,
          evidenceSearchTerm: 'Pikachu VMAX SWSH Black Star Promos SWSH286 Pokemon card',
          sourceTasteTokens: ['promo', 'vmax']
        }
      },
      'CAD',
      true
    ).toJSON();

    const why = embed.fields?.find((field) => field.name === 'Why It Fits')?.value ?? '';
    expect(why).toContain('named promo release');
    expect(why).toContain('side-collection appeal');
    expect(why).not.toContain('\n');
    expect(why.length).toBeLessThan(120);
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

  it('uses broad Japanese unique-release cues for exact niche marketplace identities', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0, 1),
        suggestion: {
          ...candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 0, 1).suggestion,
          evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
          requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
          sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
        }
      },
      'CAD',
      true
    ).toJSON();

    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(signal).toContain('Japanese Prints');
    expect(signal).toContain('Unique Releases');
    expect(signal).not.toContain('Raichu Family');
    expect(signal).not.toContain('Intro Pack Family');
  });

  it('does not label modern Team Rocket named cards as Vintage Era', () => {
    const embed = discoveryEmbed(
      {
        ...sourceCandidate("Team Rocket's Mewtwo ex Ascended Heroes 281", 'Pokemon TCG (Ascended Heroes)', 0),
        suggestion: {
          ...sourceCandidate("Team Rocket's Mewtwo ex Ascended Heroes 281", 'Pokemon TCG (Ascended Heroes)', 0).suggestion,
          lane: 'visual-format discovery',
          evidenceSearchTerm: "Team Rocket's Mewtwo ex Ascended Heroes 281 Pokemon card",
          requiredEvidenceTokens: ['team', 'rocket', '281']
        }
      },
      'CAD',
      false
    ).toJSON();

    const signal = embed.fields?.find((field) => field.name === 'Collector Cue')?.value;
    expect(signal).toContain('Card Format');
    expect(signal).not.toContain('Vintage Era');
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
    expect(marketRead).toBe('Market data is temporarily limited by eBay. Vaultr will retry automatically');
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
    const japaneseEmbed = discoveryEmbed(candidate('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese', 'Japanese Collector Trail', 3), 'CAD', false).toJSON();

    expect(promoEmbed.description).toBe('◆ Promo Trail');
    expect(artworkEmbed.description).toBe('◇ Artwork Trail');
    expect(formatEmbed.description).toBe('◇ Format Trail');
    expect(japaneseEmbed.description).toBe('◇ Japanese Collector Trail');
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
  it('keeps prepared market data visible after a currency switch while refreshing the new currency', () => {
    const name = `Mew Southern Islands Currency Switch ${Date.now()}`;
    const usdCacheKey = discoveryMarketCacheKey(name, 'USD', 'CA');
    deleteDiscoveryMarketCache(usdCacheKey);
    deleteDiscoveryMarketRefreshJob(usdCacheKey);

    const [attached] = candidatesFromDiscoveryMarketCache(
      [
        {
          ...candidate(name, 'mythical display cards', 0),
          listing: listing({ listingId: 'currency-switch-listing', title: `${name} raw card`, price: 135, currency: 'CAD' }),
          typicalRawAskingTotal: 135,
          marketSampleSize: 5,
          typicalRawSoldTotal: 120,
          soldSampleSize: 3,
          displayCurrency: 'CAD'
        }
      ],
      {
        userId: 'currency-switch-user',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'USD',
        forceRefreshMissingSignal: true,
        forceRefreshThinSignal: true
      }
    );

    expect(attached?.displayCurrency).toBe('USD');
    expect(attached?.typicalRawAskingTotal).toBeGreaterThan(0);
    expect(attached?.typicalRawAskingTotal).not.toBe(135);
    expect(attached?.marketSampleSize).toBe(5);
    expect(attached?.typicalRawSoldTotal).toBeGreaterThan(0);
    expect(attached?.soldSampleSize).toBe(3);
    expect(attached?.sourceStatus).toBeUndefined();
    expect(attached?.listing?.currency).toBe('USD');
    expect(getDiscoveryMarketRefreshJob(usdCacheKey)?.targetCurrency).toBe('USD');

    deleteDiscoveryMarketRefreshJob(usdCacheKey);
    deleteDiscoveryMarketCache(usdCacheKey);
  });

  it('backfills shelves from reliable market cache without same-set variants', () => {
    const suffix = Date.now();
    const current = sourceCandidate(`Zapdos Aquapolis 44 Cache Backfill ${suffix}`, 'Pokemon TCG (Aquapolis)', 0);
    const variantName = `Zapdos Aquapolis H32 Cache Backfill ${suffix}`;
    const unrelatedEraName = `Xatu Skyridge H32 Cache Backfill ${suffix}`;
    const rejectedName = `Ledian Skyridge H14 Cache Backfill ${suffix}`;
    const replacementName = `Mew Expedition Base Set 55 Cache Backfill ${suffix}`;
    const variantCacheKey = discoveryMarketCacheKey(variantName, 'CAD', 'CA');
    const unrelatedEraCacheKey = discoveryMarketCacheKey(unrelatedEraName, 'CAD', 'CA');
    const rejectedCacheKey = discoveryMarketCacheKey(rejectedName, 'CAD', 'CA');
    const replacementCacheKey = discoveryMarketCacheKey(replacementName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(variantCacheKey);
    deleteDiscoveryMarketCache(unrelatedEraCacheKey);
    deleteDiscoveryMarketCache(rejectedCacheKey);
    deleteDiscoveryMarketCache(replacementCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: variantCacheKey,
      suggestionName: variantName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 650,
      marketSampleSize: 6,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: unrelatedEraCacheKey,
      suggestionName: unrelatedEraName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 90,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: rejectedCacheKey,
      suggestionName: rejectedName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 80,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: replacementCacheKey,
      suggestionName: replacementName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 150,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [{ ...current, typicalRawAskingTotal: 175, marketSampleSize: 12, displayCurrency: 'CAD' }],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      2,
      ['Zapdos Aquapolis 44', 'Mew Expedition Base Set 55'].map(chase),
      undefined,
      undefined,
      [],
      [rejectedName]
    );
    const visible = marketReadyShelfCandidates(backfilled, true, strongProfileConfidence);

    expect(visible.map((item) => item.suggestion.name)).toHaveLength(2);
    expect(visible.map((item) => item.suggestion.name)).toEqual(expect.arrayContaining([current.suggestion.name, replacementName]));
    expect(visible.map((item) => item.suggestion.name)).not.toContain(variantName);
    expect(visible.map((item) => item.suggestion.name)).not.toContain(rejectedName);
    deleteDiscoveryMarketCache(variantCacheKey);
    deleteDiscoveryMarketCache(unrelatedEraCacheKey);
    deleteDiscoveryMarketCache(rejectedCacheKey);
    deleteDiscoveryMarketCache(replacementCacheKey);
  });

  it('only backfills reliable cache rows with concrete profile subject matches', () => {
    const suffix = Date.now();
    const mewtwoName = `Mewtwo & Mew-GX SM Black Star Promos SM191 Cache Fit ${suffix}`;
    const unrelatedNames = [
      `Deoxys VMAX SWSH Black Star Promos SWSH267 Cache Leak ${suffix}`,
      `Meowth Nintendo Black Star Promos 13 Cache Leak ${suffix}`,
      `Xatu Skyridge H32 Cache Leak ${suffix}`,
      `Venonat Expedition Base Set 111 Cache Leak ${suffix}`
    ];
    const unrelatedCacheKeys = unrelatedNames.map((name) => discoveryMarketCacheKey(name, 'CAD', 'CA'));
    const mewtwoCacheKey = discoveryMarketCacheKey(mewtwoName, 'CAD', 'CA');
    for (const cacheKey of unrelatedCacheKeys) deleteDiscoveryMarketCache(cacheKey);
    deleteDiscoveryMarketCache(mewtwoCacheKey);
    for (const [index, suggestionName] of unrelatedNames.entries()) {
      upsertDiscoveryMarketCache({
        cacheKey: unrelatedCacheKeys[index],
        suggestionName,
        displayCurrency: 'CAD',
        destinationCountry: 'CA',
        typicalRawAskingTotal: 25 + index,
        marketSampleSize: 12,
        soldSampleSize: 0
      });
    }
    upsertDiscoveryMarketCache({
      cacheKey: mewtwoCacheKey,
      suggestionName: mewtwoName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 125,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      2,
      ['Corocoro Shining Mew', 'Pikachu xy95'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(mewtwoName);
    for (const unrelatedName of unrelatedNames) expect(names).not.toContain(unrelatedName);
    for (const cacheKey of unrelatedCacheKeys) deleteDiscoveryMarketCache(cacheKey);
    deleteDiscoveryMarketCache(mewtwoCacheKey);
  });

  it('backfills same-subject collector-shaped set-number variants from reliable cache', () => {
    const suffix = Date.now();
    const fusionName = `Mew ex Paldean Fates 232 Full Art Cache Variant ${suffix}`;
    const fusionCacheKey = discoveryMarketCacheKey(fusionName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(fusionCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: fusionCacheKey,
      suggestionName: fusionName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 155,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      1,
      ['Corocoro Shining Mew', 'Mew XY192'].map(chase)
    );

    expect(backfilled.map((item) => item.suggestion.name)).toContain(fusionName);
    deleteDiscoveryMarketCache(fusionCacheKey);
  });

  it('fills healthy Pro shelves from reliable direct-subject cache rows after stricter scheduled rows run short', () => {
    const suffix = Date.now();
    const directNames = [
      `Mew Fates Collide 29 Direct Refill ${suffix}`,
      `Gardevoir LV.X Secret Wonders 131 Direct Refill ${suffix}`,
      `Mewtwo & Mew-GX Unified Minds 71 Direct Refill ${suffix}`
    ];
    const unrelatedName = `Deoxys VMAX SWSH Black Star Promos SWSH267 Direct Refill ${suffix}`;
    const cacheKeys = [...directNames, unrelatedName].map((name) => discoveryMarketCacheKey(name, 'CAD', 'CA'));
    for (const cacheKey of cacheKeys) deleteDiscoveryMarketCache(cacheKey);
    for (const [index, suggestionName] of directNames.entries()) {
      upsertDiscoveryMarketCache({
        cacheKey: cacheKeys[index],
        suggestionName,
        displayCurrency: 'CAD',
        destinationCountry: 'CA',
        typicalRawAskingTotal: 90 + index,
        marketSampleSize: 12,
        soldSampleSize: 0
      });
    }
    upsertDiscoveryMarketCache({
      cacheKey: cacheKeys[3],
      suggestionName: unrelatedName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 120,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD', range: { min: 0, max: 200 } },
      3,
      ['Mew CoroCoro Promo 151', 'Gardevoir ex SAR Japanese 087/063'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    for (const directName of directNames) expect(names).toContain(directName);
    expect(names).not.toContain(unrelatedName);
    for (const cacheKey of cacheKeys) deleteDiscoveryMarketCache(cacheKey);
  });

  it('uses same-set cache variants only after non-variant backfill cannot fill the target', () => {
    const suffix = Date.now();
    const current = sourceCandidate(`Umbreon Skyridge 32 Variant Anchor ${suffix}`, 'Pokemon TCG (Skyridge)', 0);
    const variantName = `Umbreon Skyridge H30 Variant Fallback ${suffix}`;
    const variantCacheKey = discoveryMarketCacheKey(variantName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(variantCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: variantCacheKey,
      suggestionName: variantName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 155,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [{ ...current, typicalRawAskingTotal: 175, marketSampleSize: 12, displayCurrency: 'CAD' }],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      2,
      ['Umbreon Skyridge 32'].map(chase)
    );

    expect(backfilled.map((item) => item.suggestion.name)).toContain(variantName);
    deleteDiscoveryMarketCache(variantCacheKey);
  });

  it('skips ordinary cached set filler while filling from collector-shaped cache rows', () => {
    const suffix = Date.now();
    const ordinaryName = `Mew Evolutions 53 Cache Filler ${suffix}`;
    const shapedName = `Mew ex Paldean Fates 232 Full Art Cache Fit ${suffix}`;
    const ordinaryCacheKey = discoveryMarketCacheKey(ordinaryName, 'CAD', 'CA');
    const shapedCacheKey = discoveryMarketCacheKey(shapedName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(ordinaryCacheKey);
    deleteDiscoveryMarketCache(shapedCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: ordinaryCacheKey,
      suggestionName: ordinaryName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 55,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: shapedCacheKey,
      suggestionName: shapedName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 155,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      1,
      ['Corocoro Shining Mew', 'Mew XY192'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(shapedName);
    expect(names).not.toContain(ordinaryName);
    deleteDiscoveryMarketCache(ordinaryCacheKey);
    deleteDiscoveryMarketCache(shapedCacheKey);
  });

  it('uses broad collector-shaped cache rows when a healthy weekly shelf is still short', () => {
    const suffix = Date.now();
    const broadVintageName = `Pikachu Skyridge 84 Broad Shelf ${suffix}`;
    const broadPromoName = `Meowth Jungle 56/64 Broad Shelf ${suffix}`;
    const ordinaryModernName = `Mew V RR 053/172 S12a Broad Shelf ${suffix}`;
    const broadVintageCacheKey = discoveryMarketCacheKey(broadVintageName, 'CAD', 'CA');
    const broadPromoCacheKey = discoveryMarketCacheKey(broadPromoName, 'CAD', 'CA');
    const ordinaryModernCacheKey = discoveryMarketCacheKey(ordinaryModernName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(broadVintageCacheKey);
    deleteDiscoveryMarketCache(broadPromoCacheKey);
    deleteDiscoveryMarketCache(ordinaryModernCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: broadVintageCacheKey,
      suggestionName: broadVintageName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 210,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: broadPromoCacheKey,
      suggestionName: broadPromoName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 64,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: ordinaryModernCacheKey,
      suggestionName: ordinaryModernName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 11,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      12,
      ['Corocoro Shining Mew', 'Umbreon 217/187 Japanese', 'Squirtle Expedition Base Set 132', 'Pikachu xy95'].map(chase),
      strongProfileConfidence
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(broadVintageName);
    expect(names.some((name) => name === broadPromoName || name === broadVintageName)).toBe(true);
    expect(names).not.toContain(ordinaryModernName);
    deleteDiscoveryMarketCache(broadVintageCacheKey);
    deleteDiscoveryMarketCache(broadPromoCacheKey);
    deleteDiscoveryMarketCache(ordinaryModernCacheKey);
  });

  it('uses shared collector traits for cache backfill when direct subjects run short', () => {
    const suffix = Date.now();
    const promoName = `Special Delivery Bidoof SWSH Black Star Promos SWSH177 Trait Fit ${suffix}`;
    const genericPromoName = `Meowth VMAX SWSH Black Star Promos SWSH005 Trait Filler ${suffix}`;
    const ordinaryName = `Moltres Legendary Treasures 22 Trait Filler ${suffix}`;
    const promoCacheKey = discoveryMarketCacheKey(promoName, 'CAD', 'CA');
    const genericPromoCacheKey = discoveryMarketCacheKey(genericPromoName, 'CAD', 'CA');
    const ordinaryCacheKey = discoveryMarketCacheKey(ordinaryName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(promoCacheKey);
    deleteDiscoveryMarketCache(genericPromoCacheKey);
    deleteDiscoveryMarketCache(ordinaryCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: ordinaryCacheKey,
      suggestionName: ordinaryName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 65,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: genericPromoCacheKey,
      suggestionName: genericPromoName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 155,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: promoCacheKey,
      suggestionName: promoName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 155,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      1,
      ['Pikachu 26/83 Toys R Us promo'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(promoName);
    expect(names).not.toContain(genericPromoName);
    expect(names).not.toContain(ordinaryName);
    deleteDiscoveryMarketCache(promoCacheKey);
    deleteDiscoveryMarketCache(genericPromoCacheKey);
    deleteDiscoveryMarketCache(ordinaryCacheKey);
  });

  it('does not use plain e-reader era residents as trait-only backfill', () => {
    const suffix = Date.now();
    const randomEraNames = [
      `Xatu Skyridge H32 Random Era ${suffix}`,
      `Zubat Skyridge 117 Random Era ${suffix}`,
      `Magneton Skyridge H19 Random Era ${suffix}`,
      `Politoed Skyridge H23 Random Era ${suffix}`
    ];
    const anchoredName = `Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Anchored Era ${suffix}`;
    const randomEraKeys = randomEraNames.map((name) => discoveryMarketCacheKey(name, 'CAD', 'CA'));
    const anchoredKey = discoveryMarketCacheKey(anchoredName, 'CAD', 'CA');
    for (const cacheKey of [...randomEraKeys, anchoredKey]) deleteDiscoveryMarketCache(cacheKey);
    for (const [index, suggestionName] of randomEraNames.entries()) {
      upsertDiscoveryMarketCache({
        cacheKey: randomEraKeys[index],
        suggestionName,
        displayCurrency: 'CAD',
        destinationCountry: 'CA',
        typicalRawAskingTotal: 55 + index,
        marketSampleSize: 12,
        soldSampleSize: 0
      });
    }
    upsertDiscoveryMarketCache({
      cacheKey: anchoredKey,
      suggestionName: anchoredName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 255,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      1,
      ['Umbreon Skyridge 32'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(anchoredName);
    for (const randomEraName of randomEraNames) expect(names).not.toContain(randomEraName);
    for (const cacheKey of [...randomEraKeys, anchoredKey]) deleteDiscoveryMarketCache(cacheKey);
  });

  it('keeps trait-only cache backfill tied to the current user special-set profile', () => {
    const suffix = Date.now();
    const siblingName = `Sylveon Terastal Festival ex SAR 205/187 Japanese ${suffix}`;
    const dialgaName = `Dialga VSTAR Universe 261/172 Japanese ${suffix}`;
    const palkiaName = `Palkia VSTAR Universe 259/172 Japanese ${suffix}`;
    const siblingKey = discoveryMarketCacheKey(siblingName, 'CAD', 'CA');
    const dialgaKey = discoveryMarketCacheKey(dialgaName, 'CAD', 'CA');
    const palkiaKey = discoveryMarketCacheKey(palkiaName, 'CAD', 'CA');
    for (const cacheKey of [siblingKey, dialgaKey, palkiaKey]) deleteDiscoveryMarketCache(cacheKey);
    for (const [cacheKey, suggestionName, asking] of [
      [siblingKey, siblingName, 210],
      [dialgaKey, dialgaName, 190],
      [palkiaKey, palkiaName, 188]
    ] as const) {
      upsertDiscoveryMarketCache({
        cacheKey,
        suggestionName,
        displayCurrency: 'CAD',
        destinationCountry: 'CA',
        typicalRawAskingTotal: asking,
        marketSampleSize: 12,
        soldSampleSize: 0
      });
    }

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      3,
      ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Corocoro Shining Mew'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(siblingName);
    expect(names).not.toContain(dialgaName);
    expect(names).not.toContain(palkiaName);
    for (const cacheKey of [siblingKey, dialgaKey, palkiaKey]) deleteDiscoveryMarketCache(cacheKey);
  });

  it('allows exact niche retail e-reader promos just above the learned max price', () => {
    const suffix = Date.now();
    const nearStretchName = `Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Stretch ${suffix}`;
    const farStretchName = `Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Too High ${suffix}`;
    const range = { min: 0, max: 1200 };
    const nearStretchCacheKey = discoveryMarketCacheKey(nearStretchName, 'CAD', 'CA', undefined, range);
    const farStretchCacheKey = discoveryMarketCacheKey(farStretchName, 'CAD', 'CA', undefined, range);
    deleteDiscoveryMarketCache(nearStretchCacheKey);
    deleteDiscoveryMarketCache(farStretchCacheKey);
    upsertDiscoveryMarketCache({
      cacheKey: nearStretchCacheKey,
      suggestionName: nearStretchName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 1355,
      marketSampleSize: 12,
      soldSampleSize: 0
    });
    upsertDiscoveryMarketCache({
      cacheKey: farStretchCacheKey,
      suggestionName: farStretchName,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 1600,
      marketSampleSize: 12,
      soldSampleSize: 0
    });

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD', range },
      2,
      ["Squirtle 007/018 McDonald's e-Reader Promo", 'Pikachu xy95', 'Pikachu 26/83 Toys R Us promo'].map(chase)
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(nearStretchName);
    expect(names).not.toContain(farStretchName);
    deleteDiscoveryMarketCache(nearStretchCacheKey);
    deleteDiscoveryMarketCache(farStretchCacheKey);
  });

  it('applies weekly soft avoids before deciding a market-ready shelf is already full', () => {
    const suffix = Date.now();
    const repeatedMew = candidate(`Mew Expedition Base Set 55 Weekly Repeat ${suffix}`, 'E-Reader Era Trail', 0, 4);
    const repeatedPikachu = candidate(`Pikachu Expedition Base Set 124 Weekly Repeat ${suffix}`, 'E-Reader Era Trail', 1, 4);
    const freshUmbreon = candidate(`Umbreon XY Black Star Promos XY96 Fresh ${suffix}`, 'Promo Trail', 2, 4);

    const backfilled = backfillMarketReadyDiscoveryCandidates(
      [repeatedMew, repeatedPikachu, freshUmbreon],
      { activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' },
      2,
      ['Corocoro Shining Mew', 'Pikachu xy95', 'Umbreon 217/187 Japanese'].map(chase),
      strongProfileConfidence,
      undefined,
      [],
      [repeatedMew.suggestion.name, repeatedPikachu.suggestion.name]
    );
    const names = backfilled.map((item) => item.suggestion.name);

    expect(names).toContain(freshUmbreon.suggestion.name);
    expect(names).not.toContain(repeatedMew.suggestion.name);
    expect(names).not.toContain(repeatedPikachu.suggestion.name);
  });

  it('does not treat unrelated premium promos as scheduled profile-relevant just because the profile likes promos', () => {
    const dialgaPromo = sourceCandidate('Origin Forme Dialga V SWSH Black Star Promos SWSH255', 'Pokemon TCG (SWSH Black Star Promos)', 0);
    const chases = [
      'Squirtle Japanese Promo 007/018',
      'Mew CoroCoro Promo 151',
      'Umbreon ex SAR Terastal Festival Japanese 217/187',
      'Pikachu 26/83 Toys R Us promo'
    ].map(chase);

    expect(isScheduledProfileRelevantCandidate(dialgaPromo, chases)).toBe(false);
  });

  it('does not treat unrelated Japanese ex cards as scheduled profile-relevant from trait-only overlap', () => {
    const blastoise151: DiscoveryCandidate = {
      selectionIndex: 0,
      suggestion: {
        name: 'Blastoise ex 151 200',
        lane: 'Format Trail',
        laneWhy: 'market-ready profile expansion',
        why: 'A market-ready adjacent card Vaultr connected to this collector profile from prepared pricing data',
        nearby: [],
        evidenceSearchTerm: 'Blastoise ex 151 200 Pokemon card',
        evidenceAliases: ['Blastoise ex 151 200'],
        requiredEvidenceTokens: ['blastoise'],
        referenceSourceName: 'Pokemon TCG (151)'
      },
      listing: listing({
        title: 'Venusaur Blastoise ex SAR 200/165 202/165 sv2a Pokemon 151 Card Japanese 332'
      }),
      typicalRawAskingTotal: 212.73,
      marketSampleSize: 12,
      displayCurrency: 'CAD'
    };
    const chases = [
      'Squirtle Japanese Promo 007/018',
      'Mew CoroCoro Promo 151',
      'Umbreon ex SAR Terastal Festival Japanese 217/187',
      'Mew-EX Legendary Treasures RC24'
    ].map(chase);

    expect(isScheduledProfileRelevantCandidate(blastoise151, chases)).toBe(false);
  });

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

  it('persists source-backed reference images into scheduled shelf items when candidate images are missing', () => {
    const items = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
      {
        selectionIndex: 0,
        suggestion: {
          name: 'Blastoise ex 151 200',
          lane: 'Artwork Trail',
          laneWhy: 'profile source match',
          why: 'try Blastoise ex 151 200',
          nearby: [],
          referenceImageUrl: 'https://images.example/blastoise-151.png',
          referenceSourceName: 'Pokemon TCG (151)',
          referenceSourceCardId: 'sv3pt5-200'
        },
        image: undefined
      }
    ], 'CAD');

    expect(items[0]?.imageUrl).toBe('https://images.example/blastoise-151.png');
    expect(items[0]?.imageSourceName).toBe('Pokemon TCG (151)');
  });

  it('does not use marketplace images as canonical saved shelf images when no card reference image exists', () => {
    const items = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
      {
        ...candidate('Gardevoir Nintendo Promo 019/P Japanese', 'Japanese Collector Trail', 0, 4),
        listing: listing({
          title: 'Gardevoir Nintendo Promo 019/P Japanese Pokemon Card NM',
          imageUrl: 'https://i.ebayimg.example/gardevoir.jpg'
        }),
        image: {
          name: 'Gardevoir Nintendo Promo 019/P Japanese',
          url: 'https://i.ebayimg.example/gardevoir.jpg',
          sourceName: 'eBay listing image',
          sourceKind: 'MARKET_LISTING'
        }
      }
    ], 'CAD');

    expect(items[0]?.imageUrl).toBeUndefined();
    expect(items[0]?.imageSourceName).toBeUndefined();
  });

  it('infers structured source names for concrete cached market cards with obvious set context', () => {
    const suffix = Date.now();
    const name = `Umbreon ex SAR Terastal Festival Japanese 217/187 ${suffix}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 420,
      marketSampleSize: 6,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [candidate(name, 'Collector Compass', 0, 6)],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'CAD'
      }
    );

    expect(attached?.suggestion.referenceSourceName).toBe('TCGdex Japanese (Terastal Festival)');
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('does not treat a listing URL alone as fully market-ready for saved weekly shelf items', () => {
    const items = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
      {
        ...publishableCandidate('Mew ex Paldean Fates 232', 'sv4pt5-232', 0),
        listing: listing({
          listingId: 'listing-thin-1',
          title: 'Mew ex Paldean Fates 232 Pokemon card',
          url: 'https://example.com/mew-thin'
        }),
        image: undefined
      }
    ], 'CAD');

    expect(items[0]?.market.status).toBe('THIN');
  });

  it('allows a strong canonical candidate with missing market data to remain publishable as non-shoppable', () => {
    const items = Array.from({ length: 20 }, (_, index) => {
      const item = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
        publishableCandidate(`Mew Card ${index + 1}`, `canonical-${index + 1}`, index)
      ], 'CAD')[0]!;
      return {
        ...item,
        position: index + 1,
        market: { ...item.market, status: 'MISSING' as const, listing: undefined }
      };
    });

    expect(__discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 20)).toEqual([]);
  });

  it('rejects a candidate without a trusted reference image from publishable weekly shelves', () => {
    const items = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
      {
        ...publishableCandidate('Mew ex Paldean Fates 232', 'sv4pt5-232', 0),
        image: undefined,
        suggestion: {
          name: 'Mew ex Paldean Fates 232',
          lane: 'Collector Compass',
          laneWhy: 'profile source match',
          why: 'try mew',
          nearby: [],
          referenceSourceName: 'Pokemon TCG API',
          referenceSourceCardId: 'sv4pt5-232'
        }
      }
    ], 'CAD');

    const failures = __discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 1);
    expect(failures.some((failure) => failure.code === 'MISSING_IMAGE')).toBe(true);
  });

  it('rejects a raw marketplace title as a final publishable display name', () => {
    const items = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
      publishableCandidate('Pokemon Card Expedition Base Set Mew 55/165 Rare', 'exp1-55', 0)
    ], 'CAD');

    const failures = __discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 1);
    expect(failures.some((failure) => failure.code === 'BAD_DISPLAY_NAME')).toBe(true);
  });

  it('fails validation for a 19-card shelf', () => {
    const items = Array.from({ length: 19 }, (_, index) =>
      __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
        publishableCandidate(`Card ${index + 1}`, `card-${index + 1}`, index)
      ], 'CAD')[0]!
    );

    const failures = __discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 20);
    expect(failures.some((failure) => failure.code === 'WRONG_SIZE')).toBe(true);
  });

  it('fails validation for duplicate canonical IDs', () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
        publishableCandidate(`Card ${index + 1}`, index < 2 ? 'dup-id' : `card-${index + 1}`, index)
      ], 'CAD')[0]!
    );

    const failures = __discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 20);
    expect(failures.some((failure) => failure.code === 'DUPLICATE_CANONICAL_IDS')).toBe(true);
  });

  it('passes validation for a complete 20-card publishable shelf', () => {
    const items = Array.from({ length: 20 }, (_, index) => {
      const item = __discoveryPersistenceTestHooks.scheduledDropItemsFromCandidates([
        {
          ...publishableCandidate(`Card ${index + 1}`, `card-${index + 1}`, index),
          typicalRawAskingTotal: 75,
          marketSampleSize: 4
        }
      ], 'CAD')[0]!;
      return { ...item, position: index + 1 };
    });

    expect(__discoveryPersistenceTestHooks.validatePublishableDiscoveryShelf(items, 20)).toEqual([]);
  });

  it('does not replace the previous valid weekly shelf when validation fails', () => {
    const userId = `weekly-persist-${Date.now()}`;
    const date = new Date('2026-07-14T12:00:00.000Z');
    const validCandidates = Array.from({ length: 20 }, (_, index) => ({
      ...publishableCandidate(`Card ${index + 1}`, `card-${index + 1}`, index),
      typicalRawAskingTotal: 75,
      marketSampleSize: 4
    }));
    const invalidCandidates = validCandidates.slice(0, 19);

    const saved = __discoveryPersistenceTestHooks.persistValidatedWeeklyDiscoveryDrop(userId, validCandidates, 'CAD', undefined, date);
    expect(saved.saved).toBe(true);

    const rejected = __discoveryPersistenceTestHooks.persistValidatedWeeklyDiscoveryDrop(userId, invalidCandidates, 'CAD', undefined, date);
    expect(rejected.saved).toBe(false);

    const drop = getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', '2026-W29');
    expect(drop?.itemCount).toBe(20);
    expect(drop?.items).toHaveLength(20);

    deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', '2026-W29');
  });

  it('reports weekly shelf persistence success only for a validated 20-card shelf', () => {
    const userId = `weekly-result-${Date.now()}`;
    const date = new Date('2026-07-14T12:00:00.000Z');
    const invalidCandidates = Array.from({ length: 19 }, (_, index) => ({
      ...publishableCandidate(`Card ${index + 1}`, `card-${index + 1}`, index),
      typicalRawAskingTotal: 75,
      marketSampleSize: 4
    }));

    const result = __discoveryPersistenceTestHooks.persistValidatedWeeklyDiscoveryDrop(userId, invalidCandidates, 'CAD', undefined, date);
    expect(result.saved).toBe(false);
    expect(result.itemCount).toBe(19);

    deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', '2026-W29');
  });

  it('does not treat weak trait-only market cache cards as scheduled shelf priorities without source backing', () => {
    const candidate: DiscoveryCandidate = {
      selectionIndex: 0,
      suggestion: {
        name: 'Blastoise ex 151 200',
        lane: 'Format Trail',
        laneWhy: 'profile source match',
        why: 'market-ready adjacent card',
        nearby: [],
        requiredEvidenceTokens: ['blastoise']
      },
      typicalRawAskingTotal: 140,
      marketSampleSize: 8,
      displayCurrency: 'CAD'
    };

    expect(__discoveryPersistenceTestHooks.isScheduledShelfPriorityCandidate(
      candidate,
      ['Squirtle Japanese Promo 007/018', 'Mew CoroCoro Promo 151'].map(chase)
    )).toBe(false);
  });

  it('does not allow weak trait-only market cache cards as broad collector filler without source backing', () => {
    const candidate: DiscoveryCandidate = {
      selectionIndex: 0,
      suggestion: {
        name: 'Cinccino ex Chaos Rising 119',
        lane: 'Format Trail',
        laneWhy: 'profile source match',
        why: 'market-ready adjacent card',
        nearby: [],
        requiredEvidenceTokens: ['cinccino', 'chaos']
      },
      typicalRawAskingTotal: 140,
      marketSampleSize: 8,
      displayCurrency: 'CAD'
    };

    expect(isBroadCollectorShelfFillerCandidate(
      candidate,
      ['Umbreon ex SAR Terastal Festival Japanese 217/187', 'Mew CoroCoro Promo 151'].map(chase)
    )).toBe(false);
  });

  it('restores cached market images when a shelf candidate has no image', () => {
    const name = `Umbreon Darkrai GX Promo ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: listing({
        listingId: 'ebay-missing-image-repair',
        title: `${name} raw card`,
        imageUrl: 'https://i.ebayimg.example/market-repair.jpg'
      }),
      imageUrl: 'https://i.ebayimg.example/cached-market-repair.jpg',
      typicalRawAskingTotal: 72,
      marketSampleSize: 8,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache(
      [candidate(name, 'tag team trail', 18, 8)],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'CAD'
      }
    );

    expect(attached?.image?.url).toBe('https://i.ebayimg.example/cached-market-repair.jpg');
    expect(attached?.image?.sourceName).toBe('eBay listing image');
    expect(attached?.image?.sourceKind).toBe('MARKET_LISTING');
    expect(attached?.listing?.listingId).toBe('ebay-missing-image-repair');
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

  it('skips repeated refresh enqueue pressure for the same user during cooldown', () => {
    const suffix = Date.now();
    const firstName = `Mew Cooldown One ${suffix}`;
    const secondName = `Mew Cooldown Two ${suffix}`;
    const firstCacheKey = discoveryMarketCacheKey(firstName, 'CAD', 'CA');
    const secondCacheKey = discoveryMarketCacheKey(secondName, 'CAD', 'CA');
    deleteDiscoveryMarketCache(firstCacheKey);
    deleteDiscoveryMarketCache(secondCacheKey);
    deleteDiscoveryMarketRefreshJob(firstCacheKey);
    deleteDiscoveryMarketRefreshJob(secondCacheKey);

    const [first] = candidatesFromDiscoveryMarketCache(
      [candidate(firstName, 'mythical display cards', 0)],
      { userId: 'cooldown-user', activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' }
    );
    const [second] = candidatesFromDiscoveryMarketCache(
      [candidate(secondName, 'mythical display cards', 1)],
      { userId: 'cooldown-user', activeChases: [], destination: { country: 'CA' }, targetCurrency: 'CAD' }
    );
    const throttle = getDiscoveryMarketRefreshThrottleState();

    expect(first?.sourceStatus).toBe('PENDING');
    expect(getDiscoveryMarketRefreshJob(firstCacheKey)?.status).toBe('QUEUED');
    expect(second?.sourceStatus).toBeUndefined();
    expect(getDiscoveryMarketRefreshJob(secondCacheKey)).toBeNull();
    expect(throttle.skippedByUserCooldown).toBe(1);

    deleteDiscoveryMarketCache(firstCacheKey);
    deleteDiscoveryMarketCache(secondCacheKey);
    deleteDiscoveryMarketRefreshJob(firstCacheKey);
    deleteDiscoveryMarketRefreshJob(secondCacheKey);
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

  it('retries thin ask-only market cache rows when scheduled hydration requests reliable comps', () => {
    const name = `Articuno Skyridge H3 Thin Ask Cache ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 790,
      marketSampleSize: 3,
      typicalRawSoldTotal: undefined,
      soldSampleSize: 0,
      fetchedAt: new Date().toISOString()
    });

    const [attached] = candidatesFromDiscoveryMarketCache([candidate(name, 'e-reader trail', 0)], {
      userId: 'user-1',
      activeChases: [],
      destination: { country: 'CA' },
      targetCurrency: 'CAD',
      forceRefreshThinSignal: true
    });

    expect(attached?.typicalRawAskingTotal).toBe(790);
    expect(attached?.marketSampleSize).toBe(3);
    expect(attached?.sourceStatus).toBe('PENDING');
    deleteDiscoveryMarketCache(cacheKey);
  });

  it('keeps thin exact niche marketplace cache rows refreshable after making them display-ready', () => {
    const name = `Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese ${Date.now()}`;
    const cacheKey = discoveryMarketCacheKey(name, 'CAD', 'CA');
    deleteDiscoveryMarketCache(cacheKey);
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: name,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      typicalRawAskingTotal: 426,
      marketSampleSize: 1,
      soldSampleSize: 0,
      fetchedAt: new Date().toISOString()
    });

    const raichuIntroPack = candidate(name, 'Japanese Collector Trail', 0, 1);
    const [attached] = candidatesFromDiscoveryMarketCache(
      [
        {
          ...raichuIntroPack,
          suggestion: {
            ...raichuIntroPack.suggestion,
            evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
            evidenceAliases: ['Raichu No.026 VHS Intro Pack Bulbasaur Deck 1999 Japanese Pokemon Card'],
            requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
            sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
          }
        }
      ],
      {
        userId: 'user-1',
        activeChases: [],
        destination: { country: 'CA' },
        targetCurrency: 'CAD',
        forceRefreshThinSignal: true
      }
    );

    expect(attached?.marketSampleSize).toBe(1);
    expect(attached?.sourceStatus).toBe('PENDING');
    expect(marketReadyShelfCandidatesWithOptions([attached!], true, strongProfileConfidence, { allowPendingExploration: false })).toHaveLength(1);
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

  it('removes eBay listing thumbnails when no clean reference image is available', async () => {
    const name = `Mew Evolutions 53 ${Date.now()}`;
    const referenceCacheKey = discoveryReferenceCacheKey(name);
    deleteDiscoveryReferenceCache(referenceCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceCacheKey,
      suggestionName: name,
      sourceName: 'Pokemon TCG',
      fetchedAt: new Date().toISOString()
    });

    const [attached] = await attachReferenceImages([
      {
        ...candidate(name, 'market ready path', 0, 4),
        image: {
          name,
          url: 'https://i.ebayimg.com/images/g/seller-photo/s-l225.jpg',
          sourceName: 'eBay listing image',
          sourceKind: 'MARKET_LISTING'
        }
      }
    ]);

    expect(attached?.image).toBeUndefined();
    deleteDiscoveryReferenceCache(referenceCacheKey);
  });

  it('preserves vetted marketplace images for exact niche retail e-reader promos', async () => {
    const name = `Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese ${Date.now()}`;
    const referenceCacheKey = discoveryReferenceCacheKey(name);
    deleteDiscoveryReferenceCache(referenceCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceCacheKey,
      suggestionName: name,
      sourceName: 'Pokemon TCG',
      fetchedAt: new Date().toISOString()
    });

    const [attached] = await attachReferenceImages([
      {
        ...candidate(name, 'Retail Promo Trail', 0, 12),
        suggestion: {
          ...candidate(name, 'Retail Promo Trail', 0, 12).suggestion,
          laneWhy: 'same-subject retail e-reader promo variants',
          evidenceSearchTerm: `${name} Pokemon card`,
          requiredEvidenceTokens: ['pikachu', '010', '018'],
          sourceTasteTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds', 'japanese']
        },
        listing: {
          source: 'EBAY',
          listingId: 'vetted-pikachu-010',
          title: "Pokemon Card Game Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Nintendo",
          price: 1180,
          currency: 'CAD',
          url: 'https://www.ebay.ca/itm/vetted-pikachu-010',
          imageUrl: 'https://i.ebayimg.com/images/g/clean-card/s-l1600.jpg',
          region: 'CA',
          listingType: 'BUY_IT_NOW'
        },
        image: {
          name,
          url: 'https://i.ebayimg.com/images/g/clean-card/s-l1600.jpg',
          sourceName: 'eBay vetted marketplace image',
          sourceKind: 'MARKET_LISTING'
        }
      }
    ]);

    expect(attached?.image?.url).toBe('https://i.ebayimg.com/images/g/clean-card/s-l1600.jpg');
    expect(attached?.image?.sourceName).toBe('eBay vetted marketplace image');
    expect(attached?.image?.sourceKind).toBe('MARKET_LISTING');
    deleteDiscoveryReferenceCache(referenceCacheKey);
  });

  it('preserves vetted marketplace images for exact niche Japanese deck exclusives', async () => {
    const name = `Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese ${Date.now()}`;
    const referenceCacheKey = discoveryReferenceCacheKey(name);
    deleteDiscoveryReferenceCache(referenceCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceCacheKey,
      suggestionName: name,
      sourceName: 'Pokemon TCG',
      fetchedAt: new Date().toISOString()
    });

    const [attached] = await attachReferenceImages([
      {
        ...candidate(name, 'Japanese Collector Trail', 0, 12),
        suggestion: {
          ...candidate(name, 'Japanese Collector Trail', 0, 12).suggestion,
          laneWhy: 'Japanese exclusiveness and unusual-release signals',
          evidenceSearchTerm: `${name} Pokemon card`,
          requiredEvidenceTokens: ['raichu', '026', 'bulbasaur'],
          sourceTasteTokens: ['raichu', '026', 'intro pack', 'bulbasaur deck', 'vhs', 'japanese', 'exclusive', 'vintage']
        },
        listing: {
          source: 'EBAY',
          listingId: 'vetted-raichu-026',
          title: 'Raichu No.026 - Intro pack bulbasaur deck - Japanese - MP',
          price: 515,
          currency: 'CAD',
          url: 'https://www.ebay.ca/itm/vetted-raichu-026',
          imageUrl: 'https://i.ebayimg.com/images/g/raichu-clean/s-l1600.jpg',
          region: 'CA',
          listingType: 'BUY_IT_NOW'
        },
        image: {
          name,
          url: 'https://i.ebayimg.com/images/g/raichu-clean/s-l1600.jpg',
          sourceName: 'eBay vetted marketplace image',
          sourceKind: 'MARKET_LISTING'
        }
      }
    ]);

    expect(attached?.image?.url).toBe('https://i.ebayimg.com/images/g/raichu-clean/s-l1600.jpg');
    expect(attached?.image?.sourceName).toBe('eBay vetted marketplace image');
    expect(attached?.image?.sourceKind).toBe('MARKET_LISTING');
    deleteDiscoveryReferenceCache(referenceCacheKey);
  });

  it('repairs missing images on saved scheduled shelf cards', async () => {
    const name = `Umbreon & Darkrai-GX SM Black Star Promos SM241 ${Date.now()}`;
    const referenceCacheKey = discoveryReferenceCacheKey(name);
    deleteDiscoveryReferenceCache(referenceCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceCacheKey,
      suggestionName: name,
      imageUrl: 'https://images.pokemontcg.io/smp/SM241_hires.png',
      sourceName: 'Pokemon TCG (SM Black Star Promos)',
      sourceCardId: 'smp-SM241',
      fetchedAt: new Date().toISOString()
    });

    const [repaired] = await repairScheduledDiscoveryShelfImages([
      {
        ...candidate(name, 'market ready path', 18, 12),
        image: undefined
      }
    ]);

    expect(repaired?.image?.url).toBe('https://images.pokemontcg.io/smp/SM241_hires.png');
    expect(repaired?.image?.sourceName).toBe('Pokemon TCG (SM Black Star Promos)');
    expect(repaired?.image?.sourceKind).toBe('CARD_REFERENCE');
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

  it('keeps Free Discovery on active Vault signals while Pro can blend taste profile memory', () => {
    const activeChases: Chase[] = [
      { id: 'c1', userId: 'u1', cardName: 'Pikachu 26/83 promo', createdAt: '2026-06-03T00:00:00.000Z' },
      { id: 'c2', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-06-03T00:00:00.000Z' }
    ];
    const tasteMemory: Chase[] = [{ id: 'taste:1', userId: 'u1', cardName: 'Corocoro Shining Mew', createdAt: '2026-06-03T00:00:00.000Z', tasteSource: 'DISCOVERY_ADD' }];

    expect(discoveryTasteProfileChases(activeChases, tasteMemory, false).map((chase) => chase.cardName)).toEqual(['Pikachu 26/83 promo', 'Mew RC24']);
    expect(discoveryTasteProfileChases(activeChases, tasteMemory, true).map((chase) => chase.cardName)).toEqual(['Pikachu 26/83 promo', 'Mew RC24', 'Corocoro Shining Mew']);
  });

  it('lets removed taste memory cancel older positive memory for the same card', () => {
    const activeChases: Chase[] = [{ id: 'c1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-06-03T00:00:00.000Z' }];
    const tasteMemory: Chase[] = [
      { id: 'taste:add-skyridge', userId: 'u1', cardName: 'Pikachu Skyridge 84', createdAt: '2026-06-05T18:48:53.216Z', tasteSource: 'DISCOVERY_ADD' },
      { id: 'taste:removed-skyridge', userId: 'u1', cardName: 'Pikachu Skyridge 84', createdAt: '2026-06-05T18:49:24.380Z', tasteSource: 'REMOVED_CHASE' }
    ];

    const profile = discoveryTasteProfileChases(activeChases, tasteMemory, true);

    expect(profile.map((chase) => `${chase.cardName}:${chase.tasteSource}`)).toEqual([
      'Mew RC24:ACTIVE_CHASE',
      'Pikachu Skyridge 84:REMOVED_CHASE'
    ]);
    expect(discoveryProfileConfidence(profile).eraCount).toBe(0);
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
