import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import {
  addChase,
  countUserChases,
  createDiscoveryVaultAction,
  deleteExpiredDiscoveryVaultActions,
  getDiscoveryVaultAction,
  getUserAlertSettings,
  getUserPlan,
  listChases,
  listRecentUserDiscoveryFeedback,
  listUserTasteMemoryChases,
  markUserDiscoverySuggestionsSeen,
  recordDiscoveryFeedback,
  recordDiscoveryAddTaste
} from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestionsForFocuses, type DiscoveryMode, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import { getOrFetchDiscoveryReferenceImage } from '../services/discovery-reference-cache.js';
import { resolveSourceBackedDiscoveryCards } from '../services/discovery-source-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import type { Chase, Listing } from '../types.js';

export type DiscoveryCandidate = {
  suggestion: DiscoverySuggestion;
  listing?: Listing;
  image?: DiscoveryCardImage;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  displayCurrency?: SupportedCurrency;
  selectionIndex?: number;
  sourceStatus?: 'PENDING' | 'RATE_LIMITED' | 'TIMEOUT' | 'ERROR';
};

type DiscoveryCardImage = {
  name: string;
  url: string;
  sourceName?: string;
  sourceCardId?: string;
  sourceKind: 'CARD_REFERENCE' | 'MARKET_LISTING';
};

type DiscoveryActionItem = {
  candidate: DiscoveryCandidate;
  token: string;
  index: number;
};

type DiscoveryActionRow = ActionRowBuilder<StringSelectMenuBuilder>;
type DiscoveryPick = NonNullable<ReturnType<typeof getDiscoveryVaultAction>>;
type DiscoveryFeedbackAction = 'MORE_LIKE_THIS' | 'NOT_FOR_ME';

const MIN_LEARNED_PROFILE_CHASES = 6;
const VISIBLE_DISCOVERY_COUNT = 3;
const DISCOVERY_CANDIDATE_POOL_SIZE = 16;
const DISCOVERY_SOURCE_PARENT_BATCH_SIZE = 6;
const DISCOVERY_SOURCE_CARD_LIMIT_PER_PARENT = 4;
const DISCOVERY_ENRICHMENT_CONCURRENCY = 6;
const DISCOVERY_SOURCE_OVERFETCH_MULTIPLIER = 3;
const DISCOVERY_REFERENCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
const DISCOVERY_FEEDBACK_PREFIX = 'discover-feedback';
const DISCOVERY_SELECT_PREFIX = 'discover-action';
const DISCOVERY_VAULT_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];
const PROFILE_SUBJECT_STOP_WORDS = new Set([
  'black',
  'card',
  'cards',
  'collection',
  'corocoro',
  'ex',
  'gx',
  'holo',
  'illustration',
  'japanese',
  'lp',
  'mega',
  'mp',
  'nm',
  'pokemon',
  'promo',
  'promos',
  'raw',
  'shining',
  'special',
  'star',
  'the',
  'trading',
  'v',
  'vmax',
  'vstar',
  'with'
]);
const JAPANESE_PROMO_CODE_PATTERN = /\b(?:\d{1,3}\s*\/\s*(?:XY|SM|S|SV)-P|(?:XY|SM|S|SV)-P\s*-?\s*\d{1,3})\b/i;
const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const JAPANESE_RELEASE_MARKER_PATTERN = /\b(?:coro\s?coro|vending|masaki|munch|poncho|battle\s*festa|players?\s+club|fan\s+club|trainers?\s+magazine|yu\s?nagaba|precious\s+collector|kanazawa|yokohama|sapporo|pokemon\s+center)\b/i;
const BARE_COLLECTOR_NUMBER_PATTERN = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/;

const DISCOVERY_MODE_LABELS: Record<DiscoveryMode, string> = {
  similar: 'Close Match',
  adjacent: 'Side Quest',
  wildcard: 'Deep Cut',
  budget: 'Smart Value'
};

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
  activeChases: Chase[],
  tasteProfileChases: Chase[],
  lane: string,
  hasFullDiscovery: boolean,
  hasLearnedProfile: boolean
): string {
  const rememberedTasteCount = Math.max(0, tasteProfileChases.length - activeChases.length);
  if (activeChases.length === 0 && rememberedTasteCount > 0) {
    return `Discovery is remembering cards you interacted with; active chases will sharpen the current hunt`;
  }
  if (activeChases.length === 0) return 'add a few chases to shape Discovery';
  const promoSignal = hasPromoLeaningDiscoveryProfile(tasteProfileChases) ? '; promo and special-release signal emerging' : '';
  const memoryNote = rememberedTasteCount > 0 ? ' plus remembered interactions' : '';
  if (hasLearnedProfile) {
    const signals = tasteSignalsFromChases(tasteProfileChases, lane).filter((signal) => signal !== lane);
    const signalNote = signals.length > 0 ? `; ${signals.join(', ')}` : '';
    return `Discovery is blending your active chases${memoryNote} with recent finds${signalNote}`;
  }
  if (hasFullDiscovery) return `your Discovery profile is taking shape from active chases${memoryNote}${promoSignal}`;
  return `early read from your active chases${memoryNote}${promoSignal}`;
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

function discoveryNameKey(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function chaseSignalWeight(chase: Chase): number {
  if (chase.tasteWeight !== undefined) return chase.tasteWeight;
  if (chase.priority === 'GRAIL') return 2.4;
  if (chase.priority === 'HIGH') return 1.6;
  return 1;
}

function hasJapaneseChaseSignal(chase: Chase): boolean {
  const text = [chase.cardName, chase.targetNote].filter(Boolean).join(' ');
  if (/\b(japanese|japan|jp|jpn)\b/i.test(text) || JAPANESE_PROMO_CODE_PATTERN.test(text) || JAPANESE_SCRIPT_PATTERN.test(text) || JAPANESE_RELEASE_MARKER_PATTERN.test(text)) {
    return true;
  }
  const collectorNumber = BARE_COLLECTOR_NUMBER_PATTERN.exec(chase.cardName);
  if (!collectorNumber) return false;
  const localNumber = Number(collectorNumber[1]);
  const setTotal = Number(collectorNumber[2]);
  return Number.isFinite(localNumber) && Number.isFinite(setTotal) && (setTotal <= 30 || (localNumber > setTotal && setTotal <= 200));
}

function japaneseSignalWeightRatio(chases: Chase[]): number {
  const totalWeight = chases.reduce((sum, chase) => sum + chaseSignalWeight(chase), 0);
  if (totalWeight <= 0) return 0;
  return chases.filter(hasJapaneseChaseSignal).reduce((sum, chase) => sum + chaseSignalWeight(chase), 0) / totalWeight;
}

function hasPriorityJapaneseChase(chases: Chase[]): boolean {
  return chases.some((chase) => hasJapaneseChaseSignal(chase) && (chase.priority === 'GRAIL' || chase.priority === 'HIGH' || chaseSignalWeight(chase) >= 1.6));
}

const ACTIVE_CHASE_ECHO_STOP_WORDS = new Set(['card', 'cards', 'holo', 'lp', 'mp', 'nm', 'mint', 'near', 'pokemon', 'raw', 'the', 'trading', 'with']);

function activeChaseEchoTokens(value: string): string[] {
  return normalizedTokens(value).filter((token) => token.length >= 2 && !ACTIVE_CHASE_ECHO_STOP_WORDS.has(token));
}

function compactIdentifier(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function activeChaseStrongIdentifiers(value: string): string[] {
  const identifiers = new Set<string>();
  for (const match of value.matchAll(/\b(?:[A-Z]{0,4}\d{1,3}\s*\/\s*\d{1,3}|(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}|H\d{1,2})\b/gi)) {
    identifiers.add(compactIdentifier(match[0]));
  }
  return [...identifiers];
}

function activeChaseWeakIdentifiers(value: string): string[] {
  const identifiers = new Set<string>();
  for (const match of value.matchAll(/\b([A-Z]{0,4}\d{1,3})\s*\/\s*\d{1,3}\b/gi)) {
    identifiers.add(compactIdentifier(match[1]));
  }
  return [...identifiers];
}

function suggestionEvidenceText(suggestion: DiscoverySuggestion): string {
  return [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
}

export function isActiveChaseEchoSuggestion(suggestion: DiscoverySuggestion, activeChases: Chase[]): boolean {
  const suggestionText = suggestionEvidenceText(suggestion);
  return isActiveChaseEchoText(suggestionText, activeChases);
}

export function isActiveChaseEchoText(text: string, activeChases: Chase[]): boolean {
  const compactSuggestionText = compactIdentifier(text);
  const suggestionTokens = new Set(activeChaseEchoTokens(text));

  return activeChases.some((chase) => {
    const chaseTokens = activeChaseEchoTokens(chase.cardName);
    const primaryToken = chaseTokens[0];
    const hasPrimaryToken = !!primaryToken && suggestionTokens.has(primaryToken);

    const strongIdentifiers = activeChaseStrongIdentifiers(chase.cardName);
    if (strongIdentifiers.length > 0 && strongIdentifiers.some((identifier) => compactSuggestionText.includes(identifier))) return true;

    const weakIdentifiers = activeChaseWeakIdentifiers(chase.cardName);
    if (hasPrimaryToken && weakIdentifiers.length > 0 && weakIdentifiers.some((identifier) => compactSuggestionText.includes(identifier))) return true;

    if (!hasPrimaryToken) return false;

    const matchedTokenCount = chaseTokens.filter((token) => suggestionTokens.has(token)).length;
    return chaseTokens.length >= 3 && matchedTokenCount >= Math.min(3, chaseTokens.length);
  });
}

function mergeActiveAndTasteMemoryChases(activeChases: Chase[], memoryChases: Chase[]): Chase[] {
  const activeNames = new Set(activeChases.map((chase) => normalize(chase.cardName)));
  const merged: Chase[] = activeChases.map((chase) => ({ ...chase, tasteSource: 'ACTIVE_CHASE' as const }));
  for (const memoryChase of memoryChases) {
    if (activeNames.has(normalize(memoryChase.cardName))) continue;
    merged.push(memoryChase);
  }
  return merged;
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

function includesAnyNonCardTerm(value: string): boolean {
  const normalized = normalize(value).replace(/\btoys\s*r\s*us\b/g, 'retail promo');
  return NON_CARD_TERMS.some((term) => normalized.includes(term));
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

  if (suggestion.lane.includes('discovery') && requiredTokens.length > 0 && looksLikeCardListing(listing)) return true;

  return candidateNames.some((name) => {
    const suggestionTokens = normalizedTokens(name).filter((token) => !['the', 'and', 'with', 'wearing'].includes(token));
    if (suggestionTokens.length === 0) return false;
    const matches = suggestionTokens.filter((token) => titleTokens.has(token) || compactTitle.includes(token.replace(/[^a-z0-9]+/g, '')));
    return matches.length / suggestionTokens.length >= 0.75;
  });
}

function looksLikeCardListing(listing: Listing): boolean {
  const title = normalize(listing.title);
  if (includesAnyNonCardTerm(title)) return false;
  return includesAnyTerm(title, CARD_TERMS);
}

function hasNonCardTerms(listing: Listing): boolean {
  return includesAnyNonCardTerm(listing.title);
}

function looksLikeDiscoveryCardListing(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  if (hasNonCardTerms(listing)) return false;
  return looksLikeCardListing(listing) || hasCoreSuggestionTokens(suggestion, listing);
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

export function isUsableDiscoveryExample(
  suggestion: DiscoverySuggestion,
  listing: Listing,
  range: { min: number; max: number } | undefined,
  targetCurrency: SupportedCurrency
): boolean {
  return (
    hasCoreSuggestionTokens(suggestion, listing) &&
    looksLikeDiscoveryCardListing(suggestion, listing) &&
    hasReliableSeller(listing) &&
    meetsPremiumFloor(suggestion, listing, targetCurrency) &&
    isListingInRange(listing, range, targetCurrency)
  );
}

function imageUrlFromListing(listing: Listing | undefined): string | undefined {
  const image = listing?.imageUrl ?? listing?.thumbnailUrl;
  return image && /^https?:\/\//i.test(image) ? image : undefined;
}

export function looksLikeVisualDiscoveryListing(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  return hasCoreSuggestionTokens(suggestion, listing) && looksLikeDiscoveryCardListing(suggestion, listing) && imageUrlFromListing(listing) !== undefined;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

export function isSourceBackedDiscoverySuggestion(suggestion: DiscoverySuggestion): boolean {
  return !!suggestion.referenceSourceCardId || !!suggestion.referenceImageUrl;
}

async function expandSourceBackedSuggestions(suggestions: DiscoverySuggestion[], activeChases: Chase[], tasteProfileChases: Chase[] = activeChases, desiredCount = VISIBLE_DISCOVERY_COUNT): Promise<DiscoverySuggestion[]> {
  const expanded: DiscoverySuggestion[] = [];
  const seenNames = new Set<string>();
  for (let start = 0; start < suggestions.length && expanded.length < desiredCount; start += DISCOVERY_SOURCE_PARENT_BATCH_SIZE) {
    const sourceParents = suggestions.slice(start, start + DISCOVERY_SOURCE_PARENT_BATCH_SIZE);
    const expandedGroups = await mapWithConcurrency(sourceParents, DISCOVERY_ENRICHMENT_CONCURRENCY, async (suggestion) => {
      const sourceBacked = await resolveSourceBackedDiscoveryCards(suggestion, activeChases, DISCOVERY_SOURCE_CARD_LIMIT_PER_PARENT, tasteProfileChases);
      return sourceBacked.suggestions;
    });
    for (const suggestion of expandedGroups.flat()) {
      if (!isSourceBackedDiscoverySuggestion(suggestion) || isActiveChaseEchoSuggestion(suggestion, activeChases)) continue;
      const nameKey = discoveryNameKey(suggestion.name);
      if (seenNames.has(nameKey)) continue;
      expanded.push(suggestion);
      seenNames.add(nameKey);
      if (expanded.length >= desiredCount) break;
    }
  }
  return expanded;
}

function formatMarketRead(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.sourceStatus === 'PENDING') return 'Market refresh queued; Vaultr will attach image and pricing once the source responds.';
  if (candidate.sourceStatus === 'RATE_LIMITED') return 'Market refresh is cooling down after an eBay throttle response; Vaultr will retry after backoff.';
  if (candidate.sourceStatus === 'TIMEOUT') return 'eBay did not answer in time; Vaultr will try this thread again after backoff.';
  if (candidate.typicalRawAskingTotal === undefined || candidate.marketSampleSize === undefined || candidate.marketSampleSize === 0) {
    return 'Market is thin right now; treat this as a thread to watch.';
  }
  return `${formatMoney(candidate.typicalRawAskingTotal, candidate.displayCurrency ?? currencyHint)} typical raw ask`;
}

async function attachReferenceImages(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  return mapWithConcurrency(candidates, VISIBLE_DISCOVERY_COUNT, async (candidate) => {
    if (candidate.image) return candidate;
    const reference = await getOrFetchDiscoveryReferenceImage(candidate.suggestion, DISCOVERY_REFERENCE_CACHE_TTL_MS);
    if (!reference?.imageUrl) return candidate;
    return {
      ...candidate,
      image: {
        name: candidate.suggestion.name,
        url: reference.imageUrl,
        sourceName: reference.sourceName,
        sourceCardId: reference.sourceCardId,
        sourceKind: 'CARD_REFERENCE'
      }
    };
  });
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
  const selectionIndex = candidate.selectionIndex ?? DISCOVERY_CANDIDATE_POOL_SIZE;
  const tasteOrderScore = Math.max(0, DISCOVERY_CANDIDATE_POOL_SIZE - selectionIndex) * 4;
  return tasteOrderScore + curiosity * 3 + marketSweetSpot + evidenceDepth;
}

function sourcePreferenceRankScore(candidate: DiscoveryCandidate, chases: Chase[] = []): number {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName ?? '';
  const suggestionText = [candidate.suggestion.name, candidate.suggestion.lane, candidate.suggestion.evidenceSearchTerm, ...(candidate.suggestion.requiredEvidenceTokens ?? [])].join(' ');
  const japaneseAffinity = japaneseSignalWeightRatio(chases);
  const priorityJapanese = hasPriorityJapaneseChase(chases);
  const hasJapaneseSource = /\btcgdex japanese\b/i.test(sourceName) || /\bjapanese\b/i.test(suggestionText);
  const isEnglishBlackStar = /\bblack star promos?\b/i.test([candidate.suggestion.name, sourceName].join(' '));
  const japaneseBoost = hasJapaneseSource ? Math.round(80 + japaneseAffinity * 80 + (priorityJapanese ? 80 : 0)) : 0;
  const blackStarPenalty = (japaneseAffinity >= 0.35 || priorityJapanese) && isEnglishBlackStar ? 90 : 0;
  return japaneseBoost + subjectProfileRankScore(candidate, chases) - blackStarPenalty;
}

function profileSubjectTokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PROFILE_SUBJECT_STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function subjectProfileRankScore(candidate: DiscoveryCandidate, chases: Chase[] = []): number {
  if (chases.length === 0) return 0;
  const tokenStats = new Map<string, { weight: number; support: number }>();
  for (const chase of chases) {
    const tokens = new Set(profileSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')));
    for (const token of tokens) {
      const existing = tokenStats.get(token) ?? { weight: 0, support: 0 };
      existing.weight += chaseSignalWeight(chase);
      existing.support += 1;
      tokenStats.set(token, existing);
    }
  }

  const candidateTokens = new Set(profileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' ')));
  let score = 0;
  for (const token of candidateTokens) {
    const stat = tokenStats.get(token);
    if (!stat) continue;
    score += stat.weight * 18 + Math.max(0, stat.support - 1) * 18;
  }
  return Math.min(140, Math.round(score));
}

function rankDiscoveryCandidatesForProfile(candidates: DiscoveryCandidate[], chases: Chase[] = []): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => {
    const sourceDelta = sourcePreferenceRankScore(right, chases) - sourcePreferenceRankScore(left, chases);
    return sourceDelta || curiosityRankScore(right) - curiosityRankScore(left);
  });
}

function tasteOnlyCandidate(suggestion: DiscoverySuggestion, selectionIndex: number): DiscoveryCandidate {
  const imageUrl = suggestion.referenceImageUrl;
  return {
    suggestion,
    selectionIndex,
    image: imageUrl
      ? {
          name: suggestion.name,
          url: imageUrl,
          sourceName: suggestion.referenceSourceName,
          sourceCardId: suggestion.referenceSourceCardId,
          sourceKind: 'CARD_REFERENCE'
        }
      : undefined
  };
}

function isJapaneseSourceSuggestion(suggestion: DiscoverySuggestion): boolean {
  return /\bjapanese\b/i.test([suggestion.name, suggestion.evidenceSearchTerm, suggestion.referenceSourceName, ...(suggestion.requiredEvidenceTokens ?? [])].filter(Boolean).join(' '));
}

function hasJapaneseWeightedProfile(chases: Chase[]): boolean {
  return japaneseSignalWeightRatio(chases) >= 0.35 || hasPriorityJapaneseChase(chases);
}

export function preserveLanguageSignalFallbackSuggestions(sourceBackedSuggestions: DiscoverySuggestion[], freshSuggestions: DiscoverySuggestion[], chases: Chase[]): DiscoverySuggestion[] {
  if (!hasJapaneseWeightedProfile(chases) || freshSuggestions.some(isJapaneseSourceSuggestion)) return freshSuggestions;
  const fallbackJapanese = sourceBackedSuggestions.find((suggestion) => isJapaneseSourceSuggestion(suggestion));
  if (!fallbackJapanese) return freshSuggestions;
  const freshNameKeys = new Set(freshSuggestions.map((suggestion) => discoveryNameKey(suggestion.name)));
  if (freshNameKeys.has(discoveryNameKey(fallbackJapanese.name))) return freshSuggestions;
  return [fallbackJapanese, ...freshSuggestions];
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

function resonanceText(candidate: DiscoveryCandidate): string {
  const text = [candidate.suggestion.name, candidate.suggestion.lane, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, ...(candidate.suggestion.sourceTasteTokens ?? []), ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
    .filter(Boolean)
    .join(' ');
  const normalized = normalize(text);
  const reasons: string[] = [];
  if (/\bjapanese\b|tcgdex japanese/.test(normalized)) reasons.push('Japanese release path: regional printings and set variants often collect differently from English runs.');
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalized)) reasons.push('e-reader era appeal: Expedition/Aquapolis/Skyridge-era cards sit in a distinct vintage collector lane.');
  if (/\bpromo|black star|special release\b/.test(normalized)) reasons.push('Promo/special-release angle: limited distribution and Black Star-style paths can create durable side quests.');
  if (/\billustration|\bart rare|\bsar\b|\bar\b|\bgallery\b|\bfull art\b/.test(normalized)) reasons.push('Display-card pull: illustration, gallery, full-art, or art-rare treatments tend to anchor binder pages.');
  if (/\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(normalized)) reasons.push('Collector format match: GX, VMAX, VSTAR, Tag Team, and Radiant-style cards form recognizable side collections.');

  const uniqueReasons = uniqueValuesPreservingOrder(reasons).slice(0, 3);
  if (uniqueReasons.length === 0) return 'Vaultr is following shared collector traits from your Vault and recent Discovery activity.';
  return uniqueReasons.join('\n');
}

function collectorTheme(candidate: DiscoveryCandidate): string {
  const requiredToken = candidate.suggestion.requiredEvidenceTokens?.[0];
  return [candidate.suggestion.lane, requiredToken].filter(Boolean).join(':');
}

function candidateSubjectKeys(candidate: DiscoveryCandidate): string[] {
  return profileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' '));
}

function isJapaneseDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  return /\bjapanese\b|\btcgdex japanese\b/i.test(
    [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
      .filter(Boolean)
      .join(' ')
  );
}

function takeDistinctThemes(candidates: DiscoveryCandidate[], chases: Chase[] = []): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const seenThemes = new Set<string>();
  const seenSubjects = new Set<string>();
  const japaneseAffinity = japaneseSignalWeightRatio(chases);
  const shouldLeaveRoomForNonJapanese = japaneseAffinity > 0 && japaneseAffinity < 0.85 && candidates.some((candidate) => !isJapaneseDiscoveryCandidate(candidate));
  const japaneseLimit = shouldLeaveRoomForNonJapanese ? Math.max(1, VISIBLE_DISCOVERY_COUNT - 1) : VISIBLE_DISCOVERY_COUNT;
  let japaneseCount = 0;
  for (const candidate of candidates) {
    const theme = collectorTheme(candidate);
    const subjectKeys = candidateSubjectKeys(candidate);
    if (seenThemes.has(theme)) continue;
    if (subjectKeys.some((subjectKey) => seenSubjects.has(subjectKey))) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    selected.push(candidate);
    seenThemes.add(theme);
    for (const subjectKey of subjectKeys) seenSubjects.add(subjectKey);
    if (isJapaneseDiscoveryCandidate(candidate)) japaneseCount += 1;
    if (selected.length >= VISIBLE_DISCOVERY_COUNT) break;
  }
  return selected;
}

export function selectVisibleCandidates(candidates: DiscoveryCandidate[], chases: Chase[] = []): DiscoveryCandidate[] {
  const strongRawData = rankDiscoveryCandidatesForProfile(candidates.filter(hasEnoughRawMarketData), chases);
  const partialRawData = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases);
  return takeDistinctThemes([...strongRawData, ...partialRawData, ...tasteRankedFallback], chases);
}

export function discoveryEmbed(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency, includeMarketRead: boolean, displayIndex?: number): EmbedBuilder {
  const tone = discoveryVisualTone(candidate.suggestion.lane);
  const prefix = displayIndex === undefined ? tone.icon : `${displayIndex}. ${tone.icon}`;
  const title = `${prefix} ${truncateValue(candidate.suggestion.name, 220)}`;
  const embed = new EmbedBuilder().setColor(tone.color).setTitle(title);
  const nearby = candidate.suggestion.nearby.slice(0, 3).map((name) => `• ${name}`).join('\n');
  const fields = [
    { name: 'Why It Resonates', value: resonanceText(candidate), inline: false },
    ...(includeMarketRead ? [{ name: 'Market Read', value: formatMarketRead(candidate, currencyHint), inline: true }] : []),
    { name: 'Next Threads', value: nearby || 'Vaultr will widen this thread as the catalog grows.', inline: false }
  ];

  if (candidate.image) embed.setThumbnail(candidate.image.url);

  embed
    .setDescription(`**${titleCase(candidate.suggestion.lane)}**${candidate.listing?.url ? `\n${markdownLink('Open example listing', candidate.listing.url)}` : ''}`)
    .addFields(...fields)
    .setFooter({ text: 'Vaultr • Discovery' })
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

function createDiscoveryActionItems(userId: string, candidates: DiscoveryCandidate[]): DiscoveryActionItem[] {
  return candidates.slice(0, 3).map((candidate, index) => ({ candidate, token: createDiscoveryVaultButtonToken(userId, candidate), index: index + 1 }));
}

function discoveryActionLabel(action: 'ADD' | DiscoveryFeedbackAction, index: number, cardName: string): string {
  if (action === 'ADD') return truncateValue(`Add ${index}: ${cardName}`, 100);
  if (action === 'MORE_LIKE_THIS') return truncateValue(`More like ${index}: ${cardName}`, 100);
  return truncateValue(`Not for me ${index}: ${cardName}`, 100);
}

export function discoveryActionRows(userId: string, candidates: DiscoveryCandidate[]): DiscoveryActionRow[] {
  const actionItems = createDiscoveryActionItems(userId, candidates);
  if (actionItems.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${DISCOVERY_SELECT_PREFIX}:${userId}`)
    .setPlaceholder('Choose a Discovery action')
    .setMinValues(1)
    .setMaxValues(1);

  const options = actionItems.flatMap(({ candidate, token, index }) => [
    new StringSelectMenuOptionBuilder()
      .setLabel(discoveryActionLabel('ADD', index, candidate.suggestion.name))
      .setDescription('Add this card to your Vault')
      .setValue(`ADD:${token}`),
    new StringSelectMenuOptionBuilder()
      .setLabel(discoveryActionLabel('MORE_LIKE_THIS', index, candidate.suggestion.name))
      .setDescription('Save this as a taste signal')
      .setValue(`MORE_LIKE_THIS:${token}`),
    new StringSelectMenuOptionBuilder()
      .setLabel(discoveryActionLabel('NOT_FOR_ME', index, candidate.suggestion.name))
      .setDescription('Steer Discovery away from this thread')
      .setValue(`NOT_FOR_ME:${token}`)
  ]);

  menu.addOptions(...options);
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function mergeFreshDiscoveryCandidates(candidates: DiscoveryCandidate[], fallbackCandidates: DiscoveryCandidate[], recentlySeenNames: string[], count: number): DiscoveryCandidate[] {
  const candidateNames = new Set(candidates.map((candidate) => discoveryNameKey(candidate.suggestion.name)));
  const recentlySeenNameKeys = new Set(recentlySeenNames.map(discoveryNameKey));
  const mergedCandidates = [...candidates];
  for (const candidate of fallbackCandidates) {
    const candidateNameKey = discoveryNameKey(candidate.suggestion.name);
    if (candidateNames.has(candidateNameKey) || recentlySeenNameKeys.has(candidateNameKey)) continue;
    mergedCandidates.push(candidate);
    candidateNames.add(candidateNameKey);
    if (mergedCandidates.length >= count) break;
  }
  return mergedCandidates;
}

async function discoverCandidatesForUser(userId: string, count: number, mode: DiscoveryMode = 'similar'): Promise<{
  chases: Chase[];
  tasteProfileChases: Chase[];
  settings: ReturnType<typeof getUserAlertSettings>;
  hasFullDiscovery: boolean;
  hasLearnedProfile: boolean;
  lane: string;
  priceRange: { min: number; max: number; label: string } | undefined;
  candidates: DiscoveryCandidate[];
}> {
  const chases = listChases(userId);
  const tasteMemoryChases = listUserTasteMemoryChases(userId);
  const tasteProfileChases = mergeActiveAndTasteMemoryChases(chases, tasteMemoryChases);
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const hasFullDiscovery = entitlements.discoveryDepth === 'full';
  const hasLearnedProfile = hasFullDiscovery && tasteProfileChases.length >= MIN_LEARNED_PROFILE_CHASES;
  const recentlyRejected = listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME');
  const rejectedNames = recentlyRejected.map((item) => item.suggestionName);
  const rejectedLanes = uniqueValuesPreservingOrder(recentlyRejected.map((item) => item.lane).filter(Boolean));
  const priceRange = hasLearnedProfile ? priceRangeFromChases(tasteProfileChases) : undefined;
  const selectAndEnrich = async () => {
    const combinedExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const combinedSourceExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const selection = selectDiscoverySuggestionsForFocuses([], tasteProfileChases, DISCOVERY_CANDIDATE_POOL_SIZE, {
      excludedNames: combinedExcludedNames,
      excludedLanes: rejectedLanes,
      excludeLanesForExcludedNames: combinedExcludedNames.length > 0,
      mode
    });
    const activeSafeSuggestions = selection.suggestions.filter((suggestion) => !isActiveChaseEchoSuggestion(suggestion, chases));
    const sourceBackedSuggestions = await expandSourceBackedSuggestions(activeSafeSuggestions, chases, tasteProfileChases, count * DISCOVERY_SOURCE_OVERFETCH_MULTIPLIER);
    const excludedSourceNameKeys = new Set(combinedSourceExcludedNames.map(discoveryNameKey));
    const freshSourceBackedSuggestions = sourceBackedSuggestions.filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name)));
    const enriched = freshSourceBackedSuggestions.map((suggestion, index) => tasteOnlyCandidate(suggestion, index));
    const candidates = await attachReferenceImages(selectVisibleCandidates(enriched, tasteProfileChases).slice(0, count));
    return {
      lane: selection.lane,
      candidates
    };
  };
  const preferred = await selectAndEnrich();
  let lane = preferred.lane;
  let candidates = preferred.candidates;
  return {
    chases,
    tasteProfileChases,
    settings,
    hasFullDiscovery,
    hasLearnedProfile,
    lane,
    priceRange,
    candidates
  };
}

export async function buildWeeklyDiscoveryPathPayload(userId: string): Promise<{
  embeds: EmbedBuilder[];
  components: DiscoveryActionRow[];
} | null> {
  const discovery = await discoverCandidatesForUser(userId, 1);
  if (discovery.tasteProfileChases.length === 0) return null;
  const [candidate] = discovery.candidates;
  if (!candidate) return null;
  markUserDiscoverySuggestionsSeen(userId, [candidate.suggestion.name]);
  return {
    embeds: [discoveryEmbed(candidate, discovery.settings.alertCurrency, false)],
    components: discoveryActionRows(userId, [candidate])
  };
}

export const discover = {
  data: new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Open Vaultr Discovery from your developing taste profile')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Choose how far Discovery should wander from your taste profile')
        .addChoices(
          { name: 'Close Match', value: 'similar' },
          { name: 'Side Quest', value: 'adjacent' },
          { name: 'Deep Cut', value: 'wildcard' },
          { name: 'Smart Value', value: 'budget' }
        )
    ),
  async execute(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const mode = (interaction.options.getString('mode') ?? 'similar') as DiscoveryMode;
    const discovery = await discoverCandidatesForUser(interaction.user.id, VISIBLE_DISCOVERY_COUNT, mode);
    const visibleCandidates = discovery.candidates;
    markUserDiscoverySuggestionsSeen(interaction.user.id, visibleCandidates.map((candidate) => candidate.suggestion.name));
    const visibleFinds = visibleCandidates.map((candidate) => candidate.suggestion.name);
    const title = '✨ Vaultr Discovery';
    const findSummary = visibleFinds.length > 0 ? visibleFinds.map((name) => truncateValue(name, 80)).join(', ') : 'No source-backed card matches right now';
    const lines = [
      `**Mode:** ${DISCOVERY_MODE_LABELS[mode]}`,
      `**Collector Profile:** ${learningSignal(
        discovery.chases,
        discovery.tasteProfileChases,
        discovery.lane,
        discovery.hasFullDiscovery,
        discovery.hasLearnedProfile
      )}`,
      `**Today’s Finds:** ${findSummary}`,
      `**Spend Feel:** ${priceRangeSummary(discovery.priceRange, discovery.settings.alertCurrency, discovery.hasFullDiscovery, discovery.hasLearnedProfile)}`
    ];
    if (!discovery.hasFullDiscovery) {
      lines.push('**Pro Adds:** deeper weekly Taste Profile paths and trusted shop monitoring.');
    }
    const overviewEmbed = infoEmbed(title, lines.join('\n')).setColor(DISCOVERY_OVERVIEW_COLOR).setFooter({ text: 'Vaultr • Discovery profile' });

    await interaction.editReply({
      embeds: [
        overviewEmbed,
        ...visibleCandidates.map((candidate, index) => discoveryEmbed(candidate, discovery.settings.alertCurrency, false, index + 1))
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
  await replyToDiscoveryVaultAdd(interaction, pick);
  return true;
}

async function replyToDiscoveryVaultAdd(interaction: any, pick: DiscoveryPick | null): Promise<void> {
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Discovery Expired', 'Run `/discover` again for fresh cards to add to your Vault.')],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existingChases = listChases(interaction.user.id);
  if (existingChases.some((chase) => normalize(chase.cardName) === normalize(pick.cardName))) {
    await interaction.reply({
      embeds: [warningEmbed('Already In Your Vault', `**${pick.cardName}** is already an active chase.`)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const plan = getUserPlan(interaction.user.id);
  const activeTier = activePlanTier(plan);
  const currentCount = countUserChases(interaction.user.id);
  const maxChases = PLAN_LIMITS[activeTier].maxActiveChases;
  if (currentCount >= maxChases) {
    const message =
      activeTier === 'PRO'
        ? `You have reached your Pro limit of ${maxChases} active chases. Remove one with /chase remove before adding another.`
        : `Free Vaults can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. Pro expands your Vault to ${PLAN_LIMITS.PRO.maxActiveChases} chases plus trusted shop monitoring. Remove one with /chase remove or run /upgrade.`;
    await interaction.reply({
      embeds: [warningEmbed('Vault Limit Reached', message)],
      flags: MessageFlags.Ephemeral
    });
    return;
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
  recordDiscoveryAddTaste(interaction.user.id, chase.cardName, chase.maxPrice);

  const lines = [
    `**Card:** ${chase.cardName}`,
    `**Thread:** ${titleCase(pick.lane)}`,
    `**Max Price:** ${chase.maxPrice ?? 'Any'}`,
    `**Grade:** Ungraded`,
    '',
    '**Next:** Use `/chase list` to review your Vault entries'
  ];

  await interaction.reply({
    embeds: [successEmbed('Added To Vault', lines.join('\n'))],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleDiscoveryFeedback(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_FEEDBACK_PREFIX}:`)) return false;

  const [, ownerUserId, token, feedback] = interaction.customId.split(':');
  if (!ownerUserId || !token || (feedback !== 'MORE_LIKE_THIS' && feedback !== 'NOT_FOR_ME')) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can tune this Discovery path.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  await replyToDiscoveryFeedback(interaction, pick, feedback);
  return true;
}

async function replyToDiscoveryFeedback(interaction: any, pick: DiscoveryPick | null, feedback: DiscoveryFeedbackAction): Promise<void> {
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Discovery Expired', 'Run `/discover` again for fresh cards to tune.')],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  recordDiscoveryFeedback({
    userId: interaction.user.id,
    cardName: pick.cardName,
    lane: pick.lane,
    feedback,
    maxPrice: pick.maxPrice
  });

  const title = feedback === 'MORE_LIKE_THIS' ? 'Taste Saved' : 'Discovery Tuned';
  const message =
    feedback === 'MORE_LIKE_THIS'
      ? `Vaultr will treat **${pick.cardName}** as a stronger taste signal.`
      : `Vaultr will steer away from **${pick.cardName}** and its thread for now.`;

  await interaction.reply({
    embeds: [successEmbed(title, message)],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleDiscoveryActionSelect(interaction: any): Promise<boolean> {
  if (!interaction.isStringSelectMenu()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_SELECT_PREFIX}:`)) return false;

  const [, ownerUserId] = interaction.customId.split(':');
  const [rawValue] = interaction.values ?? [];
  const [action, token] = String(rawValue ?? '').split(':');
  if (!ownerUserId || !token || (action !== 'ADD' && action !== 'MORE_LIKE_THIS' && action !== 'NOT_FOR_ME')) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can use this Discovery menu.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (action === 'ADD') {
    await replyToDiscoveryVaultAdd(interaction, pick);
  } else {
    await replyToDiscoveryFeedback(interaction, pick, action);
  }
  return true;
}
