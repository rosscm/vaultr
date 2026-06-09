import { createHash, randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  getUserDiscoveryState,
  getUserAlertSettings,
  getUserPlan,
  listChases,
  listRecentUserDiscoveryFeedback,
  listRecentUserDiscoverySeenNames,
  listUserTasteMemoryChases,
  markUserDiscoverySuggestionsSeen,
  recordDiscoveryFeedback,
  recordDiscoveryAddTaste,
  upsertUserDiscoveryState
} from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { searchEbayListings, searchEbaySoldListings } from '../services/ebay.js';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestionsForFocuses, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import {
  discoveryMarketCacheKey,
  getDiscoveryMarketCache,
  listingFromDiscoveryMarketCache,
  upsertDiscoveryMarketCache,
  type DiscoveryMarketCacheEntry
} from '../services/discovery-market-cache.js';
import { getOrFetchDiscoveryReferenceImage } from '../services/discovery-reference-cache.js';
import { resolveSourceBackedDiscoveryCards } from '../services/discovery-source-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanChases, activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import type { Chase, Listing, PlanTier } from '../types.js';

export type DiscoveryCandidate = {
  suggestion: DiscoverySuggestion;
  listing?: Listing;
  image?: DiscoveryCardImage;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  typicalRawSoldTotal?: number;
  soldSampleSize?: number;
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

type DiscoveryActionRow = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;
type DiscoveryPick = NonNullable<ReturnType<typeof getDiscoveryVaultAction>>;
type DiscoveryFeedbackAction = 'MORE_LIKE_THIS' | 'NOT_FOR_ME';

const MIN_LEARNED_PROFILE_CHASES = 6;
const VISIBLE_DISCOVERY_COUNT = 7;
const DISCOVERY_CANDIDATE_POOL_SIZE = 24;
const DISCOVERY_ENRICHMENT_CONCURRENCY = 4;
const DISCOVERY_BACKGROUND_ENRICHMENT_CONCURRENCY = 1;
const DISCOVERY_SOURCE_TIMEOUT_MS = 30000;
const DISCOVERY_MARKET_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DISCOVERY_REFERENCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISCOVERY_SOURCE_STATUS_RETRY_MS = 15 * 60 * 1000;
const MIN_RAW_MARKET_SAMPLE_SIZE = 2;
const NON_CARD_TERMS = [
  'acrylic case',
  'booster',
  'box',
  'coin',
  'custom',
  'deck box',
  'display case',
  'figure',
  'figurine',
  'funko',
  'gold metal',
  'magnetic case',
  'magnetic holder',
  'keychain',
  'lot',
  'orica',
  'pack',
  'protector case',
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
const DISCOVERY_SELECTION_VERSION = 4;
const DISCOVERY_STATE_BASE_KEY = 'ambient';
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

export function discoveryVisibleCountForPlan(tier: PlanTier): number {
  return getEntitlementsForTier(tier).discoveryVisibleCards;
}

export function discoveryTasteProfileChases(chases: Chase[], tasteMemoryChases: Chase[], hasFullDiscovery: boolean): Chase[] {
  return hasFullDiscovery ? mergeActiveAndTasteMemoryChases(chases, tasteMemoryChases) : chases;
}

function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return 'Unknown';
  const roundedAmount = amount >= 10 ? Math.round(amount / 10) * 10 : Math.round(amount);
  return `${roundedAmount.toLocaleString('en-CA')} ${currency ?? ''}`.trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function discoveryTrailLabel(lane: string): string {
  const normalizedLane = normalize(lane);
  if (/japanese|language|region|vending|oddit/.test(normalizedLane)) return 'Japanese Collector Trail';
  if (/e[- ]?reader/.test(normalizedLane)) return 'E-Reader Era Trail';
  if (/vintage|era/.test(normalizedLane)) return 'Vintage Era Trail';
  if (/special|release-history/.test(normalizedLane)) return 'Special Release Trail';
  if (/promo|release-family|retail/.test(normalizedLane)) return 'Promo Trail';
  if (/illustration|art|gallery|visual|full art/.test(normalizedLane)) return 'Artwork Trail';
  if (/tag team|format|multi-card|gx|ex|v format|delta/.test(normalizedLane)) return 'Format Trail';
  if (/value|watch/.test(normalizedLane)) return 'Value Watch';
  return 'Collector Compass';
}

function discoveryCandidateTrailLabel(candidate: DiscoveryCandidate): string {
  const cardText = sourceCardText(candidate);
  if (hasJapaneseCardEvidence(normalize(cardText))) return 'Japanese Collector Trail';
  return discoveryTrailLabel(candidate.suggestion.lane);
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

function isActiveChaseEchoListing(listing: Listing, activeChases: Chase[]): boolean {
  return isActiveChaseEchoText([listing.title, listing.listingId].join(' '), activeChases);
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

export function looksLikeRawCardListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return !/\b(ace grading|beckett|bgs|cgc|gma|psa|sgc|tag graded)\b|\b(?:bgs|cgc|gma|psa|sgc)\s?-?(?:[0-9](?:\.[0-9])?|10)\b|\bgraded\b|\bslab(?:bed)?\b/.test(text);
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

function discoverySourceStatus(error: unknown): DiscoveryCandidate['sourceStatus'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate limit|quota|ratelimiter|exceeded the number of times/i.test(message)) return 'RATE_LIMITED';
  if (/timeout/i.test(message)) return 'TIMEOUT';
  return 'ERROR';
}

function cacheAgeMs(entry: DiscoveryMarketCacheEntry, nowMs = Date.now()): number {
  const fetchedAtMs = new Date(entry.fetchedAt).getTime();
  return Number.isFinite(fetchedAtMs) ? nowMs - fetchedAtMs : Number.POSITIVE_INFINITY;
}

function shouldRefreshDiscoveryMarketCache(entry: DiscoveryMarketCacheEntry | null, nowMs = Date.now()): boolean {
  if (!entry) return true;
  const ageMs = cacheAgeMs(entry, nowMs);
  if (entry.sourceStatus) return ageMs >= DISCOVERY_SOURCE_STATUS_RETRY_MS;
  return ageMs >= DISCOVERY_MARKET_CACHE_TTL_MS;
}

async function expandSourceBackedSuggestions(
  suggestions: DiscoverySuggestion[],
  activeChases: Chase[],
  tasteProfileChases: Chase[] = activeChases,
  targetCount = VISIBLE_DISCOVERY_COUNT,
  echoGuardChases: Chase[] = activeChases
): Promise<DiscoverySuggestion[]> {
  const expandedGroups = new Map<number, DiscoverySuggestion[]>();
  let nextIndex = 0;
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const targetPoolSize = Math.max(targetCount * 3, targetCount);
  const sourceParentLimit = Math.min(suggestions.length, Math.max(targetCount * 2, targetCount));
  const deadline = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve();
    }, DISCOVERY_SOURCE_TIMEOUT_MS);
  });
  const collectDistinct = (): DiscoverySuggestion[] => {
    const expanded: DiscoverySuggestion[] = [];
    const seenNames = new Set<string>();
    for (let index = 0; index < suggestions.length; index += 1) {
      const group = expandedGroups.get(index);
      if (!group) continue;
      for (const suggestion of group) {
        if (isActiveChaseEchoSuggestion(suggestion, echoGuardChases)) continue;
        const nameKey = discoveryNameKey(suggestion.name);
        if (seenNames.has(nameKey)) continue;
        expanded.push(suggestion);
        seenNames.add(nameKey);
        if (expanded.length >= targetPoolSize) return expanded;
      }
    }
    return expanded;
  };
  const worker = async () => {
    while (!timedOut && nextIndex < sourceParentLimit) {
      const index = nextIndex;
      const suggestion = suggestions[nextIndex];
      nextIndex += 1;
      const sourceBacked = await resolveSourceBackedDiscoveryCards(suggestion, activeChases, 12, tasteProfileChases);
      expandedGroups.set(index, sourceBacked.suggestions);
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(DISCOVERY_ENRICHMENT_CONCURRENCY, suggestions.length) }, worker)).catch(() => undefined);
  await Promise.race([workers, deadline]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (!timedOut && collectDistinct().length < targetCount) {
    await workers;
  }
  return collectDistinct();
}

function candidateFromCachedMarket(
  suggestion: DiscoverySuggestion,
  selectionIndex: number,
  cacheEntry: DiscoveryMarketCacheEntry | null,
  targetCurrency: SupportedCurrency,
  activeChases: Chase[] = [],
  refreshQueued = false
): DiscoveryCandidate {
  if (!cacheEntry) return { suggestion, selectionIndex, sourceStatus: 'PENDING' };
  const listing = listingFromDiscoveryMarketCache(cacheEntry);
  if (listing && isActiveChaseEchoListing(listing, activeChases)) return { suggestion, selectionIndex, sourceStatus: 'PENDING' };
  const hasMarketSignal =
    (cacheEntry.typicalRawSoldTotal !== undefined && (cacheEntry.soldSampleSize ?? 0) > 0) ||
    (cacheEntry.typicalRawAskingTotal !== undefined && (cacheEntry.marketSampleSize ?? 0) > 0);
  const sourceStatus = refreshQueued && (cacheEntry.sourceStatus || !hasMarketSignal) ? 'PENDING' : cacheEntry.sourceStatus;
  return {
    suggestion,
    selectionIndex,
    typicalRawAskingTotal: cacheEntry.typicalRawAskingTotal,
    marketSampleSize: cacheEntry.marketSampleSize,
    typicalRawSoldTotal: cacheEntry.typicalRawSoldTotal,
    soldSampleSize: cacheEntry.soldSampleSize,
    displayCurrency: cacheEntry.displayCurrency ?? targetCurrency,
    sourceStatus
  };
}

export function candidatesFromDiscoveryMarketCache(
  candidates: DiscoveryCandidate[],
  context: {
    userId: string;
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  }
): DiscoveryCandidate[] {
  const refreshJobs: DiscoveryMarketRefreshJob[] = [];
  const marketCandidates = candidates.map((candidate, visibleIndex) => {
    const selectionIndex = candidate.selectionIndex ?? visibleIndex;
    const cacheKey = discoveryMarketCacheKey(candidate.suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode);
    const cacheEntry = getDiscoveryMarketCache(cacheKey);
    const refreshQueued = shouldRefreshDiscoveryMarketCache(cacheEntry);
    if (refreshQueued) {
      refreshJobs.push({
        cacheKey,
        suggestion: candidate.suggestion,
        selectionIndex,
        userId: context.userId,
        activeChases: context.activeChases,
        destination: context.destination,
        range: context.range,
        targetCurrency: context.targetCurrency
      });
    }
    const marketCandidate = candidateFromCachedMarket(
      candidate.suggestion,
      selectionIndex,
      cacheEntry,
      context.targetCurrency,
      context.activeChases,
      refreshQueued
    );
    return {
      ...candidate,
      selectionIndex,
      typicalRawAskingTotal: marketCandidate.typicalRawAskingTotal,
      marketSampleSize: marketCandidate.marketSampleSize,
      typicalRawSoldTotal: marketCandidate.typicalRawSoldTotal,
      soldSampleSize: marketCandidate.soldSampleSize,
      displayCurrency: marketCandidate.displayCurrency ?? candidate.displayCurrency,
      sourceStatus: marketCandidate.sourceStatus
    };
  });
  queueDiscoveryMarketRefreshes(refreshJobs);
  return marketCandidates;
}

async function enrichSuggestion(
  suggestion: DiscoverySuggestion,
  selectionIndex: number,
  userId: string,
  activeChases: Chase[],
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
    const listings = await withTimeout(
      searchEbayListings(discoveryChase, destination, { enrichMissingShipping: false }),
      DISCOVERY_SOURCE_TIMEOUT_MS
    );
    const nonActiveListings = listings.filter((candidate) => !isActiveChaseEchoListing(candidate, activeChases));
    const usableListings = nonActiveListings.filter((candidate) => isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency));
    const rawListings = usableListings.filter(looksLikeRawCardListing);
    const baselineRawListings = usableListings.filter(
      (candidate) => looksLikeBaselineRawMarketListing(candidate) && meetsBaselineMarketCeiling(suggestion, candidate, targetCurrency)
    );
    const marketListing =
      baselineRawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      rawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      baselineRawListings[0] ??
      rawListings[0];
    const visualListing = nonActiveListings.find((candidate) => looksLikeVisualDiscoveryListing(suggestion, candidate));
    const listing = marketListing ?? visualListing;
    if (!listing) return { suggestion, selectionIndex };

    const totals = baselineRawListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    const typicalRawAskingTotal = typicalMarketTotal(totals);
    let soldTotals: number[] = [];
    try {
      const soldListings = await withTimeout(searchEbaySoldListings(discoveryChase, destination), DISCOVERY_SOURCE_TIMEOUT_MS);
      const usableSoldListings = soldListings
        .filter((candidate) => !isActiveChaseEchoListing(candidate, activeChases))
        .filter((candidate) => isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency))
        .filter((candidate) => looksLikeBaselineRawMarketListing(candidate) && meetsBaselineMarketCeiling(suggestion, candidate, targetCurrency));
      soldTotals = usableSoldListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    } catch {
      soldTotals = [];
    }
    const typicalRawSoldTotal = typicalMarketTotal(soldTotals);
    const imageUrl = imageUrlFromListing(listing);
    return {
      suggestion,
      selectionIndex,
      listing,
      image: imageUrl ? { name: suggestion.name, url: imageUrl, sourceName: 'eBay listing image', sourceKind: 'MARKET_LISTING' } : undefined,
      typicalRawAskingTotal,
      marketSampleSize: totals.length,
      typicalRawSoldTotal,
      soldSampleSize: soldTotals.length,
      displayCurrency: targetCurrency
    };
  } catch (error) {
    return { suggestion, selectionIndex, sourceStatus: discoverySourceStatus(error) };
  }
}

type DiscoveryMarketRefreshJob = {
  cacheKey: string;
  suggestion: DiscoverySuggestion;
  selectionIndex: number;
  userId: string;
  activeChases: Chase[];
  destination: { country?: string; postalCode?: string } | undefined;
  range: { min: number; max: number } | undefined;
  targetCurrency: SupportedCurrency;
};

const discoveryMarketRefreshQueue: DiscoveryMarketRefreshJob[] = [];
const queuedDiscoveryMarketRefreshKeys = new Set<string>();
let isDiscoveryMarketRefreshRunning = false;
let scheduledDiscoveryMarketRefreshTimer: NodeJS.Timeout | undefined;

function nextDiscoveryMarketRefreshDelayMs(): number {
  const backoffUntil = getPollerState().backoffUntil;
  if (!backoffUntil) return 0;
  const backoffUntilMs = new Date(backoffUntil).getTime();
  if (!Number.isFinite(backoffUntilMs)) return 0;
  return Math.max(0, backoffUntilMs - Date.now());
}

function saveDiscoveryMarketRefreshResult(job: DiscoveryMarketRefreshJob, candidate: DiscoveryCandidate): void {
  upsertDiscoveryMarketCache({
    cacheKey: job.cacheKey,
    suggestionName: job.suggestion.name,
    displayCurrency: job.targetCurrency,
    destinationCountry: job.destination?.country,
    listing: candidate.listing,
    imageUrl: candidate.image?.sourceKind === 'MARKET_LISTING' ? candidate.image.url : undefined,
    typicalRawAskingTotal: candidate.typicalRawAskingTotal,
    marketSampleSize: candidate.marketSampleSize,
    typicalRawSoldTotal: candidate.typicalRawSoldTotal,
    soldSampleSize: candidate.soldSampleSize,
    sourceStatus: candidate.sourceStatus === 'PENDING' ? undefined : candidate.sourceStatus
  });
}

function scheduleDiscoveryMarketRefreshQueue(): void {
  if (isDiscoveryMarketRefreshRunning || discoveryMarketRefreshQueue.length === 0) return;
  const delayMs = nextDiscoveryMarketRefreshDelayMs();
  if (delayMs > 0) {
    if (!scheduledDiscoveryMarketRefreshTimer) {
      scheduledDiscoveryMarketRefreshTimer = setTimeout(() => {
        scheduledDiscoveryMarketRefreshTimer = undefined;
        void runDiscoveryMarketRefreshQueue();
      }, Math.min(delayMs, DISCOVERY_SOURCE_STATUS_RETRY_MS));
    }
    return;
  }
  void runDiscoveryMarketRefreshQueue();
}

async function runDiscoveryMarketRefreshQueue(): Promise<void> {
  if (isDiscoveryMarketRefreshRunning) return;
  isDiscoveryMarketRefreshRunning = true;
  try {
    await mapWithConcurrency(discoveryMarketRefreshQueue.splice(0), DISCOVERY_BACKGROUND_ENRICHMENT_CONCURRENCY, async (job) => {
      try {
        const candidate = await enrichSuggestion(job.suggestion, job.selectionIndex, job.userId, job.activeChases, job.destination, job.range, job.targetCurrency);
        saveDiscoveryMarketRefreshResult(job, candidate);
      } catch (error) {
        saveDiscoveryMarketRefreshResult(job, { suggestion: job.suggestion, selectionIndex: job.selectionIndex, sourceStatus: discoverySourceStatus(error) });
      } finally {
        queuedDiscoveryMarketRefreshKeys.delete(job.cacheKey);
      }
    });
  } finally {
    isDiscoveryMarketRefreshRunning = false;
    if (discoveryMarketRefreshQueue.length > 0) scheduleDiscoveryMarketRefreshQueue();
  }
}

function queueDiscoveryMarketRefreshes(jobs: DiscoveryMarketRefreshJob[]): void {
  for (const job of jobs) {
    if (queuedDiscoveryMarketRefreshKeys.has(job.cacheKey)) continue;
    queuedDiscoveryMarketRefreshKeys.add(job.cacheKey);
    discoveryMarketRefreshQueue.push(job);
  }
  scheduleDiscoveryMarketRefreshQueue();
}

function formatMarketRead(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  if (candidate.sourceStatus === 'PENDING') {
    return candidate.image
      ? 'Market refresh queued; Vaultr will attach pricing once the source responds.'
      : 'Market refresh queued; Vaultr will attach image and pricing once the source responds.';
  }
  if (candidate.sourceStatus === 'RATE_LIMITED') return 'Market refresh is cooling down after an eBay throttle response; Vaultr will retry after backoff.';
  if (candidate.sourceStatus === 'TIMEOUT') return 'eBay did not answer in time; Vaultr will try this path again after backoff.';
  const currency = candidate.displayCurrency ?? currencyHint;
  const hasSoldComps = candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0;
  const hasAskComps = candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0;
  if (!hasSoldComps && !hasAskComps) {
    return 'Market is thin right now; treat this as a collecting path to watch.';
  }
  if (hasSoldComps && hasAskComps) {
    return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps); ${formatMoney(candidate.typicalRawAskingTotal, currency)} raw ask`;
  }
  if (hasSoldComps) return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps)`;
  return `${formatMoney(candidate.typicalRawAskingTotal, currency)} typical raw ask`;
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
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE)
  );
}

function hasSomeRawMarketData(candidate: DiscoveryCandidate): boolean {
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  );
}

function curiosityRankScore(candidate: DiscoveryCandidate): number {
  const curiosity = candidate.suggestion.curiosityScore ?? 0;
  const marketTotal = candidate.typicalRawSoldTotal ?? candidate.typicalRawAskingTotal ?? 0;
  const marketSweetSpot = marketTotal >= 35 && marketTotal <= 350 ? 3 : marketTotal > 0 ? 1 : 0;
  const evidenceDepth = Math.min(3, Math.max(candidate.soldSampleSize ?? 0, candidate.marketSampleSize ?? 0));
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

function rankDiscoveryCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => curiosityRankScore(right) - curiosityRankScore(left));
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
  if (/promo/.test(normalizedLane)) return { icon: '◆', color: DISCOVERY_LANE_COLOR, path: 'Promo path' };
  if (/gallery|character/.test(normalizedLane)) return { icon: '◆', color: DISCOVERY_LANE_COLOR, path: 'Character gallery' };
  if (/mythical|mew/.test(normalizedLane)) return { icon: '✧', color: DISCOVERY_LANE_COLOR, path: 'Mythical path' };
  return { icon: '◇', color: DISCOVERY_LANE_COLOR, path: 'Discovery path' };
}

function sourceSetLabel(candidate: DiscoveryCandidate): string | undefined {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName;
  const match = /\(([^)]+)\)/.exec(sourceName ?? '');
  return match?.[1];
}

function sourceCardSubject(candidate: DiscoveryCandidate, setLabel: string | undefined): string {
  let subject = candidate.suggestion.name;
  if (setLabel) subject = subject.replace(new RegExp(`\\s+${setLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), '');
  subject = subject
    .replace(/\b(?:special delivery|with grey felt hat|grey felt hat|felt hat|illustration collection|toys r us|staff|winner|prerelease)\b/gi, ' ')
    .replace(/\b(?:promo|promos|black star)\b/gi, ' ')
    .replace(/\s+Japanese\b.*$/i, '')
    .replace(/\s+\S*\d{1,4}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return subject || candidate.suggestion.name;
}

function sourceCardText(candidate: DiscoveryCandidate): string {
  return [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
    .filter(Boolean)
    .join(' ');
}

function hasJapaneseCardEvidence(normalizedCardText: string): boolean {
  return /\bjapanese\b|tcgdex japanese/.test(normalizedCardText);
}

const TASTE_SIGNAL_TRAIT_TOKENS = new Set([
  'art',
  'collector',
  'delta',
  'e-reader',
  'ex',
  'full',
  'gallery',
  'gx',
  'illustration',
  'japanese',
  'pokemon',
  'promo',
  'rare',
  'retail',
  'set',
  'small',
  'special',
  'tag',
  'team',
  'v',
  'vintage'
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardTextHasToken(normalizedCardText: string, token: string): boolean {
  const normalizedToken = normalize(token).trim();
  if (!normalizedToken || /^\d+$/.test(normalizedToken)) return false;
  const parts = normalizedToken.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (parts.length === 0) return false;
  const pattern = parts.join('[^a-z0-9]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(normalizedCardText);
}

function tasteSignalTokenLabels(tokens: string[], normalizedCardText: string): string[] {
  const normalizedTokens = tokens.map((token) => normalize(token).trim()).filter(Boolean);
  const identityLabels = normalizedTokens
    .filter((token) => token.length >= 3 && !TASTE_SIGNAL_TRAIT_TOKENS.has(token) && cardTextHasToken(normalizedCardText, token))
    .slice(0, 2)
    .map((token) => `${titleCase(token)} Family`);
  return identityLabels;
}

function tasteSignalText(candidate: DiscoveryCandidate): string {
  const cardText = sourceCardText(candidate);
  const normalizedCardText = normalize(cardText);
  const sourceTasteTokens = candidate.suggestion.sourceTasteTokens ?? [];
  const cardAndSourceText = normalizedCardText;
  const signals: string[] = [];

  signals.push(...tasteSignalTokenLabels(sourceTasteTokens, normalizedCardText));
  if (/\bpromo|black star|special release|limited release\b/.test(cardAndSourceText)) signals.push('Promo Releases');
  if (hasJapaneseCardEvidence(normalizedCardText)) signals.push('Japanese Prints');
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(cardAndSourceText)) signals.push('E-Reader Era');
  else if (/\bbase set\b|\bteam rocket\b|\bgym heroes\b|\bgym challenge\b|\bneo\b|\bwizards black star\b/.test(cardAndSourceText)) signals.push('Vintage Era');
  if (/\billustration|\bart rare|\bsar\b|\bar\b|\bgallery\b|\bfull art\b/.test(cardAndSourceText)) signals.push('Binder Art');
  if (/\btag team\b|\bgx\b/.test(cardAndSourceText)) signals.push('GX/Tag Team Format');
  else if (/\bex\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(cardAndSourceText)) signals.push('Card Format');

  const uniqueSignals = uniqueValuesPreservingOrder(signals).slice(0, 3);
  if (uniqueSignals.length === 0) return 'Profile Path';
  return uniqueSignals.join(' • ');
}

function resonanceText(candidate: DiscoveryCandidate): string {
  const cardText = sourceCardText(candidate);
  const normalizedCardText = normalize(cardText);
  const normalized = normalize([cardText, candidate.suggestion.lane, ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' '));
  const setLabel = sourceSetLabel(candidate);
  const subject = sourceCardSubject(candidate, setLabel);
  const sourceContext = setLabel ?? 'this print';
  const reasons: string[] = [];
  if (/\bspecial delivery\b/.test(normalizedCardText)) reasons.push(`A promo with a real release story: ${candidate.suggestion.name.split(/\s+SWSH Black Star/i)[0]} feels more like a collector milestone than a standard set filler.`);
  else if (/\bfelt hat\b/.test(normalizedCardText)) reasons.push(`A memorable promo story: the Felt Hat release gives ${subject} crossover appeal beyond the base promo set.`);
  else if (hasJapaneseCardEvidence(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a regional print to compare against English runs instead of another generic copy.`);
  else if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a concrete early-2000s set identity, so the card has a clearer collecting shape than a broad vintage search.`);
  else if (/\bpromo|black star|special release\b/.test(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a named release to track instead of a generic main-set copy.`);
  if (/\billustration|\bart rare|\bsar\b|\bar\b|\bgallery\b|\bfull art\b/.test(normalizedCardText)) reasons.push(`${subject} has art-led treatment that can stand on its own visually in a binder page.`);
  if (/\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(normalizedCardText)) reasons.push(`${subject} fits a recognizable side-collection format with a different collecting shape than your current Vault.`);
  if (reasons.length === 0 && /\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalized)) reasons.push('This gives your Vault an early-2000s print to compare by set texture, artwork, and binder feel.');

  const uniqueReasons = uniqueValuesPreservingOrder(reasons).slice(0, 3);
  if (uniqueReasons.length === 0) return `${subject} gives your Vault a nearby card to compare by artwork, set feel, and release story without being another copy of the same chase.`;
  return uniqueReasons.join('\n');
}

function collectorTheme(candidate: DiscoveryCandidate): string {
  const requiredToken = candidate.suggestion.requiredEvidenceTokens?.[0];
  return [candidate.suggestion.lane, requiredToken].filter(Boolean).join(':');
}

function candidateSubjectKeys(candidate: DiscoveryCandidate): string[] {
  return profileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' '));
}

function candidateSubjectBalanceKeys(candidate: DiscoveryCandidate): string[] {
  const subject = sourceCardSubject(candidate, sourceSetLabel(candidate));
  return profileSubjectTokens(subject).slice(0, 3);
}

function isJapaneseDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  return /\bjapanese\b|\btcgdex japanese\b/i.test(
    [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
      .filter(Boolean)
      .join(' ')
  );
}

function takeDistinctThemes(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = VISIBLE_DISCOVERY_COUNT): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const seenThemes = new Set<string>();
  const seenSubjects = new Set<string>();
  const seenNames = new Set<string>();
  const selectedTrailLabels = new Set<string>();
  const trailCounts = new Map<string, number>();
  const subjectCounts = new Map<string, number>();
  const japaneseAffinity = japaneseSignalWeightRatio(chases);
  const shouldLeaveRoomForNonJapanese = japaneseAffinity > 0 && japaneseAffinity < 0.85 && candidates.some((candidate) => !isJapaneseDiscoveryCandidate(candidate));
  const japaneseLimit = shouldLeaveRoomForNonJapanese ? Math.max(1, count - 1) : count;
  const trailLimit = Math.max(1, Math.ceil(count / 3));
  const subjectLimit = count >= 5 ? 2 : count;
  let japaneseCount = 0;
  const candidateSubjectIsUnderLimit = (candidate: DiscoveryCandidate): boolean => {
    const subjectKeys = candidateSubjectBalanceKeys(candidate);
    return subjectKeys.length === 0 || subjectKeys.every((subjectKey) => (subjectCounts.get(subjectKey) ?? 0) < subjectLimit);
  };
  const hasSubjectBalancedAlternative = (): boolean =>
    candidates.some((candidate) => !seenNames.has(discoveryNameKey(candidate.suggestion.name)) && candidateSubjectIsUnderLimit(candidate) && (!isJapaneseDiscoveryCandidate(candidate) || japaneseCount < japaneseLimit));
  const canUseCandidateSubject = (candidate: DiscoveryCandidate): boolean => candidateSubjectIsUnderLimit(candidate) || !hasSubjectBalancedAlternative();
  const pushCandidate = (candidate: DiscoveryCandidate): void => {
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    selected.push(candidate);
    seenNames.add(nameKey);
    trailCounts.set(trailLabel, (trailCounts.get(trailLabel) ?? 0) + 1);
    for (const subjectKey of candidateSubjectBalanceKeys(candidate)) subjectCounts.set(subjectKey, (subjectCounts.get(subjectKey) ?? 0) + 1);
    if (isJapaneseDiscoveryCandidate(candidate)) japaneseCount += 1;
  };
  for (const candidate of candidates) {
    const theme = collectorTheme(candidate);
    const subjectKeys = candidateSubjectKeys(candidate);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenThemes.has(theme)) continue;
    if (subjectKeys.some((subjectKey) => seenSubjects.has(subjectKey))) continue;
    if (selectedTrailLabels.has(trailLabel)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
    selectedTrailLabels.add(trailLabel);
    seenThemes.add(theme);
    for (const subjectKey of subjectKeys) seenSubjects.add(subjectKey);
    if (selected.length >= count) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenNames.has(nameKey) || selectedTrailLabels.has(trailLabel)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
    selectedTrailLabels.add(trailLabel);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenNames.has(nameKey)) continue;
    if ((trailCounts.get(trailLabel) ?? 0) >= trailLimit && candidates.some((other) => !seenNames.has(discoveryNameKey(other.suggestion.name)) && (trailCounts.get(discoveryCandidateTrailLabel(other)) ?? 0) < trailLimit)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    pushCandidate(candidate);
  }
  return selected;
}

export function selectVisibleCandidates(candidates: DiscoveryCandidate[], chases: Chase[] = []): DiscoveryCandidate[] {
  const strongRawData = rankDiscoveryCandidatesForProfile(candidates.filter(hasEnoughRawMarketData), chases);
  const partialRawData = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases);
  return takeDistinctThemes([...strongRawData, ...partialRawData, ...tasteRankedFallback], chases);
}

export function selectVisibleCandidatesForCount(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = VISIBLE_DISCOVERY_COUNT): DiscoveryCandidate[] {
  const strongRawData = rankDiscoveryCandidatesForProfile(candidates.filter(hasEnoughRawMarketData), chases);
  const partialRawData = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(candidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases);
  return takeDistinctThemes([...strongRawData, ...partialRawData, ...tasteRankedFallback], chases, count);
}

export function discoveryEmbed(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency, includeMarketRead: boolean, displayIndex?: number): EmbedBuilder {
  const tone = discoveryVisualTone(candidate.suggestion.lane);
  const title = displayIndex === undefined ? candidate.suggestion.name : `${displayIndex}. ${candidate.suggestion.name}`;
  const threadLabel = `${tone.icon} ${discoveryCandidateTrailLabel(candidate)}`;
  const embed = new EmbedBuilder().setColor(tone.color).setTitle(title);
  const fields = [
    { name: 'Why This Card', value: resonanceText(candidate), inline: false },
    { name: 'Taste Cue', value: tasteSignalText(candidate), inline: false },
    ...(includeMarketRead ? [{ name: 'Market Read', value: formatMarketRead(candidate, currencyHint), inline: true }] : [])
  ];

  if (candidate.image) embed.setThumbnail(candidate.image.url);
  if (candidate.listing?.url) embed.setURL(candidate.listing.url);

  embed
    .setDescription(threadLabel)
    .addFields(...fields)
    .setFooter({ text: 'Vaultr • Discovery' })
    .setTimestamp();
  return embed;
}

export function discoveryCardEmbeds(candidates: DiscoveryCandidate[], currencyHint: SupportedCurrency, hasFullDiscovery: boolean): EmbedBuilder[] {
  return candidates.map((candidate, index) => discoveryEmbed(candidate, currencyHint, hasFullDiscovery, index + 1));
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
  return candidates.map((candidate, index) => ({ candidate, token: createDiscoveryVaultButtonToken(userId, candidate), index: index + 1 }));
}

function discoveryVaultButtons(userId: string, actionItems: DiscoveryActionItem[]): ActionRowBuilder<ButtonBuilder>[] {
  if (actionItems.length === 0) return [];
  const buttons = actionItems.map(({ token, index }) =>
    new ButtonBuilder()
      .setCustomId(`${DISCOVERY_VAULT_PREFIX}:${userId}:${token}`)
      .setLabel(`Add ${index} to Vault`)
      .setStyle(ButtonStyle.Primary)
  );
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

function discoverySelectedActionRows(userId: string, token: string, includeFeedbackActions: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${DISCOVERY_VAULT_PREFIX}:${userId}:${token}`)
      .setLabel('Add to Vault')
      .setStyle(ButtonStyle.Primary)
  ];

  if (includeFeedbackActions) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${DISCOVERY_FEEDBACK_PREFIX}:${userId}:${token}:MORE_LIKE_THIS`)
        .setLabel('More like this')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DISCOVERY_FEEDBACK_PREFIX}:${userId}:${token}:NOT_FOR_ME`)
        .setLabel('Not for me')
        .setStyle(ButtonStyle.Danger)
    );
  }

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

export function discoveryActionRows(userId: string, candidates: DiscoveryCandidate[], includeFeedbackActions = false): DiscoveryActionRow[] {
  const actionItems = createDiscoveryActionItems(userId, candidates);
  if (actionItems.length === 0) return [];

  if (!includeFeedbackActions) return discoveryVaultButtons(userId, actionItems);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${DISCOVERY_SELECT_PREFIX}:${userId}`)
    .setPlaceholder('Choose a Discovery card')
    .setMinValues(1)
    .setMaxValues(1);

  const options = actionItems.map(({ candidate, token, index }) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateValue(`${index}. ${candidate.suggestion.name}`, 100))
      .setDescription('Open actions for this card')
      .setValue(token)
  );

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

function discoveryStateKey(tier: PlanTier, visibleCount: number): string {
  return `${DISCOVERY_STATE_BASE_KEY}:v${DISCOVERY_SELECTION_VERSION}:${tier.toLowerCase()}:${visibleCount}`;
}

function discoveryProfileFingerprint(tasteProfileChases: Chase[], rejectedNames: string[], tier: PlanTier, visibleCount: number): string {
  const profileInput = {
    discoverySelectionVersion: DISCOVERY_SELECTION_VERSION,
    tier,
    visibleCount,
    chases: tasteProfileChases.map((chase) => ({
      id: chase.id,
      cardName: chase.cardName,
      priority: chase.priority ?? 'NORMAL',
      targetNote: chase.targetNote ?? '',
      maxPrice: chase.maxPrice ?? null,
      tasteWeight: chase.tasteWeight ?? null,
      tasteSource: chase.tasteSource ?? 'ACTIVE_CHASE',
      createdAt: chase.createdAt
    })),
    rejectedNames: rejectedNames.map(discoveryNameKey).sort()
  };
  return createHash('sha256').update(JSON.stringify(profileInput)).digest('hex');
}

export function orderCandidatesFromPersistedState(
  candidates: DiscoveryCandidate[],
  persistedNames: string[],
  count: number,
  options: { hardExcludedNames?: string[]; softAvoidNames?: string[] } = {}
): DiscoveryCandidate[] {
  const candidatesByName = new Map(candidates.map((candidate) => [discoveryNameKey(candidate.suggestion.name), candidate]));
  const selected: DiscoveryCandidate[] = [];
  const selectedNames = new Set<string>();
  const hardExcludedNameKeys = new Set((options.hardExcludedNames ?? []).map(discoveryNameKey));
  const softAvoidNameKeys = new Set((options.softAvoidNames ?? []).map(discoveryNameKey));
  for (const name of persistedNames) {
    const nameKey = discoveryNameKey(name);
    const candidate = candidatesByName.get(nameKey);
    if (!candidate || selectedNames.has(nameKey) || hardExcludedNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
    if (selected.length >= count) return selected;
  }
  for (const candidate of candidates) {
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (selectedNames.has(nameKey) || hardExcludedNameKeys.has(nameKey) || softAvoidNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
    if (selected.length >= count) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (selectedNames.has(nameKey) || hardExcludedNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
  }
  return selected;
}

async function discoverCandidatesForUser(userId: string, count: number): Promise<{
  chases: Chase[];
  tasteProfileChases: Chase[];
  settings: ReturnType<typeof getUserAlertSettings>;
  hasFullDiscovery: boolean;
  hasLearnedProfile: boolean;
  lane: string;
  candidates: DiscoveryCandidate[];
}> {
  const storedChases = listChases(userId);
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const chases = activePlanChases(storedChases, plan);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const hasFullDiscovery = entitlements.discoveryDepth === 'full';
  const visibleCount = Math.min(count, discoveryVisibleCountForPlan(activeTier));
  const tasteMemoryChases = hasFullDiscovery ? listUserTasteMemoryChases(userId) : [];
  const tasteProfileChases = discoveryTasteProfileChases(chases, tasteMemoryChases, hasFullDiscovery);
  const hasLearnedProfile = hasFullDiscovery && tasteProfileChases.length >= MIN_LEARNED_PROFILE_CHASES;
  const recentlyRejected = listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME');
  const rejectedNames = recentlyRejected.map((item) => item.suggestionName);
  const recentlySeenNames = listRecentUserDiscoverySeenNames(userId);
  const profileFingerprint = discoveryProfileFingerprint(tasteProfileChases, rejectedNames, activeTier, visibleCount);
  const stateKey = discoveryStateKey(activeTier, visibleCount);
  const selectAndEnrich = async () => {
    const combinedExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const combinedSourceExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const selection = selectDiscoverySuggestionsForFocuses([], tasteProfileChases, DISCOVERY_CANDIDATE_POOL_SIZE, {
      excludedNames: combinedExcludedNames,
      excludeLanesForExcludedNames: combinedExcludedNames.length > 0
    });
    const activeSafeSuggestions = selection.suggestions.filter((suggestion) => !isActiveChaseEchoSuggestion(suggestion, storedChases));
    const sourceBackedSuggestions = await expandSourceBackedSuggestions(activeSafeSuggestions, chases, tasteProfileChases, visibleCount, storedChases);
    const excludedSourceNameKeys = new Set(combinedSourceExcludedNames.map(discoveryNameKey));
    const freshSourceBackedSuggestions = sourceBackedSuggestions.filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name)));
    const enriched = freshSourceBackedSuggestions.map((suggestion, index) => tasteOnlyCandidate(suggestion, index));
    const rankedCandidates = selectVisibleCandidatesForCount(enriched, tasteProfileChases, Math.max(visibleCount, discoveryVisibleCountForPlan(activeTier)));
    const persistedState = hasFullDiscovery && visibleCount >= VISIBLE_DISCOVERY_COUNT ? getUserDiscoveryState(userId, stateKey) : null;
    const persistedCandidates =
      persistedState?.profileFingerprint === profileFingerprint && persistedState.suggestionNames.length >= visibleCount
        ? orderCandidatesFromPersistedState(rankedCandidates, persistedState.suggestionNames, visibleCount, { hardExcludedNames: rejectedNames })
        : null;
    const visibleCandidates = persistedCandidates ?? orderCandidatesFromPersistedState(rankedCandidates, [], visibleCount, { hardExcludedNames: rejectedNames, softAvoidNames: recentlySeenNames });
    if (hasFullDiscovery && visibleCount >= VISIBLE_DISCOVERY_COUNT && visibleCandidates.length >= visibleCount) {
      upsertUserDiscoveryState({ userId, mode: stateKey, profileFingerprint, suggestionNames: visibleCandidates.map((candidate) => candidate.suggestion.name) });
    }
    const marketCandidates = hasFullDiscovery
      ? candidatesFromDiscoveryMarketCache(visibleCandidates, {
          userId,
          activeChases: chases,
          destination: settings.shippingCountry ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode } : undefined,
          targetCurrency: settings.alertCurrency
        })
      : visibleCandidates;
    const candidates = await attachReferenceImages(marketCandidates);
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
    .setDescription('Discover cards shaped by your Vault'),
  async execute(interaction: any) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discovery = await discoverCandidatesForUser(interaction.user.id, VISIBLE_DISCOVERY_COUNT);
    const visibleCandidates = discovery.candidates;
    markUserDiscoverySuggestionsSeen(interaction.user.id, visibleCandidates.map((candidate) => candidate.suggestion.name));
    const visiblePaths = uniqueValuesPreservingOrder(visibleCandidates.map((candidate) => discoveryCandidateTrailLabel(candidate)));
    const title = '✨ Vaultr Discovery';
    const pathSummary = visiblePaths.length > 0 ? visiblePaths.join(', ') : 'No fresh Discovery matches right now';
    const lines = [
      `**Collector Profile:** ${learningSignal(
        discovery.chases,
        discovery.tasteProfileChases,
        discovery.lane,
        discovery.hasFullDiscovery,
        discovery.hasLearnedProfile
      )}`,
      `**Collecting Paths:** ${pathSummary}`
    ];
    if (!discovery.hasFullDiscovery) {
      lines.push('', '**Pro Discovery:** unlock a deeper Taste Profile shelf with more collector paths, remembered taste cues, and controls to guide what Vaultr learns next');
    }
    const overviewEmbed = infoEmbed(title, lines.join('\n')).setColor(DISCOVERY_OVERVIEW_COLOR).setFooter({ text: 'Vaultr • Discovery Profile' });

    await interaction.editReply({
      embeds: [
        overviewEmbed,
        ...discoveryCardEmbeds(visibleCandidates, discovery.settings.alertCurrency, discovery.hasFullDiscovery)
      ],
      components: discoveryActionRows(interaction.user.id, visibleCandidates, discovery.hasFullDiscovery)
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
      embeds: [warningEmbed('Already In Vault', `**${pick.cardName}** is already an active chase.`)],
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
        : `Free Vaults can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. Pro expands your Vault to ${PLAN_LIMITS.PRO.maxActiveChases} active chases, faster checks, deeper Discovery, and trusted shop sources. Remove one with /chase remove or run /upgrade.`;
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
    'Good find. This one is joining the Vault.',
    '',
    `**Card:** ${chase.cardName}`,
    `**Path:** ${discoveryTrailLabel(pick.lane)}`,
    `**Max Price:** ${chase.maxPrice ?? 'Any'}`,
    `**Grade:** Ungraded`,
    '',
    '**Next:** Use `/chase list` to see where it landed'
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
      ? `Vaultr will treat **${pick.cardName}** as a stronger taste cue.`
      : `Vaultr will steer away from **${pick.cardName}** and this path for now.`;

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
  const token = String(rawValue ?? '');
  if (!ownerUserId || !token) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can use this Discovery menu.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Discovery Expired', 'Run `/discover` again for fresh card actions.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const activeTier = activePlanTier(getUserPlan(interaction.user.id));
  const includeFeedbackActions = activeTier === 'PRO';
  const lines = [
    'Pick your move for this Discovery card.',
    '',
    `**Card:** ${pick.cardName}`,
    `**Path:** ${discoveryTrailLabel(pick.lane)}`,
    ...(pick.maxPrice === undefined ? [] : [`**Suggested Max:** ${pick.maxPrice}`])
  ];

  await interaction.reply({
    embeds: [infoEmbed('Discovery Actions', lines.join('\n'))],
    components: discoverySelectedActionRows(interaction.user.id, token, includeFeedbackActions),
    flags: MessageFlags.Ephemeral
  });
  return true;
}
