import fs from 'node:fs';
import path from 'node:path';
import type { CardCatalogRecord } from '../types.js';
import { catalogDisplayValue, isPromoRecord, normalizeCatalogCardNumber, normalizeCatalogText, uniqueCatalogAliases } from '../normalize.js';
import { arrayFromJson, asRecord, readJsonFile } from './common.js';

type PokemonTcgSetMetadata = {
  id?: string;
  name?: string;
  series?: string;
  printedTotal?: string;
  releaseDate?: string;
};

function pokemonImageUrl(card: Record<string, any>, setId?: string): string | undefined {
  const large = typeof card.images?.large === 'string' ? card.images.large : undefined;
  if (large) return large;
  const id = typeof card.id === 'string' ? card.id : undefined;
  if (!id || !setId || !id.startsWith(`${setId}-`)) return undefined;
  const cardId = id.slice(setId.length + 1);
  return `https://images.pokemontcg.io/${setId}/${cardId}_hires.png`;
}

function setIdFromCard(card: Record<string, any>, filePath?: string): string | undefined {
  if (typeof card.set?.id === 'string') return card.set.id;
  if (typeof card.id === 'string' && card.id.includes('-')) return card.id.split('-')[0];
  if (filePath) return path.basename(filePath, '.json');
  return undefined;
}

export function pokemonTcgRecordFromCard(card: unknown, importedAt = new Date().toISOString(), setMetadata?: PokemonTcgSetMetadata, filePath?: string): CardCatalogRecord | undefined {
  const row = asRecord(card);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return undefined;
  const set = asRecord(row.set);
  const setId = setMetadata?.id ?? (typeof set?.id === 'string' ? set.id : setIdFromCard(row, filePath));
  const setName = setMetadata?.name ?? (typeof set?.name === 'string' ? set.name : undefined);
  const series = setMetadata?.series ?? (typeof set?.series === 'string' ? set.series : undefined);
  const cardNumber = typeof row.number === 'string' || typeof row.number === 'number' ? String(row.number) : undefined;
  const printedTotal = setMetadata?.printedTotal ?? (typeof set?.printedTotal === 'string' || typeof set?.printedTotal === 'number'
    ? String(set.printedTotal)
    : undefined);
  const normalizedCardNumber = normalizeCatalogCardNumber(cardNumber);
  const rarity = typeof row.rarity === 'string' ? row.rarity : undefined;
  const isPromo = isPromoRecord({ setName, series, rarity });
  const displayValue = catalogDisplayValue({ name: row.name, setName, cardNumber, printedTotal, language: 'en' });
  return {
    source: 'POKEMONTCG',
    sourceCardId: row.id,
    language: 'en',
    name: row.name,
    normalizedName: normalizeCatalogText(row.name),
    setId,
    setName,
    normalizedSetName: normalizeCatalogText(setName),
    series,
    cardNumber,
    normalizedCardNumber,
    printedTotal,
    rarity,
    imageUrl: pokemonImageUrl(row, setId),
    releaseDate: setMetadata?.releaseDate ?? (typeof set?.releaseDate === 'string' ? set.releaseDate : undefined),
    isPromo,
    promoContext: isPromo ? setName : undefined,
    sourceUpdatedAt: undefined,
    importedAt,
    aliases: uniqueCatalogAliases([
      { alias: row.name, locale: 'en', kind: 'native_name' },
      { alias: displayValue, locale: 'en', kind: 'display_name' }
    ])
  };
}

function loadPokemonTcgSetMetadata(sourceDir: string): Map<string, PokemonTcgSetMetadata> {
  const setPath = path.join(sourceDir, 'sets', 'en.json');
  const sets = arrayFromJson(readJsonFile(setPath)).map(asRecord).filter(Boolean);
  return new Map(sets.map((set) => [String(set!.id), {
    id: typeof set!.id === 'string' ? set!.id : undefined,
    name: typeof set!.name === 'string' ? set!.name : undefined,
    series: typeof set!.series === 'string' ? set!.series : undefined,
    printedTotal: typeof set!.printedTotal === 'string' || typeof set!.printedTotal === 'number' ? String(set!.printedTotal) : undefined,
    releaseDate: typeof set!.releaseDate === 'string' ? set!.releaseDate : undefined
  }]));
}

export function loadPokemonTcgRepositoryRecords(sourceDir: string, importedAt = new Date().toISOString()): { records: CardCatalogRecord[]; examined: number; errors: number } {
  const records: CardCatalogRecord[] = [];
  let examined = 0;
  let errors = 0;
  let sets = new Map<string, PokemonTcgSetMetadata>();
  try {
    sets = loadPokemonTcgSetMetadata(sourceDir);
  } catch {
    errors += 1;
  }
  const cardsDir = path.join(sourceDir, 'cards', 'en');
  const files = fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter((name) => name.endsWith('.json')).map((name) => path.join(cardsDir, name)) : [];
  for (const filePath of files) {
    try {
      for (const card of arrayFromJson(readJsonFile(filePath))) {
        examined += 1;
        const row = asRecord(card);
        const setId = row ? setIdFromCard(row, filePath) : undefined;
        const record = pokemonTcgRecordFromCard(card, importedAt, setId ? sets.get(setId) : undefined, filePath);
        if (record) records.push(record);
      }
    } catch {
      errors += 1;
    }
  }
  return { records, examined, errors };
}

export function pokemonTcgDisplayValue(record: CardCatalogRecord): string {
  return catalogDisplayValue(record);
}
