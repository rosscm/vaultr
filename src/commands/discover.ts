import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan, listChases } from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { selectDiscoverySuggestions, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { searchEbayListings } from '../services/ebay.js';
import { infoEmbed } from '../ui/embeds.js';
import type { Chase, Listing } from '../types.js';

type DiscoveryCandidate = {
  suggestion: DiscoverySuggestion;
  listing?: Listing;
  images: DiscoveryCardImage[];
  averageAskingTotal?: number;
  averageSampleSize?: number;
  displayCurrency?: SupportedCurrency;
};

type DiscoveryCardImage = {
  name: string;
  url: string;
  role: 'primary' | 'nearby';
};

const MIN_LEARNED_PROFILE_CHASES = 6;
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

function tasteSignalsFromChases(chases: Chase[], lane: string): string[] {
  if (chases.length === 0) return ['starter collector profile', lane];

  const priorities = chases.map((chase) => chase.priority ?? 'NORMAL');
  const grades = uniqueValues(chases.map((chase) => chase.grade)).slice(0, 2);
  const listingTypes = uniqueValues(
    chases.map((chase) => (chase.listingType && chase.listingType !== 'ANY' ? chase.listingType : undefined))
  );
  const signals = [lane];

  if (priorities.includes('GRAIL')) signals.push('grail-weighted pursuit');
  if (grades.length > 0) signals.push(`grade focus: ${grades.join(', ')}`);
  if (listingTypes.length > 0) signals.push(`buying style: ${listingTypes.join(', ').toLowerCase().replaceAll('_', ' ')}`);

  return signals.slice(0, 4);
}

function learningSignal(
  focus: string | null,
  chases: Chase[],
  lane: string,
  hasFullDiscovery: boolean,
  hasLearnedProfile: boolean
): string {
  if (focus && !hasLearnedProfile) return `steered by \`${focus}\`; early read from ${chases.length} active chase${chases.length === 1 ? '' : 's'}`;
  if (focus) return `steered by \`${focus}\`, shaped by ${chases.length} active chases`;
  if (hasLearnedProfile) {
    const signals = tasteSignalsFromChases(chases, lane).filter((signal) => signal !== lane);
    const signalNote = signals.length > 0 ? `; ${signals.join(', ')}` : '';
    return `shaped by ${chases.length} active chases${signalNote}`;
  }
  if (!hasFullDiscovery && chases.length > 0) {
    return `early read from ${chases.length} active chase${chases.length === 1 ? '' : 's'}`;
  }
  if (!hasFullDiscovery) return 'starter read; add chases to shape future picks';
  if (chases.length === 0) return 'starter read; add chases to shape future picks';
  const remainingChases = Math.max(0, MIN_LEARNED_PROFILE_CHASES - chases.length);
  const chaseNote = remainingChases > 0 ? `; ${remainingChases} more chase${remainingChases === 1 ? '' : 's'} will sharpen future picks` : '';
  return `developing from ${chases.length} active chase${chases.length === 1 ? '' : 's'}${chaseNote}`;
}

function priceRangeSummary(
  priceRange: { min: number; max: number; label: string } | undefined,
  currency: SupportedCurrency,
  hasFullDiscovery: boolean,
  hasLearnedProfile: boolean
): string {
  if (hasLearnedProfile && priceRange) return `tuned around ${priceRange.label} ${currency} from chase targets`;
  if (hasLearnedProfile) return 'add max prices to help Vaultr understand your range';
  if (hasFullDiscovery) return 'based on chase max prices as your collection grows';
  return 'based on chase max prices as your collection grows';
}

function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return 'Unknown';
  return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueValuesPreservingOrder(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
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
  const compactTitle = normalize(listing.title).replace(/[^a-z0-9]+/g, '');
  const suggestionTokens = normalizedTokens(suggestion.name).filter(
    (token) => !['the', 'and', 'with', 'wearing'].includes(token)
  );
  if (suggestionTokens.length === 0) return false;
  const matches = suggestionTokens.filter((token) => titleTokens.has(token) || compactTitle.includes(token.replace(/[^a-z0-9]+/g, '')));
  return matches.length / suggestionTokens.length >= 0.75;
}

function looksLikeCardListing(listing: Listing): boolean {
  const title = normalize(listing.title);
  if (includesAnyTerm(title, NON_CARD_TERMS)) return false;
  return includesAnyTerm(title, CARD_TERMS);
}

function looksLikeRawCardImage(listing: Listing): boolean {
  const title = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return !includesAnyTerm(title, ['psa', 'bgs', 'cgc', 'sgc', 'graded', 'slab']);
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

function imageUrlFromListing(listing: Listing | undefined): string | undefined {
  const image = listing?.imageUrl ?? listing?.thumbnailUrl;
  return image && /^https?:\/\//i.test(image) ? image : undefined;
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
  const searchImageForCard = async (name: string, role: DiscoveryCardImage['role']): Promise<DiscoveryCardImage | undefined> => {
    const imageSuggestion: DiscoverySuggestion = {
      ...suggestion,
      name,
      minimumExampleTotalCad: undefined
    };
    const imageChase: Chase = {
      id: `discover-image:${name}`,
      userId,
      cardName: `${name} pokemon card`,
      createdAt: new Date().toISOString()
    };

    const imageListings = await withTimeout(searchEbayListings(imageChase, destination), 5000);
    const usableImageListings = imageListings.filter((candidate) => isUsableDiscoveryExample(imageSuggestion, candidate, range, targetCurrency));
    const imageListing =
      usableImageListings.find((candidate) => (candidate.imageUrl || candidate.thumbnailUrl) && looksLikeRawCardImage(candidate)) ??
      usableImageListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl);
    const url = imageUrlFromListing(imageListing);
    return url ? { name, url, role } : undefined;
  };

  const discoveryChase: Chase = {
    id: `discover:${suggestion.name}`,
    userId,
    cardName: `${suggestion.name} pokemon card`,
    createdAt: new Date().toISOString()
  };

  try {
    const listings = await withTimeout(searchEbayListings(discoveryChase, destination), 7000);
    const usableListings = listings.filter((candidate) => isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency));
    const listing =
      usableListings.find((candidate) => (candidate.imageUrl || candidate.thumbnailUrl) && looksLikeRawCardImage(candidate)) ??
      usableListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      usableListings[0];
    if (!listing) return { suggestion, images: [] };

    const totals = usableListings.slice(0, 8).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    const averageAskingTotal = totals.length > 0 ? totals.reduce((sum, total) => sum + total, 0) / totals.length : undefined;
    const primaryImage = imageUrlFromListing(listing);
    const nearbyImages = await Promise.all(suggestion.nearby.slice(0, 2).map((name) => searchImageForCard(name, 'nearby')));
    return {
      suggestion,
      listing,
      images: [primaryImage ? { name: suggestion.name, url: primaryImage, role: 'primary' as const } : undefined, ...nearbyImages].filter(
        (image): image is DiscoveryCardImage => image !== undefined
      ),
      averageAskingTotal,
      averageSampleSize: totals.length,
      displayCurrency: targetCurrency
    };
  } catch {
    return { suggestion, images: [] };
  }
}

function formatAverageAsking(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.averageAskingTotal === undefined || candidate.averageSampleSize === undefined || candidate.averageSampleSize === 0) {
    return 'not enough clean examples right now';
  }
  const sample = `${candidate.averageSampleSize} clean listing${candidate.averageSampleSize === 1 ? '' : 's'}`;
  return `${formatMoney(candidate.averageAskingTotal, candidate.displayCurrency ?? currencyHint)} average asking from ${sample}`;
}

function discoveryEmbed(candidate: DiscoveryCandidate, index: number, currencyHint: SupportedCurrency): EmbedBuilder {
  const title = `${index + 1}. ${titleCase(candidate.suggestion.lane)}`;
  const listing = candidate.listing;
  const embed = infoEmbed(title);

  if (!listing) {
    embed.setDescription(
      [
        `**Start With:** ${candidate.suggestion.name}`,
        `**Why Vaultr Picked It:** ${candidate.suggestion.why}`,
        `**Nearby Cards:** ${candidate.suggestion.nearby.join(', ')}`,
        `**Average Asking:** ${formatAverageAsking(candidate, currencyHint)}`
      ].join('\n')
    );
    return embed;
  }

  const primaryImage = candidate.images.find((image) => image.role === 'primary') ?? candidate.images[0];
  if (primaryImage) embed.setImage(primaryImage.url);

  embed.setDescription(
    [
      `**Start With:** ${candidate.suggestion.name}`,
      `**Why Vaultr Picked It:** ${candidate.suggestion.why}`,
      `**Nearby Cards:** ${candidate.suggestion.nearby.join(', ')}`,
      `**Average Asking:** ${formatAverageAsking(candidate, currencyHint)}`
    ].join('\n')
  );
  return embed;
}

function discoveryImageEmbed(image: DiscoveryCardImage): EmbedBuilder {
  return infoEmbed(image.name).setImage(image.url);
}

export const discover = {
  data: new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Open Vaultr Discovery from your developing taste profile')
    .addStringOption((opt) =>
      opt
        .setName('focus')
        .setDescription('Steer this discovery, e.g. umbreon, gengar, or japanese vending')
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
    const selection = selectDiscoverySuggestions(focus, chases);
    const priceRange = hasLearnedProfile ? priceRangeFromChases(chases) : undefined;
    const destination = settings.shippingCountry
      ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode }
      : undefined;
    const candidates = await Promise.all(
      selection.suggestions.map((suggestion) =>
        enrichSuggestion(suggestion, interaction.user.id, destination, priceRange, settings.alertCurrency)
      )
    );
    const visibleCandidates = candidates.slice(0, 3);
    const visibleLanes = uniqueValuesPreservingOrder(visibleCandidates.map((candidate) => titleCase(candidate.suggestion.lane)));
    const title = focus ? `✨ Vaultr Discovery · ${focus}` : '✨ Vaultr Discovery';
    const lines = [
      `**Collector Profile:** ${learningSignal(focus, chases, selection.lane, hasFullDiscovery, hasLearnedProfile)}`,
      `**Discovery Lanes:** ${visibleLanes.join(', ')}`,
      `**Price Range:** ${priceRangeSummary(priceRange, settings.alertCurrency, hasFullDiscovery, hasLearnedProfile)}`
    ];

    await interaction.editReply({
      embeds: [
        infoEmbed(title, lines.join('\n')),
        ...visibleCandidates.flatMap((candidate, index) => [
          discoveryEmbed(candidate, index, settings.alertCurrency),
          ...candidate.images.filter((image) => image.role === 'nearby').map((image) => discoveryImageEmbed(image))
        ])
      ]
    });
  }
};
