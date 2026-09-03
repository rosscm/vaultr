import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardCatalogStats, getCardCatalogRecordBySourceCardId, initializeCardCatalogDb, listCardCatalogMisses, openCardCatalogDb, recordCardCatalogMiss, replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import { searchLocalCardCatalog } from '../card-catalog/search.js';
import { catalogDisplayValue } from '../card-catalog/normalize.js';
import { loadPokemonTcgRepositoryRecords, pokemonTcgRecordFromCard } from '../card-catalog/importers/pokemontcg.js';
import { loadTcgDexJapaneseSetTranslations, loadTcgDexRepositoryRecords, tcgDexRecordFromCard } from '../card-catalog/importers/tcgdex.js';
import { importVaultrPromoSupplementRecords, loadVaultrPromoSupplementRecords, vaultrPromoRecordFromDefinition } from '../card-catalog/importers/vaultr-promos.js';
import { auditCuratedJapanesePromos, curatedJapanesePromoProvenanceStatus, isTraceableCuratedJapanesePromoReference } from '../card-catalog/curated-japanese-promo-audit.js';
import { CURATED_JAPANESE_PROMOS, curatedJapanesePromoCountsByFamily } from '../card-catalog/supplements/curated-japanese-promos.js';
import { autocompleteChaseCardsWithStatus, clearChaseCardAutocompleteCache } from '../chase-card-catalog.js';
import { runCatalogMissesCli } from '../../catalog-misses.js';
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
    const db = openCardCatalogDb(dbPath, { readonly: true, fileMustExist: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        'card_catalog_identifiers',
        'card_catalog_references',
        'card_catalog_misses'
      ]));
    } finally {
      db.close();
    }
  });

  it('normalizes representative PokemonTCG and real-format TCGdex source records', () => {
    expect(pokemonTcgRecordFromCard({
      id: 'bw11-RC24',
      name: 'Mew-EX',
      artist: '  Atsuko Nishida  ',
      number: 'RC24',
      rarity: 'Radiant Collection',
      set: { id: 'bw11', name: 'Legendary Treasures', series: 'Black & White', printedTotal: 113, releaseDate: '2013/11/06' }
    })).toMatchObject({
      source: 'POKEMONTCG',
      sourceCardId: 'bw11-RC24',
      language: 'en',
      normalizedCardNumber: 'RC24',
      illustrator: 'Atsuko Nishida',
      imageUrl: 'https://images.pokemontcg.io/bw11/RC24_hires.png'
    });

    expect(tcgDexRecordFromCard({
      set: {},
      name: { ja: 'ブラッキーex', id: 'Umbreon ex' },
      illustrator: '  Shinji Kanda '
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
      illustrator: 'Shinji Kanda',
      aliases: expect.arrayContaining([
        expect.objectContaining({ alias: 'Umbreon ex', locale: 'id', kind: 'localized_name' })
      ])
    });

    expect(pokemonTcgRecordFromCard({
      id: 'sv1-1',
      name: 'Sprigatito',
      number: '1',
      set: { id: 'sv1', name: 'Scarlet & Violet', printedTotal: 198 }
    })).toMatchObject({ illustrator: undefined });
    expect(pokemonTcgRecordFromCard({ id: 'bad' })).toBeUndefined();
  });

  it('round-trips illustrator through storage and local search choices', () => {
    const dbPath = tempCatalogPath('illustrator');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({
        sourceCardId: 'swsh12-160',
        name: 'Pikachu',
        cardNumber: '160',
        normalizedCardNumber: '160',
        setName: 'Silver Tempest',
        normalizedSetName: 'silver tempest',
        illustrator: 'Shinji Kanda'
      })
    ], dbPath);

    expect(getCardCatalogRecordBySourceCardId('POKEMONTCG', 'swsh12-160', dbPath)).toMatchObject({
      illustrator: 'Shinji Kanda'
    });
    expect(searchLocalCardCatalog('pikachu silver tempest 160', 5, { dbPath })[0]).toMatchObject({
      canonicalName: 'Pikachu',
      illustrator: 'Shinji Kanda'
    });
  });

  it('treats provider printedTotal zero as unknown instead of rendering slash-zero identities', () => {
    const dbPath = tempCatalogPath('zero-total');
    initializeCardCatalogDb(dbPath);
    const squirtle = tcgDexRecordFromCard({
      id: 'PROMOS-A-033',
      localId: '033',
      set: {
        id: 'PROMOS-A',
        name: { ja: 'プロモカード', id: 'Promos-A' },
        cardCount: { official: 0 }
      },
      name: { ja: 'ゼニガメ', id: 'Squirtle' },
      image: 'https://assets.tcgdex.net/ja/PROMOS-A/033'
    }, { language: 'ja', setTranslations: new Map([['PROMOS-A', 'Promos-A']]) })!;

    expect(squirtle.printedTotal).toBeUndefined();
    expect((squirtle.aliases ?? []).map((alias) => alias.alias).join(' ')).not.toContain('/0');

    replaceCardCatalogSourceRecords('TCGDEX', [squirtle], dbPath);
    const stored = getCardCatalogRecordBySourceCardId('TCGDEX', 'PROMOS-A-033', dbPath);

    expect(stored).toMatchObject({
      cardNumber: '033',
      printedTotal: undefined
    });
    const displayValue = catalogDisplayValue({
      name: stored!.name,
      setName: stored!.setName,
      translatedSetName: stored!.translatedSetName,
      cardNumber: stored!.cardNumber,
      printedTotal: stored!.printedTotal,
      language: stored!.language
    });

    expect(displayValue).toContain('033');
    expect(displayValue).not.toContain('/0');
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

  it('records only specific trustworthy autocomplete misses', async () => {
    const dbPath = tempCatalogPath('autocomplete-misses');
    process.env.CARD_CATALOG_PATH = dbPath;
    initializeCardCatalogDb(dbPath);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io') || url.includes('api.tcgdex.net')) {
        return new Response(JSON.stringify(url.includes('pokemontcg') ? { data: [] } : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;

    await autocompleteChaseCardsWithStatus('mew corocoro', 25);
    await autocompleteChaseCardsWithStatus('mew', 25);
    expect(listCardCatalogMisses({ dbPath })).toHaveLength(1);
    expect(listCardCatalogMisses({ dbPath })[0]).toMatchObject({ normalizedQuery: 'mew corocoro', missCount: 1 });

    clearChaseCardAutocompleteCache();
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' })
    ], dbPath);
    await autocompleteChaseCardsWithStatus('mew rc24', 25);
    expect(listCardCatalogMisses({ dbPath })[0]?.missCount).toBe(1);

    clearChaseCardAutocompleteCache();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('provider unavailable');
    }) as typeof fetch;
    await autocompleteChaseCardsWithStatus('mew corocoro jumbo', 25);
    expect(listCardCatalogMisses({ dbPath })[0]?.missCount).toBe(1);
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

  it('keeps raw canonical names separate from decorated Japanese choice labels', () => {
    const dbPath = tempCatalogPath('choice-canonical-name');
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'SV8a-217',
        name: 'ブラッキーex',
        normalizedName: 'ブラッキーex',
        language: 'ja',
        cardNumber: '217',
        normalizedCardNumber: '217',
        printedTotal: '187',
        setName: 'Terastal Festival ex',
        normalizedSetName: 'terastal festival ex',
        translatedSetName: 'Terastal Festival ex'
      })
    ], dbPath);

    const [choice] = searchLocalCardCatalog('ブラッキーex terastal festival 217 japanese', 10, { dbPath });

    expect(choice).toMatchObject({
      canonicalName: 'ブラッキーex',
      sourceCardId: 'SV8a-217',
      value: 'ブラッキーex Terastal Festival ex 217/187 Japanese'
    });
    expect(choice?.name).toContain('Terastal Festival ex');
    expect(choice?.name).toContain('#217/187');
    expect(choice?.name).toContain('(Japanese)');
  });

  it('imports the verified Vaultr promo Squirtle supplement without replacing core sources', () => {
    const dbPath = tempCatalogPath('vaultr-promo-squirtle');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'random-007', name: 'Squirtle', cardNumber: '007', normalizedCardNumber: '7', setName: 'Random Japanese Promo', normalizedSetName: 'random japanese promo', printedTotal: '018', isPromo: true })
    ], dbPath);

    const report = importVaultrPromoSupplementRecords({ dbPath, importedAt: '2026-08-27T00:00:00.000Z' });
    const results = searchLocalCardCatalog('squirtle mcdonalds 007/018', 10, { dbPath });

    expect(loadVaultrPromoSupplementRecords('2026-08-27T00:00:00.000Z')).toHaveLength(1);
    expect(report).toMatchObject({ examined: 1, imported: 1, bySource: { VAULTR_PROMO: 1 } });
    expect(cardCatalogStats(dbPath).sourceCounts).toMatchObject({ POKEMONTCG: 1, VAULTR_PROMO: 1 });
    expect(results[0]).toMatchObject({
      source: 'VAULTR_PROMO',
      sourceCardId: 'vaultr-promo-dextcg-jpn-mcdemp-7',
      canonicalName: 'Squirtle',
      value: "Squirtle McDonald's Pokemon-e Minimum Pack 007/018 Japanese",
      imageUrl: 'https://static.dextcg.com/cards/jpn_mcdemp/7.png'
    });
    expect(searchLocalCardCatalog('squirtle corocoro 007/018', 10, { dbPath })).toEqual([]);
  });

  it('keeps curated Japanese promo metadata separate, unique, sourced, and Japanese-only', () => {
    const ids = CURATED_JAPANESE_PROMOS.map((record) => record.curationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CURATED_JAPANESE_PROMOS.every((record) => record.language === 'ja')).toBe(true);
    expect(CURATED_JAPANESE_PROMOS.some((record) => record.references.some((reference) => reference.sourceName === 'POKUMON' && reference.sourceId?.startsWith('pokumon:')))).toBe(false);
    expect(isTraceableCuratedJapanesePromoReference({ sourceName: 'POKUMON', sourceId: 'pokumon:local-slug', kind: 'metadata_reference' })).toBe(false);
    expect(isTraceableCuratedJapanesePromoReference({ sourceName: 'POKUMON', url: 'https://www.pokumon.com/card/example', kind: 'metadata_reference' })).toBe(true);
    expect(isTraceableCuratedJapanesePromoReference({ sourceName: 'DEXTCG', sourceId: 'jpn_mcdemp-7', kind: 'source_identity' })).toBe(true);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => curatedJapanesePromoProvenanceStatus(record) === 'TRACEABLE')).toHaveLength(18);

    const mcdonalds = CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === "McDonald's Pokemon-e Minimum Pack");
    expect(mcdonalds.map((record) => record.cardNumber)).toEqual(Array.from({ length: 18 }, (_, index) => String(index + 1).padStart(3, '0')));
    expect(mcdonalds.every((record) => record.printedTotal === '018')).toBe(true);
    expect(mcdonalds.every((record) => record.releaseYear === 2002)).toBe(true);

    const coolPorygon = CURATED_JAPANESE_PROMOS.filter((record) => record.name === 'Cool Porygon');
    expect(coolPorygon).toHaveLength(1);
    expect(coolPorygon[0]?.additionalReleaseEvents).toContain('Nintendo 64 W Double Get');
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'Pokemon Song Best Collection CD').some((record) => record.identicalPrintingGroup)).toBe(false);
    expect(curatedJapanesePromoCountsByFamily()["McDonald's Pokemon-e Minimum Pack"]).toBe(18);
    expect(CURATED_JAPANESE_PROMOS.some((record) => 'verifiedSupplement' in record)).toBe(false);
    expect(CURATED_JAPANESE_PROMOS.some((record) => record.estimatedCopies || record.finish || record.surface || record.backType)).toBe(false);
  });

  it('expands curated Japanese promo families without guessed years or collapsed variants', () => {
    const counts = curatedJapanesePromoCountsByFamily();

    expect(CURATED_JAPANESE_PROMOS.length).toBeGreaterThanOrEqual(95);
    expect(CURATED_JAPANESE_PROMOS.length).toBeLessThanOrEqual(110);
    expect(counts['Evolution Communication Masaki campaign']).toBe(5);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'Evolution Communication Masaki campaign').map((record) => record.name).sort()).toEqual(['Alakazam', 'Gengar', 'Golem', 'Machamp', 'Omastar']);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'Trade Please! campaign').map((record) => record.name).sort()).toEqual(['Blastoise', 'Charizard', 'Trade Please!', 'Venusaur']);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.name === 'Flying Pikachu' && record.promoContext.startsWith('ANA airline campaign'))).toHaveLength(2);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'CoroCoro Best Photo Contest')).toHaveLength(5);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'Pokemon Snap 64 Mario Stadium photo contest')).toHaveLength(5);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.variantOf === 'lucky-stadium-world-challenge-summer-2000')).toHaveLength(9);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'How I Became a Pokemon Card').every((record) => record.releaseYear === undefined)).toBe(true);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.promoContext === 'Pokemon Card Trainers Magazine').every((record) => record.releaseYear === undefined)).toBe(true);
    expect(CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-official-card-file-pikachu')?.name).toBe('Pikachu');
    expect(CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-official-card-file-charmander')?.name).toBe('Charmander');
    expect(CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-pocket-monsters-fan-book-mewtwo')?.name).toBe('Mewtwo');
    expect(CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-toyota-campaign-arcanine')?.name).toBe('Arcanine');
  });

  it('audits exact numbered curated promo coverage conservatively and read-only', () => {
    const dbPath = tempCatalogPath('curated-audit-numbered');
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jpn_mcdemp-10',
        language: 'ja',
        name: 'Pikachu',
        normalizedName: 'pikachu',
        setName: "McDonald's Pokemon-e Minimum Pack",
        normalizedSetName: 'mcdonald s pokemon e minimum pack',
        cardNumber: '010',
        normalizedCardNumber: '10',
        printedTotal: '018'
      })
    ], dbPath);
    const before = cardCatalogStats(dbPath);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const report = auditCuratedJapanesePromos({
      dbPath,
      includeCovered: true,
      records: [
        CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-mcdemp-2002-010')!,
        CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-mcdemp-2002-011')!
      ]
    });

    expect(report.statusCounts).toMatchObject({ COVERED: 1, MISSING: 1, AMBIGUOUS: 0 });
    expect(report.records.find((record) => record.cardNumber === '010')?.status).toBe('COVERED');
    expect(report.records.find((record) => record.cardNumber === '010')?.reason).toBe('exact numbered release match');
    expect(report.records.find((record) => record.cardNumber === '011')?.status).toBe('MISSING');
    expect(cardCatalogStats(dbPath)).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('audits ambiguous unnumbered same-name records without false coverage', () => {
    const dbPath = tempCatalogPath('curated-audit-unnumbered');
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-random-mew',
        language: 'ja',
        name: 'Mew',
        normalizedName: 'mew',
        setName: 'Japanese Promo',
        normalizedSetName: 'japanese promo',
        cardNumber: undefined,
        normalizedCardNumber: undefined,
        printedTotal: undefined,
        isUnnumbered: true
      })
    ], dbPath);

    const report = auditCuratedJapanesePromos({
      dbPath,
      includeCovered: true,
      records: [CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-jr-train-rally-1997-mew')!]
    });

    expect(report.records[0]?.status).toBe('AMBIGUOUS');
    expect(report.records[0]?.reason).toBe('same name but release context insufficient');
  });

  it('audits exact unnumbered release identity and multiple plausible candidates conservatively', () => {
    const dbPath = tempCatalogPath('curated-audit-release-context');
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-jr-mew',
        language: 'ja',
        name: 'Mew',
        normalizedName: 'mew',
        setName: 'JR Train Rally 1997',
        normalizedSetName: 'jr train rally 1997',
        isUnnumbered: true
      }),
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-jr-mew-alt',
        language: 'ja',
        name: 'Mew',
        normalizedName: 'mew',
        setName: 'JR Train Rally 1997 prize',
        normalizedSetName: 'jr train rally 1997 prize',
        isUnnumbered: true
      })
    ], dbPath);

    const mew = CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-jr-train-rally-1997-mew')!;
    const multiple = auditCuratedJapanesePromos({ dbPath, includeCovered: true, records: [mew] });
    expect(multiple.records[0]).toMatchObject({ status: 'AMBIGUOUS', reason: 'multiple contextual candidates' });

    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-jr-mew',
        language: 'ja',
        name: 'Mew',
        normalizedName: 'mew',
        setName: 'JR Train Rally 1997',
        normalizedSetName: 'jr train rally 1997',
        isUnnumbered: true
      })
    ], dbPath);

    const exact = auditCuratedJapanesePromos({ dbPath, includeCovered: true, records: [mew] });
    expect(exact.records[0]).toMatchObject({ status: 'COVERED', reason: 'exact release identity match' });
  });

  it('audits product insert records by canonical name and release context', () => {
    const dbPath = tempCatalogPath('curated-audit-product-insert');
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-official-card-file-pikachu',
        language: 'ja',
        name: 'Pikachu',
        normalizedName: 'pikachu',
        setName: 'Official Card File insert',
        normalizedSetName: 'official card file insert',
        isUnnumbered: true
      }),
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-generic-pikachu',
        language: 'ja',
        name: 'Pikachu',
        normalizedName: 'pikachu',
        setName: 'Pokemon Promo',
        normalizedSetName: 'pokemon promo',
        isUnnumbered: true
      })
    ], dbPath);
    const pikachu = CURATED_JAPANESE_PROMOS.find((record) => record.curationId === 'jp-promo-official-card-file-pikachu')!;

    expect(auditCuratedJapanesePromos({ dbPath, includeCovered: true, records: [pikachu] }).records[0]).toMatchObject({
      status: 'COVERED',
      reason: 'exact release identity match'
    });

    replaceCardCatalogSourceRecords('TCGDEX', [
      record({
        source: 'TCGDEX',
        sourceCardId: 'jp-generic-pikachu',
        language: 'ja',
        name: 'Pikachu',
        normalizedName: 'pikachu',
        setName: 'Pokemon Promo',
        normalizedSetName: 'pokemon promo',
        isUnnumbered: true
      })
    ], dbPath);
    expect(auditCuratedJapanesePromos({ dbPath, includeCovered: true, records: [pikachu] }).records[0]?.status).toBe('AMBIGUOUS');
  });

  it('leaves existing Vaultr promo import behavior scoped to verified supplements', () => {
    const records = loadVaultrPromoSupplementRecords('2026-09-03T00:00:00.000Z');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: 'VAULTR_PROMO',
      sourceCardId: 'vaultr-promo-dextcg-jpn-mcdemp-7',
      name: 'Squirtle'
    });
    expect(CURATED_JAPANESE_PROMOS.length).toBeGreaterThan(records.length);
    expect(CURATED_JAPANESE_PROMOS.filter((record) => record.references.some((reference) => reference.sourceName === 'DEXTCG')).length).toBeGreaterThan(records.length);
  });

  it('supports verified unnumbered promo fixtures without treating alternate identifiers as printed numbers', () => {
    const dbPath = tempCatalogPath('unnumbered-promo');
    replaceCardCatalogSourceRecords('VAULTR_PROMO', [
      vaultrPromoRecordFromDefinition({
        sourceCardId: 'fixture-corocoro-mew',
        name: 'Mew',
        language: 'ja',
        isUnnumbered: true,
        promoContext: 'CoroCoro Promo',
        releaseType: 'magazine_promo',
        releaseEvent: 'CoroCoro',
        aliases: ['Shining Mew', 'CoroCoro Mew'],
        identifiers: [{ value: '151', kind: 'pokedex' }],
        verificationStatus: 'VERIFIED',
        references: [{ sourceName: 'Fixture', sourceId: 'corocoro-mew' }]
      }, '2026-08-27T00:00:00.000Z')
    ], dbPath);

    expect(searchLocalCardCatalog('mew corocoro', 10, { dbPath })[0]).toMatchObject({
      source: 'VAULTR_PROMO',
      value: 'Mew CoroCoro Promo Japanese unnumbered',
      isUnnumbered: true,
      cardNumber: undefined
    });
    expect(searchLocalCardCatalog('shining mew corocoro', 10, { dbPath })[0]?.sourceCardId).toBe('fixture-corocoro-mew');
    expect(searchLocalCardCatalog('mew corocoro 151', 10, { dbPath })[0]).toMatchObject({
      sourceCardId: 'fixture-corocoro-mew',
      isUnnumbered: true,
      cardNumber: undefined
    });
    expect(searchLocalCardCatalog('mew 151', 10, { dbPath })).toEqual([]);
    expect(searchLocalCardCatalog('mew corocoro 151/999', 10, { dbPath })).toEqual([]);
  });

  it('hides REVIEW Vaultr promo records while returning VERIFIED records', () => {
    const dbPath = tempCatalogPath('promo-verification');
    replaceCardCatalogSourceRecords('VAULTR_PROMO', [
      vaultrPromoRecordFromDefinition({
        sourceCardId: 'review-mew',
        name: 'Mew',
        language: 'ja',
        isUnnumbered: true,
        promoContext: 'CoroCoro Promo',
        aliases: ['CoroCoro Mew'],
        identifiers: [{ value: '151', kind: 'pokedex' }],
        verificationStatus: 'REVIEW',
        references: [{ sourceName: 'Fixture' }]
      }, '2026-08-27T00:00:00.000Z'),
      vaultrPromoRecordFromDefinition({
        sourceCardId: 'verified-pikachu',
        name: 'Pikachu',
        language: 'ja',
        isUnnumbered: true,
        promoContext: 'ANA Promo',
        aliases: ['Pikachu ANA Promo'],
        verificationStatus: 'VERIFIED',
        references: [{ sourceName: 'Fixture' }]
      }, '2026-08-27T00:00:00.000Z')
    ], dbPath);

    expect(searchLocalCardCatalog('mew corocoro', 10, { dbPath })).toEqual([]);
    expect(searchLocalCardCatalog('pikachu ana', 10, { dbPath })[0]).toMatchObject({ sourceCardId: 'verified-pikachu' });
  });

  it('keeps core upstream records ahead of equivalent Vaultr promo supplements', () => {
    const dbPath = tempCatalogPath('promo-precedence');
    replaceCardCatalogSourceRecords('POKEMONTCG', [
      record({ sourceCardId: 'bw11-RC24', name: 'Mew-EX', cardNumber: 'RC24', normalizedCardNumber: 'RC24', setName: 'Legendary Treasures', normalizedSetName: 'legendary treasures' })
    ], dbPath);
    replaceCardCatalogSourceRecords('VAULTR_PROMO', [
      vaultrPromoRecordFromDefinition({
        sourceCardId: 'supplement-rc24',
        name: 'Mew-EX',
        language: 'en',
        setName: 'Legendary Treasures',
        cardNumber: 'RC24',
        promoContext: 'Radiant Collection',
        verificationStatus: 'VERIFIED',
        references: [{ sourceName: 'Fixture' }]
      }, '2026-08-27T00:00:00.000Z')
    ], dbPath);

    const results = searchLocalCardCatalog('mew rc24', 10, { dbPath });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'POKEMONTCG', sourceCardId: 'bw11-RC24' });
  });

  it('tracks anonymous catalog misses by normalized query only', () => {
    const dbPath = tempCatalogPath('misses');
    recordCardCatalogMiss('Mew   CoroCoro', dbPath, '2026-08-27T00:00:00.000Z');
    recordCardCatalogMiss('mew corocoro', dbPath, '2026-08-28T00:00:00.000Z');
    recordCardCatalogMiss('Squirtle McDonalds 007/018', dbPath, '2026-08-29T00:00:00.000Z');

    expect(listCardCatalogMisses({ dbPath })).toEqual([
      {
        normalizedQuery: 'mew corocoro',
        firstSeenAt: '2026-08-27T00:00:00.000Z',
        lastSeenAt: '2026-08-28T00:00:00.000Z',
        missCount: 2
      },
      {
        normalizedQuery: 'squirtle mcdonalds 007/018',
        firstSeenAt: '2026-08-29T00:00:00.000Z',
        lastSeenAt: '2026-08-29T00:00:00.000Z',
        missCount: 1
      }
    ]);
  });

  it('reports catalog misses from the CLI without user identifiers', () => {
    const dbPath = tempCatalogPath('misses-cli');
    process.env.CARD_CATALOG_PATH = dbPath;
    recordCardCatalogMiss('Mew CoroCoro', dbPath, '2026-08-27T00:00:00.000Z');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let payload: unknown;

    try {
      runCatalogMissesCli(['--limit=5']);
      payload = JSON.parse(log.mock.calls[0]?.[0] as string);
    } finally {
      log.mockRestore();
    }

    expect(payload).toEqual({
      misses: [{
        normalizedQuery: 'mew corocoro',
        firstSeenAt: '2026-08-27T00:00:00.000Z',
        lastSeenAt: '2026-08-27T00:00:00.000Z',
        missCount: 1
      }]
    });
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
