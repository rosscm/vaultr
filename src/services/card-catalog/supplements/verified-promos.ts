import type { CardCatalogLanguage, CardCatalogVerificationStatus } from '../types.js';

export type VaultrPromoSupplementDefinition = {
  sourceCardId: string;
  name: string;
  language: CardCatalogLanguage;
  setName?: string;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  promoContext: string;
  releaseType?: string;
  releaseEvent?: string;
  releaseYear?: number;
  aliases?: string[];
  identifiers?: Array<{ value: string; kind: 'collector_alias' | 'pokedex' | 'legacy_catalog' }>;
  verificationStatus: CardCatalogVerificationStatus;
  illustrator?: string;
  imageUrl?: string;
  references: Array<{ sourceName: string; sourceId?: string; url?: string; kind?: string }>;
};

export const VAULTR_VERIFIED_PROMOS: VaultrPromoSupplementDefinition[] = [
  {
    sourceCardId: 'vaultr-promo-dextcg-jpn-mcdemp-7',
    name: 'Squirtle',
    language: 'ja',
    setName: "McDonald's Pokemon-e Minimum Pack",
    cardNumber: '007',
    printedTotal: '018',
    promoContext: "McDonald's Promo",
    releaseType: 'restaurant_campaign',
    releaseEvent: "McDonald's Pokemon-e Minimum Pack",
    aliases: ["Squirtle Japanese McDonald's Pokemon-e Minimum Pack 007/018"],
    verificationStatus: 'VERIFIED',
    imageUrl: 'https://static.dextcg.com/cards/jpn_mcdemp/7.png',
    references: [{ sourceName: 'DEXTCG', sourceId: 'jpn_mcdemp-7', kind: 'source_identity' }]
  }
];
