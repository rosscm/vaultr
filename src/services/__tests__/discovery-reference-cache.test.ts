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

  it('builds Nintendo promo set hints without leaving Nintendo in the card name', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Gardevoir Nintendo Promo 024/P Japanese',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Gardevoir Nintendo Promo 024/P Japanese Pokemon card'
    });

    expect(queries).toContain('name:"Gardevoir" set.name:"Nintendo Black Star Promos"');
    expect(queries).toContain('name:"Gardevoir" number:24');
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

  it('does not map Raichu No.026 Intro Pack to modern Raichu 026 reference images', () => {
    const queries = pokemonTcgQueriesForSuggestion({
      name: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese',
      lane: 'Japanese Collector Trail',
      laneWhy: 'deck exclusive cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese Pokemon card',
      requiredEvidenceTokens: ['raichu', '026', 'bulbasaur']
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

  it('does not promote an arbitrary Pokemon suggestion image URL into trusted reference art', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD' && url.includes('/sv3pt5/170_hires.png')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'sv3pt5-170',
                name: 'Squirtle',
                number: '170',
                set: { name: '151' },
                images: { small: 'https://marketplace.example/squirtle-listing-photo.png' }
              }
            ]
          })
        } as Response;
      }
      if (url.includes('marketplace.example')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Squirtle 151 170',
      lane: 'collector path',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: 'Squirtle 151 170 Pokemon card',
      referenceImageUrl: 'https://marketplace.example/squirtle-listing-photo.png',
      referenceSourceName: 'Curated reference',
      referenceSourceCardId: 'sv3pt5-170'
    });

    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(reference.sourceCardId).toBe('sv3pt5-170');
    expect(reference.sourceName).toBe('Pokemon TCG (151)');
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

  it('uses TCGdex Japanese clean images for Japanese promo-style suggestions when Pokemon TCG would miss', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD' && url.includes('/sv3pt5/170_hires.png')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'swsh35-76',
                name: 'Gardevoir',
                nationalPokedexNumbers: [282]
              }
            ]
          })
        } as Response;
      }
      if (url.includes('api.tcgdex.net') && url.includes('dexId=282')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'jp-s-p-024',
              localId: '024/P',
              image: 'https://assets.tcgdex.net/ja/s-p/024'
            }
          ])
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Gardevoir Nintendo Promo 024/P Japanese',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Gardevoir Nintendo Promo 024/P Japanese Pokemon card',
      requiredEvidenceTokens: ['gardevoir', 'nintendo', '024', 'japanese']
    });

    expect(reference.imageUrl).toBe('https://assets.tcgdex.net/ja/s-p/024/high.png');
    expect(reference.sourceName).toBe('TCGdex Japanese');
    expect(reference.sourceCardId).toBe('jp-s-p-024');
  });

  it('uses exact Japanese set-code matches for normal collector cards like Eevee Heroes HRs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'swsh7-95',
                name: 'Umbreon VMAX',
                nationalPokedexNumbers: [197]
              }
            ]
          })
        } as Response;
      }
      if (url.includes('api.tcgdex.net') && url.includes('dexId=197')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'S6a-094',
              localId: '094/069',
              image: 'https://assets.tcgdex.net/ja/S/S6a/094'
            }
          ])
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese',
      lane: 'japanese collector trail',
      laneWhy: 'japanese collector trail',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Umbreon VMAX HR 094/069 s6a Eevee Heroes Pokemon Card Japanese',
      requiredEvidenceTokens: ['umbreon', '094/069', 's6a', 'japanese']
    });

    expect(reference.imageUrl).toBe('https://assets.tcgdex.net/ja/S/S6a/094/high.png');
    expect(reference.sourceName).toBe('TCGdex Japanese');
    expect(reference.sourceCardId).toBe('S6a-094');
  });

  it('uses exact Japanese promo code matches when the correct localId exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD' && url.includes('/sv3pt5/170_hires.png')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'swsh35-76',
                name: 'Gardevoir',
                nationalPokedexNumbers: [282]
              }
            ]
          })
        } as Response;
      }
      if (url.includes('api.tcgdex.net') && url.includes('dexId=282')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'jp-sm-p-408',
              localId: '408/SM-P',
              image: 'https://assets.tcgdex.net/ja/sm-p/408'
            }
          ])
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Gardevoir 408/SM-P PROMO Limited Illustration Promo Pokemon Card Japanese',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Gardevoir 408/SM-P PROMO Limited Illustration Promo Pokemon Card Japanese',
      requiredEvidenceTokens: ['gardevoir', '408/sm-p', 'japanese']
    });

    expect(reference.imageUrl).toBe('https://pkmhobby.com/cdn/shop/files/57_587a877b-0632-4034-b953-de90cfa8846b.jpg?crop=center&height=1200&v=1738722480&width=1200');
    expect(reference.sourceName).toBe('PKMhobby');
    expect(reference.sourceCardId).toBe('408/SM-P');
  });

  it('does not accept a non-matching Japanese card image when a promo code is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'swsh35-76',
                name: 'Gardevoir',
                nationalPokedexNumbers: [282]
              }
            ]
          })
        } as Response;
      }
      if (url.includes('api.tcgdex.net') && url.includes('dexId=282')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'ja_s12a_055',
              localId: '055',
              image: 'https://assets.tcgdex.net/ja/S/S12a/055'
            }
          ])
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Gardevoir Nintendo Promo 024/P Japanese',
      lane: 'promo cards',
      laneWhy: 'promo cards',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: 'Gardevoir Nintendo Promo 024/P Japanese Pokemon card',
      requiredEvidenceTokens: ['gardevoir', 'nintendo', '024', 'japanese']
    });

    expect(reference.imageUrl).toBeUndefined();
    expect(reference.sourceStatus).toBe('NOT_FOUND');
  });

  it('refetches transient reference-image failures instead of serving them from cache', async () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      sourceStatus: 'TIMEOUT'
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' })
    })));

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

  it('canonicalizes Pokemon TCG reference images to trusted hires art', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'me2pt5-281',
                name: "Team Rocket's Mewtwo ex",
                number: '281',
                set: { name: 'Ascended Heroes' },
                images: { small: 'https://images.scrydex.com/pokemon/me2pt5-281/small' }
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: "Team Rocket's Mewtwo ex Ascended Heroes 281",
      lane: 'format trail',
      laneWhy: 'format trail',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: "Team Rocket's Mewtwo ex Ascended Heroes 281 Pokemon card",
      requiredEvidenceTokens: ['team', 'rocket', '281']
    });

    expect(reference.imageUrl).toBe('https://cdn11.bigcommerce.com/s-b4ioc4fed9/products/569138/images/3745604/B733QTIMxsUolT8ZRSck3d5rT__08351.1779177196.386.513.jpg?c=1');
    expect(reference.sourceName).toBe('Magic Madhouse');
    expect(reference.sourceCardId).toBe('PE-ASC1-281');
  });

  it('uses curated image overrides for known broken discovery image sources', async () => {
    const reference = await fetchDiscoveryReferenceImage({
      name: "Team Rocket's Mewtwo ex Ascended Heroes 281",
      lane: 'format trail',
      laneWhy: 'format trail',
      why: 'try this',
      nearby: [],
      evidenceSearchTerm: "Team Rocket's Mewtwo ex Ascended Heroes 281 Pokemon card",
      requiredEvidenceTokens: ['team', 'rocket', '281']
    });

    expect(reference.imageUrl).toBe('https://cdn11.bigcommerce.com/s-b4ioc4fed9/products/569138/images/3745604/B733QTIMxsUolT8ZRSck3d5rT__08351.1779177196.386.513.jpg?c=1');
    expect(reference.sourceName).toBe('Magic Madhouse');
    expect(reference.sourceCardId).toBe('PE-ASC1-281');
  });

  it('refetches malformed cached timestamps instead of treating them as fresh', async () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      sourceStatus: 'NOT_FOUND',
      fetchedAt: 'not-a-date'
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' })
    })));

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

  it('revalidates cached dead image URLs and refetches a fresh reference', async () => {
    upsertDiscoveryReferenceCache({
      cacheKey,
      suggestionName: testName,
      imageUrl: 'https://images.pokemontcg.io/test/dead.png',
      sourceName: 'Pokemon TCG',
      sourceCardId: 'dead-1'
    });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD' && url.includes('/dead.png')) {
        return {
          ok: false,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (init?.method === 'HEAD' && url.includes('/fresh.png')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: testName,
      lane: 'test',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      referenceImageUrl: 'https://images.pokemontcg.io/test/fresh.png',
      referenceSourceName: 'Curated test reference'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/test/fresh.png');
    expect(getDiscoveryReferenceCache(cacheKey)?.imageUrl).toBe('https://images.pokemontcg.io/test/fresh.png');
  });

  it('replaces a cached Pokemon marketplace photo when the exact resolved printing disagrees', async () => {
    const suggestionName = 'Squirtle 151 170';
    const suggestionCacheKey = discoveryReferenceCacheKey(suggestionName);
    deleteDiscoveryReferenceCache(suggestionCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: suggestionCacheKey,
      suggestionName,
      imageUrl: 'https://marketplace.example/squirtle-old-photo.png',
      sourceName: 'Curated reference',
      sourceCardId: 'sv3pt5-170'
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'sv3pt5-170',
                name: 'Squirtle',
                number: '170',
                set: { name: '151' }
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: suggestionName,
      lane: 'collector path',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: 'Squirtle 151 170 Pokemon card',
      referenceImageUrl: 'https://marketplace.example/squirtle-old-photo.png',
      referenceSourceName: 'Curated reference',
      referenceSourceCardId: 'sv3pt5-170'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(reference?.sourceCardId).toBe('sv3pt5-170');
    expect(getDiscoveryReferenceCache(suggestionCacheKey)?.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(warnSpy).toHaveBeenCalledWith(
      '[DiscoveryReference] Repaired mismatched Pokemon reference image',
      expect.objectContaining({
        suggestionName,
        diagnosticReason: 'REFERENCE_IMAGE_IDENTITY_MISMATCH'
      })
    );

    deleteDiscoveryReferenceCache(suggestionCacheKey);
  });

  it('repairs a fresh reachable cached Pokemon marketplace photo instead of returning it', async () => {
    const suggestionName = 'Squirtle 151 170';
    const suggestionCacheKey = discoveryReferenceCacheKey(suggestionName);
    deleteDiscoveryReferenceCache(suggestionCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: suggestionCacheKey,
      suggestionName,
      imageUrl: 'https://marketplace.example/squirtle-fresh-photo.png',
      sourceName: 'Curated reference',
      sourceCardId: 'sv3pt5-170',
      fetchedAt: new Date().toISOString()
    });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD' && url === 'https://marketplace.example/squirtle-fresh-photo.png') {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' })
        } as Response;
      }
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'sv3pt5-170',
                name: 'Squirtle',
                number: '170',
                set: { name: '151' }
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: suggestionName,
      lane: 'collector path',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: 'Squirtle 151 170 Pokemon card',
      referenceImageUrl: 'https://marketplace.example/squirtle-fresh-photo.png',
      referenceSourceName: 'Curated reference',
      referenceSourceCardId: 'sv3pt5-170'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(reference?.diagnosticReason).toBe('REFERENCE_IMAGE_IDENTITY_MISMATCH');

    deleteDiscoveryReferenceCache(suggestionCacheKey);
  });

  it('reuses a verified exact Pokemon TCG cache hit without refetching', async () => {
    const suggestionName = 'Squirtle 151 170';
    const suggestionCacheKey = discoveryReferenceCacheKey(suggestionName);
    deleteDiscoveryReferenceCache(suggestionCacheKey);
    upsertDiscoveryReferenceCache({
      cacheKey: suggestionCacheKey,
      suggestionName,
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/170_hires.png',
      sourceName: 'Pokemon TCG (151)',
      sourceCardId: 'sv3pt5-170',
      fetchedAt: new Date().toISOString()
    });

    const fetchSpy = vi.fn(async () => {
      throw new Error('should not refetch verified canonical art');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const reference = await getOrFetchDiscoveryReferenceImage({
      name: suggestionName,
      lane: 'collector path',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: 'Squirtle 151 170 Pokemon card',
      referenceImageUrl: 'https://images.pokemontcg.io/sv3pt5/170_hires.png',
      referenceSourceName: 'Pokemon TCG (151)',
      referenceSourceCardId: 'sv3pt5-170'
    }, 60 * 60 * 1000);

    expect(reference?.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(fetchSpy).not.toHaveBeenCalled();

    deleteDiscoveryReferenceCache(suggestionCacheKey);
  });

  it('refreshes Squirtle 151 170 to canonical API artwork instead of preserving a listing-style photograph', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'sv3pt5-170',
                name: 'Squirtle',
                number: '170',
                set: { name: '151' },
                images: { large: 'https://listing.example/wrong-squirtle-photo.jpg' }
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: 'Squirtle 151 170',
      lane: 'collector path',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: 'Squirtle 151 170 Pokemon card',
      referenceImageUrl: 'https://listing.example/wrong-squirtle-photo.jpg',
      referenceSourceName: 'Listing photo',
      referenceSourceCardId: 'sv3pt5-170'
    });

    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/sv3pt5/170_hires.png');
    expect(reference.imageUrl?.includes('listing.example')).toBe(false);
  });

  it('preserves exact Pokemon TCG variant image URLs with suffix identifiers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'cel25c-24_A',
                name: "_____'s Pikachu",
                number: '24_A',
                set: { name: 'Celebrations: Classic Collection' },
                images: { large: 'https://images.pokemontcg.io/cel25c/24_A_hires.png' }
              }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }));

    const reference = await fetchDiscoveryReferenceImage({
      name: "_____'s Pikachu Celebrations: Classic Collection 24",
      lane: 'classic collection',
      laneWhy: 'test',
      why: 'test',
      nearby: [],
      evidenceSearchTerm: "_____'s Pikachu Celebrations Classic Collection 24 Pokemon card",
      referenceSourceCardId: 'cel25c-24_A'
    });

    expect(reference.sourceCardId).toBe('cel25c-24_A');
    expect(reference.imageUrl).toBe('https://images.pokemontcg.io/cel25c/24_A_hires.png');
  });
});
