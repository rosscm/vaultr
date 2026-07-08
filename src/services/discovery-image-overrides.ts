export type DiscoveryImageOverride = {
  imageUrl: string;
  sourceName: string;
  sourceCardId?: string;
};

const DISCOVERY_IMAGE_OVERRIDES = new Map<string, DiscoveryImageOverride>([
  [
    normalizeSuggestionName("Team Rocket's Mewtwo ex Ascended Heroes 281"),
    {
      imageUrl: 'https://cdn11.bigcommerce.com/s-b4ioc4fed9/products/569138/images/3745604/B733QTIMxsUolT8ZRSck3d5rT__08351.1779177196.386.513.jpg?c=1',
      sourceName: 'Magic Madhouse',
      sourceCardId: 'PE-ASC1-281'
    }
  ],
  [
    normalizeSuggestionName('Gardevoir 408/SM-P PROMO Limited Illustration Promo Pokemon Card Japanese'),
    {
      imageUrl: 'https://pkmhobby.com/cdn/shop/files/57_587a877b-0632-4034-b953-de90cfa8846b.jpg?crop=center&height=1200&v=1738722480&width=1200',
      sourceName: 'PKMhobby',
      sourceCardId: '408/SM-P'
    }
  ]
]);

export function normalizeSuggestionName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function discoveryImageOverrideForSuggestion(suggestionName: string): DiscoveryImageOverride | undefined {
  return DISCOVERY_IMAGE_OVERRIDES.get(normalizeSuggestionName(suggestionName));
}
