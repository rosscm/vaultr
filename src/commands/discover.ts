import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan, listChases } from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { searchEbayListings } from '../services/ebay.js';
import { infoEmbed } from '../ui/embeds.js';
import type { Chase, Listing } from '../types.js';

type DiscoverySeed = {
  keywords: string[];
  theme: string;
  suggestions: DiscoverySuggestion[];
};

type DiscoverySuggestion = {
  name: string;
  why: string;
  minimumExampleTotalCad?: number;
};

type DiscoveryCandidate = {
  suggestion: DiscoverySuggestion;
  listing?: Listing;
  displayPrice?: number;
  displayShipping?: number;
  displayCurrency?: SupportedCurrency;
};

const MAX_LISTING_TITLE_LENGTH = 180;
const MIN_LEARNED_PROFILE_CHASES = 4;
const NON_CARD_TERMS = [
  'booster',
  'box',
  'coin',
  'custom',
  'deck box',
  'figure',
  'figurine',
  'funko',
  'gold metal',
  'keychain',
  'lot',
  'orica',
  'pack',
  'plush',
  'poster',
  'proxy',
  'replica',
  'reprint',
  'sleeve',
  'statue',
  'sticker',
  'toy'
];
const CARD_TERMS = ['card', 'cards', 'tcg', 'pokemon', 'psa', 'bgs', 'cgc', 'sgc', 'graded', 'slab'];

const DISCOVERY_SEEDS: DiscoverySeed[] = [
  {
    keywords: ['umbreon', 'moonbreon', 'espeon', 'eevee'],
    theme: 'moonlit Eeveelution cards',
    suggestions: [
      {
        name: "Karen's Umbreon",
        why: 'extends the Umbreon thread into an older collector lane with strong character identity'
      },
      {
        name: 'Umbreon VMAX 215/203',
        why: 'sits at the center of the modern moonlit alt-art pattern your Vault is circling'
      },
      {
        name: 'Espeon VMAX 270/264',
        why: 'keeps the same Eeveelution texture while widening the chase beyond Umbreon'
      }
    ]
  },
  {
    keywords: ['gengar', 'darkrai', 'shadow', 'night'],
    theme: 'dark atmospheric artwork',
    suggestions: [
      {
        name: 'Gengar VMAX 271/264',
        why: 'matches a darker visual lane with a display-heavy modern chase profile'
      },
      {
        name: 'Darkrai & Cresselia LEGEND',
        why: 'keeps the shadowy mood but adds a more unusual era and card format'
      },
      {
        name: "Sabrina's Gengar",
        why: 'turns the same atmosphere toward vintage character-driven collecting'
      }
    ]
  },
  {
    keywords: ['pikachu', 'poncho', 'promo'],
    theme: 'character promo pieces',
    suggestions: [
      {
        name: 'Poncho-Wearing Pikachu',
        why: 'leans into costume identity and promo scarcity without leaving the character lane',
        minimumExampleTotalCad: 1000
      },
      {
        name: 'Mario Pikachu',
        why: 'adds crossover appeal and high-recognition display value',
        minimumExampleTotalCad: 1000
      },
      {
        name: 'Pretend Magikarp Pikachu',
        why: 'keeps the playful promo thread with a collector-favorite visual twist',
        minimumExampleTotalCad: 500
      }
    ]
  },
  {
    keywords: ['rayquaza', 'lugia', 'crystal', 'gold star'],
    theme: 'high-impact vintage grails',
    suggestions: [
      {
        name: 'Gold Star Rayquaza',
        why: 'fits a premium legendary lane with long-term collector gravity'
      },
      {
        name: 'Crystal Lugia',
        why: 'shares the high-impact vintage profile while changing the legendary centerpiece'
      },
      {
        name: 'Rayquaza VMAX Alt Art',
        why: 'keeps the Rayquaza identity but gives the thread a modern alt-art expression'
      }
    ]
  },
  {
    keywords: ['japanese', 'jp', 'vending', 'web'],
    theme: 'Japanese-only texture',
    suggestions: [
      {
        name: 'Web Series Gengar',
        why: 'keeps the Japanese-only texture with a distinctive oddball release history'
      },
      {
        name: 'Vending Series Mewtwo',
        why: 'adds unusual format and era depth to a Japanese collector thread'
      },
      {
        name: 'Masaki Gengar',
        why: 'pairs Japanese exclusivity with a true character grail profile'
      }
    ]
  }
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function normalizedTokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function pickSeed(text: string): DiscoverySeed {
  const normalized = normalize(text);
  const seed = DISCOVERY_SEEDS.find((candidate) => candidate.keywords.some((keyword) => normalized.includes(keyword)));
  return seed ?? {
    keywords: [],
    theme: 'cards with strong collector identity',
    suggestions: [
      {
        name: 'Japanese promos',
        why: 'often carry distinct release stories and strong collection identity'
      },
      {
        name: 'vintage holos',
        why: 'add era depth and display nostalgia without needing a narrow character lane'
      },
      {
        name: 'illustration rares with matching themes',
        why: 'expand the visual taste of your Vault while staying collector-first'
      }
    ]
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function priceRangeFromChases(chases: Chase[]): { min: number; max: number; label: string } | undefined {
  const maxPrices = chases
    .map((chase) => chase.maxPrice)
    .filter((price): price is number => price !== undefined && price > 0);
  const anchor = median(maxPrices);
  if (anchor === undefined) return undefined;
  const min = Math.max(0, anchor * 0.5);
  const max = anchor * 1.5;
  return {
    min,
    max,
    label: `${min.toFixed(0)}-${max.toFixed(0)}`
  };
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

function tasteSignalsFromChases(chases: Chase[], seed: DiscoverySeed): string[] {
  if (chases.length === 0) return ['starter collector profile', seed.theme];

  const priorities = chases.map((chase) => chase.priority ?? 'NORMAL');
  const grades = uniqueValues(chases.map((chase) => chase.grade)).slice(0, 2);
  const listingTypes = uniqueValues(
    chases.map((chase) => (chase.listingType && chase.listingType !== 'ANY' ? chase.listingType : undefined))
  );
  const signals = [seed.theme];

  if (priorities.includes('GRAIL')) signals.push('grail-weighted pursuit');
  if (grades.length > 0) signals.push(`grade focus: ${grades.join(', ')}`);
  if (listingTypes.length > 0) signals.push(`buying style: ${listingTypes.join(', ').toLowerCase().replaceAll('_', ' ')}`);

  return signals.slice(0, 4);
}

function profileBasis(focus: string | null, chases: Chase[], hasLearnedProfile: boolean): string {
  if (focus) return `focused on \`${focus}\``;
  if (hasLearnedProfile) return `learned from your ${chases.length} active chases`;
  if (chases.length > 0) return `warming up from your ${chases.length} active chase${chases.length === 1 ? '' : 's'}`;
  return 'based on a starter collector profile';
}

function profileStatus(chaseCount: number, hasFullDiscovery: boolean, hasLearnedProfile: boolean): string {
  if (hasLearnedProfile) return 'Learned profile active';
  if (!hasFullDiscovery) {
    return `Developing; Pro unlocks a learned profile after ${MIN_LEARNED_PROFILE_CHASES} active chases`;
  }
  return `Developing (${chaseCount}/${MIN_LEARNED_PROFILE_CHASES} active chases tracked)`;
}

function developingTasteSignals(seed: DiscoverySeed): string[] {
  return ['starter thread', seed.theme, 'more chases will sharpen this over time'];
}

function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return 'Unknown';
  return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
}

function formatSellerFeedback(listing: Listing): string {
  const percent = listing.sellerFeedbackPercent === undefined ? 'Unknown' : `${listing.sellerFeedbackPercent}%`;
  const score = listing.sellerFeedbackScore === undefined ? undefined : ` (${listing.sellerFeedbackScore})`;
  return `${percent}${score ?? ''}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function convertedListingParts(
  listing: Listing,
  targetCurrency: SupportedCurrency
): { price: number; shipping: number | undefined; total: number; currency: SupportedCurrency } {
  const price = convertCurrencyAmount(listing.price, listing.currency, targetCurrency);
  const shipping =
    listing.shippingCost === undefined
      ? undefined
      : convertCurrencyAmount(listing.shippingCost, listing.shippingCurrency ?? listing.currency, targetCurrency);
  return {
    price,
    shipping,
    total: price + (shipping ?? 0),
    currency: targetCurrency
  };
}

function isListingInRange(
  listing: Listing,
  range: { min: number; max: number } | undefined,
  targetCurrency: SupportedCurrency
): boolean {
  if (!range) return true;
  const converted = convertedListingParts(listing, targetCurrency);
  return converted.total >= range.min && converted.total <= range.max;
}

function includesAnyTerm(value: string, terms: string[]): boolean {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function hasCoreSuggestionTokens(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  const titleTokens = new Set(normalizedTokens(listing.title));
  const suggestionTokens = normalizedTokens(suggestion.name).filter(
    (token) => !['the', 'and', 'with', 'wearing'].includes(token)
  );
  if (suggestionTokens.length === 0) return false;
  const matches = suggestionTokens.filter((token) => titleTokens.has(token));
  return matches.length / suggestionTokens.length >= 0.75;
}

function looksLikeCardListing(listing: Listing): boolean {
  const title = normalize(listing.title);
  if (includesAnyTerm(title, NON_CARD_TERMS)) return false;
  return includesAnyTerm(title, CARD_TERMS);
}

function hasReliableSeller(listing: Listing): boolean {
  const feedbackScore = listing.sellerFeedbackScore;
  const feedbackPercent = listing.sellerFeedbackPercent;
  if (feedbackScore !== undefined && feedbackScore < 10) return false;
  if (feedbackPercent !== undefined && feedbackPercent < 95) return false;
  return true;
}

function meetsPremiumFloor(
  suggestion: DiscoverySuggestion,
  listing: Listing,
  targetCurrency: SupportedCurrency
): boolean {
  if (suggestion.minimumExampleTotalCad === undefined) return true;
  const floor = convertCurrencyAmount(suggestion.minimumExampleTotalCad, 'CAD', targetCurrency);
  return convertedListingParts(listing, targetCurrency).total >= floor;
}

function isUsableDiscoveryExample(
  suggestion: DiscoverySuggestion,
  listing: Listing,
  range: { min: number; max: number } | undefined,
  targetCurrency: SupportedCurrency
): boolean {
  return (
    hasCoreSuggestionTokens(suggestion, listing) &&
    looksLikeCardListing(listing) &&
    hasReliableSeller(listing) &&
    meetsPremiumFloor(suggestion, listing, targetCurrency) &&
    isListingInRange(listing, range, targetCurrency)
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Discovery source timeout')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function enrichSuggestion(
  suggestion: DiscoverySuggestion,
  userId: string,
  destination: { country?: string; postalCode?: string } | undefined,
  range: { min: number; max: number } | undefined,
  targetCurrency: SupportedCurrency
): Promise<DiscoveryCandidate> {
  const discoveryChase: Chase = {
    id: `discover:${suggestion.name}`,
    userId,
    cardName: `${suggestion.name} pokemon card`,
    createdAt: new Date().toISOString()
  };

  try {
    const listings = await withTimeout(searchEbayListings(discoveryChase, destination), 7000);
    const listing = listings.find((candidate) =>
      isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency)
    );
    if (!listing) return { suggestion };

    const converted = convertedListingParts(listing, targetCurrency);
    return {
      suggestion,
      listing,
      displayPrice: converted.price,
      displayShipping: converted.shipping,
      displayCurrency: converted.currency
    };
  } catch {
    return { suggestion };
  }
}

function discoveryEmbed(candidate: DiscoveryCandidate, index: number, currencyHint: SupportedCurrency): EmbedBuilder {
  const title = `${index + 1}. ${candidate.suggestion.name}`;
  const listing = candidate.listing;
  const embed = infoEmbed(title);

  if (!listing) {
    embed.setDescription(
      [`**Why Vaultr picked it:** ${candidate.suggestion.why}`, '**Live Example:** Not available right now'].join('\n')
    );
    return embed;
  }

  const image = listing.thumbnailUrl ?? listing.imageUrl;
  if (image && /^https?:\/\//i.test(image)) embed.setThumbnail(image);

  embed.setDescription(
    [
      `**Why Vaultr picked it:** ${candidate.suggestion.why}`,
      `**Live Example:** ${truncate(listing.title, MAX_LISTING_TITLE_LENGTH)}`,
      `**Price:** ${formatMoney(candidate.displayPrice, candidate.displayCurrency ?? currencyHint)}`,
      `**Total:** ${formatMoney(
        (candidate.displayPrice ?? 0) + (candidate.displayShipping ?? 0),
        candidate.displayCurrency ?? currencyHint
      )}`,
      `**Seller Feedback:** ${formatSellerFeedback(listing)}`,
      `**Source:** eBay`,
      `[Open Listing](${listing.url})`
    ].join('\n')
  );
  return embed;
}

export const discover = {
  data: new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Open a discovery thread from your developing taste profile')
    .addStringOption((opt) =>
      opt
        .setName('focus')
        .setDescription('Steer this discovery thread, e.g. umbreon, gengar, or japanese vending')
        .setMaxLength(80)
    ),
  async execute(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const focus = interaction.options.getString('focus');
    const chases = listChases(interaction.user.id);
    const settings = getUserAlertSettings(interaction.user.id);
    const plan = getUserPlan(interaction.user.id);
    const entitlements = getEntitlementsForTier(plan.tier);
    const hasFullDiscovery = plan.status === 'ACTIVE' && entitlements.discoveryDepth === 'full';
    const hasLearnedProfile = hasFullDiscovery && chases.length >= MIN_LEARNED_PROFILE_CHASES;
    const sourceText = focus ?? chases.map((chase) => chase.cardName).join(' ');
    const seed = pickSeed(sourceText);
    const priceRange = hasLearnedProfile ? priceRangeFromChases(chases) : undefined;
    const tasteSignals = hasLearnedProfile ? tasteSignalsFromChases(chases, seed) : developingTasteSignals(seed);
    const destination = settings.shippingCountry
      ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode }
      : undefined;
    const candidates = hasFullDiscovery
      ? await Promise.all(
          seed.suggestions.map((suggestion) =>
            enrichSuggestion(suggestion, interaction.user.id, destination, priceRange, settings.alertCurrency)
          )
        )
      : seed.suggestions.map((suggestion) => ({ suggestion }));
    const visibleCandidates = candidates.slice(0, 3);
    const title = focus ? `🔎 Discovery Thread · ${focus}` : '🔎 Discovery Thread';
    const priceNeighborhood = hasLearnedProfile
      ? priceRange
        ? `${priceRange.label} ${settings.alertCurrency}, inferred from chase max prices`
        : 'learning; add max prices to your chases to shape this'
      : hasFullDiscovery
        ? `available after ${MIN_LEARNED_PROFILE_CHASES} active chases`
        : 'available with a learned Pro profile';
    const note = hasFullDiscovery
      ? 'Live examples are supporting evidence, not endorsements.'
      : 'This is a starter discovery thread. Your taste profile develops as Vaultr sees more active chases.';
    const lines = [
      `**Collector Thread:** ${seed.theme}`,
      `**Profile Status:** ${profileStatus(chases.length, hasFullDiscovery, hasLearnedProfile)}`,
      `**Taste Profile:** ${tasteSignals.join(', ')}`,
      `**Basis:** ${profileBasis(focus, chases, hasLearnedProfile)}`,
      `**Price Neighborhood:** ${priceNeighborhood}`,
      '',
      `**Note:** ${note}`
    ];

    if (!hasFullDiscovery) {
      lines.push(
        '',
        `**Pro:** learned discovery uses ${MIN_LEARNED_PROFILE_CHASES}+ tracked chases, price neighborhood, and vetted live examples.`
      )
    }

    await interaction.editReply({
      embeds: [
        infoEmbed(title, lines.join('\n')),
        ...visibleCandidates.map((candidate, index) => discoveryEmbed(candidate, index, settings.alertCurrency))
      ]
    });
  }
};
