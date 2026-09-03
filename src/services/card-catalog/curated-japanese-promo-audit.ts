import { catalogSubjectMatchesChoice, searchLocalCardCatalog } from './search.js';
import { normalizeCatalogCardNumber, normalizeCatalogText } from './normalize.js';
import { CURATED_JAPANESE_PROMOS, curatedJapanesePromoCountsByFamily, type CuratedJapanesePromoPrinting } from './supplements/curated-japanese-promos.js';
import type { LocalCardCatalogChoice } from './types.js';
import type { CuratedJapanesePromoReference } from './supplements/curated-japanese-promos.js';

export type CuratedJapanesePromoAuditStatus = 'COVERED' | 'MISSING' | 'AMBIGUOUS';
export type CuratedJapanesePromoProvenanceStatus = 'TRACEABLE' | 'PARTIAL' | 'UNRESOLVED';

export type CuratedJapanesePromoAuditRecord = {
  curationId: string;
  name: string;
  promoContext: string;
  releaseYear?: number;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  status: CuratedJapanesePromoAuditStatus;
  provenanceStatus: CuratedJapanesePromoProvenanceStatus;
  reason: string;
  matches: Array<{
    source: string;
    sourceCardId: string;
    value: string;
    setName?: string;
    cardNumber?: string;
    printedTotal?: string;
  }>;
};

export type CuratedJapanesePromoAuditReport = {
  total: number;
  byReleaseFamily: Record<string, number>;
  statusesByReleaseFamily: Record<string, Record<CuratedJapanesePromoAuditStatus, number>>;
  statusCounts: Record<CuratedJapanesePromoAuditStatus, number>;
  records: CuratedJapanesePromoAuditRecord[];
};

function identityQuery(record: CuratedJapanesePromoPrinting): string {
  if (record.isUnnumbered) return [record.name, 'Japanese'].filter(Boolean).join(' ');
  const number = record.cardNumber && record.printedTotal
    ? `${record.cardNumber}/${record.printedTotal}`
    : record.cardNumber;
  return [record.name, record.promoContext, number, 'Japanese'].filter(Boolean).join(' ');
}

export function isTraceableCuratedJapanesePromoReference(reference: CuratedJapanesePromoReference): boolean {
  if (reference.sourceName === 'POKUMON') {
    return Boolean(reference.url?.startsWith('https://www.pokumon.com/') || reference.url?.startsWith('https://pokumon.com/'));
  }
  return Boolean(reference.url || reference.sourceId);
}

export function curatedJapanesePromoProvenanceStatus(record: CuratedJapanesePromoPrinting): CuratedJapanesePromoProvenanceStatus {
  if (record.references.some(isTraceableCuratedJapanesePromoReference)) return 'TRACEABLE';
  if (record.references.length > 0) return 'PARTIAL';
  return 'UNRESOLVED';
}

function sameName(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  return catalogSubjectMatchesChoice(record.name, match);
}

function sameNumber(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  if (!record.cardNumber) return false;
  if (normalizeCatalogCardNumber(record.cardNumber) !== normalizeCatalogCardNumber(match.cardNumber)) return false;
  if (!record.printedTotal) return true;
  return normalizeCatalogCardNumber(record.printedTotal) === normalizeCatalogCardNumber(match.printedTotal);
}

const GENERIC_CONTEXT_TERMS = new Set([
  'pokemon',
  'pocket',
  'monsters',
  'japanese',
  'promo',
  'card',
  'cards',
  'collection',
  'campaign',
  'release',
  'special',
  'distribution'
]);

function distinctiveTerms(value: string): string[] {
  return normalizeCatalogText(value)
    .split(' ')
    .filter((term) => term.length >= 4 && !GENERIC_CONTEXT_TERMS.has(term));
}

function sameReleaseContext(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  const releasePhrases = [
    record.promoContext,
    record.releaseEvent,
    ...(record.additionalReleaseEvents ?? [])
  ].map(normalizeCatalogText).filter(Boolean);
  const matched = normalizeCatalogText([
    match.setName,
    match.translatedSetName,
    match.promoContext,
    match.releaseType,
    match.releaseEvent,
    match.value
  ].join(' '));
  if (releasePhrases.some((phrase) => phrase.length >= 8 && matched.includes(phrase))) return true;
  const aliasPhrases = (record.aliases ?? []).map(normalizeCatalogText).filter((alias) => alias.length >= 8);
  if (aliasPhrases.some((alias) => matched.includes(alias))) return true;
  const terms = Array.from(new Set(releasePhrases.flatMap(distinctiveTerms)));
  if (terms.length === 0) return false;
  const overlap = terms.filter((term) => matched.includes(term));
  if (overlap.length >= 2) return true;
  return overlap.length === 1 && terms.length === 1 && terms[0].length >= 8;
}

function classify(record: CuratedJapanesePromoPrinting, matches: LocalCardCatalogChoice[]): {
  status: CuratedJapanesePromoAuditStatus;
  reason: string;
} {
  const japaneseNameMatches = matches.filter((match) => match.language === 'ja' && sameName(record, match));
  if (japaneseNameMatches.length === 0) return { status: 'MISSING', reason: 'no same-name Japanese candidates' };
  if (record.cardNumber) {
    if (japaneseNameMatches.some((match) => sameNumber(record, match) && sameReleaseContext(record, match))) {
      return { status: 'COVERED', reason: 'exact numbered release match' };
    }
    if (japaneseNameMatches.some((match) => sameNumber(record, match))) {
      return { status: 'AMBIGUOUS', reason: 'same name and number but release context insufficient' };
    }
    return { status: 'AMBIGUOUS', reason: 'same name but number mismatch' };
  }
  const contextual = japaneseNameMatches.filter((match) => sameReleaseContext(record, match));
  if (contextual.length === 1) return { status: 'COVERED', reason: 'exact release identity match' };
  if (contextual.length > 1) return { status: 'AMBIGUOUS', reason: 'multiple contextual candidates' };
  return { status: 'AMBIGUOUS', reason: 'same name but release context insufficient' };
}

export function auditCuratedJapanesePromos(options: {
  dbPath?: string;
  records?: CuratedJapanesePromoPrinting[];
  includeCovered?: boolean;
} = {}): CuratedJapanesePromoAuditReport {
  const records = options.records ?? CURATED_JAPANESE_PROMOS;
  const auditRecords = records.map((record) => {
    const matches = searchLocalCardCatalog(identityQuery(record), 12, { dbPath: options.dbPath });
    const classification = classify(record, matches);
    return {
      curationId: record.curationId,
      name: record.name,
      promoContext: record.promoContext,
      releaseYear: record.releaseYear,
      cardNumber: record.cardNumber,
      printedTotal: record.printedTotal,
      isUnnumbered: record.isUnnumbered,
      status: classification.status,
      provenanceStatus: curatedJapanesePromoProvenanceStatus(record),
      reason: classification.reason,
      matches: matches.slice(0, 4).map((match) => ({
        source: match.source,
        sourceCardId: match.sourceCardId,
        value: match.value,
        setName: match.translatedSetName ?? match.setName,
        cardNumber: match.cardNumber,
        printedTotal: match.printedTotal
      }))
    };
  });
  const statusCounts: CuratedJapanesePromoAuditReport['statusCounts'] = { COVERED: 0, MISSING: 0, AMBIGUOUS: 0 };
  const statusesByReleaseFamily: CuratedJapanesePromoAuditReport['statusesByReleaseFamily'] = {};
  for (const record of auditRecords) {
    statusCounts[record.status] += 1;
    const familyCounts = statusesByReleaseFamily[record.promoContext] ?? { COVERED: 0, MISSING: 0, AMBIGUOUS: 0 };
    familyCounts[record.status] += 1;
    statusesByReleaseFamily[record.promoContext] = familyCounts;
  }
  return {
    total: records.length,
    byReleaseFamily: curatedJapanesePromoCountsByFamily(records),
    statusesByReleaseFamily,
    statusCounts,
    records: options.includeCovered ? auditRecords : auditRecords.filter((record) => record.status !== 'COVERED')
  };
}
