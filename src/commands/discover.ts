import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  addChase,
  countUserChases,
  createDiscoveryVaultAction,
  deleteExpiredDiscoveryVaultActions,
  getDiscoveryVaultAction,
  getUserAlertSettings,
  getUserPlan,
  listChases
} from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestions, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { searchEbayListings } from '../services/ebay.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import type { Chase, Listing } from '../types.js';

type DiscoveryCandidate = {
  suggestion: DiscoverySuggestion;
  listing?: Listing;
  image?: DiscoveryCardImage;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  displayCurrency?: SupportedCurrency;
  selectionIndex?: number;
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

const DISCOVERY_OVERVIEW_COLOR = 0x8b5cf6;
const DISCOVERY_LANE_COLOR = 0x0e7490;
const DISCOVERY_VAULT_PREFIX = 'discover-vault';
const DISCOVERY_VAULT_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];

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

function tasteSignalsFromChases(chases: Chase[], lane: string): string[] {
  if (chases.length === 0) return ['starter collector profile', lane];

  const signals = [lane];

  if (hasPromoLeaningDiscoveryProfile(chases)) signals.push('promos and special releases are standing out');

  return signals.slice(0, 3);
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
    return `built from ${chases.length} active chases${signalNote}`;
  }
  if (!hasFullDiscovery && chases.length > 0) {
    const promoSignal = hasPromoLeaningDiscoveryProfile(chases) ? '; promo and special-release signal emerging' : '';
    return `early read from ${chases.length} active chase${chases.length === 1 ? '' : 's'}${promoSignal}; lane variety grows with the vault`;
  }
  if (!hasFullDiscovery) return 'starter read; build your vault to shape future lanes';
  if (chases.length === 0) return 'starter read; build your vault to shape future lanes';
  const remainingChases = Math.max(0, MIN_LEARNED_PROFILE_CHASES - chases.length);
  const promoSignal = hasPromoLeaningDiscoveryProfile(chases) ? '; promo and special-release signal emerging' : '';
  const chaseNote = remainingChases > 0 ? `; ${remainingChases} more chase${remainingChases === 1 ? '' : 's'} will sharpen future picks` : '';
  return `developing from ${chases.length} active chase${chases.length === 1 ? '' : 's'}${promoSignal}${chaseNote}`;
}

function priceRangeSummary(
  priceRange: { min: number; max: number; label: string } | undefined,
  currency: SupportedCurrency,
  hasFullDiscovery: boolean,
  hasLearnedProfile: boolean
): string {
  if (hasLearnedProfile && priceRange) return `below your biggest chases, with room for lighter pickups`;
  if (hasLearnedProfile) return 'add max prices to help Vaultr understand your range';
  if (hasFullDiscovery) return 'based on chase max prices as your collection grows';
  return 'based on chase max prices as your collection grows';
}

function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return 'Unknown';
  return `${Math.round(amount).toLocaleString('en-CA')} ${currency ?? ''}`.trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncateValue(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
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
  return converted.total <= range.max;
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
  selectionIndex: number,
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
    if (!listing) return { suggestion, selectionIndex };

    const totals = baselineRawListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    const typicalRawAskingTotal = typicalMarketTotal(totals);
    const imageUrl = imageUrlFromListing(listing);
    return {
      suggestion,
      selectionIndex,
      listing,
      image: imageUrl ? { name: suggestion.name, url: imageUrl } : undefined,
      typicalRawAskingTotal,
      marketSampleSize: totals.length,
      displayCurrency: targetCurrency
    };
  } catch {
    return { suggestion, selectionIndex };
  }
}

function formatMarketFeel(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.typicalRawAskingTotal === undefined || candidate.marketSampleSize === undefined || candidate.marketSampleSize === 0) {
    return 'not enough clean raw examples right now';
  }
  const sample = `${candidate.marketSampleSize} clean raw listing${candidate.marketSampleSize === 1 ? '' : 's'}`;
  return `${formatMoney(candidate.typicalRawAskingTotal, candidate.displayCurrency ?? currencyHint)} typical raw asking from ${sample}`;
}

function formatMarketRead(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.typicalRawAskingTotal === undefined || candidate.marketSampleSize === undefined || candidate.marketSampleSize === 0) {
    return 'Market is thin right now; treat this as a lane to watch.';
  }
  const sample = `${candidate.marketSampleSize} clean raw listing${candidate.marketSampleSize === 1 ? '' : 's'}`;
  return `${formatMoney(candidate.typicalRawAskingTotal, candidate.displayCurrency ?? currencyHint)} typical raw ask\n${sample} found`;
}

function hasEnoughRawMarketData(candidate: DiscoveryCandidate): boolean {
  return candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE;
}

function hasSomeRawMarketData(candidate: DiscoveryCandidate): boolean {
  return candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0;
}

function curiosityRankScore(candidate: DiscoveryCandidate): number {
  const curiosity = candidate.suggestion.curiosityScore ?? 0;
  const marketTotal = candidate.typicalRawAskingTotal ?? 0;
  const marketSweetSpot = marketTotal >= 35 && marketTotal <= 350 ? 3 : marketTotal > 0 ? 1 : 0;
  const evidenceDepth = Math.min(3, candidate.marketSampleSize ?? 0);
  const originalOrderPenalty = (candidate.selectionIndex ?? 0) / 100;
  return curiosity * 10 + marketSweetSpot + evidenceDepth - originalOrderPenalty;
}

function rankDiscoveryCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => curiosityRankScore(right) - curiosityRankScore(left));
}

function candidateMatchesFocus(candidate: DiscoveryCandidate, focus: string | null): boolean {
  const focusTokens = normalizedTokens(focus ?? '');
  if (focusTokens.length === 0) return false;
  const candidateText = normalize([
    candidate.suggestion.name,
    candidate.suggestion.lane,
    candidate.suggestion.laneWhy,
    ...candidate.suggestion.nearby,
    ...(candidate.suggestion.evidenceAliases ?? [])
  ].join(' '));
  return focusTokens.some((token) => candidateText.includes(token));
}

function discoveryVisualTone(lane: string): { icon: string; color: number; path: string } {
  const normalizedLane = normalize(lane);
  if (/japanese|vending|oddit/.test(normalizedLane)) return { icon: '🗾', color: DISCOVERY_LANE_COLOR, path: 'Hidden release path' };
  if (/secret|bird|legendary/.test(normalizedLane)) return { icon: '✦', color: DISCOVERY_LANE_COLOR, path: 'Rarer detour' };
  if (/promo/.test(normalizedLane)) return { icon: '◆', color: DISCOVERY_LANE_COLOR, path: 'Promo thread' };
  if (/gallery|character/.test(normalizedLane)) return { icon: '◆', color: DISCOVERY_LANE_COLOR, path: 'Character gallery' };
  if (/mythical|mew/.test(normalizedLane)) return { icon: '✧', color: DISCOVERY_LANE_COLOR, path: 'Mythical thread' };
  return { icon: '◇', color: DISCOVERY_LANE_COLOR, path: 'Discovery thread' };
}

function markdownLink(label: string, url: string | undefined): string {
  const safeLabel = label.replaceAll('[', '').replaceAll(']', '');
  return url ? `[${safeLabel}](${url})` : safeLabel;
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

function selectVisibleCandidates(candidates: DiscoveryCandidate[], focus: string | null): DiscoveryCandidate[] {
  const focusedRawData = rankDiscoveryCandidates(candidates.filter((candidate) => candidateMatchesFocus(candidate, focus) && hasSomeRawMarketData(candidate)));
  const strongRawData = rankDiscoveryCandidates(candidates.filter(hasEnoughRawMarketData));
  const partialRawData = rankDiscoveryCandidates(candidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)));
  return takeDistinctThemes([...focusedRawData, ...strongRawData, ...partialRawData]);
}

function discoveryEmbed(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): EmbedBuilder {
  const tone = discoveryVisualTone(candidate.suggestion.lane);
  const title = `${tone.icon} ${titleCase(candidate.suggestion.lane)}`;
  const embed = new EmbedBuilder().setColor(tone.color).setTitle(title);
  const nearby = candidate.suggestion.nearby.slice(0, 3).map((name) => `• ${name}`).join('\n');

  if (candidate.image) embed.setThumbnail(candidate.image.url);

  embed
    .setDescription(`**${markdownLink(candidate.suggestion.name, candidate.listing?.url)}**`)
    .addFields(
      { name: 'Why It Resonates', value: candidate.suggestion.laneWhy, inline: false },
      { name: 'Market Read', value: formatMarketRead(candidate, currencyHint), inline: true },
      { name: 'Discovery Path', value: tone.path, inline: true },
      { name: 'Next Threads', value: nearby || 'Vaultr will widen this lane as the catalog grows.', inline: false }
    )
    .setFooter({ text: 'Vaultr • Discovery Path' })
    .setTimestamp();
  return embed;
}

function createDiscoveryVaultButtonToken(userId: string, candidate: DiscoveryCandidate): string {
  deleteExpiredDiscoveryVaultActions();
  const token = randomUUID().replaceAll('-', '').slice(0, 12);
  createDiscoveryVaultAction({
    token,
    userId,
    cardName: candidate.suggestion.name,
    lane: candidate.suggestion.lane,
    maxPrice: candidate.typicalRawAskingTotal === undefined ? undefined : Math.max(1, Math.round(candidate.typicalRawAskingTotal)),
    expiresAt: new Date(Date.now() + DISCOVERY_VAULT_ACTION_TTL_MS).toISOString()
  });
  return token;
}

function discoveryVaultButtons(userId: string, candidates: DiscoveryCandidate[]): ActionRowBuilder<ButtonBuilder>[] {
  if (candidates.length === 0) return [];
  const buttons = candidates.slice(0, 3).map((candidate) =>
    new ButtonBuilder()
      .setCustomId(`${DISCOVERY_VAULT_PREFIX}:${userId}:${createDiscoveryVaultButtonToken(userId, candidate)}`)
      .setLabel(truncateValue(`Add ${candidate.suggestion.name}`, 80))
      .setStyle(ButtonStyle.Primary)
  );
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

function discoveryActionRows(userId: string, candidates: DiscoveryCandidate[]): ActionRowBuilder<ButtonBuilder>[] {
  return discoveryVaultButtons(userId, candidates);
}

async function discoverCandidatesForUser(userId: string, focus: string | null, count: number): Promise<{
  chases: Chase[];
  settings: ReturnType<typeof getUserAlertSettings>;
  hasFullDiscovery: boolean;
  hasLearnedProfile: boolean;
  lane: string;
  priceRange: { min: number; max: number; label: string } | undefined;
  candidates: DiscoveryCandidate[];
}> {
  const chases = listChases(userId);
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const entitlements = getEntitlementsForTier(plan.tier);
  const hasFullDiscovery = plan.status === 'ACTIVE' && entitlements.discoveryDepth === 'full';
  const hasLearnedProfile = hasFullDiscovery && chases.length >= MIN_LEARNED_PROFILE_CHASES;
  const selection = selectDiscoverySuggestions(focus, chases, DISCOVERY_CANDIDATE_POOL_SIZE);
  const priceRange = hasLearnedProfile ? priceRangeFromChases(chases) : undefined;
  const destination = settings.shippingCountry
    ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode }
    : undefined;
  const enriched = await Promise.all(
    selection.suggestions.map((suggestion, index) =>
      enrichSuggestion(suggestion, index, userId, destination, priceRange, settings.alertCurrency)
    )
  );
  return {
    chases,
    settings,
    hasFullDiscovery,
    hasLearnedProfile,
    lane: selection.lane,
    priceRange,
    candidates: selectVisibleCandidates(enriched, focus).slice(0, count)
  };
}

export async function buildWeeklyDiscoveryPathPayload(userId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> {
  const discovery = await discoverCandidatesForUser(userId, null, 1);
  const [candidate] = discovery.candidates;
  if (!candidate) return null;
  const intro = new EmbedBuilder()
    .setColor(DISCOVERY_OVERVIEW_COLOR)
    .setTitle('✨ Taste Profile Discovery')
    .setDescription('Vaultr found one card your taste profile may want to remember this week.')
    .setFooter({ text: 'Vaultr • Taste profile' })
    .setTimestamp();
  return {
    embeds: [intro, discoveryEmbed(candidate, discovery.settings.alertCurrency)],
    components: discoveryActionRows(userId, [candidate])
  };
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
    const discovery = await discoverCandidatesForUser(interaction.user.id, focus, VISIBLE_DISCOVERY_COUNT);
    const visibleCandidates = discovery.candidates;
    const visibleLanes = uniqueValuesPreservingOrder(visibleCandidates.map((candidate) => titleCase(candidate.suggestion.lane)));
    const title = focus ? `✨ Vaultr Discovery · ${focus}` : '✨ Vaultr Discovery';
    const laneSummary = visibleLanes.length > 0 ? visibleLanes.join(', ') : 'No raw-market-ready lanes right now';
    const lines = [
      `**Collector Profile:** ${learningSignal(focus, discovery.chases, discovery.lane, discovery.hasFullDiscovery, discovery.hasLearnedProfile)}`,
      `**Today’s Finds:** ${laneSummary}`,
      `**Spend Feel:** ${priceRangeSummary(discovery.priceRange, discovery.settings.alertCurrency, discovery.hasFullDiscovery, discovery.hasLearnedProfile)}`
    ];
    const overviewEmbed = infoEmbed(title, lines.join('\n')).setColor(DISCOVERY_OVERVIEW_COLOR).setFooter({ text: 'Vaultr • Discovery profile' });

    await interaction.editReply({
      embeds: [
        overviewEmbed,
        ...visibleCandidates.map((candidate) => discoveryEmbed(candidate, discovery.settings.alertCurrency))
      ],
      components: discoveryActionRows(interaction.user.id, visibleCandidates)
    });
  }
};

export async function handleDiscoveryVaultAdd(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_VAULT_PREFIX}:`)) return false;

  const [, ownerUserId, token] = interaction.customId.split(':');
  if (!ownerUserId || !token) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can add this discovery to their Vault.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Discovery Expired', 'Run `/discover` again for fresh cards to add to your Vault.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const existingChases = listChases(interaction.user.id);
  if (existingChases.some((chase) => normalize(chase.cardName) === normalize(pick.cardName))) {
    await interaction.reply({
      embeds: [warningEmbed('Already In Your Vault', `**${pick.cardName}** is already an active chase.`)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const plan = getUserPlan(interaction.user.id);
  const currentCount = countUserChases(interaction.user.id);
  const maxChases = PLAN_LIMITS[plan.tier].maxActiveChases;
  if (currentCount >= maxChases) {
    await interaction.reply({
      embeds: [warningEmbed('Plan Limit Reached', `You have reached your ${plan.tier} limit of ${maxChases} active chases. Remove one with /chase remove or run /upgrade.`)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const chase = addChase({
    userId: interaction.user.id,
    guildId: interaction.guildId ?? undefined,
    cardName: pick.cardName,
    priority: 'NORMAL',
    maxPrice: pick.maxPrice,
    grade: 'UNGRADED',
    listingType: 'ANY',
    negativeKeywords: DEFAULT_NEGATIVE_KEYWORDS
  });

  const lines = [
    `**Card:** ${chase.cardName}`,
    `**Lane:** ${titleCase(pick.lane)}`,
    `**Max Price:** ${chase.maxPrice ?? 'Any'}`,
    `**Grade:** Ungraded`,
    '',
    '**Next:** Use `/chase list` to review your Vault entries'
  ];

  await interaction.reply({
    embeds: [successEmbed('Added To Vault', lines.join('\n'))],
    flags: MessageFlags.Ephemeral
  });
  return true;
}
