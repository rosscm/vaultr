import { normalizeChaseCardName, POKEMON_RELEASE_ALIASES } from '../collector-card-aliases.js';

const CARD_NUMBER_PREFIX_TERMS = new Set(['bw', 'dp', 'rc', 'sm', 'sv', 'svp', 'swsh', 'xy']);
const QUERY_STOP_TERMS = new Set([
  'card', 'cards', 'pokemon', 'tcg', 'japanese', 'english', 'holo', 'foil',
  'rare', 'promo', 'promos', 'promotional', 'sar', 'sir', 'ex', 'v', 'vmax', 'gx'
]);

export type ParsedCatalogSearchQuery = {
  original: string;
  normalized: string;
  subject?: string;
  language?: 'en' | 'ja';
  localNumber?: string;
  printedTotal?: string;
  alphanumericNumber?: string;
  releaseContext?: string;
};

export function normalizeCatalogText(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function cleanCatalogIllustrator(value: string | undefined | null): string | undefined {
  const cleaned = (value ?? '').trim().replace(/\s+/g, ' ');
  return cleaned || undefined;
}

export function normalizeCatalogCardNumber(value: string | undefined | null): string | undefined {
  const compact = (value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!compact) return undefined;
  const fraction = /^0*(\d{1,4})\/0*(\d{1,4})$/.exec(compact);
  if (fraction) return `${Number(fraction[1])}/${Number(fraction[2])}`;
  const numeric = /^0*(\d{1,4})$/.exec(compact);
  if (numeric) return String(Number(numeric[1]));
  return compact;
}

export function normalizeCatalogPrintedTotal(value: string | number | undefined | null): string | undefined {
  const compact = value === undefined || value === null ? '' : String(value).trim().replace(/\s+/g, '').toUpperCase();
  if (!compact || /^0+$/.test(compact)) return undefined;
  return compact;
}

export function parseCatalogSearchQuery(query: string): ParsedCatalogSearchQuery {
  const normalizedChase = normalizeChaseCardName(query);
  const normalized = normalizeCatalogText(normalizedChase);
  const fraction = /\b0*(\d{1,4})\s*\/\s*0*(\d{1,4})\b/.exec(query);
  const alphaMatch = /\b([A-Z]{1,5})\s*(0*\d{1,4})\b/i.exec(query);
  const alpha = alphaMatch && CARD_NUMBER_PREFIX_TERMS.has(alphaMatch[1]!.toLowerCase())
    ? `${alphaMatch[1]}${alphaMatch[2]}`
    : undefined;
  const standalone = !fraction && !alpha ? /\b0*(\d{1,4})\b/.exec(query) : undefined;
  const language = /\bjapanese\b/i.test(query) || /[\u3040-\u30ff\u3400-\u9fff]/.test(query)
    ? 'ja'
    : /\benglish\b/i.test(query)
      ? 'en'
      : undefined;
  const releaseContext = POKEMON_RELEASE_ALIASES.find(({ pattern }) => pattern.test(query))?.alias.label;
  const numberTerms = new Set<string>();
  if (fraction) {
    numberTerms.add(String(Number(fraction[1])));
    numberTerms.add(String(Number(fraction[2])));
  }
  if (alpha) {
    const alphaTerm = alpha.replace(/\s+/g, '').toLowerCase();
    numberTerms.add(alphaTerm);
    const prefix = /^[a-z]+/.exec(alphaTerm)?.[0];
    if (prefix) numberTerms.add(prefix);
  }
  if (standalone) numberTerms.add(String(Number(standalone[1])));

  const terms = normalized
    .split(' ')
    .filter(Boolean)
    .filter((term) => !QUERY_STOP_TERMS.has(term))
    .filter((term) => !CARD_NUMBER_PREFIX_TERMS.has(term))
    .filter((term) => !numberTerms.has(term))
    .filter((term) => !/^\d+$/.test(term))
    .filter((term) => !/^[a-z]{1,5}\d{1,4}$/.test(term));

  return {
    original: query,
    normalized,
    subject: terms[0],
    language,
    localNumber: fraction ? String(Number(fraction[1])) : standalone ? String(Number(standalone[1])) : undefined,
    printedTotal: fraction ? normalizeCatalogPrintedTotal(fraction[2]) : undefined,
    alphanumericNumber: alpha ? alpha.replace(/\s+/g, '').toUpperCase() : undefined,
    releaseContext
  };
}

export function isPromoRecord(input: { setName?: string; series?: string; rarity?: string }): boolean {
  const text = normalizeCatalogText([input.setName, input.series, input.rarity].filter(Boolean).join(' '));
  return /\bpromo|promos|promotional|black star|mcdonald|corocoro|coro coro\b/.test(text);
}

export function catalogDisplayValue(record: {
  name: string;
  setName?: string;
  translatedSetName?: string;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  language: string;
}): string {
  if (record.isUnnumbered) {
    const parts = [record.name, record.translatedSetName ?? record.setName, record.language === 'ja' ? 'Japanese unnumbered' : 'unnumbered'].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const parts = [record.name, record.translatedSetName ?? record.setName, record.cardNumber].filter(Boolean);
  const base = parts.join(' ').replace(/\s+/g, ' ').trim();
  const printedTotal = normalizeCatalogPrintedTotal(record.printedTotal);
  const withFraction = printedTotal && record.cardNumber && /^\d+$/.test(record.cardNumber) && !base.includes('/')
    ? `${record.name} ${record.translatedSetName ?? record.setName ?? ''} ${record.cardNumber}/${printedTotal}`
    : base;
  return record.language === 'ja' && !/\bjapanese\b/i.test(withFraction)
    ? `${withFraction} Japanese`
    : withFraction;
}

export function uniqueCatalogAliases(aliases: Array<{ alias: string; locale?: string; kind: 'native_name' | 'localized_name' | 'display_name' | 'source_alias' }>): Array<{ alias: string; normalizedAlias: string; locale?: string; kind: 'native_name' | 'localized_name' | 'display_name' | 'source_alias' }> {
  const byKey = new Map<string, { alias: string; normalizedAlias: string; locale?: string; kind: 'native_name' | 'localized_name' | 'display_name' | 'source_alias' }>();
  for (const alias of aliases) {
    const cleaned = alias.alias.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const normalizedAlias = normalizeCatalogText(cleaned);
    if (!normalizedAlias) continue;
    const key = `${normalizedAlias}|${alias.locale ?? ''}|${alias.kind}`;
    if (!byKey.has(key)) byKey.set(key, { ...alias, alias: cleaned, normalizedAlias });
  }
  return [...byKey.values()];
}
