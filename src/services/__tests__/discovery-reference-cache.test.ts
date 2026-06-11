import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteDiscoveryReferenceCache,
  discoveryReferenceCacheKey,
  fetchDiscoveryReferenceImage,
  getDiscoveryReferenceCache,
  getOrFetchDiscoveryReferenceImage,
  onePieceCardImageCandidatesForSuggestion,
  pokemonTcgQueriesForSuggestion,
  upsertDiscoveryReferenceCache
} from '../discovery-reference-cache.js';

const testName = `Test Reference ${Date.now()}`;
const cacheKey = discoveryReferenceCacheKey(testName);

afterEach(() => {
  deleteDiscoveryReferenceCache(cacheKey);
});

describe('discovery reference cache', () => {
  it('round-trips non-market reference image data', () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      imageUrl: 'https://images.pokemontcg.io/test/1.png',
      sourceName: 'Pokemon TCG',
      sourceCardId: 'test-1'
    });

    const entry = getDiscoveryReferenceCache(cacheKey);
    expect(entry?.imageUrl).toBe('https://images.pokemontcg.io/test/1.png');
    expect(entry?.sourceName).toBe('Pokemon TCG');
    expect(entry?.sourceCardId).toBe('test-1');
  });

  it('builds exact Pokemon TCG queries from card numbers and set hints', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Mew GG10 Crown Zenith',
      lane: 'soft mythical galleries',
      laneWhy: 'modern gallery cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Mew GG10 Crown Zenith',
      requiredEvidenceTokens: ['mew', 'gg10']
    });

    expect(queries).toContain('name:"Mew" number:GG10');
    expect(queries).toContain('name:"Mew" number:GG10 set.name:"Crown Zenith"');
  });

  it('builds exact Pokemon TCG queries for Surging Sparks secret rares', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Pikachu ex Surging Sparks 238',
      lane: 'modern texture',
      laneWhy: 'modern chase cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Pikachu ex Surging Sparks 238 Pokemon card',
      evidenceAliases: ['Pikachu ex Surging Sparks 238'],
      requiredEvidenceTokens: ['pikachu', 'surging', '238']
    });

    expect(queries).toContain('name:"Pikachu ex" number:238 set.name:"Surging Sparks"');
  });

  it('builds exact Pokemon TCG queries for SWSH Black Star promos', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Pikachu VMAX SWSH Black Star Promos SWSH286',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Pikachu VMAX SWSH Black Star Promos SWSH286 Pokemon card',
      requiredEvidenceTokens: ['pikachu', 'swsh']
    });

    expect(queries).toContain('name:"Pikachu VMAX" number:SWSH286 set.name:"SWSH Black Star Promos"');
  });

  it('does not send One Piece cards to the Pokemon TCG API', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Monkey.D.Luffy ST01-001 Leader',
      lane: 'main-character leaders',
      laneWhy: 'One Piece character cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Monkey D Luffy ST01-001 One Piece card'
    });

    expect(queries).toEqual([]);
  });

  it('builds exact One Piece official image candidates from card codes', () => {
    const candidates = onePieceCardImageCandidatesForSuggestion({
      name: 'Nami OP01-016 Parallel',
      lane: 'crew character parallels',
      laneWhy: 'One Piece character cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Nami OP01-016 One Piece card'
    });

    expect(candidates[0]).toBe('https://en.onepiece-cardgame.com/images/cardlist/card/OP01-016_p1.png');
    expect(candidates).toContain('https://en.onepiece-cardgame.com/images/cardlist/card/OP01-016.png');
  });

  it('prefers the McDonalds 2021 set for 25th Anniversary promo cards', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: "Totodile 18/25 McDonald's 25th Anniversary Promo",
      lane: 'starter promo side paths',
      laneWhy: 'starter promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Totodile 18/25 McDonalds Pokemon',
      requiredEvidenceTokens: ['totodile', '18', '25']
    });

    expect(queries[0]).toBe('name:"Totodile" number:18 set.name:"McDonald\'s Collection 2021"');
  });

  it('does not use broad name fallback for exact numbered Japanese cards', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Totodile 073/071 Triplet Beat Art Rare',
      lane: 'water starter art rares',
      laneWhy: 'starter Pokemon cards',
      why: 'try this',
      nearby: []
    });

    expect(queries).toEqual(['name:"Totodile" number:073', 'name:"Totodile" number:73']);
  });

  it('uses curated reference image overrides before querying a card database', async () => {
    const reference = await fetchDiscoveryReferenceImage({
      name: 'Ditto Charmander Delta Species',
      lane: 'playful display cards',
      laneWhy: 'cards with visual charm',
      why: 'try this',
      nearby: [],
      referenceImageUrl: 'https://images.pokemontcg.io/ex11/37_hires.png',
      referenceSourceName: 'Pokemon TCG (EX Delta Species)',
      referenceSourceCardId: 'ex11-37'
    });

    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/ex11/37_hires.png');
    expect(reference.sourceCardId).toBe('ex11-37');
    expect(reference.sourceName).toBe('Pokemon TCG (EX Delta Species)');
  });

  it('refetches transient reference-image failures instead of serving them from cache', async () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      sourceStatus: 'TIMEOUT'
    });

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: testName,
      lane: 'test',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      referenceImageUrl: 'https://images.pokemontcg.io/test/refetch.png',
      referenceSourceName: 'Curated test reference'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/test/refetch.png');
    expect(getDiscoveryReferenceCache(cacheKey)?.sourceStatus).toBeUndefined();
  });

  it('refetches malformed cached timestamps instead of treating them as fresh', async () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      sourceStatus: 'NOT_FOUND',
      fetchedAt: 'not-a-date'
    });

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: testName,
      lane: 'test',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      referenceImageUrl: 'https://images.pokemontcg.io/test/fresh.png'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/test/fresh.png');
  });
});
