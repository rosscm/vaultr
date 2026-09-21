import type { CuratedJapanesePromoPrinting } from './supplements/curated-japanese-promos.js';
import { POKUMON_ADDITIONAL_JAPANESE_PROMO_SETS, POKUMON_VALIDATED_JAPANESE_PROMO_SETS, type PokumonCoverageRecord, type PokumonCoverageReport } from './pokumon-japanese-promo-inventory.js';

export const POKUMON_MATERIALIZED_PROMO_SETS = ['P', 'J', 'PLAY', 'PPP', 'ADV-P', 'PCG-P', 'DP-P', 'DPT-P', 'L-P'] as const;
const POKUMON_MATERIALIZER_SORT_PROMO_SETS = [
  ...POKUMON_VALIDATED_JAPANESE_PROMO_SETS.map((set) => set.toUpperCase()),
  ...POKUMON_ADDITIONAL_JAPANESE_PROMO_SETS.map((set) => set.toUpperCase())
] as const;

export type PokumonMaterializerSummary = {
  sets: string[];
  sourcePrintings: number;
  alreadyRepresented: number;
  missing: number;
  existingReview: number;
  ambiguous: number;
  withImage: number;
  withoutImage: number;
  generated: number;
  byPromoSet: Record<string, number>;
  output: string;
  written: boolean;
};

function pageSlug(url: string): string {
  const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  if (!slug) throw new Error(`Missing Pokumon page slug: ${url}`);
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function pokumonMaterializedCurationId(url: string): string {
  return `jp-promo-pokumon-${pageSlug(url)}`;
}

function promoContext(promoSet: string): string {
  return `Japanese ${promoSet} promo series`;
}

function meaningfulSourceTitle(record: PokumonCoverageRecord): string | undefined {
  const sourceTitle = record.sourceTitle?.trim();
  if (!sourceTitle || sourceTitle === record.name) return undefined;
  return sourceTitle;
}

function unique(values: Array<string | undefined>): string[] | undefined {
  const aliases = [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  return aliases.length > 0 ? aliases : undefined;
}

function assertMaterializableMissing(record: PokumonCoverageRecord): void {
  const missing = [
    !record.url ? 'url' : undefined,
    !record.name ? 'name' : undefined,
    !record.promoSet ? 'promoSet' : undefined,
    !record.releaseEvent ? 'releaseEvent' : undefined,
    !record.imageUrl ? 'imageUrl' : undefined
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Cannot materialize Pokumon record missing ${missing.join(', ')}: ${record.url || record.name || 'unknown record'}`);
  const numbered = Boolean(record.cardNumber) && record.isUnnumbered !== true;
  const unnumbered = !record.cardNumber && record.isUnnumbered === true;
  if (!numbered && !unnumbered) throw new Error(`Cannot materialize invalid Pokumon identity: ${record.url} ${record.name}`);
}

export function pokumonCoverageRecordToCuratedPromo(record: PokumonCoverageRecord): CuratedJapanesePromoPrinting | undefined {
  if (record.status !== 'MISSING') return undefined;
  assertMaterializableMissing(record);
  return {
    curationId: pokumonMaterializedCurationId(record.url),
    name: record.name,
    language: 'ja',
    cardNumber: record.cardNumber,
    printedTotal: record.printedTotal,
    isUnnumbered: record.isUnnumbered,
    releaseYear: record.releaseYear,
    releaseType: record.releaseType,
    releaseEvent: record.releaseEvent!,
    illustrator: record.illustrator,
    finish: record.finish,
    surface: record.surface,
    imageUrl: record.imageUrl,
    verificationStatus: 'VERIFIED',
    promoContext: promoContext(record.promoSet!),
    aliases: unique([
      record.cardNumber ? `${record.name} ${record.cardNumber} Japanese promo` : undefined,
      `${record.name} ${record.promoSet} Japanese promo`,
      meaningfulSourceTitle(record)
    ]),
    references: [{ sourceName: 'POKUMON', url: record.url, kind: 'source_identity' }]
  };
}

function sortKey(record: CuratedJapanesePromoPrinting): string {
  const promoSet = /^Japanese (?<set>.+) promo series$/.exec(record.promoContext)?.groups?.set ?? '';
  const setIndex = POKUMON_MATERIALIZER_SORT_PROMO_SETS.indexOf(promoSet as typeof POKUMON_MATERIALIZER_SORT_PROMO_SETS[number]);
  const setOrder = setIndex >= 0 ? setIndex : POKUMON_MATERIALIZER_SORT_PROMO_SETS.length;
  const number = record.cardNumber ?? 'UNNUMBERED';
  const url = record.references.find((reference) => reference.sourceName === 'POKUMON')?.url ?? '';
  return `${setOrder.toString().padStart(2, '0')}|${promoSet}|${number}|${url}`;
}

export function sortPokumonMaterializedPromos(records: CuratedJapanesePromoPrinting[]): CuratedJapanesePromoPrinting[] {
  return [...records].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export function materializePokumonCoverageReport(report: PokumonCoverageReport, expectedMissing?: number): CuratedJapanesePromoPrinting[] {
  if (expectedMissing !== undefined && report.missing !== expectedMissing) throw new Error(`Expected ${expectedMissing} missing Pokumon records, received ${report.missing}`);
  if (report.existingReview > 0) throw new Error(`Cannot materialize with existing review records: ${report.existingReview}`);
  if (report.ambiguous > 0) throw new Error(`Cannot materialize with ambiguous records: ${report.ambiguous}`);
  if (report.records.some((record) => record.status === 'MISSING' && record.imageStatus !== 'PRESENT')) throw new Error('Cannot materialize missing Pokumon records without images');
  const generated = report.records.map(pokumonCoverageRecordToCuratedPromo).filter((record): record is CuratedJapanesePromoPrinting => Boolean(record));
  validatePokumonMaterializedPromos(generated, expectedMissing);
  return sortPokumonMaterializedPromos(generated);
}

export function validatePokumonMaterializedPromos(records: CuratedJapanesePromoPrinting[], expectedCount?: number): void {
  if (expectedCount !== undefined && records.length !== expectedCount) throw new Error(`Expected ${expectedCount} generated Pokumon records, received ${records.length}`);
  const ids = new Set<string>();
  const urls = new Set<string>();
  const identities = new Set<string>();
  for (const record of records) {
    const url = record.references.find((reference) => reference.sourceName === 'POKUMON' && reference.kind === 'source_identity')?.url;
    if (!record.curationId || !record.name || !record.promoContext || !record.releaseEvent || !record.imageUrl || !url) {
      throw new Error(`Invalid materialized Pokumon record: ${record.curationId || record.name}`);
    }
    if (ids.has(record.curationId)) throw new Error(`Duplicate Pokumon curationId: ${record.curationId}`);
    if (urls.has(url)) throw new Error(`Duplicate Pokumon source URL: ${url}`);
    const numbered = Boolean(record.cardNumber) && record.isUnnumbered !== true;
    const unnumbered = !record.cardNumber && record.isUnnumbered === true;
    if (!numbered && !unnumbered) throw new Error(`Invalid materialized Pokumon identity: ${record.curationId}`);
    const identity = JSON.stringify([
      record.name,
      record.cardNumber ?? 'UNNUMBERED',
      record.promoContext,
      record.releaseEvent,
      record.releaseYear ?? null,
      record.illustrator ?? null,
      record.finish ?? null,
      record.surface ?? null
    ]);
    if (identities.has(identity)) throw new Error(`Duplicate Pokumon generated identity: ${identity}`);
    ids.add(record.curationId);
    urls.add(url);
    identities.add(identity);
  }
}

function stableValue(value: unknown, indent = 0): string {
  const space = ' '.repeat(indent);
  const next = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${next}${stableValue(item, indent + 2)}`).join(',\n')}\n${space}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, entryValue]) => `${next}${JSON.stringify(key)}: ${stableValue(entryValue, indent + 2)}`).join(',\n')}\n${space}}`;
  }
  return JSON.stringify(value);
}

export function serializePokumonMaterializedSupplement(records: CuratedJapanesePromoPrinting[]): string {
  const sorted = sortPokumonMaterializedPromos(records);
  return [
    "import type { CuratedJapanesePromoPrinting } from './curated-japanese-promos.js';",
    '',
    'export const POKUMON_JAPANESE_PROMO_MATERIALIZED_SUPPLEMENT: CuratedJapanesePromoPrinting[] = ',
    `${stableValue(sorted)};`,
    ''
  ].join('\n');
}

export function pokumonMaterializerSummary(report: PokumonCoverageReport, generated: CuratedJapanesePromoPrinting[], output: string, written: boolean, sets = POKUMON_MATERIALIZED_PROMO_SETS.map((set) => set.toLowerCase())): PokumonMaterializerSummary {
  return {
    sets,
    sourcePrintings: report.total,
    alreadyRepresented: report.alreadyRepresented,
    missing: report.missing,
    existingReview: report.existingReview,
    ambiguous: report.ambiguous,
    withImage: report.withImage,
    withoutImage: report.withoutImage,
    generated: generated.length,
    byPromoSet: report.byPromoSet,
    output,
    written
  };
}
