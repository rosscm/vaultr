import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardCatalogStats, initializeCardCatalogDb, replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import { searchLocalCardCatalog } from '../card-catalog/search.js';
import { loadPokemonTcgRepositoryRecords, pokemonTcgRecordFromCard } from '../card-catalog/importers/pokemontcg.js';
import { loadTcgDexJapaneseSetTranslations, loadTcgDexRepositoryRecords, tcgDexRecordFromCard } from '../card-catalog/importers/tcgdex.js';
import { autocompleteChaseCardsWithStatus, clearChaseCardAutocompleteCache } from '../chase-card-catalog.js';
import { runCatalogImportPokemonTcgCli } from '../../catalog-import-pokemontcg.js';

const originalFetch = globalThis.fetch;
const originalCatalogPath = process.env.CARD_CATALOG_PATH;
const tempDirs = new Set<string>();

function tempCatalogPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vaultr-card-catalog-${label}-`));
  tempDirs.add(dir);
  return path.join(dir, 'card-catalog.db');
}

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vaultr-card-catalog-${label}-`));
  tempDirs.add(dir);
  return dir;
}

function record(overrides: Partial<ReturnType<typeof pokemonTcgRecordFromCard>> & { sourceCardId: string; name: string }) {
  const base = pokemonTcgRecordFromCard({
    id: overrides.sourceCardId,
    name: overrides.name,
    number: '1',
    rarity: 'Rare Holo',
    set: { id: 'test', name: 'Test Set', series: 'Test', printedTotal: 100, releaseDate: '2020/01/01' },
    images: { large: `https://images.pokemontcg.io/test/${overrides.sourceCardId}.png` }
  })!;
  return { ...base, ...overrides };
}

function writeTcgDexSet(root: string, setId: string, nativeName: string, translatedName: string, total: number): void {
  const era = setId.startsWith('SV') ? 'SV' : 'S';
  fs.mkdirSync(path.join(root, 'data-asia', era, setId), { recursive: true });
  fs.writeFileSync(path.join(root, 'data-asia', era, `${setId}.ts`), `
    const set: Set = {
      id: '${setId}',
      name: { ja: '${nativeName}', id: '${translatedName}' },
      cardCount: { official: ${total} },
      releaseDate: { ja: '2023-12-01' }
    }
    export default set
  `);
}

function writeTcgDexCard(root: string, setId: string, number: string, nativeName: string, latinName: string): void {
  const era = setId.startsWith('SV') ? 'SV' : 'S';
  fs.mkdirSync(path.join(root, 'data-asia', era, setId), { recursive: true });
  fs.writeFileSync(path.join(root, 'data-asia', era, setId, `${number}.ts`), `
    const card: Card = {
      set: Set,
      category: CardCategory.POKEMON,
      name: { ja: '${nativeName}', id: '${latinName}' },
      rarity: 'SAR'
    }
    export default card
  `);
}

function writeTcgDexTranslations(root: string): void {
  fs.mkdirSync(path.join(root, 'scripts', 'utils-data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'utils-data', 'jp_set_translations.ts'), `
    export const jpSetTranslationsMap = new Map<string, string>([
      ['SV1S', 'Scarlet ex'],
      ['SV3a', 'Raging Surf'],
      ['SV4a', 'Shiny Treasure ex'],
      ['SV8a', 'Terastal Festival ex'],
    ])
  `);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearChaseCardAutocompleteCache();
  if (originalCatalogPath === undefined) delete process.env.CARD_CATALOG_PATH;
  else process.env.CARD_CATALOG_PATH = originalCatalogPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe('local card catalog', () => {
  it('initializes a separate catalog database with source uniqueness and stats', () => {
    const dbPath = tempCatalogPath('schema');
    initializeCardCatalogDb(dbPath);
    const first = record({ sourceCardId: 'xy-promo-XY95', name: 'Pikachu', cardNumber: 'XY95', normalizedCardNumber: 'XY95', setName: 'XY Black Star Promos', normalizedSetName: 'xy black star promos', isPromo: true });
    const duplicate = { ...first };
    const report = replaceCardCatalogSourceRecords('POKEMONTCG', [first, duplicate], dbPath);
    const stats = cardCatalogStats(dbPath);

    expect(report).toMatchObject({ examined: 2, imported: 1, errors: 1 });
    expect(stats).toMatchObject({ totalRecords: 1, promoMarked: 1 });
    expect(stats.path).toBe(dbPath);
  });

  it('normalizes representative PokemonTCG and real-format TCGdex source records', () => {
    expect(pokemonTcgRecordFromCard({
      id: 'bw11-RC24',
      name: 'Mew-EX',
      number: 'RC24',
      rarity: 'Radiant Collection',
      set: { id: 'bw11', name: 'Legendary Treasures', series: 'Black & White', printedTotal: 113, releaseDate: '2013/11/06' }
    })).toMatchObject({
      source: 'POKEMONTCG',
      sourceCardId: 'bw11-RC24',
      language: 'en',
      normalizedCardNumber: 'RC24',
      imageUrl: 'https://images.pokemontcg.io/bw11/RC24_hires.png'
    });

    expect(tcgDexRecordFromCard({
      set: {},
      name: { ja: 'ブラッキーex', id: 'Umbreon ex' }
    }, {
      language: 'ja',
      filePath: '/repo/data-asia/SV/SV8a/217.ts',
      setMetadata: {
        id: 'SV8a',
        name: { ja: 'テラスタルフェスex', id: 'Terastal Festival ex' },
        cardCount: { official: 187 },
        releaseDate: { ja: '2024-12-06' }
      },
      setTranslations: new Map([['SV8a', 'Terastal Festival ex']])
    })).toMatchObject({
      source: 'TCGDEX',
      sourceCardId: 'SV8a-217',
      language: 'ja',
      cardNumber: '217',
      printedTotal: '187',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV8a/217/high.png',
      releaseDate: '2024-12-06',
      translatedSetName: 'Terastal Festival ex',
      aliases: expect.arrayContaining([
        expect.objectContaining({ alias: 'Umbreon ex', locale: 'id', kind: 'localized_name' })
      ])
    });

    expect(pokemonTcgRecordFromCard({ id: 'bad' })).toBeUndefined();
  });

  it('loads PokemonTCG repository cards by joining cards/en files to sets/en.json', () => {
    const root = tempDir('ptcg-fixture');
    fs.mkdirSync(path.join(root, 'sets'), { recursive: true });
    fs.mkdirSync(path.join(root, 'cards', 'en'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sets', 'en.json'), JSON.stringify([
      { id: 'sv2', name: 'Paldea Evolved', series: 'Scarlet & Violet', printedTotal: 193, releaseDate: '2023/06/09' }
    ]));
    fs.writeFileSync(path.join(root, 'cards', 'en', 'sv2.json'), JSON.stringify([
      { id: 'sv2-101', name: 'Gardevoir', number: '101', rarity: 'Rare Holo', images: { large: 'https://images.pokemontcg.io/sv2/101_hires.png' } }
    ]));
    fs.writeFileSync(path.join(root, 'sets', 'ignored.json'), JSON.stringify([{ id: 'fake', name: 'Not a card' }]));

    const loaded = loadPokemonTcgRepositoryRecords(root, '2026-08-27T00:00:00.000Z');

    expect(loaded).toMatchObject({ examined: 1, errors: 0 });
    expect(loaded.records[0]).toMatchObject({
      sourceCardId: 'sv2-101',
      setId: 'sv2',
      setName: 'Paldea Evolved',
      series: 'Scarlet & Violet',
      printedTotal: '193',
      releaseDate: '2023/06/09'
    });
  });

  it('loads real-format TCGdex TypeScript card files with localized aliases', () => {
    const root = tempDir('tcgdex-fixture');
    writeTcgDexTranslations(root);
    writeTcgDexSet(root, 'SV4a', 'レイジングサーフ', 'Wrong Native Name', 190);
    writeTcgDexCard(root, 'SV4a', '347', 'ミュウex', 'Mew ex');

    const loaded = loadTcgDexRepositoryRecords(root, '2026-08-27T00:00:00.000Z');

    expect(loaded).toMatchObject({ examined: 1, errors: 0 });
    const translations = loadTcgDexJapaneseSetTranslations(root);
    expect(translations.get('SV1S')).toBe('Scarlet ex');
    expect(translations.get('SV3a')).toBe('Raging Surf');
    expect(translations.get('SV4a')).toBe('Shiny Treasure ex');
    expect(translations.get('SV8a')).toBe('Terastal Festival ex');
    expect(loaded.records[0]).toMatchObject({
      sourceCardId: 'SV4a-347',
      language: 'ja',
      name: 'ミュウex',
      setName: 'レイジングサーフ',
      translatedSetName: 'Shiny Treasure ex',
      cardNumber: '347',
      printedTotal: '190',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV4a/347/high.png',
      aliases: expect.arrayContaining([
        expect.objectContaining({ alias: 'Mew ex', locale: 'id' })
      ])
    });
  });

  it('ranks structured local searches and rejects conflicting collector fractions', () => {
    const dbPath = tempCatalogPath('search');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'sv2-101', name: 'Gardevoir', cardNumber: '101', normalizedCardNumber: '101', printedTotal: '078', setName: 'Scarlet & Violet', normalizedSetName: 'scarlet and violet' }),
      record({ sourceCardId: 'xy-101', name: 'Gardevoir Spirit Link', cardNumber: '101', normalizedCardNumber: '101', printedTotal: '114', setName: 'Steam Siege', normalizedSetName: 'steam siege' }),
      record({ sourceCardId: 'xyp-XY192', name: 'Mew', cardNumber: 'XY192', normalizedCardNumber: 'XY192', setName: 'XY Black Star Promos', normalizedSetName: 'xy black star promos', isPromo: true }),
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' }),
      record({ sourceCardId: 'svp-176', name: 'Umbreon', cardNumber: '176', normalizedCardNumber: '176', printedTotal: undefined, setName: 'Scarlet & Violet Black Star Promos', normalizedSetName: 'scarlet and violet black star promos', isPromo: true })
    ], dbPath);

    expect(searchLocalCardCatalog('gardevoir 101/078', 5, { dbPath }).map((choice) => choice.value)).toEqual([
      'Gardevoir Scarlet & Violet 101/078'
    ]);
    expect(searchLocalCardCatalog('mew rc24', 5, { dbPath })[0]).toMatchObject({ value: 'Mew-EX Legendary Treasures RC24' });
    expect(searchLocalCardCatalog('umbreon 176', 5, { dbPath })[0]).toMatchObject({ value: 'Umbreon Scarlet & Violet Black Star Promos 176' });
  });

  it('uses existing Japanese subject aliases for structured local searches', () => {
    const dbPath = tempCatalogPath('jp-subject-alias');
    replaceCardCatalogSourceRecords('TCGDEX', [
      tcgDexRecordFromCard({
        name: { ja: 'サーナイトex' },
        set: {}
      }, {
        language: 'ja',
        filePath: '/repo/data-asia/SV/SV1S/101.ts',
        setMetadata: { id: 'SV1S', name: { ja: 'スカーレットex', id: 'Scarlet ex' }, cardCount: { official: 78 } },
        setTranslations: new Map([['SV1S', 'Scarlet ex']])
      })!,
      tcgDexRecordFromCard({
        name: { ja: 'ピカチュウ', id: 'Pikachu' },
        set: {}
      }, {
        language: 'ja',
        filePath: '/repo/data-asia/SV/SV1S/101.ts',
        setMetadata: { id: 'SV1S', name: { ja: 'スカーレットex', id: 'Scarlet ex' }, cardCount: { official: 78 } },
        setTranslations: new Map([['SV1S', 'Scarlet ex']])
      })!
    ], dbPath);

    expect(searchLocalCardCatalog('gardevoir 101/078', 5, { dbPath })[0]).toMatchObject({
      value: 'サーナイトex Scarlet ex 101/78 Japanese',
      sourceCardId: 'SV1S-101',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV1S/101/high.png'
    });
  });

  it('lets exact Japanese number evidence outrank unrelated local Mew cards', () => {
    const dbPath = tempCatalogPath('japanese');
    replaceCardCatalogSourceRecords('TCGDEX', [
      tcgDexRecordFromCard({
        name: { ja: 'ミュウex', id: 'Mew ex' },
        set: {}
      }, {
        language: 'ja',
        filePath: '/repo/data-asia/SV/SV4a/347.ts',
        setMetadata: { id: 'SV4a', name: { ja: 'レイジングサーフ', id: 'Wrong Native Name' }, cardCount: { official: 190 } },
        setTranslations: new Map([['SV4a', 'Shiny Treasure ex']])
      })!,
      tcgDexRecordFromCard({
        name: { ja: 'ピカチュウ', id: 'Pikachu' },
        set: {}
      }, {
        language: 'ja',
        filePath: '/repo/data-asia/S/S12a/347.ts',
        setMetadata: { id: 'S12a', name: { ja: 'VSTARユニバース', id: 'VSTAR Universe' }, cardCount: { official: 190 } }
      })!
    ], dbPath);

    expect(searchLocalCardCatalog('mew 347/190', 5, { dbPath })[0]).toMatchObject({
      value: 'ミュウex Shiny Treasure ex 347/190 Japanese',
      imageSourceName: 'TCGDEX',
      imageSourceKind: 'CARD_REFERENCE'
    });
  });

  it('does not match Japanese exact numbers without a matching source alias', () => {
    const dbPath = tempCatalogPath('japanese-alias');
    replaceCardCatalogSourceRecords('TCGDEX', [
      tcgDexRecordFromCard({
        name: { ja: 'ピカチュウ', id: 'Pikachu' },
        set: {}
      }, {
        language: 'ja',
        filePath: '/repo/data-asia/SV/SV4a/347.ts',
        setMetadata: { id: 'SV4a', name: { ja: 'シャイニートレジャーex', id: 'Shiny Treasure ex' }, cardCount: { official: 190 } }
      })!
    ], dbPath);

    expect(searchLocalCardCatalog('mew 347/190', 5, { dbPath })).toEqual([]);
  });

  it('deduplicates obvious cross-source copies while preserving trusted preview metadata', () => {
    const dbPath = tempCatalogPath('dedupe');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' })
    ], dbPath);
    replaceCardCatalogSourceRecords('TCGDEX', [
      { ...record({ sourceCardId: 'en-bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' }), source: 'TCGDEX' as const }
    ], dbPath);

    const results = searchLocalCardCatalog('mew rc24', 10, { dbPath });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      value: 'Mew-EX Legendary Treasures RC24',
      imageSourceKind: 'CARD_REFERENCE'
    });
  });

  it('uses local autocomplete during remote outage and keeps wrong CoroCoro override absent', async () => {
    const dbPath = tempCatalogPath('autocomplete');
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' })
    ], dbPath);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('provider unavailable');
    }) as typeof fetch;

    const result = await autocompleteChaseCardsWithStatus('mew rc24', 25);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ unavailable: false, stale: false, availability: 'AVAILABLE' });
    expect(result.choices[0]).toEqual({ name: 'Mew-EX - Legendary Treasures #RC24', value: 'Mew-EX Legendary Treasures RC24' });

    const coro = await autocompleteChaseCardsWithStatus('mew corocoro 151', 25);
    expect(JSON.stringify(coro)).not.toContain('jpn_unp-124');
  });

  it('requires explicit promo publication context to match local records', () => {
    const dbPath = tempCatalogPath('promo-context');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'wotc-8', name: 'Mew', cardNumber: '8', normalizedCardNumber: '8', setName: 'Wizards Black Star Promos', normalizedSetName: 'wizards black star promos', isPromo: true, promoContext: 'Wizards Black Star Promos' }),
      record({ sourceCardId: 'np-40', name: 'Mew', cardNumber: '40', normalizedCardNumber: '40', setName: 'Nintendo Black Star Promos', normalizedSetName: 'nintendo black star promos', isPromo: true, promoContext: 'Nintendo Black Star Promos' }),
      record({ sourceCardId: 'exp-19', name: 'Mew', cardNumber: '19', normalizedCardNumber: '19', setName: 'Expedition Base Set', normalizedSetName: 'expedition base set', isPromo: false }),
      record({ sourceCardId: 'coro-151', name: 'Mew', cardNumber: '151', normalizedCardNumber: '151', setName: 'CoroCoro Promo', normalizedSetName: 'corocoro promo', isPromo: true, promoContext: 'CoroCoro Promo' })
    ], dbPath);

    expect(searchLocalCardCatalog('mew corocoro', 10, { dbPath }).map((choice) => choice.sourceCardId)).toEqual(['coro-151']);
  });

  it('returns no local CoroCoro substitute when only unrelated Mew promos exist', () => {
    const dbPath = tempCatalogPath('promo-context-miss');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'wotc-8', name: 'Mew', cardNumber: '8', normalizedCardNumber: '8', setName: 'Wizards Black Star Promos', normalizedSetName: 'wizards black star promos', isPromo: true, promoContext: 'Wizards Black Star Promos' }),
      record({ sourceCardId: 'np-40', name: 'Mew', cardNumber: '40', normalizedCardNumber: '40', setName: 'Nintendo Black Star Promos', normalizedSetName: 'nintendo black star promos', isPromo: true, promoContext: 'Nintendo Black Star Promos' }),
      record({ sourceCardId: 'exp-19', name: 'Mew', cardNumber: '19', normalizedCardNumber: '19', setName: 'Expedition Base Set', normalizedSetName: 'expedition base set', isPromo: false })
    ], dbPath);

    expect(searchLocalCardCatalog('mew corocoro', 10, { dbPath })).toEqual([]);
  });

  it('requires McDonalds publication context to match Squirtle records', () => {
    const dbPath = tempCatalogPath('mcdonalds-context');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'random-007', name: 'Squirtle', cardNumber: '007', normalizedCardNumber: '7', setName: 'Random Japanese Promo', normalizedSetName: 'random japanese promo', printedTotal: '018', isPromo: true }),
      record({ sourceCardId: 'mcd-007', name: 'Squirtle', cardNumber: '007', normalizedCardNumber: '7', setName: "McDonald's Pokemon-e Minimum Pack", normalizedSetName: 'mcdonalds pokemon e minimum pack', printedTotal: '018', isPromo: true, promoContext: "McDonald's Promo" })
    ], dbPath);

    expect(searchLocalCardCatalog('squirtle mcdonalds 007/018', 10, { dbPath }).map((choice) => choice.sourceCardId)).toEqual(['mcd-007']);
  });

  it('falls back to remote providers when no local catalog exists and tolerates corrupt local DB files', async () => {
    process.env.CARD_CATALOG_PATH = path.join(os.tmpdir(), `missing-card-catalog-${Date.now()}.db`);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.tcgdex.net')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({
        data: [{ id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    expect((await autocompleteChaseCardsWithStatus('mew', 10)).choices[0]).toEqual({ name: 'Mew — Southern Islands #1', value: 'Mew Southern Islands 1' });

    const corruptPath = tempCatalogPath('corrupt');
    fs.writeFileSync(corruptPath, 'not sqlite');
    process.env.CARD_CATALOG_PATH = corruptPath;
    clearChaseCardAutocompleteCache();
    expect((await autocompleteChaseCardsWithStatus('mew', 10)).choices[0]).toEqual({ name: 'Mew — Southern Islands #1', value: 'Mew Southern Islands 1' });
  });

  it('aborts tiny full-repository imports without replacing existing catalog records', () => {
    const dbPath = tempCatalogPath('import-safety');
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' })
    ], dbPath);
    const root = tempDir('tiny-ptcg');
    fs.mkdirSync(path.join(root, 'sets'), { recursive: true });
    fs.mkdirSync(path.join(root, 'cards', 'en'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sets', 'en.json'), JSON.stringify([{ id: 'sv2', name: 'Paldea Evolved', printedTotal: 193 }]));
    fs.writeFileSync(path.join(root, 'cards', 'en', 'sv2.json'), JSON.stringify([{ id: 'sv2-1', name: 'Tiny Fixture', number: '1' }]));

    expect(() => runCatalogImportPokemonTcgCli([root])).toThrow(/only 1 records/);
    expect(searchLocalCardCatalog('mew rc24', 5, { dbPath })[0]).toMatchObject({ value: 'Mew-EX Legendary Treasures RC24' });
  });
});
