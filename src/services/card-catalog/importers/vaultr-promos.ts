import { replaceCardCatalogSourceRecords } from '../../card-catalog-db.js';
import { catalogDisplayValue, normalizeCatalogCardNumber, normalizeCatalogPrintedTotal, normalizeCatalogText, uniqueCatalogAliases } from '../normalize.js';
import type { CardCatalogImportReport, CardCatalogRecord } from '../types.js';
import { VAULTR_VERIFIED_PROMOS, type VaultrPromoSupplementDefinition } from '../supplements/verified-promos.js';

export function vaultrPromoRecordFromDefinition(definition: VaultrPromoSupplementDefinition, importedAt = new Date().toISOString()): CardCatalogRecord {
  const normalizedCardNumber = definition.cardNumber ? normalizeCatalogCardNumber(definition.cardNumber) : undefined;
  const printedTotal = normalizeCatalogPrintedTotal(definition.printedTotal);
  const displayValue = catalogDisplayValue({
    name: definition.name,
    setName: definition.setName ?? definition.promoContext,
    cardNumber: definition.cardNumber,
    printedTotal,
    isUnnumbered: definition.isUnnumbered,
    language: definition.language
  });
  return {
    source: 'VAULTR_PROMO',
    sourceCardId: definition.sourceCardId,
    language: definition.language,
    name: definition.name,
    normalizedName: normalizeCatalogText(definition.name),
    setName: definition.setName ?? definition.promoContext,
    normalizedSetName: normalizeCatalogText(definition.setName ?? definition.promoContext),
    cardNumber: definition.cardNumber,
    normalizedCardNumber,
    printedTotal,
    isUnnumbered: definition.isUnnumbered,
    imageUrl: definition.imageUrl,
    isPromo: true,
    promoContext: definition.promoContext,
    releaseType: definition.releaseType,
    releaseEvent: definition.releaseEvent,
    releaseYear: definition.releaseYear,
    verificationStatus: definition.verificationStatus,
    importedAt,
    aliases: uniqueCatalogAliases([
      { alias: displayValue, locale: definition.language, kind: 'display_name' },
      { alias: definition.promoContext, locale: 'en', kind: 'source_alias' },
      ...(definition.releaseEvent ? [{ alias: definition.releaseEvent, locale: 'en', kind: 'source_alias' as const }] : []),
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

export function loadVaultrPromoSupplementRecords(importedAt = new Date().toISOString(), definitions = VAULTR_VERIFIED_PROMOS): CardCatalogRecord[] {
  return definitions.map((definition) => vaultrPromoRecordFromDefinition(definition, importedAt));
}

export function importVaultrPromoSupplementRecords(options: { dbPath?: string; importedAt?: string; definitions?: VaultrPromoSupplementDefinition[] } = {}): CardCatalogImportReport {
  return replaceCardCatalogSourceRecords(
    'VAULTR_PROMO',
    loadVaultrPromoSupplementRecords(options.importedAt, options.definitions ?? VAULTR_VERIFIED_PROMOS),
    options.dbPath
  );
}
