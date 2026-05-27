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
  image?: DiscoveryCardImage;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  displayCurrency?: SupportedCurrency;
};

type DiscoveryCardImage = {
  name: string;
  url: string;
};

const MIN_LEARNED_PROFILE_CHASES = 6;
const VISIBLE_DISCOVERY_COUNT = 3;
const DISCOVERY_CANDIDATE_POOL_SIZE = 16;
const MIN_RAW_MARKET_SAMPLE_SIZE = 2;
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

function chaseSignalText(chase: Chase): string {
  return [chase.cardName, chase.targetNote, chase.grade, chase.condition, chase.listingType].filter(Boolean).join(' ').toLowerCase();
}

function hasPromoLeaningProfile(chases: Chase[]): boolean {
  if (chases.length === 0) return false;
  const promoPattern = /\b(promo|promotional|black star|corocoro|coro coro|sm\d{2,4}|s[tw]\d{2}-\d{3}|st\d{2}-\d{3})\b/i;
  const promoSignals = chases.filter((chase) => promoPattern.test(chaseSignalText(chase)));
  return promoSignals.length >= 2 || promoSignals.length / chases.length >= 0.5;
}

function tasteSignalsFromChases(chases: Chase[], lane: string): string[] {
  if (chases.length === 0) return ['starter collector profile', lane];

  const priorities = chases.map((chase) => chase.priority ?? 'NORMAL');
  const grades = uniqueValues(chases.map((chase) => chase.grade)).slice(0, 2);
  const listingTypes = uniqueValues(
    chases.map((chase) => (chase.listingType && chase.listingType !== 'ANY' ? chase.listingType : undefined))
  );
  const signals = [lane];

  if (hasPromoLeaningProfile(chases)) signals.push('early promo and special-release signal');
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
    const promoSignal = hasPromoLeaningProfile(chases) ? '; promo and special-release signal emerging' : '';
    return `early read from ${chases.length} active chase${chases.length === 1 ? '' : 's'}${promoSignal}; lane variety grows with the vault`;
  }
  if (!hasFullDiscovery) return 'starter read; build your vault to shape future lanes';
  if (chases.length === 0) return 'starter read; build your vault to shape future lanes';
  const remainingChases = Math.max(0, MIN_LEARNED_PROFILE_CHASES - chases.length);
  const promoSignal = hasPromoLeaningProfile(chases) ? '; promo and special-release signal emerging' : '';
  const chaseNote = remainingChases > 0 ? `; ${remainingChases} more chase${remainingChases === 1 ? '' : 's'} will sharpen future picks` : '';
  return `developing from ${chases.length} active chase${chases.length === 1 ? '' : 's'}${promoSignal}${chaseNote}`;
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
  const candidateNames = [suggestion.name, ...(suggestion.evidenceAliases ?? [])];
  const requiredTokens = suggestion.requiredEvidenceTokens ?? [];
  const hasRequiredTokens = requiredTokens.every((token) => {
    const normalized = normalize(token).replace(/[^a-z0-9]+/g, '');
    return titleTokens.has(token) || compactTitle.includes(normalized);
  });

  if (!hasRequiredTokens) return false;

  return candidateNames.some((name) => {
    const suggestionTokens = normalizedTokens(name).filter((token) => !['the', 'and', 'with', 'wearing'].includes(token));
    if (suggestionTokens.length === 0) return false;
    const matches = suggestionTokens.filter((token) => titleTokens.has(token) || compactTitle.includes(token.replace(/[^a-z0-9]+/g, '')));
    return matches.length / suggestionTokens.length >= 0.75;
  });
}

function looksLikeCardListing(listing: Listing): boolean {
  const title = normalize(listing.title);
  if (includesAnyTerm(title, NON_CARD_TERMS)) return false;
  return includesAnyTerm(title, CARD_TERMS);
}

function looksLikeRawCardListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return !/\b(ace grading|beckett|bgs|cgc|gma|psa|sgc|tag graded)\b|\bgraded\b|\bslab(?:bed)?\b/.test(text);
}

function looksLikeBaselineRawMarketListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return (
    looksLikeRawCardListing(listing) &&
    !/\b(error|gem mint|minty mint|misprint|miscut|nintedo|sealed|unopened|signature|signed|autograph|staff)\b/.test(text) &&
    !/\b(lot|pack|post ?card)\b|\bcard set\b|\b(complete|master|binder)\b.*\b(set|collection)\b|\b(6|9|18)[- ]?card set\b|\bset of \d+\b/.test(text)
  );
}

function meetsBaselineMarketCeiling(
  suggestion: DiscoverySuggestion,
  listing: Listing,
  targetCurrency: SupportedCurrency
): boolean {
  if (suggestion.maximumBaselineRawTotalCad === undefined) return true;
  const ceiling = convertCurrencyAmount(suggestion.maximumBaselineRawTotalCad, 'CAD', targetCurrency);
  return convertedListingParts(listing, targetCurrency).total <= ceiling;
}

function typicalMarketTotal(totals: number[]): number | undefined {
  if (totals.length === 0) return undefined;
  const sorted = [...totals].sort((a, b) => a - b);
  const anchor = median(sorted);
  if (anchor === undefined || anchor <= 0) return anchor;
  const withoutHighOutliers = sorted.filter((total) => total <= anchor * 3);
  return median(withoutHighOutliers.length > 0 ? withoutHighOutliers : sorted);
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
  const discoveryChase: Chase = {
    id: `discover:${suggestion.name}`,
    userId,
    cardName: suggestion.evidenceSearchTerm ?? `${suggestion.name} trading card`,
    createdAt: new Date().toISOString()
  };

  try {
    const listings = await withTimeout(searchEbayListings(discoveryChase, destination), 7000);
    const usableListings = listings.filter((candidate) => isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency));
    const rawListings = usableListings.filter(looksLikeRawCardListing);
    const baselineRawListings = usableListings.filter(
      (candidate) => looksLikeBaselineRawMarketListing(candidate) && meetsBaselineMarketCeiling(suggestion, candidate, targetCurrency)
    );
    const listing =
      baselineRawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      rawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      baselineRawListings[0] ??
      rawListings[0];
    if (!listing) return { suggestion };

    const totals = baselineRawListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    const typicalRawAskingTotal = typicalMarketTotal(totals);
    const imageUrl = imageUrlFromListing(listing);
    return {
      suggestion,
      listing,
      image: imageUrl ? { name: suggestion.name, url: imageUrl } : undefined,
      typicalRawAskingTotal,
      marketSampleSize: totals.length,
      displayCurrency: targetCurrency
    };
  } catch {
    return { suggestion };
  }
}

function formatMarketFeel(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.typicalRawAskingTotal === undefined || candidate.marketSampleSize === undefined || candidate.marketSampleSize === 0) {
    return 'not enough clean raw examples right now';
  }
  const sample = `${candidate.marketSampleSize} clean raw listing${candidate.marketSampleSize === 1 ? '' : 's'}`;
  return `${formatMoney(candidate.typicalRawAskingTotal, candidate.displayCurrency ?? currencyHint)} typical raw asking from ${sample}`;
}

function hasEnoughRawMarketData(candidate: DiscoveryCandidate): boolean {
  return candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE;
}

function hasSomeRawMarketData(candidate: DiscoveryCandidate): boolean {
  return candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0;
}

function collectorTheme(candidate: DiscoveryCandidate): string {
  const text = normalize([candidate.suggestion.name, candidate.suggestion.lane, ...candidate.suggestion.nearby].join(' '));
  if (/\b(mew|mewtwo|mythical)\b/.test(text)) return 'mythical-mew';
  if (/\b(articuno|zapdos|moltres|legendary bird|bird trio)\b/.test(text)) return 'legendary-birds';
  if (/\b(squirtle|wartortle|blastoise|totodile|water starter)\b/.test(text)) return 'water-starters';
  if (/\b(luffy|nami|zoro|one piece)\b/.test(text)) return 'one-piece';
  return candidate.suggestion.lane;
}

function takeDistinctThemes(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const seenThemes = new Set<string>();
  for (const candidate of candidates) {
    const theme = collectorTheme(candidate);
    if (seenThemes.has(theme)) continue;
    selected.push(candidate);
    seenThemes.add(theme);
    if (selected.length >= VISIBLE_DISCOVERY_COUNT) break;
  }
  return selected;
}

function selectVisibleCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const strongRawData = candidates.filter(hasEnoughRawMarketData);
  const partialRawData = candidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate));
  return takeDistinctThemes([...strongRawData, ...partialRawData]);
}

function discoveryEmbed(candidate: DiscoveryCandidate, index: number, currencyHint: SupportedCurrency): EmbedBuilder {
  const title = `${index + 1} · ${titleCase(candidate.suggestion.lane)}`;
  const embed = infoEmbed(title);
  const nearby = candidate.suggestion.nearby.slice(0, 3).map((name) => `• ${name}`).join('\n');

  if (candidate.image) embed.setThumbnail(candidate.image.url);

  embed
    .setDescription(`**${candidate.suggestion.name}**\n${candidate.suggestion.why}`)
    .addFields(
      { name: 'Explore Next', value: nearby || 'Vaultr will widen this lane as the catalog grows.', inline: false },
      { name: 'Market Feel', value: formatMarketFeel(candidate, currencyHint), inline: false }
    );
  return embed;
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
    const selection = selectDiscoverySuggestions(focus, chases, DISCOVERY_CANDIDATE_POOL_SIZE);
    const priceRange = hasLearnedProfile ? priceRangeFromChases(chases) : undefined;
    const destination = settings.shippingCountry
      ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode }
      : undefined;
    const candidates = await Promise.all(
      selection.suggestions.map((suggestion) =>
        enrichSuggestion(suggestion, interaction.user.id, destination, priceRange, settings.alertCurrency)
      )
    );
    const visibleCandidates = selectVisibleCandidates(candidates);
    const visibleLanes = uniqueValuesPreservingOrder(visibleCandidates.map((candidate) => titleCase(candidate.suggestion.lane)));
    const title = focus ? `✨ Vaultr Discovery · ${focus}` : '✨ Vaultr Discovery';
    const laneSummary = visibleLanes.length > 0 ? visibleLanes.join(', ') : 'No raw-market-ready lanes right now';
    const lines = [
      `**Collector Profile:** ${learningSignal(focus, chases, selection.lane, hasFullDiscovery, hasLearnedProfile)}`,
      `**Discovery Lanes:** ${laneSummary}`,
      `**Price Range:** ${priceRangeSummary(priceRange, settings.alertCurrency, hasFullDiscovery, hasLearnedProfile)}`
    ];

    await interaction.editReply({
      embeds: [
        infoEmbed(title, lines.join('\n')),
        ...visibleCandidates.map((candidate, index) => discoveryEmbed(candidate, index, settings.alertCurrency))
      ]
    });
  }
};
