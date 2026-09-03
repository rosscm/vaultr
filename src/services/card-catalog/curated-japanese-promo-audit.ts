import { searchLocalCardCatalog } from './search.js';
import { normalizeCatalogCardNumber, normalizeCatalogText } from './normalize.js';
import { CURATED_JAPANESE_PROMOS, curatedJapanesePromoCountsByFamily, type CuratedJapanesePromoPrinting } from './supplements/curated-japanese-promos.js';
import type { LocalCardCatalogChoice } from './types.js';

export type CuratedJapanesePromoAuditStatus = 'COVERED' | 'MISSING' | 'AMBIGUOUS';

export type CuratedJapanesePromoAuditRecord = {
  curationId: string;
  name: string;
  promoContext: string;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  status: CuratedJapanesePromoAuditStatus;
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

function sameName(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  return normalizeCatalogText(record.name) === normalizeCatalogText(match.canonicalName);
}

function sameNumber(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  if (!record.cardNumber) return false;
  if (normalizeCatalogCardNumber(record.cardNumber) !== normalizeCatalogCardNumber(match.cardNumber)) return false;
  if (!record.printedTotal) return true;
  return normalizeCatalogCardNumber(record.printedTotal) === normalizeCatalogCardNumber(match.printedTotal);
}

function sameReleaseContext(record: CuratedJapanesePromoPrinting, match: LocalCardCatalogChoice): boolean {
  const release = normalizeCatalogText([
    record.promoContext,
    record.releaseEvent,
    ...(record.additionalReleaseEvents ?? [])
  ].join(' '));
  const matched = normalizeCatalogText([
    match.setName,
    match.translatedSetName,
    match.promoContext,
    match.releaseType,
    match.releaseEvent,
    match.value
  ].join(' '));
  return release.split(' ').filter((term) => term.length >= 4).some((term) => matched.includes(term));
}

function classify(record: CuratedJapanesePromoPrinting, matches: LocalCardCatalogChoice[]): CuratedJapanesePromoAuditStatus {
  const japaneseNameMatches = matches.filter((match) => match.language === 'ja' && sameName(record, match));
  if (record.cardNumber) {
    return japaneseNameMatches.some((match) => sameNumber(record, match) && sameReleaseContext(record, match))
      ? 'COVERED'
      : japaneseNameMatches.length > 0
        ? 'AMBIGUOUS'
        : 'MISSING';
  }
  const contextual = japaneseNameMatches.filter((match) => sameReleaseContext(record, match));
  if (contextual.length === 1) return 'COVERED';
  if (contextual.length > 1 || japaneseNameMatches.length > 0) return 'AMBIGUOUS';
  return 'MISSING';
}

export function auditCuratedJapanesePromos(options: {
  dbPath?: string;
  records?: CuratedJapanesePromoPrinting[];
  includeCovered?: boolean;
} = {}): CuratedJapanesePromoAuditReport {
  const records = options.records ?? CURATED_JAPANESE_PROMOS;
  const auditRecords = records.map((record) => {
    const matches = searchLocalCardCatalog(identityQuery(record), 12, { dbPath: options.dbPath });
    const status = classify(record, matches);
    return {
      curationId: record.curationId,
      name: record.name,
      promoContext: record.promoContext,
      cardNumber: record.cardNumber,
      printedTotal: record.printedTotal,
      isUnnumbered: record.isUnnumbered,
      status,
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
