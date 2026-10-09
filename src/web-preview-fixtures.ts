import {
  CONDITION_CHOICES,
  GRADE_VALUE_CHOICES,
  GRADING_TYPE_CHOICES,
  LISTING_TYPE_CHOICES,
  PRIORITY_CHOICES
} from './services/chase-options.js';

const images = {
  mew: 'https://images.pokemontcg.io/bw11/RC24_hires.png',
  umbreon: 'https://images.pokemontcg.io/swsh9tg/TG23_hires.png',
  squirtle: 'https://images.pokemontcg.io/sv3pt5/170_hires.png',
  dragonite: 'https://images.pokemontcg.io/pgo/76_hires.png',
  gardevoir: 'https://images.pokemontcg.io/sv4pt5/233_hires.png',
  pichu: 'https://images.pokemontcg.io/ecard1/22_hires.png',
  pikachu: 'https://images.pokemontcg.io/xyp/XY95_hires.png',
  articuno: 'https://images.pokemontcg.io/smp/SM144_hires.png'
};

export const WEB_PREVIEW_ME = {
  user: { id: 'preview-user', displayName: 'Catherine Preview' },
  identities: { discord: { connected: true, username: 'preview.collector', displayName: 'Catherine Preview' } },
  preview: true
};

function chase(id: string, cardName: string, cardImageUrl: string, priority: string, extra: Record<string, unknown> = {}) {
  return {
    chase: {
      id,
      cardName,
      cardImageUrl,
      priority,
      createdAt: '2026-09-01T14:00:00.000Z',
      ...extra
    },
    monitoringState: 'ACTIVE'
  };
}

export const WEB_PREVIEW_CHASES = {
  items: [
    chase('preview-mew', 'Mew-EX Legendary Treasures RC24', images.mew, 'GRAIL', { maxPrice: 145, grade: 'UNGRADED', condition: 'NM,LP', targetNote: 'Clean binder copy' }),
    chase('preview-umbreon', 'Umbreon VMAX Brilliant Stars TG23', images.umbreon, 'HIGH', { maxPrice: 70, grade: 'PSA 10', listingType: 'BUY_IT_NOW' }),
    chase('preview-squirtle', 'Squirtle 151 170/165', images.squirtle, 'NORMAL', { maxPrice: 42, grade: 'UNGRADED' }),
    chase('preview-dragonite', 'Dragonite VSTAR Pokemon GO 076/078', images.dragonite, 'HIGH', { maxPrice: 48, condition: 'NM' }),
    chase('preview-gardevoir', 'Gardevoir ex Paldean Fates 233/091', images.gardevoir, 'NORMAL', { maxPrice: 85, grade: 'UNGRADED' }),
    chase('preview-pikachu', 'Pikachu XY Black Star Promos XY95', images.pikachu, 'GRAIL', { maxPrice: 120, grade: 'PSA 9' })
  ],
  completedItems: [{
    ...chase('preview-pichu', 'Pichu Expedition Base Set 22/165', images.pichu, 'HIGH', { maxPrice: 240 }).chase,
    completedAt: '2026-09-28T12:00:00.000Z'
  }],
  plan: { tier: 'PRO', activeCount: 6, maxActiveChases: 25, pausedCount: 0 },
  currency: 'CAD',
  options: {
    gradingTypes: GRADING_TYPE_CHOICES,
    gradeValues: GRADE_VALUE_CHOICES,
    conditions: CONDITION_CHOICES,
    listingTypes: LISTING_TYPE_CHOICES,
    priorities: PRIORITY_CHOICES
  }
};

export const WEB_PREVIEW_ALERTS = [
  { alertId: 'preview-alert-1', chaseId: 'preview-mew', chaseName: 'Mew-EX Legendary Treasures RC24', chasePriority: 'GRAIL', listingTitle: 'Mew EX RC24 Legendary Treasures Near Mint', listingPrice: 118, listingCurrency: 'CAD', priceDelta: -27, listingUrl: 'https://www.ebay.ca/', matchScore: 96, source: 'EBAY', imageUrl: images.mew, createdAt: '2026-10-09T14:35:00.000Z' },
  { alertId: 'preview-alert-2', chaseId: 'preview-umbreon', chaseName: 'Umbreon VMAX Brilliant Stars TG23', chasePriority: 'HIGH', listingTitle: 'Umbreon VMAX TG23 PSA 10', listingPrice: 64, listingCurrency: 'CAD', priceDelta: -6, listingUrl: 'https://example.com/preview-shop', matchScore: 91, source: 'SHOPIFY', imageUrl: images.umbreon, createdAt: '2026-10-09T11:15:00.000Z' },
  { alertId: 'preview-alert-3', chaseId: 'preview-squirtle', chaseName: 'Squirtle 151 170/165', chasePriority: 'NORMAL', listingTitle: 'Squirtle Illustration Rare 170/165 Raw', listingPrice: 35, listingCurrency: 'CAD', priceDelta: -7, listingUrl: 'https://www.ebay.ca/', matchScore: 88, source: 'EBAY', imageUrl: images.squirtle, createdAt: '2026-10-08T18:20:00.000Z' },
  { alertId: 'preview-alert-4', chaseId: 'preview-gardevoir', chaseName: 'Gardevoir ex Paldean Fates 233/091', chasePriority: 'NORMAL', listingTitle: 'Gardevoir ex Special Illustration Rare', listingPrice: 79, listingCurrency: 'CAD', priceDelta: -6, listingUrl: 'https://example.com/preview-shop', matchScore: 84, source: 'SHOPIFY', imageUrl: images.gardevoir, createdAt: '2026-10-07T16:05:00.000Z' },
  { alertId: 'preview-alert-5', chaseId: 'preview-pikachu', chaseName: 'Pikachu XY Black Star Promos XY95', chasePriority: 'GRAIL', listingTitle: 'Pikachu XY95 Promo PSA 9', listingPrice: 105, listingCurrency: 'CAD', priceDelta: -15, listingUrl: 'https://www.ebay.ca/', matchScore: 93, source: 'EBAY', imageUrl: images.pikachu, createdAt: '2026-10-06T13:40:00.000Z' }
];

const shelfCards = [
  ['Mew-EX Legendary Treasures RC24', images.mew, 'Legendary Treasures', 'ENGLISH', 'Collector Match', 'A radiant Mew printing connected to the character and artwork signals in your Vault.', 128, 'READY'],
  ['Umbreon VMAX Brilliant Stars TG23', images.umbreon, 'Brilliant Stars', 'ENGLISH', 'Collector Thread', 'Builds on your Umbreon Chase with a distinct Trainer Gallery treatment.', 66, 'READY'],
  ['Pichu Expedition Base Set 22/165', images.pichu, 'Expedition Base Set', 'ENGLISH', 'Release Trail', 'An e-reader holo that follows the vintage texture already present in your collection.', 235, 'READY'],
  ['Squirtle 151 170/165', images.squirtle, '151', 'ENGLISH', 'Collector Match', 'Keeps your Squirtle interest while exploring a modern illustration rare.', 39, 'READY'],
  ['Gardevoir ex Paldean Fates 233/091', images.gardevoir, 'Paldean Fates', 'ENGLISH', 'Collector Trail', 'A nearby Gardevoir printing with the illustrated treatment your Vault favors.', 82, 'READY'],
  ['Dragonite VSTAR Pokemon GO 076/078', images.dragonite, 'Pokemon GO', 'ENGLISH', 'Collector Trail', 'A full-art Dragonite adjacent to the modern textured cards you chase.', 42, 'READY'],
  ['Pikachu XY Black Star Promos XY95', images.pikachu, 'XY Black Star Promos', 'ENGLISH', 'Release Trail', 'A distinctive promo that connects to your preference for standalone releases.', 112, 'READY'],
  ['Articuno-GX SM Black Star Promos SM144', images.articuno, 'SM Black Star Promos', 'ENGLISH', 'Release Trail', 'A promo-era legendary bird with a different composition from your current cards.', 34, 'READY'],
  ['Mew Japanese PCG-P 019/PCG-P', images.mew, 'PCG-P Promos', 'JAPANESE', 'Release Trail', 'A Japanese campaign printing grounded in your repeated Mew and promo interests.', 74, 'READY'],
  ['Pikachu Japanese PLAY 005/PLAY', images.pikachu, 'PLAY Promos', 'JAPANESE', 'Collector Thread', 'Explores a documented Japanese PLAY release beside your existing Pikachu promo.', 0, 'THIN'],
  ['Articuno Trainers Magazine 014/T', images.articuno, 'T Promos', 'JAPANESE', 'Release Trail', 'A Trainers Magazine release that broadens your Japanese promotional thread.', 0, 'MISSING'],
  ['Gardevoir Japanese PCG-P 070/PCG-P', images.gardevoir, 'PCG-P Promos', 'JAPANESE', 'Collector Trail', 'Carries your Gardevoir interest into a source-backed Japanese promo printing.', 58, 'READY']
] as const;

export const WEB_PREVIEW_SHELF = {
  status: 'READY',
  shelfKind: 'CURRENT',
  periodKey: '2026-W41',
  title: 'Weekly Shelf',
  summary: 'Collector picks shaped by your Vault and completed Chases.',
  availableAt: '2026-10-05T13:00:00.000Z',
  updatedAt: '2026-10-05T12:30:00.000Z',
  itemCount: shelfCards.length,
  marketReadyCount: shelfCards.filter((card) => card[7] === 'READY').length,
  imageReadyCount: shelfCards.length,
  currency: 'CAD',
  items: shelfCards.map(([name, imageUrl, setName, language, signalLabel, reason, price, status], index) => ({
    position: index + 1,
    name,
    imageUrl,
    setName,
    language,
    roleLabel: index < 4 ? 'Right up your alley' : index < 9 ? 'Worth exploring' : 'Something different',
    signalLabel,
    reason,
    market: status === 'READY' ? { status, currency: 'CAD', askingTotal: price, askingSampleSize: 4 } : { status, currency: 'CAD' },
    ebayUrl: 'https://www.ebay.ca/'
  }))
};
