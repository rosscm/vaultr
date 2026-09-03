import { replaceCardCatalogSourceRecords } from '../../card-catalog-db.js';
import { catalogDisplayValue, normalizeCatalogCardNumber, normalizeCatalogPrintedTotal, normalizeCatalogText, uniqueCatalogAliases } from '../normalize.js';
import { CURATED_JAPANESE_PROMOS, type CuratedJapanesePromoPrinting } from '../supplements/curated-japanese-promos.js';
import type { CardCatalogImportReport, CardCatalogRecord } from '../types.js';

export function curatedRecordFromDefinition(definition: CuratedJapanesePromoPrinting, importedAt = new Date().toISOString()): CardCatalogRecord {
  const normalizedCardNumber = definition.cardNumber ? normalizeCatalogCardNumber(definition.cardNumber) : undefined;
  const printedTotal = normalizeCatalogPrintedTotal(definition.printedTotal);
  const displayValue = catalogDisplayValue({
    name: definition.name,
    setName: definition.promoContext,
    cardNumber: definition.cardNumber,
    printedTotal,
    isUnnumbered: definition.isUnnumbered,
    language: definition.language
  });
  return {
    source: 'CURATED',
    sourceCardId: definition.curationId,
    language: definition.language,
    name: definition.name,
    normalizedName: normalizeCatalogText(definition.name),
    setName: definition.promoContext,
    normalizedSetName: normalizeCatalogText(definition.promoContext),
    cardNumber: definition.cardNumber,
    normalizedCardNumber,
    printedTotal,
    isUnnumbered: definition.isUnnumbered,
    illustrator: definition.illustrator,
    imageUrl: definition.imageUrl,
    isPromo: true,
    promoContext: definition.promoContext,
    releaseType: definition.releaseType,
    releaseEvent: definition.releaseEvent,
    releaseYear: definition.releaseYear,
    releaseDate: definition.releaseDate,
    verificationStatus: definition.verificationStatus,
    importedAt,
    aliases: uniqueCatalogAliases([
      { alias: displayValue, locale: definition.language, kind: 'display_name' },
      { alias: definition.promoContext, locale: 'en', kind: 'source_alias' },
      ...(definition.releaseEvent ? [{ alias: definition.releaseEvent, locale: 'en', kind: 'source_alias' as const }] : []),
      ...(definition.additionalReleaseEvents ?? []).map((event) => ({ alias: event, locale: 'en', kind: 'source_alias' as const })),
      ...(definition.aliases ?? []).map((alias) => ({ alias, locale: definition.language, kind: 'source_alias' as const }))
    ]),
    identifiers: definition.identifiers?.map((identifier) => ({
      value: identifier.value,
      normalizedValue: normalizeCatalogCardNumber(identifier.value) ?? normalizeCatalogText(identifier.value),
      kind: identifier.kind
    })),
    references: definition.references
  };
}

export function loadVerifiedCuratedRecords(importedAt = new Date().toISOString(), definitions = CURATED_JAPANESE_PROMOS): CardCatalogRecord[] {
  return definitions
    .filter((definition) => definition.verificationStatus === 'VERIFIED')
    .map((definition) => curatedRecordFromDefinition(definition, importedAt));
}

export function importVerifiedCuratedRecords(options: { dbPath?: string; importedAt?: string; definitions?: CuratedJapanesePromoPrinting[] } = {}): CardCatalogImportReport {
  return replaceCardCatalogSourceRecords(
    'CURATED',
    loadVerifiedCuratedRecords(options.importedAt, options.definitions ?? CURATED_JAPANESE_PROMOS),
    options.dbPath
  );
}
