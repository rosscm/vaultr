import fs from 'node:fs';
import path from 'node:path';
import type { CardCatalogLanguage, CardCatalogRecord } from '../types.js';
import { catalogDisplayValue, isPromoRecord, normalizeCatalogCardNumber, normalizeCatalogText, uniqueCatalogAliases } from '../normalize.js';
import { asRecord } from './common.js';

function tcgDexLanguageFromPath(filePath: string): CardCatalogLanguage | undefined {
  if (/(^|[/\\])data-asia([/\\]|$)/i.test(filePath) || /(^|[/\\])ja([/\\]|$)/i.test(filePath) || /[/\\]jp[/\\]/i.test(filePath)) return 'ja';
  if (/(^|[/\\])en([/\\]|$)/i.test(filePath)) return 'en';
  if (/(^|[/\\])data([/\\]|$)/i.test(filePath)) return 'en';
  return undefined;
}

function tcgDexImageUrl(card: Record<string, any>): string | undefined {
  const image = typeof card.image === 'string' ? card.image : undefined;
  if (!image) return undefined;
  return image.endsWith('/high.png') ? image : `${image.replace(/\/+$/, '')}/high.png`;
}

function tcgDexImageUrlFromPath(filePath: string | undefined, language: CardCatalogLanguage): string | undefined {
  if (!filePath) return undefined;
  const match = /[/\\](data(?:-asia)?)[/\\]([^/\\]+)[/\\]([^/\\]+)[/\\]([^/\\]+)\.ts$/i.exec(filePath);
  if (!match) return undefined;
  const era = match[2];
  const setId = match[3];
  const number = match[4];
  const locale = language === 'ja' ? 'ja' : 'en';
  return `https://assets.tcgdex.net/${locale}/${era}/${setId}/${number}/high.png`;
}

function localizedString(value: unknown, preferred: string): string | undefined {
  if (typeof value === 'string') return value;
  const row = asRecord(value);
  if (!row) return undefined;
  return typeof row[preferred] === 'string'
    ? row[preferred]
    : typeof row.en === 'string'
      ? row.en
      : typeof row.id === 'string'
        ? row.id
        : Object.values(row).find((entry): entry is string => typeof entry === 'string');
}

function aliasesFromLocalizedName(value: unknown): Array<{ alias: string; locale?: string; kind: 'native_name' | 'localized_name' }> {
  if (typeof value === 'string') return [{ alias: value, kind: 'native_name' }];
  const row = asRecord(value);
  if (!row) return [];
  return Object.entries(row)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([locale, alias]) => ({ alias, locale, kind: locale === 'ja' ? 'native_name' : 'localized_name' }));
}

function localizedDate(value: unknown, preferred: string): string | undefined {
  if (typeof value === 'string') return value;
  const row = asRecord(value);
  if (!row) return undefined;
  return typeof row[preferred] === 'string' ? row[preferred] : undefined;
}

function parseTcgDexModuleObject(source: string, variable: 'card' | 'set'): Record<string, any> | undefined {
  const match = new RegExp(`const\\s+${variable}\\s*:[^{=]+=(?<body>[\\s\\S]*?)\\n\\s*export\\s+default\\s+${variable}`).exec(source);
  const body = match?.groups?.body;
  if (!body) return undefined;
  try {
    const cleaned = body
      .trim()
      .replace(/,\s*$/, '')
      .replace(/\bset:\s*Set\s*,?/g, '');
    return Function(`"use strict"; return (${cleaned});`)() as Record<string, any>;
  } catch {
    return parseTcgDexNeededFields(body, variable);
  }
}

function parseLocalizedObjectField(source: string, field: string): Record<string, string> | undefined {
  const match = new RegExp(`${field}\\s*:\\s*{(?<body>[\\s\\S]*?)}`, 'm').exec(source);
  const body = match?.groups?.body;
  if (!body) return undefined;
  const values: Record<string, string> = {};
  const entryPattern = /['"]?([a-z]{2}(?:-[a-z]{2})?|id)['"]?\s*:\s*['"]([^'"]+)['"]/gi;
  for (const entry of body.matchAll(entryPattern)) values[entry[1]!] = entry[2]!;
  return Object.keys(values).length > 0 ? values : undefined;
}

function parseTcgDexNeededFields(source: string, variable: 'card' | 'set'): Record<string, any> | undefined {
  const name = parseLocalizedObjectField(source, 'name');
  if (variable === 'card') {
    if (!name) return undefined;
    const image = /image\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
    const rarity = /rarity\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
    return { name, image, rarity };
  }
  const id = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  const official = /cardCount\s*:\s*{[\s\S]*?official\s*:\s*(\d+)/.exec(source)?.[1];
  const releaseDate = parseLocalizedObjectField(source, 'releaseDate');
  const serie = /serie\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? /series\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  return id || name ? { id, name, cardCount: official ? { official } : undefined, releaseDate, serie } : undefined;
}

function setMetadataFromFile(filePath: string): Record<string, any> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return parseTcgDexModuleObject(fs.readFileSync(filePath, 'utf8'), 'set');
}

export function loadTcgDexJapaneseSetTranslations(sourceDir: string): Map<string, string> {
  const filePath = path.join(sourceDir, 'scripts', 'utils-data', 'jp_set_translations.ts');
  const translations = new Map<string, string>();
  if (!fs.existsSync(filePath)) return translations;
  const source = fs.readFileSync(filePath, 'utf8');
  const entryPattern = /['"]?([A-Za-z0-9]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  for (const entry of source.matchAll(entryPattern)) translations.set(entry[1]!, entry[2]!);
  return translations;
}

export function tcgDexRecordFromCard(card: unknown, options: { filePath?: string; importedAt?: string; language?: CardCatalogLanguage; setMetadata?: Record<string, any>; setTranslations?: Map<string, string> } = {}): CardCatalogRecord | undefined {
  const row = asRecord(card);
  if (!row) return undefined;
  const rowSet = asRecord(row.set);
  const set = rowSet && Object.keys(rowSet).length > 0 ? rowSet : options.setMetadata;
  const language = options.language ?? (options.filePath ? tcgDexLanguageFromPath(options.filePath) : undefined);
  if (!language) return undefined;
  const preferredLocale = language === 'ja' ? 'ja' : 'en';
  const setId = typeof set?.id === 'string' ? set.id : options.filePath ? path.basename(path.dirname(options.filePath)) : undefined;
  const fileNumber = options.filePath ? path.basename(options.filePath, '.ts') : undefined;
  const sourceCardId = typeof row.id === 'string' ? row.id : setId && fileNumber ? `${setId}-${fileNumber}` : undefined;
  const name = localizedString(row.name, preferredLocale);
  if (!sourceCardId || !name) return undefined;
  const setName = localizedString(set?.name, preferredLocale) ?? setId;
  const translatedSetName = language === 'ja' && setId ? options.setTranslations?.get(setId) : undefined;
  const cardNumber = typeof row.localId === 'string' || typeof row.localId === 'number'
    ? String(row.localId)
    : typeof row.number === 'string' || typeof row.number === 'number'
      ? String(row.number)
      : fileNumber;
  const printedTotal = typeof set?.cardCount?.official === 'string' || typeof set?.cardCount?.official === 'number'
    ? String(set.cardCount.official)
    : typeof set?.printedTotal === 'string' || typeof set?.printedTotal === 'number'
      ? String(set.printedTotal)
      : undefined;
  const rarity = typeof row.rarity === 'string' ? row.rarity : undefined;
  const series = typeof set?.serie === 'string' ? set.serie : typeof set?.series === 'string' ? set.series : undefined;
  const isPromo = isPromoRecord({ setName, series, rarity });
  const displayValue = catalogDisplayValue({ name, setName, translatedSetName, cardNumber, printedTotal, language });
  return {
    source: 'TCGDEX',
    sourceCardId,
    language,
    name,
    normalizedName: normalizeCatalogText(name),
    setId,
    setName,
    translatedSetName,
    normalizedSetName: normalizeCatalogText(setName),
    series,
    cardNumber,
    normalizedCardNumber: normalizeCatalogCardNumber(cardNumber),
    printedTotal,
    rarity,
    imageUrl: tcgDexImageUrl(row) ?? tcgDexImageUrlFromPath(options.filePath, language),
    releaseDate: localizedDate(set?.releaseDate, preferredLocale),
    isPromo,
    promoContext: isPromo ? setName : undefined,
    sourceUpdatedAt: undefined,
    importedAt: options.importedAt ?? new Date().toISOString(),
    aliases: uniqueCatalogAliases([
      ...aliasesFromLocalizedName(row.name),
      { alias: displayValue, locale: language, kind: 'display_name' },
      ...(translatedSetName ? [{ alias: translatedSetName, locale: 'en', kind: 'source_alias' as const }] : [])
    ])
  };
}

export function loadTcgDexRepositoryRecords(sourceDir: string, importedAt = new Date().toISOString()): { records: CardCatalogRecord[]; examined: number; errors: number } {
  const records: CardCatalogRecord[] = [];
  let examined = 0;
  let errors = 0;
  const setTranslations = loadTcgDexJapaneseSetTranslations(sourceDir);
  const roots = [path.join(sourceDir, 'data'), path.join(sourceDir, 'data-asia')].filter((root) => fs.existsSync(root));
  const files: string[] = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) stack.push(path.join(current, entry.name));
      } else if (/[/\\]\d+\.ts$/.test(current) || /[/\\][A-Z0-9]+[/\\][A-Z0-9-]+\.ts$/i.test(current)) {
        files.push(current);
      }
    }
  }
  for (const filePath of files) {
    try {
      const card = parseTcgDexModuleObject(fs.readFileSync(filePath, 'utf8'), 'card');
      if (!card) continue;
      examined += 1;
      const setPath = `${path.dirname(filePath)}.ts`;
      const record = tcgDexRecordFromCard(card, { filePath, importedAt, setMetadata: setMetadataFromFile(setPath), setTranslations });
      if (record) records.push(record);
    } catch {
      errors += 1;
    }
  }
  return { records, examined, errors };
}

export function tcgDexDisplayValue(record: CardCatalogRecord): string {
  return catalogDisplayValue(record);
}
