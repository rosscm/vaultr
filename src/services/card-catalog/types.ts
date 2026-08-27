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
};

export type StoredCardCatalogRecord = CardCatalogRecord & {
  id: number;
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
  cardNumber?: string;
  printedTotal?: string;
  score: number;
};
