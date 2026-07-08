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

  it('builds source queries for McDonalds e-reader promo taste threads', () => {
    const queries = pokemonTcgCatalogQueriesForSuggestion({
      name: "Pikachu McDonald's e-Reader promo Pokemon cards",
      lane: 'Retail Promo Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: "Pikachu McDonald's e-Reader promo Pokemon card",
      requiredEvidenceTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds'],
      sourceTasteTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds']
    });

    expect(queries).toContain('supertype:Pokemon rarity:Promo');
    expect(queries).not.toContain('supertype:Pokemon set.name:"Nintendo Black Star Promos"');
  });

  it('builds source queries for same-set sibling special-set threads', () => {
    const queries = pokemonTcgCatalogQueriesForSuggestion({
      name: 'Sylveon Terastal Festival Pokemon cards',
      lane: 'Set Companion Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'sylveon Terastal Festival Japanese Pokemon card',
      requiredEvidenceTokens: ['sylveon', 'japanese', 'Terastal Festival', 'special set', 'small set', 'numbered set'],
      sourceTasteTokens: ['sylveon', 'japanese', 'Terastal Festival', 'special set', 'small set', 'numbered set']
    });

    expect(queries).toContain('supertype:Pokemon set.name:"Terastal Festival"');
  });

  it('does not send Japanese unique release identities to broad Pokemon TCG source lookup', () => {
    const queries = pokemonTcgCatalogQueriesForSuggestion({
      name: 'Raichu Japanese unique release Pokemon cards',
      lane: 'Japanese Collector Trail',
      laneWhy: 'profile',
      why: 'profile',
      nearby: [],
      evidenceSearchTerm: 'raichu Japanese unique release Pokemon card',
      requiredEvidenceTokens: ['raichu', 'japanese', 'exclusive', 'unique'],
      sourceTasteTokens: ['raichu', 'japanese', 'exclusive', 'unique']
    });

    expect(queries).toEqual([]);
  });

  it('turns broad taste threads into named source-backed cards', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'swshp-SWSH074',
              name: 'Special Delivery Pikachu',
              number: 'SWSH074',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'Promo'],
              rarity: 'Promo',
              nationalPokedexNumbers: [25],
              set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield' },
              images: { small: 'https://images.pokemontcg.io/swshp/SWSH074.png', large: 'https://images.pokemontcg.io/swshp/SWSH074_hires.png' }
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

    expect(resolved.suggestions[0]?.name).toBe('Special Delivery Pikachu SWSH Black Star Promos SWSH074');
    expect(resolved.suggestions[0]?.referenceSourceName).toBe('Pokemon TCG (SWSH Black Star Promos)');
    expect(resolved.suggestions[0]?.evidenceSearchTerm).toBe('Special Delivery Pikachu SWSH Black Star Promos SWSH074 Pokemon card');
  });

  it('does not inject curated Pikachu McDonalds identities from broad retail e-reader threads', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('Nintendo Black Star Promos')
        ? [
            {
              id: 'np-35',
              name: 'Pikachu δ',
              number: '35',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Promo',
              nationalPokedexNumbers: [25],
              set: { name: 'Nintendo Black Star Promos', series: 'NP', releaseDate: '2006/03/01' },
              images: { small: 'https://images.pokemontcg.io/np/35.png', large: 'https://images.pokemontcg.io/np/35_hires.png' }
            },
            {
              id: 'np-12',
              name: 'Pikachu',
              number: '12',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Promo',
              nationalPokedexNumbers: [25],
              set: { name: 'Nintendo Black Star Promos', series: 'NP', releaseDate: '2003/10/01' },
              images: { small: 'https://images.pokemontcg.io/np/12.png', large: 'https://images.pokemontcg.io/np/12_hires.png' }
            }
          ]
        : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: "Pikachu McDonald's e-Reader promo Pokemon cards",
        lane: 'Retail Promo Trail',
        laneWhy: 'same-subject retail e-reader promo variants',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: "Pikachu McDonald's e-Reader promo Pokemon card",
        requiredEvidenceTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds'],
        sourceTasteTokens: ['pikachu', 'promo', 'e-reader', 'mcdonalds']
      },
      [],
      3,
      [chase('Pikachu xy95'), chase('Squirtle 007/018 McDonalds e-Reader Promo')]
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain("Pikachu 010/018 Holo McDonald's Promo e-Reader 2002 Japanese");
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain("Pikachu McDonald's e-Reader Promo 12");
  });

  it('does not inject curated Raichu Intro Pack identities from broad Japanese unique-release threads', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Raichu Japanese unique release Pokemon cards',
        lane: 'Japanese Collector Trail',
        laneWhy: 'Japanese exclusiveness and unusual-release signals',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'raichu Japanese unique release Pokemon card',
        requiredEvidenceTokens: ['raichu', 'japanese', 'exclusive', 'unique'],
        sourceTasteTokens: ['raichu', 'japanese', 'exclusive', 'unique']
      },
      [],
      3,
      [chase('Pikachu 26/83 Toys R Us promo'), chase('Umbreon 217/187 Japanese'), chase('Corocoro Shining Mew')]
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese');
    expect(resolved.suggestions).toEqual([]);
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
      2,
      [chase('Pikachu')]
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

  it('filters off-profile modern promos from generic promo threads', async () => {
    const pikachuCard = {
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
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const query = new URL(String(input)).searchParams.get('q') ?? '';
      const data = query.includes('name:"pikachu"')
        ? [pikachuCard]
        : query.includes('name:"mew"')
          ? [
              {
                id: 'swsh12pt5gg-GG10',
                name: 'Mew',
                number: 'GG10',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Rare Holo',
                types: ['Psychic'],
                nationalPokedexNumbers: [151],
                set: { name: 'Crown Zenith Galarian Gallery', series: 'Sword & Shield', releaseDate: '2023/01/20' },
                images: { small: 'https://images.pokemontcg.io/swsh12pt5gg/GG10.png' }
              }
            ]
          : /\bname:"/i.test(query)
            ? []
            : [
              {
                id: 'svp-123',
                name: 'Teal Mask Ogerpon',
                number: '123',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Promo',
                types: ['Grass'],
                nationalPokedexNumbers: [1017],
                set: { name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', releaseDate: '2024/05/24' },
                images: { small: 'https://images.pokemontcg.io/svp/123.png' }
              },
              pikachuCard
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
      [priorityChase('Pikachu 26/83 Toys R Us promo', 'HIGH'), chase('Mew RC24')],
      4
    );

    const names = resolved.suggestions.map((suggestion) => suggestion.name);
    expect(names).not.toContain('Teal Mask Ogerpon Scarlet & Violet Black Star Promos 123');
    expect(names.length).toBeGreaterThan(0);
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

  it('uses resolved active card metadata to open e-reader source paths', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"squirtle" number:007')
        ? [
            {
              id: 'ecard-squirtle-007',
              name: 'Squirtle',
              number: '007',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              types: ['Water'],
              nationalPokedexNumbers: [7],
              set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15', printedTotal: 165 }
            }
          ]
        : query.includes('set.series:"E-Card"')
          ? [
              {
                id: 'ecard-articuno-h3',
                name: 'Articuno',
                number: 'H3',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Rare Holo',
                types: ['Water'],
                nationalPokedexNumbers: [144],
                set: { name: 'Skyridge', series: 'E-Card', releaseDate: '2003/05/12', printedTotal: 144 },
                images: { small: 'https://images.example/articuno-skyridge.png' }
              }
            ]
          : [];
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
        sourceTasteTokens: ['special']
      },
      [priorityChase('Squirtle 007/018', 'GRAIL')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toContain('Articuno Skyridge H3');
  });

  it('uses chase priority to rank source-backed e-reader identity matches without card-specific expectations', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"squirtle" number:007')
        ? [
            {
              id: 'ecard-squirtle-007',
              name: 'Squirtle',
              number: '007',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              types: ['Water'],
              nationalPokedexNumbers: [7],
              set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15', printedTotal: 165 }
            }
          ]
        : query.includes('set.series:"E-Card" name:"squirtle"')
          ? [
              {
                id: 'ecard-squirtle-132',
                name: 'Squirtle',
                number: '132',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Water'],
                nationalPokedexNumbers: [7],
                set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15', printedTotal: 165 },
                images: { small: 'https://images.example/squirtle-expedition.png' }
              }
            ]
          : query.includes('set.series:"E-Card" name:"articuno"')
            ? [
                {
                  id: 'ecard-articuno-h3',
                  name: 'Articuno',
                  number: 'H3',
                  supertype: 'Pokemon',
                  subtypes: ['Basic'],
                  rarity: 'Rare Holo',
                  types: ['Water'],
                  nationalPokedexNumbers: [144],
                  set: { name: 'Skyridge', series: 'E-Card', releaseDate: '2003/05/12', printedTotal: 144 },
                  images: { small: 'https://images.example/articuno-skyridge.png' }
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
      [priorityChase('Squirtle 007/018', 'GRAIL'), priorityChase('Articuno', 'NORMAL')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual(['Squirtle Expedition Base Set 132', 'Articuno Skyridge H3']);
  });

  it('does not surface unanchored broad vintage catalog filler when a profile exists', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mew"')
        ? [
            {
              id: 'ecard-mew-55',
              name: 'Mew',
              number: '55',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Rare Holo',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15' }
            }
          ]
        : query.includes('set.series:Base')
          ? [
              {
                id: 'base-zubat-70',
                name: 'Zubat',
                number: '70',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Grass'],
                nationalPokedexNumbers: [41],
                set: { name: 'Team Rocket', series: 'Base', releaseDate: '2000/04/24' },
                images: { small: 'https://images.example/zubat-rocket.png' }
              }
            ]
          : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'vintage Pokemon cards',
        lane: 'Vintage Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'vintage Pokemon cards',
        requiredEvidenceTokens: ['vintage'],
        sourceTasteTokens: ['vintage']
      },
      [priorityChase('Mew RC24', 'HIGH')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toContain('Mew Expedition Base Set 55');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Zubat Team Rocket 70');
  });

  it('uses resolved set size metadata rather than /018 text for compact-set profile expansion', async () => {
    const queries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      queries.push(query);
      const data = query.includes('name:"pikachu" number:001')
        ? [
            {
              id: 'mini-pikachu-001',
              name: 'Pikachu',
              number: '001',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              types: ['Lightning'],
              nationalPokedexNumbers: [25],
              set: { name: 'Tiny Source Set', series: 'Other', releaseDate: '2022/01/01', printedTotal: 18 }
            }
          ]
        : query === 'supertype:Pokemon'
          ? [
              {
                id: 'mini-eevee-002',
                name: 'Eevee',
                number: '002',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Common',
                types: ['Colorless'],
                nationalPokedexNumbers: [133],
                set: { name: 'Tiny Source Set', series: 'Other', releaseDate: '2022/01/01', printedTotal: 18 },
                images: { small: 'https://images.example/eevee-mini.png' }
              }
            ]
          : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    await resolveSourceBackedDiscoveryCards(
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
      [priorityChase('Pikachu 001/018', 'HIGH')],
      2
    );

    expect(queries).toContain('supertype:Pokemon');
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

  it('ignores overly broad TCGdex dex summaries so real Japanese profile matches survive', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        const query = url.searchParams.get('q') ?? '';
        const data = query.includes('name:"pikachu"')
          ? [
              {
                id: 'basep-26',
                name: 'Pikachu',
                number: '26',
                supertype: 'Pokemon',
                subtypes: ['Basic'],
                rarity: 'Promo',
                types: ['Lightning'],
                nationalPokedexNumbers: [25],
                set: { name: 'Wizards Black Star Promos', series: 'Base', releaseDate: '2000/07/01' }
              }
            ]
          : query.includes('name:"mew"')
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
            : [];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/v2/ja/cards') {
        if (url.searchParams.get('dexId') === '25') {
          return new Response(
            JSON.stringify(
              Array.from({ length: 70 }, (_, index) => ({ id: `NOISY-${index}`, localId: String(index + 1).padStart(3, '0'), name: `Noisy ${index}` }))
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.searchParams.get('dexId') === '151') {
          return new Response(JSON.stringify([{ id: 'S12a-052', localId: '052', name: 'ミュウ', image: 'https://assets.tcgdex.net/ja/S/S12a/052' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(
        JSON.stringify({
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
      [priorityChase('Pikachu 26/83 promo', 'HIGH'), priorityChase('Mew RC24', 'HIGH')],
      2
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toContain('Mew Japanese S12a 052');
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

    expect(resolved.suggestions[0]?.referenceSourceName).toBe('TCGdex Japanese (SV2a)');
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

  it('does not label single Japanese source cards with multi-Pokemon profile names', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'smp-SM210',
                name: 'Moltres & Zapdos & Articuno-GX',
                number: 'SM210',
                supertype: 'Pokemon',
                subtypes: ['Basic', 'TAG TEAM', 'GX'],
                rarity: 'Promo',
                types: ['Colorless'],
                nationalPokedexNumbers: [146, 145, 144],
                set: { name: 'SM Black Star Promos', series: 'Sun & Moon', releaseDate: '2019/10/04' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/v2/ja/cards') {
        return new Response(JSON.stringify([{ id: 'SV9-102', localId: '102', name: 'フリーザー', image: 'https://assets.tcgdex.net/ja/SV/SV9/102' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SV9-102',
          localId: '102',
          name: 'フリーザー',
          image: 'https://assets.tcgdex.net/ja/SV/SV9/102',
          set: { id: 'SV9', name: 'バトルパートナーズ', cardCount: { official: 100, total: 132 } },
          dexId: [144],
          types: ['Water'],
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
      [priorityChase('Moltres Zapdos Articuno SM210', 'HIGH')],
      1
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Moltres & Zapdos & Articuno Japanese SV9 102/100');
    expect(resolved.suggestions).toHaveLength(0);
  });

  it('surfaces compact numbered Japanese special sets with source-backed set totals', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'xy-rc24',
                name: 'Mew',
                number: 'RC24',
                supertype: 'Pokemon',
                types: ['Psychic'],
                nationalPokedexNumbers: [151],
                set: { name: 'Radiant Collection', series: 'XY', releaseDate: '2016/02/22' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/v2/ja/cards') {
        return new Response(JSON.stringify([{ id: 'SPSET-005', localId: '005', name: 'ミュウ', image: 'https://assets.tcgdex.net/ja/XY/SPSET/005' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SPSET-005',
          localId: '005',
          name: 'ミュウ',
          image: 'https://assets.tcgdex.net/ja/XY/SPSET/005',
          rarity: 'None',
          set: { id: 'SPSET', name: 'スペシャルセット', cardCount: { official: 16, total: 16 } },
          dexId: [151],
          types: ['Psychic'],
          stage: 'Basic'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Mew Japanese special set Pokemon cards',
        lane: 'Japanese Collector Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'mew Japanese special set Pokemon card',
        requiredEvidenceTokens: ['mew', 'japanese', 'special set'],
        sourceTasteTokens: ['mew', 'japanese', 'special set']
      },
      [chase('Corocoro Shining Mew'), chase('Mew RC24/RC25')],
      1
    );

    expect(resolved.suggestions[0]?.name).toBe('Mew Japanese SPSET 005/016');
    expect(resolved.suggestions[0]?.evidenceSearchTerm).toContain('005/016');
    expect(resolved.suggestions[0]?.requiredEvidenceTokens).toContain('005/016');
    expect(resolved.suggestions[0]?.sourceTasteTokens).toEqual(expect.arrayContaining(['special set', 'small set', 'numbered set']));
  });

  it('drops stale parent subjects from Japanese source taste tokens while preserving traits', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'xy-rc24',
                name: 'Mew',
                number: 'RC24',
                supertype: 'Pokemon',
                types: ['Psychic'],
                nationalPokedexNumbers: [151],
                set: { name: 'Radiant Collection', series: 'XY', releaseDate: '2016/02/22' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/v2/ja/cards') {
        return new Response(JSON.stringify([{ id: 'S12a-052', localId: '052', name: 'ミュウ', image: 'https://assets.tcgdex.net/ja/S/S12a/052' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'S12a-052',
          localId: '052',
          name: 'ミュウ',
          image: 'https://assets.tcgdex.net/ja/S/S12a/052',
          rarity: 'AR',
          set: { id: 'S12a', name: 'VSTARユニバース' },
          dexId: [151],
          types: ['Psychic'],
          stage: 'Basic'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Squirtle Japanese Pokemon cards',
        lane: 'Japanese Collector Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'squirtle Japanese Pokemon card',
        requiredEvidenceTokens: ['squirtle', 'japanese'],
        sourceTasteTokens: ['squirtle', 'japanese']
      },
      [chase('Corocoro Shining Mew'), chase('Mew RC24/RC25')],
      1
    );

    expect(resolved.suggestions[0]?.name).toBe('Mew Japanese S12a 052');
    expect(resolved.suggestions[0]?.sourceTasteTokens).toContain('japanese');
    expect(resolved.suggestions[0]?.sourceTasteTokens).not.toContain('squirtle');
  });

  it('surfaces same-set Japanese sibling cards for special-set collector threads', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.pokemontcg.io') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'sv8a-sylveon',
                name: 'Sylveon ex',
                number: '212',
                supertype: 'Pokemon',
                nationalPokedexNumbers: [700],
                set: { name: 'Terastal Festival ex', series: 'Scarlet & Violet', releaseDate: '2024/12/01' }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/v2/ja/cards') {
        const name = url.searchParams.get('name');
        if (name === 'sylveon') {
          return new Response(JSON.stringify([{ id: 'SV8a-212', localId: '212', name: 'ニンフィアex', image: 'https://assets.tcgdex.net/ja/SV/SV8a/212' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          category: 'Pokemon',
          id: 'SV8a-212',
          localId: '212',
          name: 'ニンフィアex',
          image: 'https://assets.tcgdex.net/ja/SV/SV8a/212',
          rarity: 'SAR',
          set: { id: 'SV8a', name: 'Terastal Festival ex', cardCount: { official: 187, total: 187 } },
          dexId: [700],
          types: ['Psychic'],
          stage: 'Stage 1'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Sylveon Terastal Festival Pokemon cards',
        lane: 'Set Companion Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'sylveon Terastal Festival Japanese Pokemon card',
        requiredEvidenceTokens: ['sylveon', 'japanese', 'Terastal Festival', 'special set', 'small set', 'numbered set'],
        sourceTasteTokens: ['sylveon', 'japanese', 'Terastal Festival', 'special set', 'small set', 'numbered set']
      },
      [priorityChase('Umbreon ex SAR Terastal Festival Japanese 217/187', 'HIGH')],
      1,
      [priorityChase('Umbreon ex SAR Terastal Festival Japanese 217/187', 'HIGH')]
    );

    expect(resolved.suggestions[0]?.name).toBe('Sylveon Japanese SV8a 212/187');
    expect(resolved.suggestions[0]?.sourceTasteTokens).toEqual(expect.arrayContaining(['japanese', 'special set', 'small set', 'numbered set']));
  });

  it('drops stale parent subjects from Pokemon TCG source taste tokens while preserving traits', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'ecard2-124',
              name: 'Pikachu',
              number: '124',
              supertype: 'Pokemon',
              subtypes: ['Basic'],
              rarity: 'Common',
              types: ['Lightning'],
              nationalPokedexNumbers: [25],
              set: { name: 'Expedition Base Set', series: 'E-Card', releaseDate: '2002/09/15' },
              images: { small: 'https://images.pokemontcg.io/ecard2/124.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Squirtle e-reader Pokemon cards',
        lane: 'E-Reader Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'squirtle e-reader Pokemon card',
        requiredEvidenceTokens: ['squirtle', 'e-reader'],
        sourceTasteTokens: ['squirtle', 'e-reader']
      },
      [chase('Pikachu xy95')],
      1
    );

    expect(resolved.suggestions[0]?.name).toBe('Pikachu Expedition Base Set 124');
    expect(resolved.suggestions[0]?.sourceTasteTokens).toContain('e-reader');
    expect(resolved.suggestions[0]?.sourceTasteTokens).not.toContain('squirtle');
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
        name: 'Pokemon promo cards',
        lane: 'Promo Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon promo cards',
        requiredEvidenceTokens: ['promo'],
        sourceTasteTokens: ['promo']
      },
      [chase('Mew LP MP it RC24'), chase('Zapdos lightning promo')],
      3
    );

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual([]);
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Zapdos ex Scarlet & Violet Black Star Promos 49');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Mega Greninja ex Chaos Rising 101');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain('Tauros Chaos Rising 96');
  });

  it('does not surface ordinary modern common cards when collector-shaped alternatives exist', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.tcgdex.net') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const data = [
        {
          id: 'sv4pt5-18',
          name: 'Pikachu',
          number: '18',
          supertype: 'Pokemon',
          subtypes: ['Basic'],
          rarity: 'Common',
          types: ['Lightning'],
          nationalPokedexNumbers: [25],
          set: { name: 'Paldean Fates', series: 'Scarlet & Violet', releaseDate: '2024/01/26' },
          images: { small: 'https://images.pokemontcg.io/sv4pt5/18.png' }
        },
        {
          id: 'swshp-SWSH074',
          name: 'Special Delivery Pikachu',
          number: 'SWSH074',
          supertype: 'Pokemon',
          subtypes: ['Basic'],
          rarity: 'Promo',
          types: ['Lightning'],
          nationalPokedexNumbers: [25],
          set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield', releaseDate: '2020/11/13' },
          images: { small: 'https://images.pokemontcg.io/swshp/SWSH074.png' }
        },
        {
          id: 'swshp-SWSH286',
          name: 'Pikachu VMAX',
          number: 'SWSH286',
          supertype: 'Pokemon',
          subtypes: ['VMAX', 'Promo'],
          rarity: 'Promo',
          types: ['Lightning'],
          nationalPokedexNumbers: [25],
          set: { name: 'SWSH Black Star Promos', series: 'Sword & Shield', releaseDate: '2022/11/11' },
          images: { small: 'https://images.pokemontcg.io/swshp/SWSH286.png' }
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
      [],
      2
    );

    const names = resolved.suggestions.map((suggestion) => suggestion.name);
    expect(names).not.toContain('Pikachu Paldean Fates 18');
    expect(names).toContain('Special Delivery Pikachu SWSH Black Star Promos SWSH074');
    expect(names).not.toContain('Pikachu VMAX SWSH Black Star Promos SWSH286');
  });

  it('turns premium source-backed cards into exact card suggestions', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'sv4pt5-232',
              name: 'Mew ex',
              number: '232',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Paldean Fates', series: 'Scarlet & Violet', releaseDate: '2024/01/26' },
              images: { small: 'https://images.pokemontcg.io/sv4pt5/232.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon illustration rare cards',
        lane: 'Artwork Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon illustration rare cards',
        requiredEvidenceTokens: ['illustration'],
        sourceTasteTokens: ['illustration']
      },
      [],
      1
    );

    expect(resolved.suggestions[0]?.name).toBe('Mew ex Paldean Fates 232');
    expect(resolved.suggestions[0]?.evidenceSearchTerm).toBe('Mew ex Paldean Fates 232 Pokemon card');
  });

  it('keeps visual-format discovery anchored to the source profile subject', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.tcgdex.net') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const query = url.searchParams.get('q') ?? '';
      const data = query.includes('name:"mew"')
        ? [
            {
              id: 'swsh11tg-TG30',
              name: 'Mew VMAX',
              number: 'TG30',
              supertype: 'Pokemon',
              subtypes: ['VMAX'],
              rarity: 'Rare Secret',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Lost Origin Trainer Gallery', series: 'Sword & Shield', releaseDate: '2022/09/09' }
            }
          ]
        : [
            {
              id: 'sv4pt5-232',
              name: 'Mew ex',
              number: '232',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [151],
              set: { name: 'Paldean Fates', series: 'Scarlet & Violet', releaseDate: '2024/01/26' },
              images: { small: 'https://images.pokemontcg.io/sv4pt5/232.png' }
            },
            {
              id: 'me2pt5-281',
              name: "Team Rocket's Mewtwo ex",
              number: '281',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [150],
              set: { name: 'Ascended Heroes', series: 'Mega Evolution', releaseDate: '2026/01/30' },
              images: { small: 'https://images.scrydex.com/pokemon/me2pt5-281/small' }
            }
          ];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Pokemon illustration rare cards',
        lane: 'visual-format discovery',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Pokemon illustration rare cards',
        requiredEvidenceTokens: ['illustration', 'rare'],
        sourceTasteTokens: ['illustration', 'rare']
      },
      [chase('Mew RC24/RC25')],
      4
    );

    expect(resolved.sourceStatus).toBe('NOT_FOUND');
    expect(resolved.suggestions.map((suggestion) => suggestion.name)).not.toContain("Team Rocket's Mewtwo ex Ascended Heroes 281");
  });

  it('turns ordinary source-backed cards into exact card suggestions', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
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
              set: { name: 'Base', series: 'Base', releaseDate: '1999/01/09' },
              images: { small: 'https://images.pokemontcg.io/base1/58.png' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'vintage Pokemon cards',
        lane: 'Vintage Era Trail',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'vintage Pokemon cards',
        requiredEvidenceTokens: ['vintage'],
        sourceTasteTokens: ['vintage']
      },
      [],
      1
    );

    expect(resolved.suggestions[0]?.name).toBe('Pikachu Base 58');
    expect(resolved.suggestions[0]?.evidenceSearchTerm).toBe('Pikachu Base 58 Pokemon card');
  });

  it('canonicalizes source-backed Pokemon images to trusted hires art', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'me2pt5-281',
              name: "Team Rocket's Mewtwo ex",
              number: '281',
              supertype: 'Pokemon',
              subtypes: ['Basic', 'ex'],
              rarity: 'Special Illustration Rare',
              types: ['Psychic'],
              nationalPokedexNumbers: [150],
              set: { name: 'Ascended Heroes', series: 'Mega Evolution', releaseDate: '2026/01/30' },
              images: { small: 'https://images.scrydex.com/pokemon/me2pt5-281/small' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as any;

    const resolved = await resolveSourceBackedDiscoveryCards(
      {
        name: 'Mewtwo special illustration rare Pokemon cards',
        lane: 'visual-format discovery',
        laneWhy: 'profile',
        why: 'profile',
        nearby: [],
        evidenceSearchTerm: 'Mewtwo special illustration rare Pokemon cards',
        requiredEvidenceTokens: ['mewtwo', 'illustration', 'rare'],
        sourceTasteTokens: ['mewtwo', 'illustration', 'rare']
      },
      [],
      1
    );

    expect(resolved.suggestions[0]?.referenceImageUrl).toBe('https://cdn11.bigcommerce.com/s-b4ioc4fed9/products/569138/images/3745604/B733QTIMxsUolT8ZRSck3d5rT__08351.1779177196.386.513.jpg?c=1');
    expect(resolved.suggestions[0]?.referenceSourceName).toBe('Magic Madhouse');
    expect(resolved.suggestions[0]?.referenceSourceCardId).toBe('PE-ASC1-281');
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

    expect(resolved.suggestions.map((suggestion) => suggestion.name)).toEqual([]);
  });
});
