import { queryCardCatalogRecords } from '../card-catalog-db.js';
import { catalogDisplayValue, normalizeCatalogCardNumber, normalizeCatalogText, parseCatalogSearchQuery } from './normalize.js';
import type { LocalCardCatalogChoice, StoredCardCatalogRecord } from './types.js';

const ACCESSORY_TERMS = /\b(spirit link|tool|energy|stadium|supporter|trainer)\b/i;

function sourceRank(source: string): number {
  return source === 'POKEMONTCG' ? 3 : source === 'TCGDEX' ? 2 : 0;
}

function recordScore(record: StoredCardCatalogRecord, query: ReturnType<typeof parseCatalogSearchQuery>): number {
  let score = 0;
  const recordName = record.normalizedName;
  const recordSet = record.normalizedSetName ?? '';
  const subject = query.subject;
  if (subject) {
    if (recordName === subject) score += 70;
    else if (recordName.split(' ').includes(subject)) score += 55;
    else if (recordName.includes(subject)) score += 35;
    else if (recordSet.includes(subject)) score += 10;
    if (ACCESSORY_TERMS.test(record.name) && recordName !== subject) score -= 80;
  }

  if (query.localNumber) {
    const requested = normalizeCatalogCardNumber(query.localNumber);
    if (record.normalizedCardNumber === requested) score += 45;
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
    if (recordSet.includes(release) || normalizeCatalogText(record.promoContext).includes(release)) score += 30;
  }
  if (record.isPromo && /\bpromo|promos|promotional|black star|mcdonald|corocoro\b/.test(query.normalized)) score += 20;
  if (record.imageUrl) score += 8;
  score += sourceRank(record.source);
  return score;
}

function hardReject(record: StoredCardCatalogRecord, query: ReturnType<typeof parseCatalogSearchQuery>): boolean {
  if (query.language && record.language !== query.language) return true;
  if (query.printedTotal && normalizeCatalogCardNumber(record.printedTotal) !== normalizeCatalogCardNumber(query.printedTotal)) return true;
  if (query.localNumber && record.normalizedCardNumber !== normalizeCatalogCardNumber(query.localNumber)) return true;
  if (query.alphanumericNumber) {
    const requested = query.alphanumericNumber.toUpperCase();
    const normalized = (record.normalizedCardNumber ?? '').toUpperCase();
    const raw = (record.cardNumber ?? '').toUpperCase();
    if (normalized !== requested && raw !== requested) return true;
  }
  return false;
}

function toChoice(record: StoredCardCatalogRecord, score: number): LocalCardCatalogChoice {
  const value = catalogDisplayValue(record);
  const labelNumber = record.printedTotal && record.cardNumber && /^\d+$/.test(record.cardNumber)
    ? `${record.cardNumber}/${record.printedTotal}`
    : record.cardNumber;
  return {
    name: `${record.name}${record.setName ? ` - ${record.setName}` : ''}${labelNumber ? ` #${labelNumber}` : ''}${record.language === 'ja' ? ' (Japanese)' : ''}`,
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
    cardNumber: record.cardNumber,
    printedTotal: record.printedTotal,
    score
  };
}

export function searchLocalCardCatalog(query: string, limit = 25, options: { dbPath?: string } = {}): LocalCardCatalogChoice[] {
  const parsed = parseCatalogSearchQuery(query);
  if (parsed.normalized.length < 2) return [];
  const records = queryCardCatalogRecords({
    dbPath: options.dbPath,
    subject: parsed.subject,
    normalizedQuery: parsed.normalized,
    normalizedCardNumber: normalizeCatalogCardNumber(parsed.alphanumericNumber ?? parsed.localNumber),
    printedTotal: parsed.printedTotal,
    limit: Math.max(limit * 8, 80)
  });
  const scored = records
    .filter((record) => !hardReject(record, parsed))
    .map((record) => ({ record, score: recordScore(record, parsed) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id - b.record.id);
  const deduped = new Map<string, LocalCardCatalogChoice>();
  for (const item of scored) {
    const key = [
      item.record.normalizedName,
      item.record.normalizedSetName ?? '',
      item.record.normalizedCardNumber ?? '',
      item.record.printedTotal ?? '',
      item.record.language
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, toChoice(item.record, item.score));
  }
  return [...deduped.values()].slice(0, limit);
}
