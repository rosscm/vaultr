export type CardCatalogSource = 'TCGDEX' | 'POKEMONTCG';
export type CardCatalogLanguage = 'en' | 'ja';

export type CardCatalogRecord = {
  source: CardCatalogSource;
  sourceCardId: string;
  language: CardCatalogLanguage;
  name: string;
  normalizedName: string;
  setId?: string;
  setName?: string;
  translatedSetName?: string;
  normalizedSetName?: string;
  series?: string;
  cardNumber?: string;
  normalizedCardNumber?: string;
  printedTotal?: string;
  rarity?: string;
  imageUrl?: string;
  releaseDate?: string;
  isPromo: boolean;
  promoContext?: string;
  sourceUpdatedAt?: string;
  importedAt: string;
  aliases?: CardCatalogAlias[];
};

export type StoredCardCatalogRecord = CardCatalogRecord & {
  id: number;
};

export type CardCatalogAlias = {
  alias: string;
  normalizedAlias: string;
  locale?: string;
  kind: 'native_name' | 'localized_name' | 'display_name' | 'source_alias';
};

export type CardCatalogImportReport = {
  examined: number;
  imported: number;
  skipped: number;
  missingImage: number;
  byLanguage: Record<string, number>;
  bySource: Record<string, number>;
  errors: number;
};

export type CardCatalogStats = {
  path: string;
  sizeBytes: number;
  totalRecords: number;
  sourceCounts: Record<string, number>;
  languageCounts: Record<string, number>;
  imageCoverage: { withImage: number; withoutImage: number };
  promoMarked: number;
};

export type LocalCardCatalogChoice = {
  name: string;
  value: string;
  imageUrl?: string;
  imageIdentity?: string;
  imageSourceName?: CardCatalogSource;
  imageSourceKind?: 'CARD_REFERENCE';
  imageSourceCardId?: string;
  source: CardCatalogSource;
  sourceCardId: string;
  language: CardCatalogLanguage;
  setName?: string;
  translatedSetName?: string;
  cardNumber?: string;
  printedTotal?: string;
  score: number;
};
