import { queryCardCatalogRecords } from '../card-catalog-db.js';
import { JAPANESE_SUBJECT_ALIASES } from '../collector-card-aliases.js';
import { catalogDisplayValue, normalizeCatalogCardNumber, normalizeCatalogText, parseCatalogSearchQuery } from './normalize.js';
import type { LocalCardCatalogChoice, StoredCardCatalogRecord } from './types.js';

const ACCESSORY_TERMS = /\b(spirit link|tool|energy|stadium|supporter|trainer)\b/i;

function sourceRank(source: string): number {
  return source === 'POKEMONTCG' ? 3 : source === 'TCGDEX' ? 2 : source === 'VAULTR_PROMO' ? 1 : 0;
}

function recordScore(record: StoredCardCatalogRecord, query: ReturnType<typeof parseCatalogSearchQuery>): number {
  let score = 0;
  const recordName = record.normalizedName;
  const recordSet = normalizeCatalogText([record.normalizedSetName, record.translatedSetName].filter(Boolean).join(' '));
  const aliases = [recordName, ...(record.aliases ?? []).map((alias) => alias.normalizedAlias)].filter(Boolean);
  const subject = query.subject;
  if (subject) {
    const subjectAliases = subjectIdentityTerms(subject);
    if (subjectAliases.some((term) => aliases.some((alias) => alias === term))) score += 70;
    else if (subjectAliases.some((term) => aliases.some((alias) => alias.split(' ').includes(term)))) score += 55;
    else if (subjectAliases.some((term) => aliases.some((alias) => alias.includes(term)))) score += 35;
    else if (subjectAliases.some((term) => recordSet.includes(term))) score += 10;
    if (ACCESSORY_TERMS.test(record.name) && !subjectAliases.some((term) => aliases.some((alias) => alias === term))) score -= 80;
  }

  if (query.localNumber) {
    const requested = normalizeCatalogCardNumber(query.localNumber);
    if (record.normalizedCardNumber === requested) score += 45;
    else if (query.releaseContext && !query.printedTotal && record.isUnnumbered && record.identifiers?.some((identifier) => identifier.normalizedValue === requested)) score += 25;
    else score -= 80;
  }
  if (query.printedTotal) {
    if (normalizeCatalogCardNumber(record.printedTotal) === normalizeCatalogCardNumber(query.printedTotal)) score += 45;
    else score -= 120;
  }
  if (query.alphanumericNumber) {
    const requested = query.alphanumericNumber.toUpperCase();
    if ((record.normalizedCardNumber ?? '').toUpperCase() === requested || `${record.cardNumber ?? ''}`.toUpperCase() === requested) score += 80;
    else if (normalizeCatalogText(record.setName).split(' ').includes(requested.replace(/\d+$/, '').toLowerCase())) score += 10;
  }
  if (query.language) score += record.language === query.language ? 30 : -90;
  if (query.releaseContext) {
    const release = normalizeCatalogText(query.releaseContext);
    if (recordSet.includes(release) || releaseMetadataText(record).includes(release)) score += 30;
  }
  if (record.isPromo && /\bpromo|promos|promotional|black star|mcdonald|corocoro\b/.test(query.normalized)) score += 20;
  if (record.imageUrl) score += 8;
  score += sourceRank(record.source);
  return score;
}

function hardReject(record: StoredCardCatalogRecord, query: ReturnType<typeof parseCatalogSearchQuery>): boolean {
  const aliases = [record.normalizedName, ...(record.aliases ?? []).map((alias) => alias.normalizedAlias)].filter(Boolean);
  const subjectAliases = subjectIdentityTerms(query.subject);
  if (query.subject && !subjectAliases.some((subject) => aliases.some((alias) => alias === subject || alias.split(' ').includes(subject) || alias.includes(subject)))) return true;
  if (query.language && record.language !== query.language) return true;
  if (query.printedTotal && normalizeCatalogCardNumber(record.printedTotal) !== normalizeCatalogCardNumber(query.printedTotal)) return true;
  if (query.localNumber && record.normalizedCardNumber !== normalizeCatalogCardNumber(query.localNumber)) {
    const safeAlternateIdentifierMatch = query.releaseContext
      && !query.printedTotal
      && record.isUnnumbered
      && record.identifiers?.some((identifier) => identifier.normalizedValue === normalizeCatalogCardNumber(query.localNumber));
    if (!safeAlternateIdentifierMatch) return true;
  }
  if (query.alphanumericNumber) {
    const requested = query.alphanumericNumber.toUpperCase();
    const normalized = (record.normalizedCardNumber ?? '').toUpperCase();
    const raw = (record.cardNumber ?? '').toUpperCase();
    if (normalized !== requested && raw !== requested) return true;
  }
  if (query.releaseContext && !recordMatchesReleaseContext(record, query.releaseContext)) return true;
  return false;
}

function toChoice(record: StoredCardCatalogRecord, score: number): LocalCardCatalogChoice {
  const value = catalogDisplayValue(record);
  const labelNumber = record.isUnnumbered
    ? 'unnumbered'
    : record.printedTotal && record.cardNumber && /^\d+$/.test(record.cardNumber)
    ? `${record.cardNumber}/${record.printedTotal}`
    : record.cardNumber;
  return {
    name: `${record.name}${record.translatedSetName ?? record.setName ? ` - ${record.translatedSetName ?? record.setName}` : ''}${labelNumber ? ` #${labelNumber}` : ''}${record.language === 'ja' ? ' (Japanese)' : ''}`,
    canonicalName: record.name,
    value,
    imageUrl: record.imageUrl,
    imageIdentity: value,
    imageSourceName: record.source,
    imageSourceKind: record.imageUrl ? 'CARD_REFERENCE' : undefined,
    imageSourceCardId: record.sourceCardId,
    source: record.source,
    sourceCardId: record.sourceCardId,
    language: record.language,
    setName: record.setName,
    translatedSetName: record.translatedSetName,
    cardNumber: record.cardNumber,
    printedTotal: record.printedTotal,
    isUnnumbered: record.isUnnumbered,
    rarity: record.rarity,
    isPromo: record.isPromo,
    promoContext: record.promoContext,
    releaseType: record.releaseType,
    releaseEvent: record.releaseEvent,
    releaseYear: record.releaseYear,
    setId: record.setId,
    series: record.series,
    score
  };
}

function subjectIdentityTerms(subject: string | undefined): string[] {
  if (!subject) return [];
  return [...new Set([
    subject,
    ...(JAPANESE_SUBJECT_ALIASES[subject] ?? []).map(normalizeCatalogText)
  ].filter(Boolean))];
}

function recordMatchesReleaseContext(record: StoredCardCatalogRecord, releaseContext: string): boolean {
  const release = normalizeCatalogText(releaseContext);
  const haystack = releaseMetadataText(record);
  if (release.includes('corocoro')) return haystack.includes('corocoro') || haystack.includes('coro coro');
  if (release.includes('mcdonald')) return haystack.includes('mcdonald');
  if (release.includes('pokemon center')) return haystack.includes('pokemon center');
  if (release.includes('black star')) return haystack.includes('black star');
  if (release.includes('toys r us')) return haystack.includes('toys r us');
  if (release.includes('ana') || release.includes('all nippon')) return haystack.includes('ana') || haystack.includes('all nippon');
  if (release.includes('jr') || release.includes('train') || release.includes('rail') || release.includes('stamp rally')) {
    return haystack.includes('jr') || haystack.includes('train') || haystack.includes('rail') || haystack.includes('stamp rally');
  }
  return haystack.includes(release);
}

function releaseMetadataText(record: StoredCardCatalogRecord): string {
  return normalizeCatalogText([
    record.setName,
    record.translatedSetName,
    record.promoContext,
    record.series,
    record.releaseType,
    record.releaseEvent,
    ...(record.aliases ?? []).map((alias) => alias.alias)
  ].filter(Boolean).join(' '));
}

export function searchLocalCardCatalog(query: string, limit = 25, options: { dbPath?: string } = {}): LocalCardCatalogChoice[] {
  const parsed = parseCatalogSearchQuery(query);
  if (parsed.normalized.length < 2) return [];
  const records = queryCardCatalogRecords({
    dbPath: options.dbPath,
    subject: parsed.subject,
    subjectAliases: subjectIdentityTerms(parsed.subject),
    normalizedQuery: parsed.normalized,
    normalizedCardNumber: normalizeCatalogCardNumber(parsed.alphanumericNumber ?? parsed.localNumber),
    printedTotal: parsed.printedTotal,
    releaseContext: parsed.releaseContext,
    limit: Math.max(limit * 8, 80)
  });
  const scored = records
    .filter((record) => !hardReject(record, parsed))
    .map((record) => ({ record, score: recordScore(record, parsed) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id - b.record.id);
  const deduped = new Map<string, LocalCardCatalogChoice>();
  for (const item of scored) {
    const numberKey = item.record.normalizedCardNumber ?? '';
    const printedTotalKey = /^[A-Z]+\d+$/i.test(numberKey) ? '' : item.record.printedTotal ?? '';
    const key = [
      item.record.normalizedName,
      item.record.normalizedSetName ?? '',
      numberKey,
      printedTotalKey,
      item.record.language
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, toChoice(item.record, item.score));
  }
  return [...deduped.values()].slice(0, limit);
}

export function hasHighConfidenceLocalCatalogMatch(query: string, choices: LocalCardCatalogChoice[]): boolean {
  const parsed = parseCatalogSearchQuery(query);
  if (choices.length === 0) return false;
  const hasStructuredEvidence = !!parsed.printedTotal || !!parsed.alphanumericNumber || (!!parsed.localNumber && !!parsed.releaseContext);
  if (!parsed.subject || !hasStructuredEvidence) return false;
  return choices.some((choice) => choice.score >= 120 && !!choice.imageUrl && choice.imageSourceKind === 'CARD_REFERENCE');
}
