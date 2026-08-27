import type { CardCatalogRecord } from '../types.js';
import { catalogDisplayValue, isPromoRecord, normalizeCatalogCardNumber, normalizeCatalogText } from '../normalize.js';
import { arrayFromJson, asRecord, jsonFiles, readJsonFile } from './common.js';

function pokemonImageUrl(card: Record<string, any>): string | undefined {
  const large = typeof card.images?.large === 'string' ? card.images.large : undefined;
  if (large) return large;
  const id = typeof card.id === 'string' ? card.id : undefined;
  const setId = typeof card.set?.id === 'string' ? card.set.id : undefined;
  if (!id || !setId || !id.startsWith(`${setId}-`)) return undefined;
  const cardId = id.slice(setId.length + 1);
  return `https://images.pokemontcg.io/${setId}/${cardId}_hires.png`;
}

export function pokemonTcgRecordFromCard(card: unknown, importedAt = new Date().toISOString()): CardCatalogRecord | undefined {
  const row = asRecord(card);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return undefined;
  const set = asRecord(row.set);
  const setName = typeof set?.name === 'string' ? set.name : undefined;
  const series = typeof set?.series === 'string' ? set.series : undefined;
  const cardNumber = typeof row.number === 'string' || typeof row.number === 'number' ? String(row.number) : undefined;
  const printedTotal = typeof set?.printedTotal === 'string' || typeof set?.printedTotal === 'number'
    ? String(set.printedTotal)
    : undefined;
  const normalizedCardNumber = normalizeCatalogCardNumber(cardNumber);
  const rarity = typeof row.rarity === 'string' ? row.rarity : undefined;
  const isPromo = isPromoRecord({ setName, series, rarity });
  return {
    source: 'POKEMONTCG',
    sourceCardId: row.id,
    language: 'en',
    name: row.name,
    normalizedName: normalizeCatalogText(row.name),
    setId: typeof set?.id === 'string' ? set.id : undefined,
    setName,
    normalizedSetName: normalizeCatalogText(setName),
    series,
    cardNumber,
    normalizedCardNumber,
    printedTotal,
    rarity,
    imageUrl: pokemonImageUrl(row),
    releaseDate: typeof set?.releaseDate === 'string' ? set.releaseDate : undefined,
    isPromo,
    promoContext: isPromo ? setName : undefined,
    sourceUpdatedAt: undefined,
    importedAt
  };
}

export function loadPokemonTcgRepositoryRecords(sourceDir: string, importedAt = new Date().toISOString()): { records: CardCatalogRecord[]; examined: number; errors: number } {
  const records: CardCatalogRecord[] = [];
  let examined = 0;
  let errors = 0;
  for (const filePath of jsonFiles(sourceDir)) {
    try {
      for (const card of arrayFromJson(readJsonFile(filePath))) {
        examined += 1;
        const record = pokemonTcgRecordFromCard(card, importedAt);
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
