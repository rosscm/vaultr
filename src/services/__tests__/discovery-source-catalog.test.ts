import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDiscoverySourceCatalogCache, pokemonTcgCatalogQueriesForSuggestion, resolveSourceBackedDiscoveryCards } from '../discovery-source-catalog.js';
import type { Chase } from '../../types.js';

const originalFetch = globalThis.fetch;

function chase(cardName: string): Chase {
  return {
    id: cardName,
    userId: 'u1',
    cardName,
    createdAt: '2026-06-03T00:00:00.000Z'
  };
}

function priorityChase(cardName: string, priority: Chase['priority']): Chase {
  return { ...chase(cardName), priority };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDiscoverySourceCatalogCache();
  vi.restoreAllMocks();
});

describe('discovery source catalog', () => {
  it('builds Pokemon TCG catalog queries from broad taste threads', () => {
    const queries = pokemonTcgCatalogQueriesForSuggestion({
      name: 'Pokemon promo cards',
      lane: 'Promo Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'Pokemon promo cards',
      requiredEvidenceTokens: ['promo']
    });

    expect(queries).toContain('supertype:Pokemon rarity:Promo');
  });

  it('builds e-reader era source queries from e-reader taste threads', () => {
    const queries = pokemonTcgCatalogQueriesForSuggestion({
      name: 'e-reader Pokemon cards',
      lane: 'E-Reader Era Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'e-reader Pokemon cards',
      requiredEvidenceTokens: ['e-reader']
    });

    expect(queries).toEqual(expect.arrayContaining(['supertype:Pokemon set.series:"E-Card"', 'supertype:Pokemon set.name:Expedition']));
  });

  it('keeps source expansion alive when one expanded catalog query times out', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (query.includes('set.series')) {
        const error = new Error('timeout');
        error.name = 'AbortError';
        throw error;
      }
      const data = query.includes('set.name:Expedition')
        ? [
            {
              id: 'ecard-pikachu-124',
              name: 'Pikachu',
              number: '124',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              nationalPokedexNumbers: [25],
              set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15' },
              images: { small: 'https://images.example/pikachu-expedition.png' }
            }
          ]
        : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'e-reader Pokemon cards',
        lane: 'E-Reader Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'e-reader Pokemon cards',
        requiredEvidenceTokens: ['e-reader'],
        sourceTasteTokens: ['e-reader', 'vintage']
      },
      [],
      3,
      []
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Pikachu Expedition Base Set 124']);
  });

  it('uses active profile identity terms to find e-reader cards beyond the broad catalog page', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"zapdos"')
        ? [
            {
              id: 'ecard-zapdos-h32',
              name: 'Zapdos',
              number: 'H32',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Rare Holo',
              nationalPokedexNumbers: [145],
              set: { name: 'Aquapolis', series: 'E-Card', releaseDate: '2003/01/15' },
              images: { small: 'https://images.example/zapdos-aquapolis.png' }
            }
          ]
        : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'e-reader Pokemon cards',
        lane: 'E-Reader Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'e-reader Pokemon cards',
        requiredEvidenceTokens: ['e-reader'],
        sourceTasteTokens: ['e-reader', 'vintage']
      },
      [chase('Moltres Zapdos Articuno SM210')],
      3,
      [chase('Moltres Zapdos Articuno SM210')]
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Zapdos Aquapolis H32']);
  });

  it('ranks active-profile e-reader query results ahead of broad e-reader page results', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"moltres"')
        ? [
            {
              id: 'ecard-moltres-h20',
              name: 'Moltres',
              number: 'H20',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Rare Holo',
              nationalPokedexNumbers: [146],
              set: { name: 'Skyridge', series: 'E-Card', releaseDate: '2003/05/12' },
              images: { small: 'https://images.example/moltres-skyridge.png' }
            }
          ]
        : query.includes('set.name:Skyridge')
          ? [
              {
                id: 'ecard-umbreon-h30',
                name: 'Umbreon',
                number: 'H30',
                supertype: 'Pokemon',
                subtypes: ['Stage 1'],
                rarity: 'Rare Holo',
                nationalPokedexNumbers: [197],
                set: { name: 'Skyridge', series: 'E-Card', releaseDate: '2003/05/12' },
                images: { small: 'https://images.example/umbreon-skyridge.png' }
              }
            ]
          : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'e-reader Pokemon cards',
        lane: 'E-Reader Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'e-reader Pokemon cards',
        requiredEvidenceTokens: ['e-reader'],
        sourceTasteTokens: ['e-reader', 'vintage']
      },
      [chase('Moltres Zapdos Articuno SM210')],
      2,
      [chase('Moltres Zapdos Articuno SM210')]
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Moltres Skyridge H20']);
  });

  it('turns broad taste threads into named source-backed cards', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'swshp-SWSH118',
              name: 'Eevee VMAX',
              number: 'SWSH118',
              supertype: 'Pokemon',
              subtypes: ['VMAX', 'Promo'],
              rarity: 'Promo',
              set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield' },
              images: { small: 'https://images.pokemontcg.io/swshp/SWSH118.png', large: 'https://images.pokemontcg.io/swshp/SWSH118_hires.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo']
      },
      [],
      3
    );

    expect(resolved.suggestions[0]?.name).toBe('Eevee VMAX SWSH Black Star Promos SWSH118');
    expect(resolved.suggestions[0]?.referenceSourceName).toBe('Pokemon TCG (SWSH Black Star Promos)');
    expect(resolved.suggestions[0]?.evidenceSearchTerm).toBe('Eevee VMAX SWSH Black Star Promos SWSH118 Pokemon card');
  });

  it('caches repeated source API lookups for the same catalog query', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'swshp-SWSH118',
              name: 'Eevee VMAX',
              number: 'SWSH118',
              supertype: 'Pokemon',
              subtypes: ['VMAX', 'Promo'],
              rarity: 'Promo',
              set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield' },
              images: { small: 'https://images.pokemontcg.io/swshp/SWSH118.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock as any;

    const suggestion = {
      name: 'Pokemon promo cards',
      lane: 'Promo Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'Pokemon promo cards',
      requiredEvidenceTokens: ['promo']
    };

    await resolveSourceBackedDiscoveryCards(suggestion, [], 3);
    await resolveSourceBackedDiscoveryCards(suggestion, [], 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ranks source cards by taste and metadata instead of API alphabetical order', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'svp-60',
              name: 'Aegislash',
              number: '60',
              supertype: 'Pokemon',
              subtypes: ['Stage 2'],
              rarity: 'Promo',
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
              images: { small: 'https://images.pokemontcg.io/svp/60.png' }
            },
            {
              id: 'svp-50',
              name: 'Alakazam ex',
              number: '50',
              supertype: 'Pokemon',
              subtypes: ['Stage 2', 'ex'],
              rarity: 'Promo',
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
              images: { small: 'https://images.pokemontcg.io/svp/50.png', large: 'https://images.pokemontcg.io/svp/50_hires.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'ex']
      },
      [],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Alakazam ex Scarlet & Violet Black Star Promos 50']);
  });

  it('does not promote ex promos when the profile has no ex taste signal', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"squirtle"')
        ? [
            {
              id: 'base1-63',
              name: 'Squirtle',
              number: '63',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              types: ['Water'],
              nationalPokedexNumbers: [7],
              set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
            }
          ]
        : [
            {
              id: 'svp-49',
              name: 'Zapdos ex',
              number: '49',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Promo',
              types: ['Lightning'],
              nationalPokedexNumbers: [145],
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
              images: { small: 'https://images.pokemontcg.io/svp/49.png' }
            },
            {
              id: 'swshp-SWSH233',
              name: 'Squirtle Illustration Collection',
              number: 'SWSH233',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Promo',
              types: ['Water'],
              nationalPokedexNumbers: [7],
              set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield', releaseDate: '2022/07/01' },
              images: { small: 'https://images.pokemontcg.io/swshp/SWSH233.png' }
            }
          ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo']
      },
      [priorityChase('Squirtle 007/018', 'GRAIL')],
      2
    );

    expect(resolved.suggestions[0]?.name).toBe('Squirtle Illustration Collection SWSH Black Star Promos SWSH233');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Zapdos ex Scarlet & Violet Black Star Promos 49');
  });

  it('deprioritizes modern plain promos when stronger collector-shaped cards are available', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'svp-101',
              name: 'Pikachu',
              number: '101',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Promo',
              types: ['Lightning'],
              nationalPokedexNumbers: [25],
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
              images: { small: 'https://images.pokemontcg.io/svp/101.png' }
            },
            {
              id: 'smp-SM168',
              name: 'Pikachu & Zekrom-GX',
              number: 'SM168',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'TAG TEAM', 'GX'],
              rarity: 'Promo',
              types: ['Lightning'],
              nationalPokedexNumbers: [25, 644],
              set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' },
              images: { small: 'https://images.pokemontcg.io/smp/SM168.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'special', 'tag team', 'gx']
      },
      [priorityChase('Pikachu 26/83 promo', 'HIGH'), chase('Moltres Zapdos Articuno SM210')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Pikachu & Zekrom-GX SM Black Star Promos SM168']);
  });

  it('does not treat SIR ex names as permission to recommend ordinary ex cards', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mega gardevoir ex"') || query.includes('name:"mega"')
        ? [
            {
              id: 'me1-360',
              name: 'Mega Gardevoir ex',
              number: '360',
              supertype: 'Pokemon',
              subtypes: ['Stage 1', 'Mega', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [282],
              set: { name: 'Mega Evolution', series: 'Mega Evolution', releaseDate: '2026/09/26' },
              images: { small: 'https://images.pokemontcg.io/me1/360.png' }
            }
          ]
        : [
            {
              id: 'svp-49',
              name: 'Zapdos ex',
              number: '49',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Double Rare',
              types: ['Lightning'],
              nationalPokedexNumbers: [145],
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
              images: { small: 'https://images.pokemontcg.io/svp/49.png' }
            }
          ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'ex']
      },
      [priorityChase('Mega Gardevoir ex 360/132', 'GRAIL')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Zapdos ex Scarlet & Violet Black Star Promos 49');
  });

  it('still allows premium illustration cards whose names include ex', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mega gardevoir ex"') || query.includes('name:"mega"')
        ? [
            {
              id: 'me1-360',
              name: 'Mega Gardevoir ex',
              number: '360',
              supertype: 'Pokemon',
              subtypes: ['Stage 1', 'Mega', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [282],
              set: { name: 'Mega Evolution', series: 'Mega Evolution', releaseDate: '2026/09/26' },
              images: { small: 'https://images.pokemontcg.io/me1/360.png' }
            }
          ]
        : [
            {
              id: 'sv4a-245',
              name: 'Gardevoir ex',
              number: '245',
              supertype: 'Pokemon',
              subtypes: ['Stage 2', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [282],
              set: { name: 'Scarlet & Violet', series: 'Scarlet & Violet', releaseDate: '2023/03/31' },
              images: { small: 'https://images.pokemontcg.io/sv4a/245.png' }
            }
          ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon illustration rare cards',
        lane: 'Illustration Rarity Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon illustration rare cards',
        requiredEvidenceTokens: ['illustration', 'rare'],
        sourceTasteTokens: ['illustration', 'rare']
      },
      [priorityChase('Mega Gardevoir ex 360/132', 'GRAIL')],
      2
    );

    expect(resolved.suggestions[0]?.name).toBe('Gardevoir ex Scarlet & Violet 245');
  });

  it('uses active source-profile metadata to prefer matching collector energy over generic modern promos', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mew"')
        ? [
            {
              id: 'bw11-RC24',
              name: 'Mew-EX',
              number: 'RC24',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'EX'],
              rarity: 'Rare Ultra',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Legendary Treasures', series: 'Black & White', releaseDate: '2013/11/06' }
            }
          ]
        : query.includes('name:"moltres"')
          ? [
              {
                id: 'smp-SM210',
                name: 'Moltres & Zapdos & Articuno-GX',
                number: 'SM210',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'TAG TEAM', 'GX'],
                rarity: 'Promo',
                types: ['Colorless'],
                nationalPokedexNumbers: [144, 145, 146],
                set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' }
              }
            ]
          : query.includes('subtypes:"TAG TEAM"')
            ? [
                {
                  id: 'smp-SM191',
                  name: 'Mewtwo & Mew-GX',
                  number: 'SM191',
                  supertype: 'Pokemon',
                  subtypes: ['Basic', 'TAG TEAM', 'GX'],
                  rarity: 'Promo',
                  types: ['Psychic'],
                  nationalPokedexNumbers: [150, 151],
                  set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' },
                  images: { small: 'https://images.pokemontcg.io/smp/SM191.png' }
                }
              ]
            : [
                {
                  id: 'svp-162',
                  name: 'Houndstone ex',
                  number: '162',
                  supertype: 'Pokemon',
                  subtypes: ['Stage 1', 'ex'],
                  rarity: 'Promo',
                  types: ['Psychic'],
                  nationalPokedexNumbers: [972],
                  set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' },
                  images: { small: 'https://images.pokemontcg.io/svp/162.png' }
                }
              ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'special']
      },
      [chase('Mew LP MP it RC24'), chase('Moltres Zapdos Articuno SM210')],
      2
    );

    expect(resolved.suggestions[0]?.name).toBe('Mewtwo & Mew-GX SM Black Star Promos SM191');
  });

  it('prefers Japanese source cards when the taste profile carries Japanese signals', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'bw11-RC24',
                name: 'Mew-EX',
                number: 'RC24',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'EX'],
                rarity: 'Rare Ultra',
                types: ['Psychic'],
                nationalPokedexNumbers: [151],
                set: { name: 'Legendary Treasures', series: 'Black & White', releaseDate: '2013/11/06' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.pathname === '/v2/ja/cards') {
        return new Response(
          JSON.stringify([
            { id: 'S12a-052', localId: '052', name: 'ミュウ', image: 'https://assets.tcgdex.net/ja/S/S12a/052' },
            { id: 'SVK-006', localId: '006', name: 'ミュウex', image: 'https://assets.tcgdex.net/ja/SV/SVK/006' },
            { id: 'PMCG6-055', localId: '055', name: 'ロケットのミュウツー' }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const card = url.pathname.endsWith('/S12a-052')
        ? {
            category: 'Pokemon',
            id: 'S12a-052',
            localId: '052',
            name: 'ミュウ',
            image: 'https://assets.tcgdex.net/ja/S/S12a/052',
            rarity: 'Rare',
            set: { id: 'S12a', name: 'VSTARユニバース' },
            dexId: [151],
            types: ['Psychic'],
            stage: 'Basic'
          }
        : url.pathname.endsWith('/SVK-006')
          ? {
              category: 'Pokemon',
              id: 'SVK-006',
              localId: '006',
              name: 'ミュウex',
              image: 'https://assets.tcgdex.net/ja/SV/SVK/006',
              rarity: 'None',
              set: { id: 'SVK', name: 'デッキビルドBOX ステラミラクル' },
              dexId: [151],
              types: ['Psychic'],
              stage: 'Basic',
              suffix: 'EX'
            }
        : {
            category: 'Pokemon',
            id: 'PMCG6-055',
            localId: '055',
            name: 'ロケットのミュウツー',
            rarity: 'Holo Rare',
            set: { id: 'PMCG6', name: '闇からの挑戦' },
            dexId: [150],
            types: ['Psychic'],
            stage: 'Basic'
          };
      return new Response(JSON.stringify(card), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Japanese promo Pokemon cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Japanese promo Pokemon cards',
        requiredEvidenceTokens: ['japanese', 'promo'],
        sourceTasteTokens: ['japanese', 'special', 'promo']
      },
      [chase('Mew LP MP it RC24')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.referenceSourceName)).toEqual(
      expect.arrayContaining(['TCGdex Japanese (SVK)', 'TCGdex Japanese (S12a)'])
    );
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(
      expect.arrayContaining(['Mew Japanese SVK 006', 'Mew Japanese S12a 052'])
    );
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('ロケットのミュウツー 闇からの挑戦 055');
    expect(resolved.suggestions[0]?.requiredEvidenceTokens).toContain('japanese');
  });

  it('uses Japanese-coded active chases to resolve broad promo threads through TCGdex', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        const query = url.searchParams.get('q') ?? '';
        const data = query.includes('name:"pikachu"')
          ? [
              {
                id: 'base1-58',
                name: 'Pikachu',
                number: '58',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Lightning'],
                nationalPokedexNumbers: [25],
                set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
              }
            ]
          : [];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/v2/ja/cards') {
        return new Response(
          JSON.stringify([
            { id: 'S12a-205', localId: '205', name: 'ピカチュウ', image: 'https://assets.tcgdex.net/ja/S/S12a/205' },
            { id: 'SV8a-236', localId: '236', name: 'ピカチュウex', image: 'https://assets.tcgdex.net/ja/SV/SV8a/236' }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const card = url.pathname.endsWith('/SV8a-236')
        ? {
            category: 'Pokemon',
            id: 'SV8a-236',
            localId: '236',
            name: 'ピカチュウex',
            image: 'https://assets.tcgdex.net/ja/SV/SV8a/236',
            rarity: 'SAR',
            set: { id: 'SV8a', name: 'テラスタルフェスex' },
            dexId: [25],
            types: ['Lightning'],
            stage: 'Basic',
            suffix: 'EX'
          }
        : {
            category: 'Pokemon',
            id: 'S12a-205',
            localId: '205',
            name: 'ピカチュウ',
            image: 'https://assets.tcgdex.net/ja/S/S12a/205',
            rarity: 'Secret Rare',
            set: { id: 'S12a', name: 'VSTARユニバース' },
            dexId: [25],
            types: ['Lightning'],
            stage: 'Basic'
          };
      return new Response(JSON.stringify(card), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'special']
      },
      [chase('Mario Pikachu XY-P 294'), chase('Munch Psyduck 286/SM-P'), chase('Kanazawa Pikachu 144/S-P')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.referenceSourceName)).toEqual(
      expect.arrayContaining(['TCGdex Japanese (SV8a)', 'TCGdex Japanese (S12a)'])
    );
    expect(resolved.suggestions.every((suggestion) => suggestion.requiredEvidenceTokens?.includes('japanese'))).toBe(true);
  });

  it('deprioritizes ordinary modern Japanese rare cards behind stronger collector rarities', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'base1-58',
                name: 'Pikachu',
                number: '58',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Lightning'],
                nationalPokedexNumbers: [25],
                set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.pathname === '/v2/ja/cards') {
        return new Response(
          JSON.stringify([
            { id: 'SV2a-025', localId: '025', name: 'ピカチュウ', image: 'https://assets.tcgdex.net/ja/SV/SV2a/025' },
            { id: 'S12a-205', localId: '205', name: 'ピカチュウ', image: 'https://assets.tcgdex.net/ja/S/S12a/205' }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const card = url.pathname.endsWith('/SV2a-025')
        ? {
            category: 'Pokemon',
            id: 'SV2a-025',
            localId: '025',
            name: 'ピカチュウ',
            image: 'https://assets.tcgdex.net/ja/SV/SV2a/025',
            rarity: 'Rare',
            set: { id: 'SV2a', name: 'ポケモンカード151' },
            dexId: [25],
            types: ['Lightning'],
            stage: 'Basic'
          }
        : {
            category: 'Pokemon',
            id: 'S12a-205',
            localId: '205',
            name: 'ピカチュウ',
            image: 'https://assets.tcgdex.net/ja/S/S12a/205',
            rarity: 'AR',
            set: { id: 'S12a', name: 'VSTARユニバース' },
            dexId: [25],
            types: ['Lightning'],
            stage: 'Basic'
          };
      return new Response(JSON.stringify(card), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Japanese Pokemon cards',
        lane: 'Japanese Collector Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Japanese Pokemon cards',
        requiredEvidenceTokens: ['japanese'],
        sourceTasteTokens: ['japanese']
      },
      [priorityChase('Mario Pikachu XY-P 294', 'GRAIL')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Pikachu Japanese S12a 205']);
  });

  it('lets generic threads mix Japanese and English source cards while keeping Japanese grails first', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        const query = url.searchParams.get('q') ?? '';
        const data = query.includes('name:"pikachu"')
          ? [
              {
                id: 'base1-58',
                name: 'Pikachu',
                number: '58',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Lightning'],
                nationalPokedexNumbers: [25],
                set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
              }
            ]
          : [
              {
                id: 'smp-SM191',
                name: 'Mewtwo & Mew-GX',
                number: 'SM191',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'TAG TEAM', 'GX'],
                rarity: 'Promo',
                types: ['Psychic'],
                nationalPokedexNumbers: [150, 151],
                set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' }
              },
              {
                id: 'smp-SM168',
                name: 'Pikachu & Zekrom-GX',
                number: 'SM168',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'TAG TEAM', 'GX'],
                rarity: 'Promo',
                types: ['Lightning'],
                nationalPokedexNumbers: [25, 644],
                set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' }
              }
            ];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/v2/ja/cards') {
        return new Response(JSON.stringify([{ id: 'SV2a-025', localId: '025', name: 'ピカチュウ', image: 'https://assets.tcgdex.net/ja/SV/SV2a/025' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SV2a-025',
          localId: '025',
          name: 'ピカチュウ',
          image: 'https://assets.tcgdex.net/ja/SV/SV2a/025',
          rarity: 'AR',
          set: { id: 'SV2a', name: 'ポケモンカード151' },
          dexId: [25],
          types: ['Lightning'],
          stage: 'Basic'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'special']
      },
      [priorityChase('Pikachu XY-P 294', 'GRAIL'), priorityChase('Mew LP MP it RC24', 'NORMAL'), priorityChase('Moltres Zapdos Articuno SM210', 'NORMAL')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.referenceSourceName)).toEqual(
      expect.arrayContaining(['TCGdex Japanese (SV2a)', 'Pokemon TCG (SM Black Star Promos)'])
    );
  });

  it('treats Japanese-exclusive release shapes as Japanese source signals even without literal JPN text', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        const query = url.searchParams.get('q') ?? '';
        const data = query.includes('name:"shining"')
          ? [
              {
                id: 'neo4-66',
                name: 'Shining Magikarp',
                number: '66',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Rare Shining',
                types: ['Water'],
                nationalPokedexNumbers: [129],
                set: { name: 'Neo Revelation', series: 'Neo', releaseDate: '2001/09/21' }
              }
            ]
          : query.includes('name:"mew"')
          ? [
              {
                id: 'base1-151',
                name: 'Mew',
                number: '151',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Rare',
                types: ['Psychic'],
                nationalPokedexNumbers: [151],
                set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
              }
            ]
          : [
              {
                id: 'smp-SM191',
                name: 'Mewtwo & Mew-GX',
                number: 'SM191',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'TAG TEAM', 'GX'],
                rarity: 'Promo',
                types: ['Psychic'],
                nationalPokedexNumbers: [150, 151],
                set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/05/03' }
              }
            ];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/v2/ja/cards') {
        const dexId = url.searchParams.get('dexId');
        const summaries = dexId === '129'
          ? [{ id: 'SV1a-022', localId: '022', name: 'コイキング', image: 'https://assets.tcgdex.net/ja/SV/SV1a/022' }]
          : [{ id: 'SV2a-151', localId: '151', name: 'ミュウ', image: 'https://assets.tcgdex.net/ja/SV/SV2a/151' }];
        return new Response(JSON.stringify(summaries), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname.endsWith('/SV1a-022')) {
        return new Response(
          JSON.stringify({
            category: 'Pokemon',
            id: 'SV1a-022',
            localId: '022',
            name: 'コイキング',
            image: 'https://assets.tcgdex.net/ja/SV/SV1a/022',
            rarity: 'Rare',
            set: { id: 'SV1a', name: 'トリプレットビート' },
            dexId: [129],
            types: ['Water'],
            stage: 'Basic'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SV2a-151',
          localId: '151',
          name: 'ミュウ',
          image: 'https://assets.tcgdex.net/ja/SV/SV2a/151',
          rarity: 'AR',
          set: { id: 'SV2a', name: 'ポケモンカード151' },
          dexId: [151],
          types: ['Psychic'],
          stage: 'Basic'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo', 'special']
      },
      [
        priorityChase('Squirtle 007/018', 'GRAIL'),
        priorityChase('Corocoro Shining Mew', 'HIGH'),
        priorityChase('Mew 347/190', 'NORMAL'),
        priorityChase('Mega Gardevoir 087/063', 'NORMAL'),
        priorityChase('Moltres Zapdos Articuno SM210', 'NORMAL')
      ],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.referenceSourceName)).toEqual(['TCGdex Japanese (SV2a)']);
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Mewtwo & Mew-GX SM Black Star Promos SM191');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('コイキング トリプレットビート 022');
  });

  it('resolves Japanese-only threads through TCGdex before declaring them unsupported', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        const query = url.searchParams.get('q') ?? '';
        const data = query.includes('name:"pikachu"')
          ? [
              {
                id: 'base1-58',
                name: 'Pikachu',
                number: '58',
                supertype: 'Pokemon',
                types: ['Lightning'],
                nationalPokedexNumbers: [25],
                set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' }
              }
            ]
          : [];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/v2/ja/cards') {
        return new Response(JSON.stringify([{ id: 'SV2a-025', localId: '025', name: 'ピカチュウ', image: 'https://assets.tcgdex.net/ja/SV/SV2a/025' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SV2a-025',
          localId: '025',
          name: 'ピカチュウ',
          image: 'https://assets.tcgdex.net/ja/SV/SV2a/025',
          set: { id: 'SV2a', name: 'ポケモンカード151' },
          dexId: [25],
          types: ['Lightning'],
          stage: 'Basic'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Japanese Pokemon cards',
        lane: 'Japanese Collector Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Japanese Pokemon cards',
        requiredEvidenceTokens: ['japanese'],
        sourceTasteTokens: ['japanese']
      },
      [chase('Mario Pikachu XY-P 294'), chase('Kanazawa Pikachu 144/S-P')],
      1
    );

    expect(resolved.sourceStatus).toBeUndefined();
    expect(resolved.suggestions[0]?.name).toBe('Pikachu Japanese SV2a 025');
  });

  it('does not let broad collector threads drift into unrelated modern source cards', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mew"')
        ? [
            {
              id: 'bw11-RC24',
              name: 'Mew-EX',
              number: 'RC24',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'EX'],
              rarity: 'Rare Ultra',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Legendary Treasures', series: 'Black & White', releaseDate: '2013/11/06' }
            }
          ]
        : query.includes('name:"zapdos"')
          ? [
              {
                id: 'svp-49',
                name: 'Zapdos ex',
                number: '49',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'ex'],
                rarity: 'Promo',
                types: ['Lightning'],
                nationalPokedexNumbers: [145],
                set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' }
              }
            ]
          : [
              {
                id: 'me4-96',
                name: 'Tauros',
                number: '96',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Rare',
                types: ['Colorless'],
                nationalPokedexNumbers: [128],
                set: { name: 'Chaos Rising', series: 'Mega Evolution', releaseDate: '2026/05/01' }
              },
              {
                id: 'me4-101',
                name: 'Mega Greninja ex',
                number: '101',
                supertype: 'Pokemon',
                subtypes: ['Mega', 'ex'],
                rarity: 'Rare Ultra',
                types: ['Water'],
                nationalPokedexNumbers: [658],
                set: { name: 'Chaos Rising', series: 'Mega Evolution', releaseDate: '2026/05/01' }
              },
              {
                id: 'svp-49',
                name: 'Zapdos ex',
                number: '49',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'ex'],
                rarity: 'Promo',
                types: ['Lightning'],
                nationalPokedexNumbers: [145],
                set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2023/01/01' }
              }
            ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon collector cards',
        lane: 'Collector Compass',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon collector cards',
        requiredEvidenceTokens: ['pokemon'],
        sourceTasteTokens: ['collector']
      },
      [chase('Mew LP MP it RC24'), chase('Zapdos lightning promo')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual([]);
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Zapdos ex Scarlet & Violet Black Star Promos 49');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Mega Greninja ex Chaos Rising 101');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Tauros Chaos Rising 96');
  });

  it('does not resolve broad collector threads when the source profile has no card anchors', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'mega-060',
              name: 'Metang',
              number: '60',
              supertype: 'Pokemon',
              subtypes: ['Stage 1'],
              rarity: 'Uncommon',
              nationalPokedexNumbers: [375],
              set: { name: 'Chaos Rising', series: 'Mega Evolution', releaseDate: '2026/05/01' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon collector cards',
        lane: 'Collector Compass',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon collector cards',
        requiredEvidenceTokens: ['pokemon'],
        sourceTasteTokens: ['collector']
      },
      [],
      3,
      []
    );

    expect(resolved.suggestions).toEqual([]);
  });

  it('still resolves special-release threads to premium collector shapes when profile anchors are unavailable', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:')
        ? []
        : [
            {
              id: 'sm-promos-SM168',
              name: 'Pikachu & Zekrom-GX',
              number: 'SM168',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'TAG TEAM', 'GX'],
              rarity: 'Promo',
              nationalPokedexNumbers: [25, 644],
              set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/01/01' },
              images: { small: 'https://images.example/pikachu-zekrom.png' }
            },
            {
              id: 'sv-teal-025',
              name: 'Teal Mask Ogerpon ex',
              number: '25',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Promo',
              nationalPokedexNumbers: [1017],
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2025/05/01' },
              images: { small: 'https://images.example/ogerpon.png' }
            }
          ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon special release cards',
        lane: 'Special Release Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon special release cards',
        requiredEvidenceTokens: ['pokemon'],
        sourceTasteTokens: ['promo', 'special']
      },
      [chase('Mew LP MP it RC24')],
      3,
      [chase('Mew LP MP it RC24')]
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Pikachu & Zekrom-GX SM Black Star Promos SM168']);
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Teal Mask Ogerpon ex Scarlet & Violet Black Star Promos 25');
  });

  it('does not resolve generic promo threads to unrelated cards when a user profile has no source anchors', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'sv-teal-025',
              name: 'Teal Mask Ogerpon ex',
              number: '25',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Promo',
              nationalPokedexNumbers: [1017],
              set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2025/05/01' },
              images: { small: 'https://images.example/ogerpon.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo']
      },
      [chase('Mew LP MP it RC24')],
      3,
      [chase('Mew LP MP it RC24')]
    );

    expect(resolved.suggestions).toEqual([]);
  });

  it('does not return cards already on the active chase list', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'cel25-25',
              name: 'Pikachu',
              number: '25',
              supertype: 'Pokemon',
              subtypes: ['Promo'],
              rarity: 'Promo',
              set: { name: 'Celebrations', series: 'Sword & Shield' },
              images: { small: 'https://images.pokemontcg.io/cel25/25.png' }
            },
            {
              id: 'swshp-SWSH118',
              name: 'Eevee VMAX',
              number: 'SWSH118',
              supertype: 'Pokemon',
              subtypes: ['VMAX', 'Promo'],
              rarity: 'Promo',
              set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield' },
              images: { small: 'https://images.pokemontcg.io/swshp/SWSH118.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo']
      },
      [chase('Pikachu 25/25')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Eevee VMAX SWSH Black Star Promos SWSH118']);
  });
});
