import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardCatalogStats, initializeCardCatalogDb, replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import { searchLocalCardCatalog } from '../card-catalog/search.js';
import { pokemonTcgRecordFromCard } from '../card-catalog/importers/pokemontcg.js';
import { tcgDexRecordFromCard } from '../card-catalog/importers/tcgdex.js';
import { autocompleteChaseCardsWithStatus, clearChaseCardAutocompleteCache } from '../chase-card-catalog.js';

const originalFetch = globalThis.fetch;
const originalCatalogPath = process.env.CARD_CATALOG_PATH;
const tempDirs = new Set<string>();

function tempCatalogPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vaultr-card-catalog-${label}-`));
  tempDirs.add(dir);
  return path.join(dir, 'card-catalog.db');
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

  it('normalizes representative PokemonTCG and TCGdex source records', () => {
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
      id: 'SV8a-217',
      localId: '217',
      name: 'ブラッキーex',
      image: 'https://assets.tcgdex.net/ja/SV/SV8a/217',
      set: { id: 'SV8a', name: 'Terastal Festival ex', cardCount: { official: 187 } }
    }, { language: 'ja' })).toMatchObject({
      source: 'TCGDEX',
      sourceCardId: 'SV8a-217',
      language: 'ja',
      cardNumber: '217',
      printedTotal: '187',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV8a/217/high.png'
    });

    expect(pokemonTcgRecordFromCard({ id: 'bad' })).toBeUndefined();
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

  it('lets exact Japanese number evidence outrank unrelated local Mew cards', () => {
    const dbPath = tempCatalogPath('japanese');
    replaceCardCatalogSourceRecords('TCGDEX', [
      tcgDexRecordFromCard({
        id: 'SV4a-347',
        localId: '347',
        name: 'ミュウex',
        image: 'https://assets.tcgdex.net/ja/SV/SV4a/347',
        set: { id: 'SV4a', name: 'Shiny Treasure ex', cardCount: { official: 190 } }
      }, { language: 'ja' })!,
      tcgDexRecordFromCard({
        id: 'S12a-51',
        localId: '051',
        name: 'ミュウ',
        image: 'https://assets.tcgdex.net/ja/S/S12a/051',
        set: { id: 'S12a', name: 'VSTAR Universe', cardCount: { official: 172 } }
      }, { language: 'ja' })!
    ], dbPath);

    expect(searchLocalCardCatalog('mew 347/190', 5, { dbPath })[0]).toMatchObject({
      value: 'ミュウex Shiny Treasure ex 347/190 Japanese',
      imageSourceName: 'TCGDEX',
      imageSourceKind: 'CARD_REFERENCE'
    });
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

    expect(result).toMatchObject({ unavailable: false, stale: false, availability: 'AVAILABLE' });
    expect(result.choices[0]).toEqual({ name: 'Mew-EX - Legendary Treasures #RC24', value: 'Mew-EX Legendary Treasures RC24' });

    const coro = await autocompleteChaseCardsWithStatus('mew corocoro 151', 25);
    expect(JSON.stringify(coro)).not.toContain('jpn_unp-124');
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
});
