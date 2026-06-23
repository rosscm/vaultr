import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.unstubAllGlobals();
});

describe('discovery reference cache', () => {
  it('builds exact Pokemon TCG queries for set-number reference names', () => {
    const suggestion = (name: string) => ({ name, lane: 'test', laneWhy: 'test', why: 'test', nearby: [], evidenceSearchTerm: `${name} Pokemon card` });

    expect(pokemonTcgQueriesForSuggestion(suggestion('Mew Expedition Base Set 55'))[0]).toBe('name:"Mew" number:55 set.name:"Expedition Base Set"');
    expect(pokemonTcgQueriesForSuggestion(suggestion('Umbreon XY Black Star Promos XY96'))[0]).toBe('name:"Umbreon" number:XY96');
    expect(pokemonTcgQueriesForSuggestion(suggestion('Pikachu Skyridge 84 trading card'))[0]).toBe('name:"Pikachu" number:84 set.name:"Skyridge"');
  });

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

  it('builds exact Pokemon TCG queries for Champions Path set-number cards', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: "Gardevoir VMAX Champion's Path 76",
      lane: 'modern chase cards',
      laneWhy: 'modern chase cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: "Gardevoir VMAX Champion's Path 76 Pokemon card",
      requiredEvidenceTokens: ['gardevoir', 'champion', '76']
    });

    expect(queries[0]).toBe('name:"Gardevoir VMAX" number:76 set.name:"Champion\'s Path"');
  });

  it('builds exact Pokemon TCG queries for current weekly shelf set-number cards', () => {
    const cases: Array<{ name: string; expected: string }> = [
      { name: 'Mew Evolutions 53', expected: 'name:"Mew" number:53 set.name:"Evolutions"' },
      { name: 'Pikachu VMAX Vivid Voltage 188', expected: 'name:"Pikachu VMAX" number:188 set.name:"Vivid Voltage"' },
      { name: "_____'s Pikachu Celebrations: Classic Collection 24", expected: 'name:"_____\'s Pikachu" number:24 set.name:"Celebrations: Classic Collection"' },
      { name: 'Zapdos Generations 29', expected: 'name:"Zapdos" number:29 set.name:"Generations"' },
      { name: 'Moltres Legendary Treasures 22', expected: 'name:"Moltres" number:22 set.name:"Legendary Treasures"' },
      { name: 'Mewtwo & Mew-GX Unified Minds 222', expected: 'name:"Mewtwo & Mew-GX" number:222 set.name:"Unified Minds"' },
      { name: "Team Rocket's Moltres ex Destined Rivals 229", expected: 'name:"Team Rocket\'s Moltres ex" number:229 set.name:"Destined Rivals"' }
    ];

    for (const { name, expected } of cases) {
      expect(pokemonTcgQueriesForSuggestion({ name, lane: 'test', laneWhy: 'test', why: 'test', nearby: [], evidenceSearchTerm: `${name} Pokemon card` })[0]).toBe(expected);
    }
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

  it('builds exact Pokemon TCG queries for SM Black Star tag team promos', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Umbreon & Darkrai-GX SM Black Star Promos SM241',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Umbreon & Darkrai-GX SM Black Star Promos SM241 Pokemon card',
      requiredEvidenceTokens: ['umbreon', 'darkrai', 'sm241']
    });

    expect(queries).toContain('name:"Umbreon & Darkrai-GX" number:SM241 set.name:"SM Black Star Promos"');
    expect(queries).not.toContain('name:"Umbreon & Darkrai-GX SM" number:SM241');
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

  it('does not map 2002 McDonalds e-reader promos to modern McDonalds reference images', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese",
      lane: 'Retail Promo Trail',
      laneWhy: 'retail promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: "Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese Pokemon card",
      requiredEvidenceTokens: ['pikachu', '010', '018', 'mcdonalds', 'e-reader']
    });

    expect(queries).toEqual([]);
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

  it('uses exact set hints in source labels when Pokemon TCG omits set metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'swsh35-76',
            name: 'Gardevoir VMAX',
            number: '76',
            images: { large: 'https://images.pokemontcg.io/swsh35/76_hires.png' }
          }
        ]
      })
    })));

    const reference = await fetchDiscoveryReferenceImage({
      name: "Gardevoir VMAX Champion's Path 76",
      lane: 'modern chase cards',
      laneWhy: 'modern chase cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: "Gardevoir VMAX Champion's Path 76 Pokemon card"
    });

    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/swsh35/76_hires.png');
    expect(reference.sourceName).toBe("Pokemon TCG (Champion's Path)");
  });

  it('uses SWSH Black Star source labels when Pokemon TCG omits set metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'swshp-SWSH062',
            name: 'Pikachu VMAX',
            number: 'SWSH062',
            images: { large: 'https://images.pokemontcg.io/swshp/SWSH062_hires.png' }
          }
        ]
      })
    })));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Pikachu VMAX SWSH Black Star Promos SWSH062',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Pikachu VMAX SWSH Black Star Promos SWSH062 Pokemon card'
    });

    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/swshp/SWSH062_hires.png');
    expect(reference.sourceName).toBe('Pokemon TCG (SWSH Black Star Promos)');
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
