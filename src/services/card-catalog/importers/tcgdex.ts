import type { CardCatalogLanguage, CardCatalogRecord } from '../types.js';
import { catalogDisplayValue, isPromoRecord, normalizeCatalogCardNumber, normalizeCatalogText } from '../normalize.js';
import { arrayFromJson, asRecord, jsonFiles, readJsonFile } from './common.js';

function tcgDexLanguageFromPath(filePath: string): CardCatalogLanguage | undefined {
  if (/(^|[/\\])ja([/\\]|$)/i.test(filePath) || /[/\\]jp[/\\]/i.test(filePath)) return 'ja';
  if (/(^|[/\\])en([/\\]|$)/i.test(filePath)) return 'en';
  return undefined;
}

function tcgDexImageUrl(card: Record<string, any>): string | undefined {
  const image = typeof card.image === 'string' ? card.image : undefined;
  if (!image) return undefined;
  return image.endsWith('/high.png') ? image : `${image.replace(/\/+$/, '')}/high.png`;
}

export function tcgDexRecordFromCard(card: unknown, options: { filePath?: string; importedAt?: string; language?: CardCatalogLanguage } = {}): CardCatalogRecord | undefined {
  const row = asRecord(card);
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return undefined;
  const set = asRecord(row.set);
  const language = options.language ?? (options.filePath ? tcgDexLanguageFromPath(options.filePath) : undefined);
  if (!language) return undefined;
  const setName = typeof set?.name === 'string' ? set.name : typeof set?.id === 'string' ? set.id : undefined;
  const cardNumber = typeof row.localId === 'string' || typeof row.localId === 'number'
    ? String(row.localId)
    : typeof row.number === 'string' || typeof row.number === 'number'
      ? String(row.number)
      : undefined;
  const printedTotal = typeof set?.cardCount?.official === 'string' || typeof set?.cardCount?.official === 'number'
    ? String(set.cardCount.official)
    : typeof set?.printedTotal === 'string' || typeof set?.printedTotal === 'number'
      ? String(set.printedTotal)
      : undefined;
  const rarity = typeof row.rarity === 'string' ? row.rarity : undefined;
  const series = typeof set?.serie === 'string' ? set.serie : typeof set?.series === 'string' ? set.series : undefined;
  const isPromo = isPromoRecord({ setName, series, rarity });
  return {
    source: 'TCGDEX',
    sourceCardId: row.id,
    language,
    name: row.name,
    normalizedName: normalizeCatalogText(row.name),
    setId: typeof set?.id === 'string' ? set.id : undefined,
    setName,
    normalizedSetName: normalizeCatalogText(setName),
    series,
    cardNumber,
    normalizedCardNumber: normalizeCatalogCardNumber(cardNumber),
    printedTotal,
    rarity,
    imageUrl: tcgDexImageUrl(row),
    releaseDate: typeof set?.releaseDate === 'string' ? set.releaseDate : undefined,
    isPromo,
    promoContext: isPromo ? setName : undefined,
    sourceUpdatedAt: undefined,
    importedAt: options.importedAt ?? new Date().toISOString()
  };
}

export function loadTcgDexRepositoryRecords(sourceDir: string, importedAt = new Date().toISOString()): { records: CardCatalogRecord[]; examined: number; errors: number } {
  const records: CardCatalogRecord[] = [];
  let examined = 0;
  let errors = 0;
  for (const filePath of jsonFiles(sourceDir)) {
    try {
      for (const card of arrayFromJson(readJsonFile(filePath))) {
        examined += 1;
        const record = tcgDexRecordFromCard(card, { filePath, importedAt });
        if (record) records.push(record);
      }
    } catch {
      errors += 1;
    }
  }
  return { records, examined, errors };
}

export function tcgDexDisplayValue(record: CardCatalogRecord): string {
  return catalogDisplayValue(record);
}
