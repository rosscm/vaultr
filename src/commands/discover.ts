import { createHash, randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
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
  undoDiscoveryFeedback,
  upsertUserDiscoveryState
} from '../services/chase-store.js';
import { convertCurrencyAmount, type SupportedCurrency } from '../services/currency.js';
import { searchEbayListings, searchEbaySoldListings } from '../services/ebay.js';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestionsForFocuses, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import {
  discoveryMarketCacheKey,
  getDiscoveryMarketCache,
  listReliableDiscoveryMarketCacheEntries,
  listingFromDiscoveryMarketCache,
  upsertDiscoveryMarketCache,
  type DiscoveryMarketCacheEntry
} from '../services/discovery-market-cache.js';
import { completeDiscoveryMarketRefreshJob, enqueueDiscoveryMarketRefreshJobs } from '../services/discovery-market-jobs.js';
import { getOrFetchDiscoveryReferenceImage } from '../services/discovery-reference-cache.js';
import { resolveSourceBackedDiscoveryCards } from '../services/discovery-source-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanChases, activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { getPollerState } from '../services/poller-state.js';
import { PREPARED_DISCOVERY_SELECTION_VERSION, preparedDiscoveryStateKey } from '../services/prepared-discovery.js';
import {
  getLatestAvailableScheduledDiscoveryDrop,
  getScheduledDiscoveryDrop,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop,
  type ScheduledDiscoveryDrop,
  type ScheduledDiscoveryDropType,
  type ScheduledDiscoveryDropItem
} from '../services/scheduled-discovery-drops.js';
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
export type DiscoveryRejectedFeedback = ReturnType<typeof listRecentUserDiscoveryFeedback>[number];
export type DiscoveryNegativeProfile = {
  subjectTokens: Set<string>;
  weakTraitCounts: Map<string, number>;
  protectedTraits: Set<string>;
};
type DiscoveryShelfPayload = {
  content?: string;
  headerEmbeds?: EmbedBuilder[];
  embeds: EmbedBuilder[];
  components: DiscoveryActionRow[];
  candidateNames: string[];
  hasFullDiscovery: boolean;
};
type DiscoveryProfileConfidenceTier = 'SEED' | 'EMERGING' | 'USABLE' | 'STRONG';
type DiscoveryProfileConfidence = {
  tier: DiscoveryProfileConfidenceTier;
  signalCount: number;
  subjectCount: number;
  releaseTypeCount: number;
  eraCount: number;
  minShelfSize: number;
  maxShelfSize: number;
};

const MIN_LEARNED_PROFILE_CHASES = 6;
const MIN_STRONG_PROFILE_CHASES = 9;
const VISIBLE_DISCOVERY_COUNT = 7;
const DISCOVERY_SHELF_PAGE_SIZE = 10;
const DISCOVERY_WEEKLY_DROP_SIZE = Math.max(DISCOVERY_SHELF_PAGE_SIZE, Math.min(20, Math.floor(Number(process.env.DISCOVERY_WEEKLY_DROP_SIZE ?? '20'))));
const DISCOVERY_CANDIDATE_POOL_SIZE = Math.max(72, DISCOVERY_WEEKLY_DROP_SIZE * 3);
const DISCOVERY_ENRICHMENT_CONCURRENCY = 4;
const DISCOVERY_BACKGROUND_ENRICHMENT_CONCURRENCY = 1;
const DISCOVERY_SOURCE_TIMEOUT_MS = Math.max(30000, Math.min(90000, Math.floor(Number(process.env.DISCOVERY_SOURCE_TIMEOUT_MS ?? '60000'))));
const DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS = Math.max(0, Math.min(20000, Math.floor(Number(process.env.DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS ?? '12000'))));
const DISCOVERY_MARKET_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DISCOVERY_REFERENCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISCOVERY_SOURCE_STATUS_RETRY_MS = 15 * 60 * 1000;
const MIN_RAW_MARKET_SAMPLE_SIZE = 2;
const MIN_ASK_ONLY_MARKET_SAMPLE_SIZE = 4;
const TARGET_RAW_MARKET_SAMPLE_SIZE = 12;
const MIN_READY_SHELF_PAGE_SIZE = 4;
const NON_CARD_TERMS = [
  'acrylic case',
  'blanket',
  'booster',
  'box',
  'carpet',
  'coin',
  'custom',
  'deck box',
  'display case',
  'figure',
  'figurine',
  'funko',
  'gold foil',
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
  'rug',
  'sleeve',
  'statue',
  'sticker',
  'toy'
];
const CARD_TERMS = ['card', 'cards', 'tcg', 'pokemon', 'psa', 'bgs', 'cgc', 'sgc', 'graded', 'slab'];

const DISCOVERY_OVERVIEW_COLOR = 0x8b5cf6;
const DISCOVERY_LANE_COLOR = 0x0e7490;
const DISCOVERY_SELECTION_VERSION = PREPARED_DISCOVERY_SELECTION_VERSION;
const DISCOVERY_VAULT_PREFIX = 'discover-vault';
const DISCOVERY_FEEDBACK_PREFIX = 'discover-feedback';
const DISCOVERY_FEEDBACK_UNDO_PREFIX = 'discover-feedback-undo';
const DISCOVERY_SELECT_PREFIX = 'discover-action';
const DISCOVERY_DROP_OPEN_PREFIX = 'discover-drop-open';
const DISCOVERY_DROP_PAGE_PREFIX = 'discover-drop-page';
const DISCOVERY_VAULT_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
    return `remembered taste; add active chases to sharpen it`;
  }
  if (activeChases.length === 0) return 'add a few chases to shape Discovery';
  const promoSignal = hasPromoLeaningDiscoveryProfile(tasteProfileChases) ? '; promos emerging' : '';
  const memoryNote = rememberedTasteCount > 0 ? ' + taste memory' : '';
  if (hasLearnedProfile) {
    const signals = tasteSignalsFromChases(tasteProfileChases, lane).filter((signal) => signal !== lane);
    const signalNote = signals.length > 0 ? `; ${signals.join(', ')}` : '';
    return `active chases${memoryNote}${signalNote}`;
  }
  if (hasFullDiscovery) return `taking shape from active chases${memoryNote}${promoSignal}`;
  return `early read from active chases${memoryNote}${promoSignal}`;
}

export function discoveryVisibleCountForPlan(tier: PlanTier): number {
  return getEntitlementsForTier(tier).discoveryVisibleCards;
}

export function weeklyDiscoveryShelfSizeForPlan(tier: PlanTier): number {
  return tier === 'PRO' ? DISCOVERY_WEEKLY_DROP_SIZE : getEntitlementsForTier(tier).discoveryVisibleCards;
}

export function discoveryCandidateSelectionCount(hasFullDiscovery: boolean, visibleCount: number): number {
  if (!hasFullDiscovery) return visibleCount;
  if (visibleCount >= DISCOVERY_SHELF_PAGE_SIZE) return DISCOVERY_CANDIDATE_POOL_SIZE;
  return Math.min(DISCOVERY_CANDIDATE_POOL_SIZE, visibleCount + 3);
}

export function discoveryTasteProfileChases(chases: Chase[], tasteMemoryChases: Chase[], hasFullDiscovery: boolean): Chase[] {
  return hasFullDiscovery ? mergeActiveAndTasteMemoryChases(chases, tasteMemoryChases) : chases;
}

function removedTasteMemoryChases(tasteMemoryChases: Chase[]): Chase[] {
  return tasteMemoryChases.filter((chase) => chase.tasteSource === 'REMOVED_CHASE');
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

function discoveryDisplayNameKey(value: string): string {
  return discoveryNameKey(value).replace(/\b(?:pokemon|tcg|trading) cards?\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function discoveryMarketSearchTerms(suggestion: DiscoverySuggestion): string[] {
  const terms = [suggestion.evidenceSearchTerm, suggestion.name, ...(suggestion.evidenceAliases ?? [])]
    .filter((term): term is string => !!term && term.trim().length > 0)
    .map((term) => term.replace(/\s+/g, ' ').trim());
  return uniqueValuesPreservingOrder(terms).slice(0, 3);
}

function dedupeDiscoveryListings(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  const unique: Listing[] = [];
  for (const listing of listings) {
    const key = listing.listingId || `${discoveryNameKey(listing.title)}|${listing.price}|${listing.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(listing);
  }
  return unique;
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
  return converted.total >= range.min && converted.total <= range.max;
}

export function discoveryMarketRangeFromChases(chases: Chase[]): { min: number; max: number } | undefined {
  const maxPrices = chases.map((chase) => chase.maxPrice).filter((price): price is number => price !== undefined && Number.isFinite(price) && price > 0);
  if (maxPrices.length === 0) return undefined;
  return { min: 0, max: Math.max(...maxPrices) };
}

function includesAnyTerm(value: string, terms: string[]): boolean {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(term));
}

function includesAnyNonCardTerm(value: string): boolean {
  const normalized = normalize(value).replace(/\btoys\s*r\s*us\b/g, 'retail promo');
  return (
    NON_CARD_TERMS.some((term) => normalized.includes(term)) ||
    /\b(?:extended art|full art|art)\s+case\b/.test(normalized) ||
    /\b(?:card|tcg|ccg|trading card)\s+case\b/.test(normalized) ||
    /\bcase\s+(?:for|only)\b/.test(normalized) ||
    /\bhand[ -]?drawn\b/.test(normalized) ||
    /\bsketch\b/.test(normalized)
  );
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

export function looksLikeBaselineRawMarketListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return (
    looksLikeRawCardListing(listing) &&
    !/\b(altered|bent|creased|damaged|dmg|error|gem mint|heavy play|hp|inked|minty mint|misprint|miscut|nintedo|poor|sealed|unopened|signature|signed|autograph|staff|water damaged)\b/.test(text) &&
    !/\b(lot|pack|post ?card)\b|\bcard set\b|\b(complete|master|binder)\b.*\b(set|collection)\b|\b(6|9|18)[- ]?card set\b|\bset of \d+\b/.test(text)
  );
}

export function typicalMarketTotal(totals: number[]): number | undefined {
  const sorted = totals.filter((total) => Number.isFinite(total) && total > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const anchor = median(sorted);
  if (anchor === undefined || anchor <= 0) return anchor;
  if (sorted.length >= 4) {
    const lowerHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const upperHalf = sorted.slice(Math.ceil(sorted.length / 2));
    const q1 = median(lowerHalf);
    const q3 = median(upperHalf);
    if (q1 !== undefined && q3 !== undefined) {
      const iqr = q3 - q1;
      const lowerFence = Math.max(0, q1 - iqr * 1.5);
      const upperFence = q3 + iqr * 1.5;
      const withoutOutliers = sorted.filter((total) => total >= lowerFence && total <= upperFence);
      if (withoutOutliers.length >= Math.max(MIN_RAW_MARKET_SAMPLE_SIZE, Math.floor(sorted.length / 2))) return median(withoutOutliers);
    }
  }
  const withoutHighOutliers = sorted.filter((total) => total <= anchor * 3);
  return median(withoutHighOutliers.length > 0 ? withoutHighOutliers : sorted);
}

function hasReliableSeller(listing: Listing): boolean {
  const feedbackScore = listing.sellerFeedbackScore;
  const feedbackPercent = listing.sellerFeedbackPercent;
  if (feedbackScore !== undefined && feedbackScore > 0 && feedbackScore < 10) return false;
  if (feedbackPercent !== undefined && feedbackPercent > 0 && feedbackPercent < 95) return false;
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

export function isUsableDiscoveryMarketSample(
  suggestion: DiscoverySuggestion,
  listing: Listing,
  targetCurrency: SupportedCurrency
): boolean {
  return isUsableDiscoveryExample(suggestion, listing, undefined, targetCurrency);
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
  if (!discoveryMarketCacheHasSignal(entry)) return ageMs >= DISCOVERY_SOURCE_STATUS_RETRY_MS;
  return ageMs >= DISCOVERY_MARKET_CACHE_TTL_MS;
}

function discoveryMarketCacheHasSignal(entry: DiscoveryMarketCacheEntry): boolean {
  return (
    (entry.typicalRawSoldTotal !== undefined && (entry.soldSampleSize ?? 0) > 0) ||
    (entry.typicalRawAskingTotal !== undefined && (entry.marketSampleSize ?? 0) > 0)
  );
}

function discoveryMarketCacheHasReliableEstimate(entry: DiscoveryMarketCacheEntry): boolean {
  return (
    (entry.typicalRawSoldTotal !== undefined && (entry.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) ||
    (entry.typicalRawAskingTotal !== undefined && (entry.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE)
  );
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
  const hasMarketSignal = discoveryMarketCacheHasSignal(cacheEntry);
  const sourceStatus = !hasMarketSignal || (refreshQueued && !discoveryMarketCacheHasReliableEstimate(cacheEntry)) || (refreshQueued && cacheEntry.sourceStatus) ? 'PENDING' : cacheEntry.sourceStatus;
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

function hasMarketSignal(candidate: DiscoveryCandidate): boolean {
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  );
}

export function candidatesFromDiscoveryMarketCache(
  candidates: DiscoveryCandidate[],
  context: {
    userId: string;
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
    forceRefreshMissingSignal?: boolean;
    forceRefreshThinSignal?: boolean;
  }
): DiscoveryCandidate[] {
  const refreshJobs: DiscoveryMarketRefreshWork[] = [];
  const marketCandidates = candidates.map((candidate, visibleIndex) => {
    const selectionIndex = candidate.selectionIndex ?? visibleIndex;
    const cacheKey = discoveryMarketCacheKey(candidate.suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
    const cacheEntry = getDiscoveryMarketCache(cacheKey);
    const cachedListing = cacheEntry ? listingFromDiscoveryMarketCache(cacheEntry) : undefined;
    const hasInvalidCachedListing = !!cachedListing && !isUsableDiscoveryExample(candidate.suggestion, cachedListing, context.range, context.targetCurrency);
    const effectiveCacheEntry = hasInvalidCachedListing ? null : cacheEntry;
    const refreshQueued = hasInvalidCachedListing || shouldRefreshDiscoveryMarketCache(cacheEntry) || (!!cacheEntry && context.forceRefreshMissingSignal === true && !discoveryMarketCacheHasSignal(cacheEntry)) || (!!cacheEntry && context.forceRefreshThinSignal === true && discoveryMarketCacheHasSignal(cacheEntry) && !discoveryMarketCacheHasReliableEstimate(cacheEntry));
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
      effectiveCacheEntry,
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

async function hydratePendingDiscoveryMarketCandidates(
  candidates: DiscoveryCandidate[],
  context: {
    userId: string;
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  }
): Promise<DiscoveryCandidate[]> {
  const hydratedByIndex = new Map<number, DiscoveryCandidate>();
  const pendingCandidates = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.sourceStatus === 'PENDING' && !hasEnoughRawMarketData(candidate));

  await mapWithConcurrency(pendingCandidates, Math.min(2, DISCOVERY_ENRICHMENT_CONCURRENCY), async ({ candidate, index }) => {
    try {
      const hydrated = await enrichSuggestion(
        candidate.suggestion,
        candidate.selectionIndex ?? index,
        context.userId,
        context.activeChases,
        context.destination,
        context.range,
        context.targetCurrency,
        (askCandidate) => {
          const cacheKey = discoveryMarketCacheKey(candidate.suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
          upsertDiscoveryMarketCache({
            cacheKey,
            suggestionName: candidate.suggestion.name,
            displayCurrency: context.targetCurrency,
            destinationCountry: context.destination?.country,
            listing: askCandidate.listing,
            imageUrl: askCandidate.image?.sourceKind === 'MARKET_LISTING' ? askCandidate.image.url : undefined,
            typicalRawAskingTotal: askCandidate.typicalRawAskingTotal,
            marketSampleSize: askCandidate.marketSampleSize,
            typicalRawSoldTotal: askCandidate.typicalRawSoldTotal,
            soldSampleSize: askCandidate.soldSampleSize
          });
        }
      );
      const cacheKey = discoveryMarketCacheKey(candidate.suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
      upsertDiscoveryMarketCache({
        cacheKey,
        suggestionName: candidate.suggestion.name,
        displayCurrency: context.targetCurrency,
        destinationCountry: context.destination?.country,
        listing: hydrated.listing,
        imageUrl: hydrated.image?.sourceKind === 'MARKET_LISTING' ? hydrated.image.url : undefined,
        typicalRawAskingTotal: hydrated.typicalRawAskingTotal,
        marketSampleSize: hydrated.marketSampleSize,
        typicalRawSoldTotal: hydrated.typicalRawSoldTotal,
        soldSampleSize: hydrated.soldSampleSize,
        sourceStatus: hydrated.sourceStatus === 'PENDING' ? undefined : hydrated.sourceStatus
      });
      hydratedByIndex.set(index, { ...candidate, ...hydrated, sourceStatus: hydrated.sourceStatus === 'PENDING' ? undefined : hydrated.sourceStatus });
    } catch {
      // Background refresh still owns retry/status handling; foreground hydration is best-effort.
    }
  });

  return candidates.map((candidate, index) => hydratedByIndex.get(index) ?? candidate);
}

function candidateWithFreshMarketCache(
  candidate: DiscoveryCandidate,
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  }
): DiscoveryCandidate {
  if (candidate.sourceStatus !== 'PENDING' || hasEnoughRawMarketData(candidate)) return candidate;
  const cacheKey = discoveryMarketCacheKey(candidate.suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
  const cacheEntry = getDiscoveryMarketCache(cacheKey);
  if (!cacheEntry || !discoveryMarketCacheHasReliableEstimate(cacheEntry)) return candidate;
  const marketCandidate = candidateFromCachedMarket(candidate.suggestion, candidate.selectionIndex ?? 0, cacheEntry, context.targetCurrency, context.activeChases, false);
  return {
    ...candidate,
    typicalRawAskingTotal: marketCandidate.typicalRawAskingTotal,
    marketSampleSize: marketCandidate.marketSampleSize,
    typicalRawSoldTotal: marketCandidate.typicalRawSoldTotal,
    soldSampleSize: marketCandidate.soldSampleSize,
    displayCurrency: marketCandidate.displayCurrency ?? candidate.displayCurrency,
    sourceStatus: marketCandidate.sourceStatus
  };
}

async function settlePendingDiscoveryMarketCandidates(
  candidates: DiscoveryCandidate[],
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  },
  maxWaitMs = DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS
): Promise<DiscoveryCandidate[]> {
  if (maxWaitMs <= 0 || !candidates.some((candidate) => candidate.sourceStatus === 'PENDING' && !hasEnoughRawMarketData(candidate))) return candidates;
  const deadlineMs = Date.now() + maxWaitMs;
  let settled = candidates;
  while (Date.now() < deadlineMs) {
    settled = settled.map((candidate) => candidateWithFreshMarketCache(candidate, context));
    if (!settled.some((candidate) => candidate.sourceStatus === 'PENDING' && !hasEnoughRawMarketData(candidate))) return settled;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadlineMs - Date.now()))));
  }
  return settled.map((candidate) => candidateWithFreshMarketCache(candidate, context));
}

async function enrichSuggestion(
  suggestion: DiscoverySuggestion,
  selectionIndex: number,
  userId: string,
  activeChases: Chase[],
  destination: { country?: string; postalCode?: string } | undefined,
  range: { min: number; max: number } | undefined,
  targetCurrency: SupportedCurrency,
  onAskSnapshot?: (candidate: DiscoveryCandidate) => void
): Promise<DiscoveryCandidate> {
  const discoveryChase: Chase = {
    id: `discover:${suggestion.name}`,
    userId,
    cardName: suggestion.evidenceSearchTerm ?? `${suggestion.name} trading card`,
    createdAt: new Date().toISOString()
  };
  const searchTerms = discoveryMarketSearchTerms(suggestion);
  const chaseForTerm = (term: string): Chase => ({ ...discoveryChase, cardName: term });
  const usableBaselineListings = (candidates: Listing[]) =>
    candidates
      .filter((candidate) => !isActiveChaseEchoListing(candidate, activeChases))
      .filter((candidate) => isUsableDiscoveryMarketSample(suggestion, candidate, targetCurrency))
      .filter(looksLikeBaselineRawMarketListing);

  try {
    let listings: Listing[] = [];
    for (const term of searchTerms) {
      const nextListings = await withTimeout(searchEbayListings(chaseForTerm(term), destination, { enrichMissingShipping: false }), DISCOVERY_SOURCE_TIMEOUT_MS);
      listings = dedupeDiscoveryListings([...listings, ...nextListings]);
      if (usableBaselineListings(listings).length >= TARGET_RAW_MARKET_SAMPLE_SIZE) break;
    }
    const nonActiveListings = listings.filter((candidate) => !isActiveChaseEchoListing(candidate, activeChases));
    const usableListings = nonActiveListings.filter((candidate) => isUsableDiscoveryExample(suggestion, candidate, range, targetCurrency));
    const marketSampleListings = nonActiveListings.filter((candidate) => isUsableDiscoveryMarketSample(suggestion, candidate, targetCurrency));
    const rawListings = usableListings.filter(looksLikeRawCardListing);
    const baselineInRangeRawListings = usableListings.filter(looksLikeBaselineRawMarketListing);
    const baselineRawListings = marketSampleListings.filter(looksLikeBaselineRawMarketListing);
    const marketListing =
      baselineInRangeRawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      rawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      baselineRawListings.find((candidate) => candidate.imageUrl || candidate.thumbnailUrl) ??
      baselineInRangeRawListings[0] ??
      rawListings[0] ??
      baselineRawListings[0];
    const visualListing = nonActiveListings.find((candidate) => looksLikeVisualDiscoveryListing(suggestion, candidate));
    const listing = marketListing ?? visualListing;
    if (!listing) return { suggestion, selectionIndex };

    const totals = baselineRawListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    const typicalRawAskingTotal = typicalMarketTotal(totals);
    const imageUrl = imageUrlFromListing(listing);
    const askSnapshot: DiscoveryCandidate = {
      suggestion,
      selectionIndex,
      listing,
      image: imageUrl ? { name: suggestion.name, url: imageUrl, sourceName: 'eBay listing image', sourceKind: 'MARKET_LISTING' } : undefined,
      typicalRawAskingTotal,
      marketSampleSize: totals.length,
      soldSampleSize: 0,
      displayCurrency: targetCurrency
    };
    onAskSnapshot?.(askSnapshot);
    let soldTotals: number[] = [];
    try {
      let soldListings: Listing[] = [];
      for (const term of searchTerms) {
        const nextSoldListings = await withTimeout(searchEbaySoldListings(discoveryChase, destination, { keywords: term, pageCount: 2 }), DISCOVERY_SOURCE_TIMEOUT_MS);
        soldListings = dedupeDiscoveryListings([...soldListings, ...nextSoldListings]);
        if (usableBaselineListings(soldListings).length >= TARGET_RAW_MARKET_SAMPLE_SIZE) break;
      }
      const usableSoldListings = usableBaselineListings(soldListings);
      soldTotals = usableSoldListings.slice(0, 12).map((candidate) => convertedListingParts(candidate, targetCurrency).total);
    } catch {
      soldTotals = [];
    }
    const typicalRawSoldTotal = typicalMarketTotal(soldTotals);
    return {
      ...askSnapshot,
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

export type DiscoveryMarketRefreshWork = {
  cacheKey: string;
  suggestion: DiscoverySuggestion;
  selectionIndex?: number;
  userId: string;
  activeChases: Chase[];
  destination?: { country?: string; postalCode?: string };
  range?: { min: number; max: number };
  targetCurrency: SupportedCurrency;
};

const discoveryMarketRefreshQueue: DiscoveryMarketRefreshWork[] = [];
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

function saveDiscoveryMarketRefreshResult(job: DiscoveryMarketRefreshWork, candidate: DiscoveryCandidate): void {
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

export async function processDiscoveryMarketRefreshWork(job: DiscoveryMarketRefreshWork): Promise<void> {
  try {
    const candidate = await enrichSuggestion(job.suggestion, job.selectionIndex ?? 0, job.userId, job.activeChases, job.destination, job.range, job.targetCurrency, (askCandidate) => {
      saveDiscoveryMarketRefreshResult(job, askCandidate);
    });
    saveDiscoveryMarketRefreshResult(job, candidate);
    if (candidate.sourceStatus && !hasMarketSignal(candidate)) {
      throw new Error(`Discovery market refresh returned ${candidate.sourceStatus}`);
    }
  } catch (error) {
    saveDiscoveryMarketRefreshResult(job, { suggestion: job.suggestion, selectionIndex: job.selectionIndex ?? 0, sourceStatus: discoverySourceStatus(error) });
    throw error;
  }
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
        await processDiscoveryMarketRefreshWork(job);
        completeDiscoveryMarketRefreshJob(job.cacheKey);
      } catch {
        // The durable worker path owns retry accounting; this in-process queue is best-effort.
      } finally {
        queuedDiscoveryMarketRefreshKeys.delete(job.cacheKey);
      }
    });
  } finally {
    isDiscoveryMarketRefreshRunning = false;
    if (discoveryMarketRefreshQueue.length > 0) scheduleDiscoveryMarketRefreshQueue();
  }
}

function queueDiscoveryMarketRefreshes(jobs: DiscoveryMarketRefreshWork[]): void {
  enqueueDiscoveryMarketRefreshJobs(
    jobs.map((job) => ({
      cacheKey: job.cacheKey,
      suggestion: job.suggestion,
      userId: job.userId,
      activeChases: job.activeChases,
      destination: job.destination,
      range: job.range,
      targetCurrency: job.targetCurrency,
      priority: hasPriorityJapaneseChase(job.activeChases) ? 2 : 1
    }))
  );
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
      ? 'Market data is updating; pricing will appear once the source responds.'
      : 'Market data is updating; image and pricing will appear once the source responds.';
  }
  if (candidate.sourceStatus === 'RATE_LIMITED') return 'Market data is temporarily limited by eBay; Vaultr will retry automatically.';
  if (candidate.sourceStatus === 'TIMEOUT') return 'Market data did not respond in time; Vaultr will retry automatically.';
  const currency = candidate.displayCurrency ?? currencyHint;
  const hasSoldComps = candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE;
  const hasAskComps = candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0;
  const hasReliableAskOnlyComps = candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE;
  if (!hasSoldComps && !hasAskComps) {
    return 'Market data is still being gathered; Vaultr will keep checking.';
  }
  if (hasSoldComps && hasAskComps) {
    return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps); ${formatMoney(candidate.typicalRawAskingTotal, currency)} raw ask`;
  }
  if (hasSoldComps) return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps)`;
  if (!hasReliableAskOnlyComps) return `Low recent comps data: only ${candidate.marketSampleSize ?? 0} active ask comps found, so Vaultr is not showing a price yet.`;
  return `${formatMoney(candidate.typicalRawAskingTotal, currency)} active raw ask`;
}

export async function attachReferenceImages(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  return mapWithConcurrency(candidates, VISIBLE_DISCOVERY_COUNT, async (candidate) => {
    if (candidate.image?.sourceKind === 'CARD_REFERENCE') return candidate;
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
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE)
  );
}

function hasSomeRawMarketData(candidate: DiscoveryCandidate): boolean {
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  );
}

function hasThinRawMarketEstimate(candidate: DiscoveryCandidate): boolean {
  return ((candidate.soldSampleSize ?? 0) > 0 || (candidate.marketSampleSize ?? 0) > 0) && !hasEnoughRawMarketData(candidate);
}

function marketEvidenceRank(candidate: DiscoveryCandidate): number {
  if (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) return 3;
  if (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE) return 2;
  if (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  ) return 1;
  return 0;
}

function hasReliableMarketEstimate(candidate: DiscoveryCandidate): boolean {
  return marketEvidenceRank(candidate) >= 2;
}

function pagePolishedReadyCount(readyCount: number, maxShelfSize: number): number {
  const cappedReadyCount = Math.min(readyCount, maxShelfSize);
  if (cappedReadyCount <= DISCOVERY_SHELF_PAGE_SIZE) return cappedReadyCount;
  const completePages = Math.floor(cappedReadyCount / DISCOVERY_SHELF_PAGE_SIZE);
  const remainder = cappedReadyCount % DISCOVERY_SHELF_PAGE_SIZE;
  if (remainder === 0) return cappedReadyCount;
  return completePages * DISCOVERY_SHELF_PAGE_SIZE + (remainder >= MIN_READY_SHELF_PAGE_SIZE ? remainder : 0);
}

export function marketReadyShelfCandidates(candidates: DiscoveryCandidate[], hasFullDiscovery: boolean, profileConfidence: DiscoveryProfileConfidence = discoveryProfileConfidence([])): DiscoveryCandidate[] {
  const seenDisplayNames = new Set<string>();
  const displayableCandidates = candidates.filter((candidate) => {
    if (!isDisplayableDiscoveryCandidate(candidate)) return false;
    const displayNameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenDisplayNames.has(displayNameKey)) return false;
    seenDisplayNames.add(displayNameKey);
    return true;
  });
  if (!hasFullDiscovery || displayableCandidates.length <= DISCOVERY_SHELF_PAGE_SIZE) return displayableCandidates;
  const readyCandidates = displayableCandidates.filter(hasReliableMarketEstimate);
  const visibleReadyCount = pagePolishedReadyCount(readyCandidates.length, profileConfidence.maxShelfSize);
  const targetFloor = Math.max(profileConfidence.minShelfSize, visibleReadyCount);
  const targetCount = Math.min(profileConfidence.maxShelfSize, displayableCandidates.length, targetFloor);
  const selected = readyCandidates.slice(0, Math.min(visibleReadyCount, targetCount));
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  for (const candidate of displayableCandidates) {
    if (selected.length >= targetCount) break;
    if (hasThinRawMarketEstimate(candidate)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
  }
  return selected;
}

export function orderCandidatesForMarketConfidence(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => {
    const evidenceDelta = marketEvidenceRank(right) - marketEvidenceRank(left);
    if (evidenceDelta !== 0) return evidenceDelta;
    const sourceDelta = sourcePreferenceRankScore(right, chases, negativeProfile) - sourcePreferenceRankScore(left, chases, negativeProfile);
    if (sourceDelta !== 0) return sourceDelta;
    return curiosityRankScore(right) - curiosityRankScore(left);
  });
}

function marketEstimateTotal(candidate: DiscoveryCandidate): number | undefined {
  return candidate.typicalRawSoldTotal ?? candidate.typicalRawAskingTotal;
}

function isMarketEstimateInRange(candidate: DiscoveryCandidate, range?: { min: number; max: number }): boolean {
  if (!range) return true;
  const total = marketEstimateTotal(candidate);
  return total === undefined || (total >= range.min && total <= range.max);
}

export function backfillMarketReadyDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  },
  targetCount: number,
  tasteProfileChases: Chase[] = [],
  profileConfidence: DiscoveryProfileConfidence = discoveryProfileConfidence(tasteProfileChases),
  negativeProfile?: DiscoveryNegativeProfile,
  repeatGuardChases: Chase[] = context.activeChases,
  excludedNames: string[] = []
): DiscoveryCandidate[] {
  const readyShelfCount = (items: DiscoveryCandidate[]): number => marketReadyShelfCandidates(items, true, profileConfidence).length;
  if (readyShelfCount(candidates) >= targetCount) return candidates;
  const merged = [...candidates];
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const seenVariantFamilies = new Set(merged.map(candidateVariantFamilyKey).filter((key): key is string => !!key));
  const excludedNameKeys = new Set(excludedNames.map(discoveryNameKey));
  const cacheEntries = listReliableDiscoveryMarketCacheEntries({
    displayCurrency: context.targetCurrency,
    destinationCountry: context.destination?.country,
    limit: 240
  });
  for (const entry of cacheEntries) {
    if (readyShelfCount(merged) >= targetCount) break;
    const suggestion = fallbackSuggestionFromCardName(entry.suggestionName);
    if (excludedNameKeys.has(discoveryNameKey(suggestion.name))) continue;
    const candidate = {
      ...candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE + merged.length, entry, context.targetCurrency, context.activeChases, false),
      listing: listingFromDiscoveryMarketCache(entry),
      image: entry.imageUrl
        ? {
            name: suggestion.name,
            url: entry.imageUrl,
            sourceName: 'eBay listing image',
            sourceKind: 'MARKET_LISTING' as const
          }
        : undefined
    } satisfies DiscoveryCandidate;
    if (!isDisplayableDiscoveryCandidate(candidate) || !isConcreteDiscoverySuggestion(candidate.suggestion)) continue;
    if (!hasReliableMarketEstimate(candidate) || !isMarketEstimateInRange(candidate, context.range)) continue;
    if (subjectProfileRankScore(candidate, tasteProfileChases) <= 0) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    if (seenNames.has(nameKey) || (variantKey && seenVariantFamilies.has(variantKey))) continue;
    merged.push(candidate);
    seenNames.add(nameKey);
    if (variantKey) seenVariantFamilies.add(variantKey);
  }
  return orderCandidatesForMarketConfidence(merged, tasteProfileChases, negativeProfile);
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

function sourcePreferenceRankScore(candidate: DiscoveryCandidate, chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile): number {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName ?? '';
  const suggestionText = [candidate.suggestion.name, candidate.suggestion.lane, candidate.suggestion.evidenceSearchTerm, ...(candidate.suggestion.requiredEvidenceTokens ?? [])].join(' ');
  const japaneseAffinity = japaneseSignalWeightRatio(chases);
  const priorityJapanese = hasPriorityJapaneseChase(chases);
  const hasJapaneseSource = /\btcgdex japanese\b/i.test(sourceName) || /\bjapanese\b/i.test(suggestionText);
  const isEnglishBlackStar = /\bblack star promos?\b/i.test([candidate.suggestion.name, sourceName].join(' '));
  const japaneseBoost = hasJapaneseSource ? Math.round(80 + japaneseAffinity * 80 + (priorityJapanese ? 80 : 0)) : 0;
  const blackStarPenalty = (japaneseAffinity >= 0.35 || priorityJapanese) && isEnglishBlackStar ? 90 : 0;
  const historyFallbackPenalty = isConcreteHistoryFallbackCandidate(candidate) ? 160 : 0;
  return japaneseBoost + subjectProfileRankScore(candidate, chases) - blackStarPenalty - historyFallbackPenalty - negativeProfileRankPenalty(candidate, negativeProfile);
}

function hasVmaxGxFormatSignal(value: string): boolean {
  return /\b(?:vmax|tag team|gx)\b/i.test(value);
}

function profileHasVmaxGxAffinity(chases: Chase[] = []): boolean {
  return chases.some((chase) => hasVmaxGxFormatSignal([chase.cardName, chase.targetNote].filter(Boolean).join(' ')));
}

function candidateNeedsVmaxGxAffinity(candidate: DiscoveryCandidate): boolean {
  return hasVmaxGxFormatSignal(sourceCardText(candidate));
}

function preferProfileFormatAffinity(candidates: DiscoveryCandidate[], chases: Chase[], count: number): DiscoveryCandidate[] {
  if (profileHasVmaxGxAffinity(chases)) return candidates;
  const preferred = candidates.filter((candidate) => !candidateNeedsVmaxGxAffinity(candidate));
  if (preferred.length >= count) return preferred;
  const preferredNameKeys = new Set(preferred.map((candidate) => discoveryNameKey(candidate.suggestion.name)));
  return [...preferred, ...candidates.filter((candidate) => !preferredNameKeys.has(discoveryNameKey(candidate.suggestion.name)))];
}

function isConcreteHistoryFallbackCandidate(candidate: DiscoveryCandidate): boolean {
  return candidate.suggestion.lane === 'Collector Compass' && /already connected to this profile/i.test(candidate.suggestion.why);
}

function profileSubjectTokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PROFILE_SUBJECT_STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function profileReleaseTypeKeys(value: string): string[] {
  const text = normalize(value);
  const keys: string[] = [];
  if (/\bpromo|black star|special delivery|futsal|celebrations|classic collection\b/.test(text)) keys.push('promo');
  if (/\bjapanese|tcgdex|coro\s?coro|vending|masaki|munch|poncho\b/.test(text)) keys.push('japanese');
  if (/\billustration|art rare|gallery|full art|sar|\bar\b/.test(text)) keys.push('art');
  if (/\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(text)) keys.push('format');
  if (/\bex\b/.test(text)) keys.push('ex');
  return keys;
}

function profileEraKeys(value: string): string[] {
  const text = normalize(value);
  const keys: string[] = [];
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(text)) keys.push('e-reader');
  if (/\bbase set\b|\bteam rocket\b|\bgym heroes\b|\bgym challenge\b|\bneo\b|\bwizards\b/.test(text)) keys.push('wotc');
  if (/\bxy\b|\bsm\b|\bswsh\b|\bsv\b|\bscarlet\b|\bviolet\b|\bsurging sparks\b|\bpaldean\b/.test(text)) keys.push('modern');
  return keys;
}

function distinctProfileKeys(chases: Chase[], keyFn: (value: string) => string[]): Set<string> {
  const keys = new Set<string>();
  for (const chase of chases) {
    const text = [chase.cardName, chase.targetNote].filter(Boolean).join(' ');
    for (const key of keyFn(text)) keys.add(key);
  }
  return keys;
}

function profileTraitKeys(value: string): string[] {
  return [...profileReleaseTypeKeys(value), ...profileEraKeys(value)];
}

function candidateTraitKeys(candidate: DiscoveryCandidate): string[] {
  const cardText = sourceCardText(candidate);
  return [...profileTraitKeys(cardText), discoveryCandidateTrailLabel(candidate)];
}

export function discoveryNegativeProfile(rejectedFeedback: DiscoveryRejectedFeedback[], positiveChases: Chase[]): DiscoveryNegativeProfile {
  const subjectTokens = new Set<string>();
  const weakTraitCounts = new Map<string, number>();
  const protectedTraits = distinctProfileKeys(positiveChases, profileTraitKeys);
  for (const feedback of rejectedFeedback) {
    for (const token of profileSubjectTokens(feedback.suggestionName).slice(0, 2)) subjectTokens.add(token);
    for (const trait of [...profileTraitKeys([feedback.suggestionName, feedback.lane].join(' ')), discoveryTrailLabel(feedback.lane)]) {
      weakTraitCounts.set(trait, (weakTraitCounts.get(trait) ?? 0) + Math.max(1, feedback.interactionCount));
    }
  }
  return { subjectTokens, weakTraitCounts, protectedTraits };
}

function negativeProfileRankPenalty(candidate: DiscoveryCandidate, negativeProfile?: DiscoveryNegativeProfile): number {
  if (!negativeProfile) return 0;
  const candidateSubjects = new Set(candidateSubjectBalanceKeys(candidate));
  let penalty = 0;
  for (const token of negativeProfile.subjectTokens) {
    if (candidateSubjects.has(token)) penalty += 90;
  }
  for (const trait of candidateTraitKeys(candidate)) {
    const count = negativeProfile.weakTraitCounts.get(trait) ?? 0;
    if (count < 2 || negativeProfile.protectedTraits.has(trait)) continue;
    penalty += Math.min(36, count * 12);
  }
  return penalty;
}

export function discoveryProfileConfidence(chases: Chase[]): DiscoveryProfileConfidence {
  const signalCount = chases.length;
  const subjectCount = distinctProfileKeys(chases, (value) => profileSubjectTokens(value).slice(0, 2)).size;
  const releaseTypeCount = distinctProfileKeys(chases, profileReleaseTypeKeys).size;
  const eraCount = distinctProfileKeys(chases, profileEraKeys).size;
  const diversityScore = [subjectCount >= 2, releaseTypeCount >= 2, eraCount >= 2].filter(Boolean).length;
  if (signalCount >= MIN_STRONG_PROFILE_CHASES && diversityScore >= 2) {
    return { tier: 'STRONG', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: DISCOVERY_WEEKLY_DROP_SIZE, maxShelfSize: DISCOVERY_WEEKLY_DROP_SIZE };
  }
  if (signalCount >= MIN_LEARNED_PROFILE_CHASES) return { tier: 'USABLE', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: 14, maxShelfSize: DISCOVERY_WEEKLY_DROP_SIZE };
  if (signalCount >= 3) return { tier: 'EMERGING', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: DISCOVERY_SHELF_PAGE_SIZE, maxShelfSize: 14 };
  return { tier: 'SEED', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: 5, maxShelfSize: DISCOVERY_SHELF_PAGE_SIZE };
}

export function discoveryShelfTighteningNote(): string {
  return '🔮 **Reading:** a smaller shelf for now while Vaultr continues to learn from your chases, feedback, and collector patterns';
}

export function discoveryShelfMarketCheckNote(shelfSize: number): string {
  return `🧪 **Market Check:** showing ${shelfSize} picks with cleaner live market checks; thinner comp rows will keep refreshing automatically`;
}

export function shouldShowDiscoveryShelfTighteningNote(hasFullDiscovery: boolean, shelfSize: number, proShelfSize = weeklyDiscoveryShelfSizeForPlan('PRO')): boolean {
  return hasFullDiscovery && shelfSize < proShelfSize - 1;
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

function rankDiscoveryCandidatesForProfile(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => {
    const sourceDelta = sourcePreferenceRankScore(right, chases, negativeProfile) - sourcePreferenceRankScore(left, chases, negativeProfile);
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

function broadSourceBackfillParents(): DiscoverySuggestion[] {
  const parent = (name: string, lane: string, requiredEvidenceTokens: string[], sourceTasteTokens = requiredEvidenceTokens): DiscoverySuggestion => ({
    name,
    lane,
    laneWhy: 'broad source-backed card backfill',
    why: 'keeps the weekly shelf full with concrete source-backed cards while personalized market data catches up',
    nearby: [],
    evidenceSearchTerm: name,
    evidenceAliases: [name],
    requiredEvidenceTokens,
    sourceTasteTokens,
    curiosityScore: 2
  });
  return [
    parent('Pokemon promo cards', 'Promo Trail', ['promo']),
    parent('Pokemon illustration rare cards', 'Artwork Trail', ['illustration', 'rare']),
    parent('e-reader Pokemon cards', 'E-Reader Era Trail', ['e-reader']),
    parent('vintage Pokemon cards', 'Vintage Era Trail', ['vintage']),
    parent('EX Pokemon cards', 'Format Trail', ['ex']),
    parent('Pokemon collector cards', 'Collector Compass', ['pokemon'], ['collector'])
  ];
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

function hasConcreteCardIdentifier(value: string): boolean {
  return (
    /\b(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}\b/i.test(value) ||
    /\bS\d{1,2}[a-z]?\s+\d{1,3}\b/i.test(value) ||
    /\bH\d{1,2}\b/i.test(value) ||
    /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(value) ||
    /\b(?:aquapolis|expedition|gym challenge|paldean fates|skyridge|surging sparks|futsal collection)\b.*\b\d{1,3}\b/i.test(value)
  );
}

function isGenericDiscoveryCardTitle(value: string): boolean {
  const normalized = normalize(value);
  return /\b(?:collector|e[- ]?reader|ex|full art|gx|illustration rare|japanese|promo|raw|special release|tag team|vintage) pokemon cards?\b/.test(normalized) || /\b(?:collector|e[- ]?reader|ex|full art|gx|illustration rare|japanese|promo|raw|special release|tag team|vintage) cards?\b/.test(normalized) || /\braw card\b/.test(normalized);
}

function isConcreteDiscoverySuggestion(suggestion: DiscoverySuggestion): boolean {
  return !!(suggestion.referenceImageUrl || suggestion.referenceSourceCardId || suggestion.referenceSourceName || (!isGenericDiscoveryCardTitle(suggestion.name) && hasConcreteCardIdentifier(suggestion.name)));
}

function isDisplayableDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  return isConcreteDiscoverySuggestion(candidate.suggestion) || !isGenericDiscoveryCardTitle(candidate.suggestion.name);
}

function fallbackSuggestionFromCardName(name: string): DiscoverySuggestion {
  return {
    name,
    lane: 'Collector Compass',
    laneWhy: 'previously surfaced card from this collector profile',
    why: 'A concrete card Vaultr has already connected to this profile, kept as a fallback while fresh sources resolve.',
    nearby: [],
    evidenceSearchTerm: `${name} Pokemon card`,
    evidenceAliases: [name],
    requiredEvidenceTokens: profileSubjectTokens(name).slice(0, 2)
  };
}

export function concreteDiscoveryFallbackSuggestions(names: string[], excludedNames: string[] = []): DiscoverySuggestion[] {
  const excludedNameKeys = new Set(excludedNames.map(discoveryNameKey));
  const seenNameKeys = new Set<string>();
  const suggestions: DiscoverySuggestion[] = [];
  for (const name of names) {
    const nameKey = discoveryNameKey(name);
    if (!nameKey || seenNameKeys.has(nameKey) || excludedNameKeys.has(nameKey)) continue;
    const suggestion = fallbackSuggestionFromCardName(name);
    if (!isConcreteDiscoverySuggestion(suggestion)) continue;
    suggestions.push(suggestion);
    seenNameKeys.add(nameKey);
  }
  return suggestions;
}

export function orderConcreteDiscoveryFallbackSuggestionsForMarket(
  suggestions: DiscoverySuggestion[],
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  }
): DiscoverySuggestion[] {
  const marketRank = (suggestion: DiscoverySuggestion): number => {
    const cacheKey = discoveryMarketCacheKey(suggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
    const cacheEntry = getDiscoveryMarketCache(cacheKey);
    if (!cacheEntry) return 0;
    const cachedListing = listingFromDiscoveryMarketCache(cacheEntry);
    if (cachedListing && !isUsableDiscoveryExample(suggestion, cachedListing, context.range, context.targetCurrency)) return -2;
    if (cachedListing && isActiveChaseEchoListing(cachedListing, context.activeChases)) return -2;
    if (cacheEntry.sourceStatus) return -1;
    if (!discoveryMarketCacheHasSignal(cacheEntry)) return -1;
    return Math.min(12, (cacheEntry.soldSampleSize ?? 0) + (cacheEntry.marketSampleSize ?? 0));
  };

  return suggestions
    .map((suggestion, index) => ({ suggestion, index, rank: marketRank(suggestion) }))
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .map(({ suggestion }) => suggestion);
}

export function backfillSourceBackedDiscoverySuggestions(sourceBackedSuggestions: DiscoverySuggestion[], fallbackSuggestions: DiscoverySuggestion[], targetCount: number): DiscoverySuggestion[] {
  const mergedSuggestions = [...sourceBackedSuggestions];
  const seenNameKeys = new Set(mergedSuggestions.map((suggestion) => discoveryNameKey(suggestion.name)));
  for (const suggestion of fallbackSuggestions) {
    if (mergedSuggestions.length >= targetCount) break;
    if (!isConcreteDiscoverySuggestion(suggestion)) continue;
    const nameKey = discoveryNameKey(suggestion.name);
    if (seenNameKeys.has(nameKey)) continue;
    mergedSuggestions.push(suggestion);
    seenNameKeys.add(nameKey);
  }
  return mergedSuggestions;
}

export function backfillDiscoverySuggestions(sourceBackedSuggestions: DiscoverySuggestion[], catalogSuggestions: DiscoverySuggestion[], fallbackSuggestions: DiscoverySuggestion[], targetCount: number): DiscoverySuggestion[] {
  const mergedSuggestions = [...sourceBackedSuggestions];
  const seenNameKeys = new Set(mergedSuggestions.map((suggestion) => discoveryNameKey(suggestion.name)));
  const pushSuggestions = (suggestions: DiscoverySuggestion[], requireConcrete: boolean): void => {
    for (const suggestion of suggestions) {
      if (mergedSuggestions.length >= targetCount) break;
      if (requireConcrete && !isConcreteDiscoverySuggestion(suggestion)) continue;
      const nameKey = discoveryNameKey(suggestion.name);
      if (seenNameKeys.has(nameKey)) continue;
      mergedSuggestions.push(suggestion);
      seenNameKeys.add(nameKey);
    }
  };
  pushSuggestions(catalogSuggestions, false);
  pushSuggestions(fallbackSuggestions, true);
  return mergedSuggestions;
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

function discoveryPathThreadSummary(pathLabels: string[]): string {
  const labels = uniqueValuesPreservingOrder(pathLabels.filter(Boolean));
  if (labels.length === 0) return 'No fresh Discovery threads right now';
  const explain = (label: string): string => {
    if (label === 'E-Reader Era Trail') return 'E-reader era';
    if (label === 'Collector Compass') return 'Profile-adjacent picks';
    if (label === 'Japanese Collector Trail') return 'Japanese variants';
    if (label === 'Vintage Era Trail') return 'Vintage binder era';
    if (label === 'Special Release Trail') return 'Event and limited drops';
    if (label === 'Promo Trail') return 'Promo releases';
    if (label === 'Artwork Trail') return 'Artwork-led picks';
    if (label === 'Format Trail') return 'Format threads';
    if (label === 'Value Watch') return 'Market-aware picks';
    return label;
  };
  return labels.map(explain).join(', ');
}

export function compactDiscoveryPathSummary(pathLabels: string[]): string {
  return discoveryPathThreadSummary(pathLabels);
}

function discoveryShelfHeaderEmbed(title: string, lines: string[]): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(DISCOVERY_OVERVIEW_COLOR)
    .setFooter({ text: 'Vaultr • Weekly Shelf' });
}

function sourceSetLabel(candidate: DiscoveryCandidate): string | undefined {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName;
  const match = /\(([^)]+)\)/.exec(sourceName ?? '');
  if (match?.[1]) return match[1];
  const text = candidate.suggestion.name;
  const knownSetMatch = /\b(Expedition Base Set|Aquapolis|Skyridge|Wizards Black Star Promos|XY Black Star Promos|BW Black Star Promos|SWSH Black Star Promos|SM Black Star Promos|Surging Sparks|Paldean Fates|Legendary Treasures|151)\b/i.exec(text);
  return knownSetMatch?.[1];
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
  const normalizedSourceSetText = normalize([candidate.suggestion.referenceSourceName, candidate.image?.sourceName, sourceSetLabel(candidate)].filter(Boolean).join(' '));
  const sourceTasteTokens = candidate.suggestion.sourceTasteTokens ?? [];
  const cardAndSourceText = normalizedCardText;
  const signals: string[] = [];

  signals.push(...tasteSignalTokenLabels(sourceTasteTokens, normalizedCardText));
  if (/\bpromo|black star|special release|limited release\b/.test(cardAndSourceText)) signals.push('Promo Releases');
  if (hasJapaneseCardEvidence(normalizedCardText)) signals.push('Japanese Prints');
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(cardAndSourceText)) signals.push('E-Reader Era');
  else if (/\bbase set\b|\bteam rocket\b|\bgym heroes\b|\bgym challenge\b|\bneo\b|\bwizards black star\b/.test(normalizedSourceSetText)) signals.push('Vintage Era');
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
  const hasPromoSignal = /\bpromo|black star|special release\b/.test(normalizedCardText);
  const hasFormatSignal = /\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(normalizedCardText);
  const reasons: string[] = [];
  if (/\bspecial delivery\b/.test(normalizedCardText)) reasons.push(`A promo with a real release story: ${candidate.suggestion.name.split(/\s+SWSH Black Star/i)[0]} feels more like a collector milestone than a standard set filler.`);
  else if (/\bfelt hat\b/.test(normalizedCardText)) reasons.push(`A memorable promo story: the Felt Hat release gives ${subject} crossover appeal beyond the base promo set.`);
  else if (hasJapaneseCardEvidence(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a regional print to compare against English runs instead of another generic copy.`);
  else if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a concrete early-2000s set identity, so the card has a clearer collecting shape than a broad vintage search.`);
  else if (hasPromoSignal && hasFormatSignal) reasons.push(`${sourceContext} gives ${subject} a named promo release with side-collection appeal.`);
  else if (hasPromoSignal) reasons.push(`${sourceContext} gives ${subject} a named release to track instead of a generic main-set copy.`);
  if (/\billustration|\bart rare|\bsar\b|\bar\b|\bgallery\b|\bfull art\b/.test(normalizedCardText)) reasons.push(`${subject} has art-led treatment that can stand on its own visually in a binder page.`);
  if (hasFormatSignal && !(hasPromoSignal && reasons.length > 0)) reasons.push(`${subject} fits a recognizable side-collection format with a different collecting shape than your current Vault.`);
  if (reasons.length === 0 && /\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalized)) reasons.push('This gives your Vault an early-2000s print to compare by set texture, artwork, and binder feel.');

  const uniqueReasons = uniqueValuesPreservingOrder(reasons).slice(0, 2);
  if (uniqueReasons.length === 0) return `${subject} gives your Vault a nearby card to compare by artwork, set feel, and release story without being another copy of the same chase.`;
  return uniqueReasons.join(' ');
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

function candidateVariantFamilyKey(candidate: DiscoveryCandidate): string | undefined {
  const setLabel = sourceSetLabel(candidate);
  if (!setLabel) return undefined;
  const subjectKey = discoveryNameKey(sourceCardSubject(candidate, setLabel));
  const setKey = discoveryNameKey(setLabel);
  if (!subjectKey || !setKey) return undefined;
  return `${subjectKey}|${setKey}`;
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
  const seenVariantFamilies = new Set<string>();
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
  const candidateVariantIsFresh = (candidate: DiscoveryCandidate): boolean => {
    const variantKey = candidateVariantFamilyKey(candidate);
    return !variantKey || !seenVariantFamilies.has(variantKey);
  };
  const hasSubjectBalancedAlternative = (): boolean =>
    candidates.some((candidate) => !seenNames.has(discoveryDisplayNameKey(candidate.suggestion.name)) && candidateVariantIsFresh(candidate) && candidateSubjectIsUnderLimit(candidate) && (!isJapaneseDiscoveryCandidate(candidate) || japaneseCount < japaneseLimit));
  const canUseCandidateSubject = (candidate: DiscoveryCandidate): boolean => candidateSubjectIsUnderLimit(candidate) || !hasSubjectBalancedAlternative();
  const hasNonHistoryFallbackAlternative = (): boolean =>
    candidates.some((candidate) => !seenNames.has(discoveryDisplayNameKey(candidate.suggestion.name)) && candidateVariantIsFresh(candidate) && !isConcreteHistoryFallbackCandidate(candidate) && candidateSubjectIsUnderLimit(candidate) && (!isJapaneseDiscoveryCandidate(candidate) || japaneseCount < japaneseLimit));
  const pushCandidate = (candidate: DiscoveryCandidate): void => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    selected.push(candidate);
    seenNames.add(nameKey);
    if (variantKey) seenVariantFamilies.add(variantKey);
    trailCounts.set(trailLabel, (trailCounts.get(trailLabel) ?? 0) + 1);
    for (const subjectKey of candidateSubjectBalanceKeys(candidate)) subjectCounts.set(subjectKey, (subjectCounts.get(subjectKey) ?? 0) + 1);
    if (isJapaneseDiscoveryCandidate(candidate)) japaneseCount += 1;
  };
  for (const candidate of candidates) {
    const theme = collectorTheme(candidate);
    const subjectKeys = candidateSubjectKeys(candidate);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenThemes.has(theme)) continue;
    if (!candidateVariantIsFresh(candidate)) continue;
    if (isConcreteHistoryFallbackCandidate(candidate) && hasNonHistoryFallbackAlternative()) continue;
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
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenNames.has(nameKey) || selectedTrailLabels.has(trailLabel)) continue;
    if (!candidateVariantIsFresh(candidate)) continue;
    if (isConcreteHistoryFallbackCandidate(candidate) && hasNonHistoryFallbackAlternative()) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
    selectedTrailLabels.add(trailLabel);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const trailLabel = discoveryCandidateTrailLabel(candidate);
    if (seenNames.has(nameKey)) continue;
    if (!candidateVariantIsFresh(candidate)) continue;
    if (isConcreteHistoryFallbackCandidate(candidate) && hasNonHistoryFallbackAlternative()) continue;
    if ((trailCounts.get(trailLabel) ?? 0) >= trailLimit && candidates.some((other) => !seenNames.has(discoveryDisplayNameKey(other.suggestion.name)) && candidateVariantIsFresh(other) && (trailCounts.get(discoveryCandidateTrailLabel(other)) ?? 0) < trailLimit)) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (!candidateVariantIsFresh(candidate)) continue;
    if (isConcreteHistoryFallbackCandidate(candidate) && hasNonHistoryFallbackAlternative()) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    if (!canUseCandidateSubject(candidate)) continue;
    pushCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (!candidateVariantIsFresh(candidate)) continue;
    if (isConcreteHistoryFallbackCandidate(candidate) && hasNonHistoryFallbackAlternative()) continue;
    if (isJapaneseDiscoveryCandidate(candidate) && japaneseCount >= japaneseLimit) continue;
    pushCandidate(candidate);
  }
  return selected;
}

export function selectVisibleCandidates(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile): DiscoveryCandidate[] {
  const profileAlignedCandidates = preferProfileFormatAffinity(candidates, chases, VISIBLE_DISCOVERY_COUNT);
  const strongRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter(hasEnoughRawMarketData), chases, negativeProfile);
  const partialRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases, negativeProfile);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases, negativeProfile);
  const strongSelection = takeDistinctThemes(strongRawData, chases);
  if (strongSelection.length >= VISIBLE_DISCOVERY_COUNT) return strongSelection;
  const selectedNameKeys = new Set(strongSelection.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const remainingCandidates = [...partialRawData, ...tasteRankedFallback].filter((candidate) => !selectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)));
  return takeDistinctThemes([...strongSelection, ...remainingCandidates], chases);
}

export function selectVisibleCandidatesForCount(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = VISIBLE_DISCOVERY_COUNT, negativeProfile?: DiscoveryNegativeProfile): DiscoveryCandidate[] {
  const profileAlignedCandidates = preferProfileFormatAffinity(candidates, chases, count);
  const strongRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter(hasEnoughRawMarketData), chases, negativeProfile);
  const partialRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases, negativeProfile);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases, negativeProfile);
  const strongSelection = takeDistinctThemes(strongRawData, chases, count);
  if (strongSelection.length >= count) return strongSelection;
  const selectedNameKeys = new Set(strongSelection.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const remainingCandidates = [...partialRawData, ...tasteRankedFallback].filter((candidate) => !selectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)));
  return takeDistinctThemes([...strongSelection, ...remainingCandidates], chases, count);
}

export function discoveryEmbed(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency, includeMarketRead: boolean, displayIndex?: number): EmbedBuilder {
  const tone = discoveryVisualTone(candidate.suggestion.lane);
  const title = displayIndex === undefined ? candidate.suggestion.name : `${displayIndex}. ${candidate.suggestion.name}`;
  const threadLabel = `${tone.icon} ${discoveryCandidateTrailLabel(candidate)}`;
  const embed = new EmbedBuilder().setColor(tone.color).setTitle(title);
  const fields = [
    { name: 'Why It Fits', value: resonanceText(candidate), inline: false },
    { name: 'Collector Cue', value: tasteSignalText(candidate), inline: false },
    ...(includeMarketRead ? [{ name: 'Market Snapshot', value: formatMarketRead(candidate, currencyHint), inline: true }] : [])
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

export function discoveryCardEmbeds(candidates: DiscoveryCandidate[], currencyHint: SupportedCurrency, hasFullDiscovery: boolean, startIndex = 0): EmbedBuilder[] {
  return candidates.map((candidate, index) => discoveryEmbed(candidate, currencyHint, hasFullDiscovery, startIndex + index + 1));
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

function createDiscoveryActionItems(userId: string, candidates: DiscoveryCandidate[], startIndex = 0): DiscoveryActionItem[] {
  return candidates.map((candidate, index) => ({ candidate, token: createDiscoveryVaultButtonToken(userId, candidate), index: startIndex + index + 1 }));
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

export function discoveryActionRows(userId: string, candidates: DiscoveryCandidate[], includeFeedbackActions = false, startIndex = 0): DiscoveryActionRow[] {
  const actionItems = createDiscoveryActionItems(userId, candidates, startIndex);
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

function discoveryShelfPageRows(userId: string, page: number, totalPages: number): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DISCOVERY_DROP_PAGE_PREFIX}:${userId}:${Math.max(0, page - 1)}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`${DISCOVERY_DROP_PAGE_PREFIX}:${userId}:${Math.min(totalPages - 1, page + 1)}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  ];
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
  return preparedDiscoveryStateKey(tier, visibleCount);
}

function sourceStatusFromScheduledMarketStatus(status: string): DiscoveryCandidate['sourceStatus'] | undefined {
  if (status === 'RATE_LIMITED' || status === 'TIMEOUT' || status === 'ERROR') return status;
  if (status === 'PENDING' || status === 'MISSING') return 'PENDING';
  return undefined;
}

function candidatesFromScheduledDiscoveryDrop(drop: ScheduledDiscoveryDrop): DiscoveryCandidate[] {
  return drop.items.map((item) => ({
    suggestion: item.suggestion,
    selectionIndex: item.position - 1,
    image: item.imageUrl
      ? {
          name: item.suggestion.name,
          url: item.imageUrl,
          sourceName: item.imageSourceName,
          sourceKind: 'CARD_REFERENCE' as const
        }
      : undefined,
    typicalRawAskingTotal: item.market.askingTotal,
    marketSampleSize: item.market.askingSampleSize,
    typicalRawSoldTotal: item.market.soldTotal,
    soldSampleSize: item.market.soldSampleSize,
    displayCurrency: item.market.currency,
    sourceStatus: sourceStatusFromScheduledMarketStatus(item.market.status)
  }));
}

export function backfillScheduledDiscoveryShelfCandidates(candidates: DiscoveryCandidate[], fallbackDrop: ScheduledDiscoveryDrop | null, targetCount: number, repeatGuardChases: Chase[] = []): DiscoveryCandidate[] {
  const merged = candidates.filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases));
  if (!fallbackDrop || merged.length >= targetCount) return merged;
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const seenVariantFamilies = new Set(merged.map(candidateVariantFamilyKey).filter((key): key is string => !!key));
  for (const candidate of candidatesFromScheduledDiscoveryDrop(fallbackDrop)) {
    if (merged.length >= targetCount) break;
    if (!isDisplayableDiscoveryCandidate(candidate) || !hasEnoughRawMarketData(candidate)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    if (seenNames.has(nameKey) || (variantKey && seenVariantFamilies.has(variantKey))) continue;
    merged.push(candidate);
    seenNames.add(nameKey);
    if (variantKey) seenVariantFamilies.add(variantKey);
  }
  return merged;
}

function scheduledMarketStatusFromCandidate(candidate: DiscoveryCandidate): string {
  if (hasEnoughRawMarketData(candidate)) return 'READY';
  return candidate.sourceStatus ?? 'PENDING';
}

function scheduledDropItemsFromCandidates(candidates: DiscoveryCandidate[], currency: SupportedCurrency): ScheduledDiscoveryDropItem[] {
  return candidates.map((candidate, index) => ({
    position: index + 1,
    suggestion: candidate.suggestion,
    imageUrl: candidate.image?.url,
    imageSourceName: candidate.image?.sourceName,
    market: {
      status: scheduledMarketStatusFromCandidate(candidate),
      currency: candidate.displayCurrency ?? currency,
      askingTotal: candidate.typicalRawAskingTotal,
      askingSampleSize: candidate.marketSampleSize,
      soldTotal: candidate.typicalRawSoldTotal,
      soldSampleSize: candidate.soldSampleSize,
      listing: candidate.listing
        ? {
            id: candidate.listing.listingId,
            title: candidate.listing.title,
            url: candidate.listing.url
          }
        : undefined
    }
  }));
}

function saveWeeklyDiscoveryDrop(userId: string, candidates: DiscoveryCandidate[], currency: SupportedCurrency, sourceStateUpdatedAt?: string, date = new Date()): void {
  if (candidates.length === 0) return;
  const items = scheduledDropItemsFromCandidates(candidates, currency);
  const readyCount = items.filter((item) => item.market.status === 'READY').length;
  const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date);
  const availability = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  upsertScheduledDiscoveryDrop({
    userId,
    dropType: 'WEEKLY_DISCOVERY',
    periodKey,
    status: readyCount === items.length ? 'READY' : 'PARTIAL',
    title: 'Weekly Shelf',
    summary: 'A collector shelf tuned from your Vault and recent taste signals.',
    currency,
    availableAt: availability.availableAt,
    expiresAt: availability.expiresAt,
    sourceStateUpdatedAt,
    items
  });
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

function clampDiscoveryShelfPage(page: number, totalItems: number): { page: number; totalPages: number; start: number; end: number } {
  const totalPages = Math.max(1, Math.ceil(totalItems / DISCOVERY_SHELF_PAGE_SIZE));
  const safePage = Math.min(totalPages - 1, Math.max(0, Math.floor(page)));
  const start = safePage * DISCOVERY_SHELF_PAGE_SIZE;
  return { page: safePage, totalPages, start, end: start + DISCOVERY_SHELF_PAGE_SIZE };
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

async function discoverCandidatesForUser(
  userId: string,
  count: number,
  options: { preferScheduledDrop?: boolean; requireScheduledDrop?: boolean; saveScheduledDrop?: boolean; scheduledDate?: Date; hydrateScheduledMarketInline?: boolean; usePersistedState?: boolean } = {}
): Promise<{
  chases: Chase[];
  tasteProfileChases: Chase[];
  settings: ReturnType<typeof getUserAlertSettings>;
  hasFullDiscovery: boolean;
  hasLearnedProfile: boolean;
  profileConfidence: DiscoveryProfileConfidence;
  lane: string;
  candidates: DiscoveryCandidate[];
}> {
  const preferScheduledDrop = options.preferScheduledDrop ?? true;
  const requireScheduledDrop = options.requireScheduledDrop ?? false;
  const shouldSaveScheduledDrop = options.saveScheduledDrop ?? true;
  const hydrateScheduledMarketInline = options.hydrateScheduledMarketInline ?? true;
  const usePersistedState = options.usePersistedState ?? true;
  const storedChases = listChases(userId);
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const chases = activePlanChases(storedChases, plan);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const hasFullDiscovery = entitlements.discoveryDepth === 'full';
  const visibleCount = Math.min(count, weeklyDiscoveryShelfSizeForPlan(activeTier));
  const tasteMemoryChases = hasFullDiscovery ? listUserTasteMemoryChases(userId) : [];
  const tasteProfileChases = discoveryTasteProfileChases(chases, tasteMemoryChases, hasFullDiscovery);
  const repeatGuardChases = [...storedChases, ...removedTasteMemoryChases(tasteMemoryChases)];
  const profileConfidence = discoveryProfileConfidence(tasteProfileChases);
  const targetVisibleCount = hasFullDiscovery ? Math.min(visibleCount, profileConfidence.maxShelfSize) : visibleCount;
  const hasLearnedProfile = hasFullDiscovery && (profileConfidence.tier === 'USABLE' || profileConfidence.tier === 'STRONG');
  const recentlyRejected = listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME');
  const rejectedNames = recentlyRejected.map((item) => item.suggestionName);
  const negativeProfile = discoveryNegativeProfile(recentlyRejected, tasteProfileChases);
  const recentlySeenNames = listRecentUserDiscoverySeenNames(userId);
  const profileFingerprint = discoveryProfileFingerprint(tasteProfileChases, rejectedNames, activeTier, targetVisibleCount);
  const stateKey = discoveryStateKey(activeTier, targetVisibleCount);
  const latestDrop = hasFullDiscovery && preferScheduledDrop ? getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY') : null;
  if (latestDrop && latestDrop.items.length > 0) {
    const rejectedNameKeys = new Set(rejectedNames.map(discoveryNameKey));
    const scheduledCandidates = candidatesFromScheduledDiscoveryDrop(latestDrop)
      .filter((candidate) => !rejectedNameKeys.has(discoveryNameKey(candidate.suggestion.name)))
      .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases))
      .filter(isDisplayableDiscoveryCandidate)
      .slice(0, targetVisibleCount);
    const scheduledMarketContext = {
      userId,
      activeChases: chases,
      destination: settings.shippingCountry ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode } : undefined,
      targetCurrency: settings.alertCurrency,
      range: discoveryMarketRangeFromChases(tasteProfileChases),
      forceRefreshMissingSignal: true,
      forceRefreshThinSignal: true
    };
    const cachedScheduledCandidates = candidatesFromDiscoveryMarketCache(scheduledCandidates, scheduledMarketContext);
    const candidates = orderCandidatesForMarketConfidence(
      hydrateScheduledMarketInline
        ? await settlePendingDiscoveryMarketCandidates(await hydratePendingDiscoveryMarketCandidates(cachedScheduledCandidates, scheduledMarketContext), scheduledMarketContext)
        : cachedScheduledCandidates,
      tasteProfileChases,
      negativeProfile
    );
    if (hydrateScheduledMarketInline && shouldSaveScheduledDrop && candidates.some(hasMarketSignal)) {
      saveWeeklyDiscoveryDrop(userId, candidates, settings.alertCurrency, latestDrop.sourceStateUpdatedAt);
    }
    return {
      chases,
      tasteProfileChases,
      settings,
      hasFullDiscovery,
      hasLearnedProfile,
      profileConfidence,
      lane: 'weekly discovery',
      candidates
    };
  }
  if (requireScheduledDrop) {
    return {
      chases,
      tasteProfileChases,
      settings,
      hasFullDiscovery,
      hasLearnedProfile,
      profileConfidence,
      lane: 'weekly discovery',
      candidates: []
    };
  }
  const selectAndEnrich = async () => {
    const combinedExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const combinedSourceExcludedNames = uniqueValuesPreservingOrder(rejectedNames);
    const persistedState = usePersistedState && hasFullDiscovery && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT ? getUserDiscoveryState(userId, stateKey) : null;
    const selection = selectDiscoverySuggestionsForFocuses([], tasteProfileChases, DISCOVERY_CANDIDATE_POOL_SIZE, {
      excludedNames: combinedExcludedNames,
      excludeLanesForExcludedNames: combinedExcludedNames.length > 0
    });
    const discoverySelectionCount = discoveryCandidateSelectionCount(hasFullDiscovery, targetVisibleCount);
    const activeSafeSuggestions = selection.suggestions.filter((suggestion) => !isActiveChaseEchoSuggestion(suggestion, repeatGuardChases));
    const sourceBackedSuggestions = await expandSourceBackedSuggestions(activeSafeSuggestions, chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
    const excludedSourceNameKeys = new Set(combinedSourceExcludedNames.map(discoveryNameKey));
    const marketContext = {
      userId,
      activeChases: chases,
      destination: settings.shippingCountry ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode } : undefined,
      targetCurrency: settings.alertCurrency,
      range: discoveryMarketRangeFromChases(tasteProfileChases)
    };
    const concreteFallbackSuggestions = orderConcreteDiscoveryFallbackSuggestionsForMarket(
      concreteDiscoveryFallbackSuggestions([...(persistedState?.suggestionNames ?? []), ...recentlySeenNames], combinedSourceExcludedNames),
      marketContext
    );
    const sourceBackedFreshSuggestions = sourceBackedSuggestions.filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name)) && !isActiveChaseEchoSuggestion(suggestion, repeatGuardChases));
    let concreteSourceBackedSuggestions = sourceBackedFreshSuggestions;
    if (concreteSourceBackedSuggestions.length < discoverySelectionCount) {
      const starterSelection = selectDiscoverySuggestionsForFocuses([], [], DISCOVERY_CANDIDATE_POOL_SIZE, {
        excludedNames: [...combinedSourceExcludedNames, ...concreteSourceBackedSuggestions.map((suggestion) => suggestion.name)]
      });
      const starterSourceBackedSuggestions = await expandSourceBackedSuggestions(starterSelection.suggestions, chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
      concreteSourceBackedSuggestions = backfillSourceBackedDiscoverySuggestions(concreteSourceBackedSuggestions, starterSourceBackedSuggestions, discoverySelectionCount);
    }
    if (hasLearnedProfile && concreteSourceBackedSuggestions.length < discoverySelectionCount) {
      const broadSourceBackedSuggestions = await expandSourceBackedSuggestions(broadSourceBackfillParents(), chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
      concreteSourceBackedSuggestions = backfillSourceBackedDiscoverySuggestions(concreteSourceBackedSuggestions, broadSourceBackedSuggestions, discoverySelectionCount);
    }
    const freshSourceBackedSuggestions = backfillDiscoverySuggestions(
      concreteSourceBackedSuggestions,
      activeSafeSuggestions.filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name))),
      concreteFallbackSuggestions,
      discoverySelectionCount
    );
    const enriched = freshSourceBackedSuggestions.map((suggestion, index) => tasteOnlyCandidate(suggestion, index));
    const rankedCandidates = selectVisibleCandidatesForCount(enriched, tasteProfileChases, discoverySelectionCount, negativeProfile);
    const persistedCandidates =
      persistedState?.profileFingerprint === profileFingerprint && persistedState.suggestionNames.length >= targetVisibleCount
        ? orderCandidatesFromPersistedState(rankedCandidates, persistedState.suggestionNames, targetVisibleCount, { hardExcludedNames: rejectedNames })
        : null;
    const discoveryCandidatePool =
      persistedCandidates ??
      orderCandidatesFromPersistedState(rankedCandidates, [], discoverySelectionCount, {
        hardExcludedNames: rejectedNames,
        softAvoidNames: hasFullDiscovery ? [] : recentlySeenNames
      });
    const cacheCandidates = candidatesFromDiscoveryMarketCache(discoveryCandidatePool, marketContext);
    const marketCandidates = hasFullDiscovery && hydrateScheduledMarketInline
      ? await hydratePendingDiscoveryMarketCandidates(cacheCandidates, marketContext)
      : cacheCandidates;
    const selectionPool = hasFullDiscovery && hydrateScheduledMarketInline
      ? backfillMarketReadyDiscoveryCandidates(marketCandidates, marketContext, targetVisibleCount, tasteProfileChases, profileConfidence, negativeProfile, repeatGuardChases, rejectedNames)
      : marketCandidates;
    const reliableSelectionPool = selectionPool.filter(hasReliableMarketEstimate);
    const reliableCandidates = hasFullDiscovery && hydrateScheduledMarketInline && !persistedCandidates
      ? selectVisibleCandidatesForCount(reliableSelectionPool, tasteProfileChases, targetVisibleCount, negativeProfile)
      : [];
    let visibleCandidates = hasFullDiscovery && !persistedCandidates
      ? reliableCandidates.length >= targetVisibleCount
        ? reliableCandidates
        : selectVisibleCandidatesForCount(selectionPool, tasteProfileChases, targetVisibleCount, negativeProfile)
      : selectionPool.slice(0, targetVisibleCount);
    if (hasFullDiscovery && hydrateScheduledMarketInline) visibleCandidates = await settlePendingDiscoveryMarketCandidates(visibleCandidates, marketContext);
    if (hasFullDiscovery && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT && visibleCandidates.length >= targetVisibleCount) {
      upsertUserDiscoveryState({ userId, mode: stateKey, profileFingerprint, suggestionNames: visibleCandidates.map((candidate) => candidate.suggestion.name) });
    }
    const candidates = (await attachReferenceImages(visibleCandidates))
      .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases))
      .filter(isDisplayableDiscoveryCandidate);
    if (hasFullDiscovery && shouldSaveScheduledDrop && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT) {
      saveWeeklyDiscoveryDrop(userId, candidates, settings.alertCurrency, persistedState?.updatedAt, options.scheduledDate);
    }
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
    profileConfidence,
    lane,
    candidates
  };
}

function discoveryShelfPayload(userId: string, discovery: Awaited<ReturnType<typeof discoverCandidatesForUser>>, requestedPage = 0): DiscoveryShelfPayload {
  if (discovery.candidates.length === 0) {
    const lines = discovery.hasFullDiscovery
      ? [
          '🔮 Your Weekly Shelf is still being curated',
          'Add a few more chases or save feedback so Vaultr has more collector patterns to follow'
        ]
      : [
          '🎬 Your preview needs a few Vault signals',
          'Add a chase or two so Vaultr has a trail to follow'
        ];
    return {
      embeds: [infoEmbed('Weekly Shelf', lines.join('\n')).setColor(DISCOVERY_OVERVIEW_COLOR).setFooter({ text: 'Vaultr • Weekly Shelf' })],
      components: [],
      candidateNames: [],
      hasFullDiscovery: discovery.hasFullDiscovery
    };
  }
  const shelfCandidates = marketReadyShelfCandidates(discovery.candidates, discovery.hasFullDiscovery, discovery.profileConfidence);
  const hiddenCandidateCount = Math.max(0, discovery.candidates.length - shelfCandidates.length);
  const pageState = clampDiscoveryShelfPage(requestedPage, shelfCandidates.length);
  const visibleCandidates = shelfCandidates.slice(pageState.start, pageState.end);
  const visiblePaths = uniqueValuesPreservingOrder(visibleCandidates.map((candidate) => discoveryCandidateTrailLabel(candidate)));
  const title = discovery.hasFullDiscovery ? '💫 Vaultr Weekly Discovery Shelf' : '✨ Weekly Shelf Preview';
  const shelfPickLabel = shelfCandidates.length === 1 ? 'pick' : 'picks';
  const pathSummary = compactDiscoveryPathSummary(visiblePaths);
  const profileSummary = learningSignal(
    discovery.chases,
    discovery.tasteProfileChases,
    discovery.lane,
    discovery.hasFullDiscovery,
    discovery.hasLearnedProfile
  );
  const marketCheckedProfileSummary = profileSummary.includes('; ')
    ? profileSummary.replace('; ', ' with live market checks; ')
    : `${profileSummary} with live market checks`;
  const lines = [
    discovery.hasFullDiscovery
      ? `🪄 **Personal Picks:** ${shelfCandidates.length} new ${shelfCandidates.length === 1 ? 'find' : 'finds'} shaped by ${marketCheckedProfileSummary}`
      : `🎬 **Preview:** ${shelfCandidates.length} ${shelfPickLabel} shaped by ${profileSummary}`,
    `🧵 **Threads:** ${pathSummary}`
  ];
  if (discovery.hasFullDiscovery && hiddenCandidateCount > 0) {
    lines.push('', discoveryShelfMarketCheckNote(shelfCandidates.length));
  } else if (shouldShowDiscoveryShelfTighteningNote(discovery.hasFullDiscovery, shelfCandidates.length)) {
    lines.push(discoveryShelfTighteningNote());
  }
  if (!discovery.hasFullDiscovery) {
    lines.push('Just a heads up... Pro members get the full Weekly Shelf with feedback-powered taste memory, live market reads on every card, and tune-out controls for future drops');
  }
  const actionRows = discoveryActionRows(userId, visibleCandidates, discovery.hasFullDiscovery, pageState.start);
  const headerEmbed = discoveryShelfHeaderEmbed(title, lines);
  const cardEmbeds = discoveryCardEmbeds(visibleCandidates, discovery.settings.alertCurrency, discovery.hasFullDiscovery, pageState.start);
  return {
    headerEmbeds: [headerEmbed],
    embeds: discovery.hasFullDiscovery ? cardEmbeds : [headerEmbed, ...cardEmbeds],
    components: [...actionRows, ...discoveryShelfPageRows(userId, pageState.page, pageState.totalPages)],
    candidateNames: visibleCandidates.map((candidate) => candidate.suggestion.name),
    hasFullDiscovery: discovery.hasFullDiscovery
  };
}

export async function buildDiscoveryShelfPayload(userId: string, page = 0): Promise<DiscoveryShelfPayload> {
  const activeTier = activePlanTier(getUserPlan(userId));
  const discovery = await discoverCandidatesForUser(userId, weeklyDiscoveryShelfSizeForPlan(activeTier), {
    preferScheduledDrop: activeTier === 'PRO',
    requireScheduledDrop: activeTier === 'PRO',
    saveScheduledDrop: false,
    hydrateScheduledMarketInline: false
  });
  const payload = discoveryShelfPayload(userId, discovery, page);
  markUserDiscoverySuggestionsSeen(userId, payload.candidateNames);
  return payload;
}

function discoveryReplyPayload(payload: DiscoveryShelfPayload): { content?: string; embeds: EmbedBuilder[]; components: DiscoveryActionRow[] } {
  return {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components
  };
}

function discoveryHeaderReplyPayload(payload: DiscoveryShelfPayload): { content?: string; embeds: EmbedBuilder[]; components: DiscoveryActionRow[] } {
  return {
    embeds: payload.headerEmbeds ?? payload.embeds,
    components: []
  };
}

export async function prepareWeeklyDiscoveryDropForUser(userId: string, date = new Date(), options: { force?: boolean } = {}): Promise<{
  prepared: boolean;
  itemCount: number;
  hasFullDiscovery: boolean;
}> {
  const availability = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  const previousDropLookupDate = new Date(Date.parse(availability.availableAt) - 1);
  const fallbackDrop = getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', previousDropLookupDate.toISOString());
  const existing = !options.force ? getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date)) : null;
  if (existing && (existing.status === 'READY' || existing.status === 'PARTIAL') && existing.itemCount > 0) {
    return {
      prepared: true,
      itemCount: existing.itemCount,
      hasFullDiscovery: getEntitlementsForTier(activePlanTier(getUserPlan(userId))).discoveryDepth === 'full'
    };
  }
  const discovery = await discoverCandidatesForUser(userId, DISCOVERY_WEEKLY_DROP_SIZE, { preferScheduledDrop: false, saveScheduledDrop: true, scheduledDate: date, hydrateScheduledMarketInline: true, usePersistedState: false });
  const targetCount = discovery.hasFullDiscovery ? Math.min(DISCOVERY_WEEKLY_DROP_SIZE, discovery.profileConfidence.maxShelfSize) : discovery.candidates.length;
  const candidates = backfillScheduledDiscoveryShelfCandidates(discovery.candidates, fallbackDrop, targetCount, removedTasteMemoryChases(listUserTasteMemoryChases(userId)));
  if (candidates.length > discovery.candidates.length) saveWeeklyDiscoveryDrop(userId, candidates, discovery.settings.alertCurrency, undefined, date);
  return {
    prepared: candidates.length > 0 && discovery.hasFullDiscovery,
    itemCount: candidates.length,
    hasFullDiscovery: discovery.hasFullDiscovery
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

export async function handleDiscoveryDropOpen(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_DROP_OPEN_PREFIX}:`)) return false;

  const [, dropType] = interaction.customId.split(':') as [string, ScheduledDiscoveryDropType | undefined, string | undefined];
  if (dropType !== 'WEEKLY_DISCOVERY') {
    await interaction.reply({ embeds: [warningEmbed('Drop Unavailable', 'That Weekly Shelf is not ready yet.')], flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const payload = await buildDiscoveryShelfPayload(interaction.user.id);
  if (payload.hasFullDiscovery && payload.headerEmbeds && payload.embeds.length > 0) {
    await interaction.editReply(discoveryHeaderReplyPayload(payload));
    await interaction.followUp({ ...discoveryReplyPayload(payload), flags: MessageFlags.Ephemeral });
  } else {
    await interaction.editReply(discoveryReplyPayload(payload));
  }
  return true;
}

export async function handleDiscoveryDropPage(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_DROP_PAGE_PREFIX}:`)) return false;

  const [, ownerUserId, rawPage] = interaction.customId.split(':');
  if (!ownerUserId || rawPage === undefined) return false;
  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({ content: 'Only the original requester can page through this Discovery shelf.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const page = Number.parseInt(rawPage, 10);
  await interaction.deferUpdate();
  const payload = await buildDiscoveryShelfPayload(interaction.user.id, Number.isFinite(page) ? page : 0);
  await interaction.editReply(discoveryReplyPayload(payload));
  return true;
}

export function discoveryDropOpenButton(dropType: ScheduledDiscoveryDropType, periodKey: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DISCOVERY_DROP_OPEN_PREFIX}:${dropType}:${periodKey}`)
      .setLabel('Open My Shelf')
      .setStyle(ButtonStyle.Primary)
  );
}

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
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh cards to add to your Vault.')],
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
    listingType: 'ANY'
  });
  recordDiscoveryAddTaste(interaction.user.id, chase.cardName, chase.maxPrice);

  const lines = [
    'Nice find. Added to your Vault, and Vaultr will keep watch.',
    'It will shape future Weekly Shelves once the next drop is packed.',
    '',
    `**Card:** ${chase.cardName}`,
    `**Path:** ${discoveryTrailLabel(pick.lane)}`,
    `**Max Price:** ${chase.maxPrice ?? 'Any'}`,
    `**Grade:** Ungraded`,
    '',
    '**Next:** Use `/chase list` to review active chases'
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
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh cards to tune.')],
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
      ? `Vaultr will treat **${pick.cardName}** as a stronger preference signal for your next Discovery release.`
      : `Vaultr will avoid **${pick.cardName}** and gently downrank close subject matches when they do not conflict with your Vault.`;
  const undoRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DISCOVERY_FEEDBACK_UNDO_PREFIX}:${interaction.user.id}:${pick.token}`)
      .setLabel('Undo')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [successEmbed(title, message)],
    components: [undoRow],
    flags: MessageFlags.Ephemeral
  });
}

export async function handleDiscoveryFeedbackUndo(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${DISCOVERY_FEEDBACK_UNDO_PREFIX}:`)) return false;

  const [, ownerUserId, token] = interaction.customId.split(':');
  if (!ownerUserId || !token) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can undo this Discovery feedback.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Undo Expired', 'Open the latest Weekly Shelf again to tune fresh cards.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const undone = undoDiscoveryFeedback({ userId: interaction.user.id, cardName: pick.cardName });
  const description = undone
    ? `Removed your feedback for **${pick.cardName}**. Your next Discovery release will ignore that signal.`
    : `No active Discovery feedback was found for **${pick.cardName}**.`;
  await interaction.update({
    embeds: [successEmbed('Feedback Undone', description)],
    components: []
  });
  return true;
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
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh card actions.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const activeTier = activePlanTier(getUserPlan(interaction.user.id));
  const includeFeedbackActions = activeTier === 'PRO';
  const lines = [
    'Choose an action for this shelf card.',
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
