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
  getDiscoveryGlobalCollectorGrammarSummary,
  getDiscoveryVaultAction,
  getDiscoveryLearnedSignalSummary,
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
  recordDiscoveryTrainingExamples,
  undoDiscoveryFeedback,
  upsertUserDiscoveryState
} from '../services/chase-store.js';
import { convertCurrencyAmount, roundConvertedMaxPrice, type SupportedCurrency } from '../services/currency.js';
import { buildEbaySearchKeywords, searchEbayListings, searchEbaySoldListings } from '../services/ebay.js';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestionsForFocuses, type DiscoverySuggestion } from '../services/discovery-catalog.js';
import { listDiscoveryUniverseCards, upsertDiscoveryUniverseCard, type DiscoveryUniverseCard } from '../services/discovery-card-universe.js';
import { listDiscoveryUserUniverseCards, replaceDiscoveryUserUniverseCards, type DiscoveryUserUniverseCard } from '../services/discovery-user-universe.js';
import {
  discoveryMarketCacheKey,
  getDiscoveryMarketCache,
  listDiscoveryMarketSignalCacheEntries,
  listReliableDiscoveryMarketCacheEntries,
  listingFromDiscoveryMarketCache,
  upsertDiscoveryMarketCache,
  type DiscoveryMarketCacheEntry
} from '../services/discovery-market-cache.js';
import { completeDiscoveryMarketRefreshJob, enqueueDiscoveryMarketRefreshJobs, getDiscoveryMarketRefreshQueueStats } from '../services/discovery-market-jobs.js';
import { getOrFetchDiscoveryReferenceImage } from '../services/discovery-reference-cache.js';
import { resolveSourceBackedDiscoveryCards } from '../services/discovery-source-catalog.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanChases, activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { getPollerState } from '../services/poller-state.js';
import { PREPARED_DISCOVERY_SELECTION_VERSION, preparedDiscoveryStateKey } from '../services/prepared-discovery.js';
import {
  getLatestAvailableScheduledDiscoveryDrop,
  listRecentAvailableScheduledDiscoveryDrops,
  getScheduledDiscoveryDrop,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop,
  type ScheduledDiscoveryDrop,
  type ScheduledDiscoveryDropType,
  type ScheduledDiscoveryDropItem
} from '../services/scheduled-discovery-drops.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { freeVaultLimitMessage } from './pro-copy.js';
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

export type DiscoveryCollectorFeatures = {
  directSubjectSupport: number;
  adjacentThemeNovelty: boolean;
  japaneseAffinity: number;
  japaneseSignal: boolean;
  promoSignal: boolean;
  eReaderSignal: boolean;
  retailEReaderSignal: boolean;
  nicheExclusiveSignal: boolean;
  exactNicheIdentity: boolean;
  premiumFormatContext: boolean;
  ordinaryFormatPenalty: boolean;
  weakSubjectPenalty: boolean;
  historyFallbackPenalty: boolean;
  negativeSignalPenalty: number;
  marketEvidence: number;
  imageEvidence: number;
  curiosity: number;
  collectorTerms: string[];
  collectorTraits: Record<string, string[]>;
};

type DiscoveryLearnedRankContext = ReturnType<typeof getDiscoveryLearnedSignalSummary> & {
  globalTypedTraitEdgeWeights?: Record<string, number>;
  globalExampleCount?: number;
  vaultTypedTraitEdgeWeights?: Record<string, number>;
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
type MarketReadyShelfOptions = {
  allowPendingExploration?: boolean;
  allowLanguageSignalFallback?: boolean;
  allowSourceBackedRetailEReaderFallback?: boolean;
  languageSignalTargetCount?: number;
};

const MIN_LEARNED_PROFILE_CHASES = 6;
const MIN_STRONG_PROFILE_CHASES = 9;
const VISIBLE_DISCOVERY_COUNT = 7;
const DISCOVERY_SHELF_PAGE_SIZE = 10;
const DISCOVERY_WEEKLY_DROP_SIZE = Math.max(DISCOVERY_SHELF_PAGE_SIZE, Math.min(20, Math.floor(Number(process.env.DISCOVERY_WEEKLY_DROP_SIZE ?? '20'))));
const DISCOVERY_CANDIDATE_POOL_SIZE = Math.max(72, DISCOVERY_WEEKLY_DROP_SIZE * 3);
const DISCOVERY_SEEN_EXCLUSION_LIMIT = Math.max(120, DISCOVERY_WEEKLY_DROP_SIZE * 6);
const DISCOVERY_ENRICHMENT_CONCURRENCY = 4;
const DISCOVERY_BACKGROUND_ENRICHMENT_CONCURRENCY = 1;
const DISCOVERY_SOURCE_TIMEOUT_MS = Math.max(30000, Math.min(90000, Math.floor(Number(process.env.DISCOVERY_SOURCE_TIMEOUT_MS ?? '60000'))));
const DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS = Math.max(0, Math.min(20000, Math.floor(Number(process.env.DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS ?? '12000'))));
const DISCOVERY_MARKET_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DISCOVERY_REFERENCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DISCOVERY_SOURCE_STATUS_RETRY_MS = 15 * 60 * 1000;
const DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_MS = Math.max(0, Math.floor(Number(process.env.DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_SECONDS ?? '300')) * 1000);
const DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS = Math.max(1, Math.floor(Number(process.env.DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS ?? '250')));
const DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS = Math.max(60_000, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS ?? `${10 * 60 * 1000}`)));
const MIN_RAW_MARKET_SAMPLE_SIZE = 2;
const MIN_ASK_ONLY_MARKET_SAMPLE_SIZE = 4;
const TARGET_RAW_MARKET_SAMPLE_SIZE = 12;
const MIN_COLLECTOR_WORTHY_MODERN_PROMO_TOTAL = 20;
const MIN_COLLECTOR_WORTHY_MODERN_SET_TOTAL = 25;
const MIN_COLLECTOR_WORTHY_ORDINARY_CARD_TOTAL = 15;
const NICHE_DISCOVERY_STRETCH_RATIO = 1.2;
const NICHE_DISCOVERY_STRETCH_ABSOLUTE = 200;
const EBAY_LISTING_IMAGE_SOURCE_NAME = 'eBay listing image';
const VETTED_EBAY_MARKETPLACE_IMAGE_SOURCE_NAME = 'eBay vetted marketplace image';
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
  'jumbo',
  'magnetic case',
  'magnetic holder',
  'keychain',
  'lot',
  'orica',
  'oversized',
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
const DISCOVERY_COLLECTOR_RANKER_VERSION = 'collector-v1';
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
  'sar',
  'shining',
  'sir',
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
    return `taste profile memory, add active chases to sharpen it`;
  }
  if (activeChases.length === 0) return 'add a few chases to shape Discovery';
  const promoSignal = hasPromoLeaningDiscoveryProfile(tasteProfileChases) ? ' + promos emerging' : '';
  const memoryNote = rememberedTasteCount > 0 ? ' + taste profile memory' : '';
  if (hasLearnedProfile) {
    const signals = tasteSignalsFromChases(tasteProfileChases, lane).filter((signal) => signal !== lane);
    const signalNote = signals.length > 0 ? ` + ${signals.join(', ')}` : '';
    return `active chases${memoryNote}${signalNote}`;
  }
  if (hasFullDiscovery) return `taking shape from active chases${memoryNote}${promoSignal}`;
  return `early read from active chases${memoryNote}${promoSignal}`;
}

function personalPicksProfileSummary(profileSummary: string): string {
  const parts = profileSummary.split(' + ');
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, 2).join(' and ')}; ${parts.slice(2).join(', ')}`;
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

function repeatGuardTasteMemoryChases(tasteMemoryChases: Chase[]): Chase[] {
  return tasteMemoryChases.filter((chase) => chase.tasteSource === 'REMOVED_CHASE' || chase.tasteSource === 'BOUGHT_OR_SEEN');
}

function positiveTasteSubjectChases(chases: Chase[]): Chase[] {
  return chases.filter((chase) => chase.tasteSource !== 'REMOVED_CHASE');
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
  return discoveryNameKey(value)
    .replace(/\b([a-z]{2,5})\s+([a-z]{2,5}\d{1,4}[a-z]?)\b/g, (_match, prefix: string, code: string) => code.startsWith(prefix) ? code : `${prefix} ${code}`)
    .replace(/\b([a-z]{2,5}\d{1,4}[a-z]?)\s+([a-z]{2,5})\b/g, (_match, code: string, prefix: string) => code.startsWith(prefix) ? code : `${code} ${prefix}`)
    .replace(/\b(sm|xy|bw|swsh)\s+(sm|xy|bw|swsh)(\d{1,4}[a-z]?)\b/g, (_match, left: string, right: string, number: string) => left === right ? `${left}${number}` : `${left} ${right}${number}`)
    .replace(/\b(sm|xy|bw|swsh)(\d{1,4}[a-z]?)\s+(sm|xy|bw|swsh)\b/g, (_match, left: string, number: string, right: string) => left === right ? `${left}${number}` : `${left}${number} ${right}`)
    .replace(/\b([a-z]{1,4}\d+[a-z]?)\s+(\d{1,3})\s+\d{1,3}\b/g, '$1 $2')
    .replace(/\bblack star\b/g, ' ')
    .replace(/\b(?:holo|holofoil|foil|promo|promos|pokemon|tcg|trading|card|cards)\b/g, ' ')
    .replace(/\b(sm|xy|bw|swsh)\s+(?=\1\d{1,4}[a-z]?\b)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function discoveryExclusionNameKeys(values: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const nameKey = discoveryNameKey(value);
    const displayNameKey = discoveryDisplayNameKey(value);
    if (nameKey) keys.add(nameKey);
    if (displayNameKey) keys.add(displayNameKey);
  }
  return keys;
}

function isDiscoveryNameExcluded(value: string, excludedNameKeys: Set<string>): boolean {
  return excludedNameKeys.has(discoveryNameKey(value)) || excludedNameKeys.has(discoveryDisplayNameKey(value));
}

function discoveryMarketSearchTerms(suggestion: DiscoverySuggestion): string[] {
  const terms = [suggestion.evidenceSearchTerm, suggestion.name, ...(suggestion.evidenceAliases ?? [])]
    .filter((term): term is string => !!term && term.trim().length > 0)
    .map((term) => term.replace(/\s+/g, ' ').trim());
  return uniqueValuesPreservingOrder(terms).slice(0, isRaichuIntroPackSuggestion(suggestion) ? 8 : 3);
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
  const removedMemoryNames = new Set(memoryChases.filter((chase) => chase.tasteSource === 'REMOVED_CHASE').map((chase) => normalize(chase.cardName)));
  const merged: Chase[] = activeChases.map((chase) => ({ ...chase, tasteSource: 'ACTIVE_CHASE' as const }));
  for (const memoryChase of memoryChases) {
    const memoryName = normalize(memoryChase.cardName);
    if (activeNames.has(memoryName)) continue;
    if (memoryChase.tasteSource !== 'REMOVED_CHASE' && removedMemoryNames.has(memoryName)) continue;
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
  if (hasExactRaichuIntroPackListingEvidence(suggestion, listing)) return true;
  const titleTokens = new Set(normalizedTokens(listing.title));
  const listingText = [listing.title, listing.condition].filter(Boolean).join(' ');
  const compactTitle = normalize(listing.title).replace(/[^a-z0-9]+/g, '');
  const candidateNames = [suggestion.name, ...(suggestion.evidenceAliases ?? [])];
  const requiredTokens = suggestion.requiredEvidenceTokens ?? [];
  const hasRequiredTokens = requiredTokens.every((token) => matchesRequiredEvidenceToken(token, titleTokens, compactTitle, listingText));

  if (!hasRequiredTokens) return false;

  if (suggestion.lane.includes('discovery') && requiredTokens.length > 0 && looksLikeCardListing(listing)) return true;

  return candidateNames.some((name) => {
    const suggestionTokens = normalizedTokens(name).filter((token) => !['the', 'and', 'with', 'wearing'].includes(token));
    if (suggestionTokens.length === 0) return false;
    const matches = suggestionTokens.filter((token) => titleTokens.has(token) || compactTitle.includes(token.replace(/[^a-z0-9]+/g, '')));
    return matches.length / suggestionTokens.length >= 0.75;
  });
}

function matchesRequiredEvidenceToken(token: string, titleTokens: Set<string>, compactTitle: string, listingText: string): boolean {
  const normalizedToken = normalize(token).replace(/[^a-z0-9]+/g, '');
  if (titleTokens.has(normalize(token)) || compactTitle.includes(normalizedToken)) return true;
  if (normalizedToken === 'japanese') return hasJapaneseListingEvidence(listingText);

  const identityParts = normalize(token)
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (identityParts.length < 2 || !identityParts.some((part) => /\d/.test(part))) return false;
  return identityParts.every((part) => titleTokens.has(part) || compactTitle.includes(part));
}

function hasJapaneseListingEvidence(value: string): boolean {
  return /\b(?:japanese|japan|jp|jpn)\b/i.test(value) || JAPANESE_PROMO_CODE_PATTERN.test(value) || JAPANESE_SCRIPT_PATTERN.test(value) || JAPANESE_RELEASE_MARKER_PATTERN.test(value) || /\b(?:s|sv|sm|xy)\d{1,3}[a-z]?\b/i.test(value);
}

function isRaichuIntroPackSuggestion(suggestion: DiscoverySuggestion): boolean {
  const suggestionText = normalize([suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? []), ...(suggestion.requiredEvidenceTokens ?? [])].filter(Boolean).join(' '));
  return /\braichu\b/.test(suggestionText) && /\b(?:no\.?\s*)?0?26\b/.test(suggestionText) && /\b(?:intro pack|bulbasaur deck|vhs)\b/.test(suggestionText);
}

function hasExactRaichuIntroPackListingEvidence(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  if (!isRaichuIntroPackSuggestion(suggestion)) return false;
  const listingText = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  if (!/\braichu\b/.test(listingText) || !/\bbulbasaur\b/.test(listingText) || !/\bjapanese\b/.test(listingText)) return false;
  if (!/\b(?:intro pack|vhs|deck)\b/.test(listingText)) return false;
  return /(?:\b(?:no\.?\s*)?0?26\b|#\s?0?3\b|\bno\.?\s?0?3\b)/.test(listingText);
}

function looksLikeCardListing(listing: Listing): boolean {
  const title = normalize(listing.title);
  if (includesAnyNonCardTerm(title)) return false;
  return includesAnyTerm(title, CARD_TERMS);
}

function hasNonCardTerms(listing: Listing): boolean {
  return includesAnyNonCardTerm(listing.title);
}

function allowsNicheSingleCardReleaseTerm(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  const listingText = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  if (!hasExactRaichuIntroPackListingEvidence(suggestion, listing)) return false;
  if (/\b(?:booster|bundle|display|sealed|unopened|lot|set of)\b/.test(listingText)) return false;
  return hasCoreSuggestionTokens(suggestion, listing);
}

function looksLikeDiscoveryCardListing(suggestion: DiscoverySuggestion, listing: Listing): boolean {
  if (hasNonCardTerms(listing)) return allowsNicheSingleCardReleaseTerm(suggestion, listing);
  return looksLikeCardListing(listing) || hasCoreSuggestionTokens(suggestion, listing);
}

export function looksLikeRawCardListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return !/\b(ace grading|beckett|bgs|cgc|gma|psa|sgc|tag graded)\b|\b(?:bgs|cgc|gma|psa|sgc)\s?-?(?:[0-9](?:\.[0-9])?|10)\b|\bgraded\b|\bslab(?:bed)?\b/.test(text);
}

export function looksLikeBaselineRawMarketListing(listing: Listing): boolean {
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  const exactRaichuIntroPackSingleCard = /\braichu\b/.test(text) && /\bbulbasaur\b/.test(text) && /\bjapanese\b/.test(text) && /\b(?:intro pack|vhs|deck)\b/.test(text) && /(?:\b(?:no\.?\s*)?0?26\b|#\s?0?3\b|\bno\.?\s?0?3\b)/.test(text);
  return (
    looksLikeRawCardListing(listing) &&
    !/\b(altered|bent|creased|damaged|dmg|error|gem mint|heavy play|hp|inked|minty mint|misprint|miscut|nintedo|poor|sealed|unopened|signature|signed|autograph|staff|water damaged)\b/.test(text) &&
    !(exactRaichuIntroPackSingleCard ? /\b(lot|post ?card)\b|\bcard set\b|\b(complete|master|binder)\b.*\b(set|collection)\b|\b(6|9|18)[- ]?card set\b|\bset of \d+\b/.test(text) : /\b(lot|pack|post ?card)\b|\bcard set\b|\b(complete|master|binder)\b.*\b(set|collection)\b|\b(6|9|18)[- ]?card set\b|\bset of \d+\b/.test(text))
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
  return looksLikeBaselineRawMarketListing(listing) && isUsableDiscoveryExample(suggestion, listing, undefined, targetCurrency);
}

function normalizedMarketplaceImageUrl(image: string | undefined): string | undefined {
  if (!image || !/^https?:\/\//i.test(image)) return undefined;
  return /i\.ebayimg\.com/i.test(image) ? image.replace(/\/s-l\d+(?=\.)/i, '/s-l1600') : image;
}

function imageUrlFromListing(listing: Listing | undefined): string | undefined {
  return normalizedMarketplaceImageUrl(listing?.imageUrl ?? listing?.thumbnailUrl);
}

function looksLikeCleanMarketplaceCardPhoto(listing: Listing): boolean {
  if (!imageUrlFromListing(listing)) return false;
  const text = normalize([listing.title, listing.condition].filter(Boolean).join(' '));
  return !/\b(binder|bundle|case|display|finger|fingers|hand|hands|held|holding|lot|mat|playmat|slab|toploader|top loader)\b/.test(text);
}

function preferredMarketplaceImageListing(listings: Listing[]): Listing | undefined {
  return listings.find(looksLikeCleanMarketplaceCardPhoto) ?? listings.find((listing) => listing.imageUrl || listing.thumbnailUrl);
}

function isVettedMarketplaceImageCandidate(candidate: DiscoveryCandidate): boolean {
  return candidate.image?.sourceKind === 'MARKET_LISTING' && candidate.image.sourceName === VETTED_EBAY_MARKETPLACE_IMAGE_SOURCE_NAME;
}

function marketplaceImageSourceNameForCandidate(candidate: DiscoveryCandidate): string {
  if (isExactNicheDiscoveryCandidate(candidate) && candidate.listing && looksLikeCleanMarketplaceCardPhoto(candidate.listing)) return VETTED_EBAY_MARKETPLACE_IMAGE_SOURCE_NAME;
  return EBAY_LISTING_IMAGE_SOURCE_NAME;
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

async function resolveAndPersistSourceBackedUniverseSuggestions(
  parents: DiscoverySuggestion[],
  activeChases: Chase[],
  tasteProfileChases: Chase[],
  options: { parentLimit?: number; perParentLimit?: number } = {}
): Promise<number> {
  const parentLimit = Math.max(1, Math.min(120, Math.floor(options.parentLimit ?? 36)));
  const perParentLimit = Math.max(2, Math.min(12, Math.floor(options.perParentLimit ?? 6)));
  const parentQueue = uniqueValuesByName(parents).slice(0, parentLimit);
  let nextIndex = 0;
  let persistedCount = 0;

  await Promise.all(
    Array.from({ length: Math.min(DISCOVERY_ENRICHMENT_CONCURRENCY, parentQueue.length) }, async () => {
      while (nextIndex < parentQueue.length) {
        const parent = parentQueue[nextIndex];
        nextIndex += 1;
        try {
          const resolved = await resolveSourceBackedDiscoveryCards(parent, activeChases, perParentLimit, tasteProfileChases);
          if (resolved.suggestions.length === 0) continue;
          persistDiscoveryUniverseSuggestions(resolved.suggestions);
          persistedCount += resolved.suggestions.length;
        } catch {
          // Canonical universe ingestion is best-effort and should never block shelf prep.
        }
      }
    })
  );

  return persistedCount;
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
  const imageUrl = normalizedMarketplaceImageUrl(cacheEntry.imageUrl) ?? imageUrlFromListing(listing);
  const candidate = {
    suggestion,
    selectionIndex,
    listing,
    typicalRawAskingTotal: cacheEntry.typicalRawAskingTotal,
    marketSampleSize: cacheEntry.marketSampleSize,
    typicalRawSoldTotal: cacheEntry.typicalRawSoldTotal,
    soldSampleSize: cacheEntry.soldSampleSize,
    displayCurrency: cacheEntry.displayCurrency ?? targetCurrency,
    sourceStatus
  } satisfies DiscoveryCandidate;
  return imageUrl
    ? {
        ...candidate,
        image: { name: suggestion.name, url: imageUrl, sourceName: marketplaceImageSourceNameForCandidate(candidate), sourceKind: 'MARKET_LISTING' }
      }
    : candidate;
}

function hasMarketSignal(candidate: DiscoveryCandidate): boolean {
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  );
}

function convertDiscoveryCandidateMarketCurrency(candidate: DiscoveryCandidate, targetCurrency: SupportedCurrency): DiscoveryCandidate {
  const sourceCurrency = candidate.displayCurrency ?? candidate.listing?.currency;
  if (!sourceCurrency || sourceCurrency === targetCurrency) return candidate;
  return {
    ...candidate,
    typicalRawAskingTotal: candidate.typicalRawAskingTotal === undefined ? undefined : convertCurrencyAmount(candidate.typicalRawAskingTotal, sourceCurrency, targetCurrency),
    typicalRawSoldTotal: candidate.typicalRawSoldTotal === undefined ? undefined : convertCurrencyAmount(candidate.typicalRawSoldTotal, sourceCurrency, targetCurrency),
    displayCurrency: targetCurrency,
    listing: candidate.listing
      ? {
          ...candidate.listing,
          price: convertCurrencyAmount(candidate.listing.price, candidate.listing.currency, targetCurrency),
          currency: targetCurrency,
          shippingCost: candidate.listing.shippingCost === undefined ? undefined : convertCurrencyAmount(candidate.listing.shippingCost, candidate.listing.shippingCurrency ?? candidate.listing.currency, targetCurrency),
          shippingCurrency: candidate.listing.shippingCost === undefined ? candidate.listing.shippingCurrency : targetCurrency
        }
      : candidate.listing
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
    forceRefreshMissingSignal?: boolean;
    forceRefreshThinSignal?: boolean;
  }
): DiscoveryCandidate[] {
  const refreshJobs: DiscoveryMarketRefreshWork[] = [];
  const marketCandidateRows = candidates.map((candidate, visibleIndex) => {
    const selectionIndex = candidate.selectionIndex ?? visibleIndex;
    const cacheBackedSuggestion = marketCacheSuggestionFromCardName(candidate.suggestion.name);
    const enrichedSuggestion: DiscoverySuggestion = {
      ...cacheBackedSuggestion,
      ...candidate.suggestion,
      referenceSourceName: candidate.suggestion.referenceSourceName ?? cacheBackedSuggestion.referenceSourceName,
      requiredEvidenceTokens: candidate.suggestion.requiredEvidenceTokens ?? cacheBackedSuggestion.requiredEvidenceTokens,
      evidenceSearchTerm: candidate.suggestion.evidenceSearchTerm ?? cacheBackedSuggestion.evidenceSearchTerm,
      evidenceAliases: candidate.suggestion.evidenceAliases ?? cacheBackedSuggestion.evidenceAliases
    };
    const cacheKey = discoveryMarketCacheKey(enrichedSuggestion.name, context.targetCurrency, context.destination?.country, context.destination?.postalCode, context.range);
    const cacheEntry = getDiscoveryMarketCache(cacheKey);
    const cachedListing = cacheEntry ? listingFromDiscoveryMarketCache(cacheEntry) : undefined;
    const hasInvalidCachedListing = !!cachedListing && !isUsableDiscoveryExample(enrichedSuggestion, cachedListing, context.range, context.targetCurrency);
    const effectiveCacheEntry = hasInvalidCachedListing ? null : cacheEntry;
    const refreshQueued = hasInvalidCachedListing || shouldRefreshDiscoveryMarketCache(cacheEntry) || (!!cacheEntry && context.forceRefreshMissingSignal === true && !discoveryMarketCacheHasSignal(cacheEntry)) || (!!cacheEntry && context.forceRefreshThinSignal === true && discoveryMarketCacheHasSignal(cacheEntry) && !discoveryMarketCacheHasReliableEstimate(cacheEntry));
    if (refreshQueued) {
      refreshJobs.push({
        cacheKey,
        suggestion: enrichedSuggestion,
        selectionIndex,
        userId: context.userId,
        activeChases: context.activeChases,
        destination: context.destination,
        range: context.range,
        targetCurrency: context.targetCurrency
      });
    }
    const marketCandidate = candidateFromCachedMarket(
      enrichedSuggestion,
      selectionIndex,
      effectiveCacheEntry,
      context.targetCurrency,
      context.activeChases,
      refreshQueued
    );
    const shouldPreserveExistingMarketSignal = hasMarketSignal(candidate) && !hasMarketSignal(marketCandidate);
    const displayCandidate = shouldPreserveExistingMarketSignal ? convertDiscoveryCandidateMarketCurrency(candidate, context.targetCurrency) : candidate;
    return {
      cacheKey,
      refreshQueued,
      candidate: {
        ...displayCandidate,
        suggestion: enrichedSuggestion,
        selectionIndex,
        typicalRawAskingTotal: shouldPreserveExistingMarketSignal ? displayCandidate.typicalRawAskingTotal : marketCandidate.typicalRawAskingTotal,
        marketSampleSize: shouldPreserveExistingMarketSignal ? displayCandidate.marketSampleSize : marketCandidate.marketSampleSize,
        typicalRawSoldTotal: shouldPreserveExistingMarketSignal ? displayCandidate.typicalRawSoldTotal : marketCandidate.typicalRawSoldTotal,
        soldSampleSize: shouldPreserveExistingMarketSignal ? displayCandidate.soldSampleSize : marketCandidate.soldSampleSize,
        displayCurrency: shouldPreserveExistingMarketSignal ? displayCandidate.displayCurrency : marketCandidate.displayCurrency ?? displayCandidate.displayCurrency,
        listing: displayCandidate.image?.sourceKind === 'CARD_REFERENCE' ? displayCandidate.listing : marketCandidate.listing ?? displayCandidate.listing,
        image: displayCandidate.image?.sourceKind === 'CARD_REFERENCE' ? displayCandidate.image : marketCandidate.image ?? displayCandidate.image,
        sourceStatus: shouldPreserveExistingMarketSignal ? displayCandidate.sourceStatus : marketCandidate.sourceStatus
      }
    };
  });
  const acceptedRefreshKeys = queueDiscoveryMarketRefreshes(refreshJobs);
  return marketCandidateRows.map((row) => {
    if (!row.refreshQueued || acceptedRefreshKeys.has(row.cacheKey) || row.candidate.sourceStatus !== 'PENDING') return row.candidate;
    return { ...row.candidate, sourceStatus: undefined };
  });
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
    .filter(({ candidate }) => candidate.sourceStatus === 'PENDING' && needsMoreMarketDepth(candidate));

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
  if (candidate.sourceStatus !== 'PENDING' || !needsMoreMarketDepth(candidate)) return candidate;
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
  if (maxWaitMs <= 0 || !candidates.some((candidate) => candidate.sourceStatus === 'PENDING' && needsMoreMarketDepth(candidate))) return candidates;
  const deadlineMs = Date.now() + maxWaitMs;
  let settled = candidates;
  while (Date.now() < deadlineMs) {
    settled = settled.map((candidate) => candidateWithFreshMarketCache(candidate, context));
    if (!settled.some((candidate) => candidate.sourceStatus === 'PENDING' && needsMoreMarketDepth(candidate))) return settled;
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
      preferredMarketplaceImageListing(baselineInRangeRawListings) ??
      preferredMarketplaceImageListing(rawListings) ??
      preferredMarketplaceImageListing(baselineRawListings) ??
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
      typicalRawAskingTotal,
      marketSampleSize: totals.length,
      soldSampleSize: 0,
      displayCurrency: targetCurrency
    };
    if (imageUrl) askSnapshot.image = { name: suggestion.name, url: imageUrl, sourceName: marketplaceImageSourceNameForCandidate(askSnapshot), sourceKind: 'MARKET_LISTING' };
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

export type DiscoveryMarketRefreshThrottleState = {
  userCooldownSeconds: number;
  maxActiveJobs: number;
  skippedByUserCooldown: number;
  skippedByQueuePressure: number;
  lastUserCooldownSkipAt?: string;
  lastQueuePressureSkipAt?: string;
  lastQueuePressureActiveJobs?: number;
};

const discoveryMarketRefreshQueue: DiscoveryMarketRefreshWork[] = [];
const queuedDiscoveryMarketRefreshKeys = new Set<string>();
const discoveryMarketRefreshUserCooldowns = new Map<string, number>();
const discoveryMarketRefreshThrottleState: DiscoveryMarketRefreshThrottleState = {
  userCooldownSeconds: Math.floor(DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_MS / 1000),
  maxActiveJobs: DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS,
  skippedByUserCooldown: 0,
  skippedByQueuePressure: 0
};
let isDiscoveryMarketRefreshRunning = false;
let scheduledDiscoveryMarketRefreshTimer: NodeJS.Timeout | undefined;

export function getDiscoveryMarketRefreshThrottleState(): DiscoveryMarketRefreshThrottleState {
  return { ...discoveryMarketRefreshThrottleState };
}

export function resetDiscoveryMarketRefreshThrottleState(): void {
  discoveryMarketRefreshUserCooldowns.clear();
  discoveryMarketRefreshThrottleState.skippedByUserCooldown = 0;
  discoveryMarketRefreshThrottleState.skippedByQueuePressure = 0;
  delete discoveryMarketRefreshThrottleState.lastUserCooldownSkipAt;
  delete discoveryMarketRefreshThrottleState.lastQueuePressureSkipAt;
  delete discoveryMarketRefreshThrottleState.lastQueuePressureActiveJobs;
}

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
      scheduledDiscoveryMarketRefreshTimer.unref?.();
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

function activeDiscoveryMarketRefreshJobCount(): number {
  const stats = getDiscoveryMarketRefreshQueueStats(DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS);
  return stats.queuedReady + stats.queuedScheduled + stats.retryReady + stats.retryScheduled + stats.running;
}

function isDiscoveryRefreshUserCoolingDown(userId: string, nowMs: number): boolean {
  if (DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_MS <= 0) return false;
  const lastQueuedAt = discoveryMarketRefreshUserCooldowns.get(userId) ?? 0;
  return lastQueuedAt > 0 && nowMs - lastQueuedAt < DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_MS;
}

function queueDiscoveryMarketRefreshes(jobs: DiscoveryMarketRefreshWork[]): Set<string> {
  if (jobs.length === 0) return new Set();
  const nowMs = Date.now();
  const activeJobs = activeDiscoveryMarketRefreshJobCount();
  const availableSlots = Math.max(0, DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS - activeJobs);
  const acceptedJobs: DiscoveryMarketRefreshWork[] = [];
  const acceptedUsers = new Set<string>();
  let cooldownSkipped = 0;
  let pressureSkipped = 0;

  for (const job of jobs) {
    if (isDiscoveryRefreshUserCoolingDown(job.userId, nowMs)) {
      cooldownSkipped += 1;
      continue;
    }
    if (acceptedJobs.length >= availableSlots) {
      pressureSkipped += 1;
      continue;
    }
    acceptedJobs.push(job);
    acceptedUsers.add(job.userId);
  }

  if (cooldownSkipped > 0) {
    discoveryMarketRefreshThrottleState.skippedByUserCooldown += cooldownSkipped;
    discoveryMarketRefreshThrottleState.lastUserCooldownSkipAt = new Date(nowMs).toISOString();
  }
  if (pressureSkipped > 0) {
    discoveryMarketRefreshThrottleState.skippedByQueuePressure += pressureSkipped;
    discoveryMarketRefreshThrottleState.lastQueuePressureSkipAt = new Date(nowMs).toISOString();
    discoveryMarketRefreshThrottleState.lastQueuePressureActiveJobs = activeJobs;
  }
  if (acceptedJobs.length === 0) return new Set();
  for (const userId of acceptedUsers) discoveryMarketRefreshUserCooldowns.set(userId, nowMs);

  enqueueDiscoveryMarketRefreshJobs(
    acceptedJobs.map((job) => ({
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
  for (const job of acceptedJobs) {
    if (queuedDiscoveryMarketRefreshKeys.has(job.cacheKey)) continue;
    queuedDiscoveryMarketRefreshKeys.add(job.cacheKey);
    discoveryMarketRefreshQueue.push(job);
  }
  scheduleDiscoveryMarketRefreshQueue();
  return new Set(acceptedJobs.map((job) => job.cacheKey));
}

function formatMarketRead(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency): string {
  const currency = candidate.displayCurrency ?? currencyHint;
  const hasSoldComps = candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE;
  const hasAskComps = candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0;
  const hasReliableAskOnlyComps = candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE;
  if (candidate.sourceStatus === 'PENDING' && !hasSoldComps && !hasAskComps) {
    return candidate.image
      ? 'Market data is updating. Pricing will appear once the source responds'
      : 'Market data is updating. Image and pricing will appear once the source responds';
  }
    if (candidate.sourceStatus === 'RATE_LIMITED') return 'Market data is temporarily limited by eBay. Vaultr will retry automatically';
    if (candidate.sourceStatus === 'TIMEOUT') return 'Market data did not respond in time. Vaultr will retry automatically';
  if (!hasSoldComps && !hasAskComps) {
    return 'Market data is still being gathered. Vaultr will keep checking';
  }
  if (hasSoldComps && hasAskComps) {
    return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps); ${formatMoney(candidate.typicalRawAskingTotal, currency)} raw ask`;
  }
  if (hasSoldComps) return `${formatMoney(candidate.typicalRawSoldTotal, currency)} recent raw sold (${candidate.soldSampleSize} comps)`;
  if (!hasReliableAskOnlyComps) return `Low recent comps data: only ${candidate.marketSampleSize ?? 0} active ask comps found, so Vaultr is not showing a price yet`;
  return `${formatMoney(candidate.typicalRawAskingTotal, currency)} active raw ask`;
}

export async function attachReferenceImages(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  return mapWithConcurrency(candidates, VISIBLE_DISCOVERY_COUNT, async (candidate) => {
    if (candidate.image?.sourceKind === 'CARD_REFERENCE') return candidate;
    const reference = await getOrFetchDiscoveryReferenceImage(candidate.suggestion, DISCOVERY_REFERENCE_CACHE_TTL_MS);
    if (!reference?.imageUrl) return candidate.image?.sourceKind === 'MARKET_LISTING' && !isVettedMarketplaceImageCandidate(candidate) ? { ...candidate, image: undefined } : candidate;
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

function applyMarketplaceImageFallback(candidate: DiscoveryCandidate): DiscoveryCandidate {
  if (candidate.image) return candidate;
  const fallbackUrl = imageUrlFromListing(candidate.listing);
  if (!fallbackUrl || !isConcreteDiscoveryCandidate(candidate)) return candidate;
  return {
    ...candidate,
    image: {
      name: candidate.suggestion.name,
      url: fallbackUrl,
      sourceName: marketplaceImageSourceNameForCandidate(candidate),
      sourceKind: 'MARKET_LISTING'
    }
  };
}

async function hydrateShelfCandidateImages(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  const referenced = await attachReferenceImages(candidates);
  return referenced.map(applyMarketplaceImageFallback);
}

function hasEnoughRawMarketData(candidate: DiscoveryCandidate): boolean {
  return (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE) ||
    (isExactNicheDiscoveryCandidate(candidate) && hasSomeRawMarketData(candidate))
  );
}

function needsMoreMarketDepth(candidate: DiscoveryCandidate): boolean {
  return !(
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

function hasLanguageSignalDisplayData(candidate: DiscoveryCandidate): boolean {
  return hasSomeRawMarketData(candidate) || candidate.image?.sourceKind === 'CARD_REFERENCE' || !!candidate.suggestion.referenceImageUrl;
}

function hasThinRawMarketEstimate(candidate: DiscoveryCandidate): boolean {
  return ((candidate.soldSampleSize ?? 0) > 0 || (candidate.marketSampleSize ?? 0) > 0) && !hasEnoughRawMarketData(candidate);
}

function marketEvidenceRank(candidate: DiscoveryCandidate): number {
  if (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) >= MIN_RAW_MARKET_SAMPLE_SIZE) return 3;
  if (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) >= MIN_ASK_ONLY_MARKET_SAMPLE_SIZE) return 2;
  if (isExactNicheDiscoveryCandidate(candidate) && hasSomeRawMarketData(candidate)) return 2;
  if (
    (candidate.typicalRawSoldTotal !== undefined && (candidate.soldSampleSize ?? 0) > 0) ||
    (candidate.typicalRawAskingTotal !== undefined && (candidate.marketSampleSize ?? 0) > 0)
  ) return 1;
  return 0;
}

function isSpecificReferenceSourceName(sourceName: string | undefined): boolean {
  return !!sourceName && !/^pokemon tcg$/i.test(sourceName.trim()) && !/ebay listing image/i.test(sourceName);
}

function hasSourceBackedCardPresentation(candidate: DiscoveryCandidate): boolean {
  return candidate.image?.sourceKind === 'CARD_REFERENCE'
    || isVettedMarketplaceImageCandidate(candidate)
    || !!candidate.suggestion.referenceImageUrl
    || !!candidate.suggestion.referenceSourceCardId
    || isSpecificReferenceSourceName(candidate.suggestion.referenceSourceName);
}

function imageQualityRank(candidate: DiscoveryCandidate): number {
  if (candidate.image?.sourceKind === 'CARD_REFERENCE') return isSpecificReferenceSourceName(candidate.image.sourceName) ? 4 : 2;
  if (candidate.suggestion.referenceImageUrl) return isSpecificReferenceSourceName(candidate.suggestion.referenceSourceName) ? 4 : 2;
  if (candidate.suggestion.referenceSourceCardId || isSpecificReferenceSourceName(candidate.suggestion.referenceSourceName)) return 3;
  if (candidate.image?.sourceKind === 'MARKET_LISTING') return -2;
  return 0;
}

function hasReliableMarketEstimate(candidate: DiscoveryCandidate): boolean {
  return marketEvidenceRank(candidate) >= 2 || (isExactNicheDiscoveryCandidate(candidate) && hasSomeRawMarketData(candidate));
}

function discoveryMarketTotal(candidate: DiscoveryCandidate): number | undefined {
  return candidate.typicalRawSoldTotal ?? candidate.typicalRawAskingTotal;
}

function isLowValueModernFormatPromoCandidate(candidate: DiscoveryCandidate): boolean {
  const marketTotal = discoveryMarketTotal(candidate);
  if (marketTotal === undefined || marketTotal >= MIN_COLLECTOR_WORTHY_MODERN_PROMO_TOTAL) return false;
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  if (!/\b(?:scarlet|violet|sword|shield|sun|moon|black star|promo|promos)\b/.test(text)) return false;
  if (!/\b(?:promo|promos|black star)\b/.test(text)) return false;
  if (!/\b(?:ex|gx|v|vmax|vstar)\b/.test(text)) return false;
  return !/\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release|illustration rare|special illustration rare|art rare|alt art|alternate art|full art|secret rare|trainer gallery|galarian gallery|sar|sir|tag team)\b/.test(text);
}

function hasPremiumCollectorContextText(value: string): boolean {
  return /\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release|illustration rare|special illustration rare|art rare|alt art|alternate art|full art|secret rare|trainer gallery|galarian gallery|sar|sir|tag team|gold star|shining|crystal|lv\.?x|legend|e[- ]?reader|expedition|aquapolis|skyridge)\b/.test(value);
}

function hasModernSetContextText(value: string): boolean {
  return /\b(?:scarlet|violet|sv\d+[a-z]?|sv\d*|s\d+[a-z]?|sword|shield|swsh|sun|moon|sm\d*|xy|vstar universe|vivid voltage|fusion strike|lost origin|crown zenith|paldean fates|surging sparks|fates collide|roaring skies|celestial storm|brilliant stars|silver tempest|astral radiance|chilling reign|battle styles|evolving skies|champion'?s path|shrouded fable|temporal forces|twilight masquerade|obsidian flames|paradox rift|prismatic evolutions|destined rivals|journey together|stellar crown)\b/.test(value);
}

function hasCheapModernCollectorStyleText(value: string): boolean {
  return /\b(?:ar|art rare|illustration rare|special illustration rare|sar|sir|full art|secret rare)\b/.test(value) || /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(value);
}

function hasHighSignalModernCollectorContextText(value: string): boolean {
  return /\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release|trainer gallery|galarian gallery|tag team|gold star|shining|crystal|munch|poncho|pokemon center|kanazawa|yokohama|sapporo)\b/.test(value);
}

function isLowValueModernCollectorStyleCandidate(candidate: DiscoveryCandidate): boolean {
  const marketTotal = discoveryMarketTotal(candidate);
  if (marketTotal === undefined || marketTotal >= 20) return false;
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  if (!hasModernSetContextText(text)) return false;
  if (!hasCheapModernCollectorStyleText(text)) return false;
  if (hasHighSignalModernCollectorContextText(text)) return false;
  return true;
}

function isLowValueOrdinaryModernSetCandidate(candidate: DiscoveryCandidate): boolean {
  const marketTotal = discoveryMarketTotal(candidate);
  if (marketTotal === undefined || marketTotal >= MIN_COLLECTOR_WORTHY_MODERN_SET_TOTAL) return false;
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  if (!hasModernSetContextText(text)) return false;
  if (isExactNicheDiscoveryCandidate(candidate) || hasPremiumCollectorContextText(text)) return false;
  return true;
}

function isLowValueOrdinaryCollectorCard(candidate: DiscoveryCandidate): boolean {
  const marketTotal = discoveryMarketTotal(candidate);
  if (marketTotal === undefined || marketTotal >= MIN_COLLECTOR_WORTHY_ORDINARY_CARD_TOTAL) return false;
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  if (isExactNicheDiscoveryCandidate(candidate) || hasPremiumCollectorContextText(text)) return false;
  if (/\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release|tag team|gold star|shining|crystal|lv\.?x|legend)\b/.test(text)) return false;
  return true;
}

function isCollectorWorthyWeeklyCandidate(candidate: DiscoveryCandidate): boolean {
  return !isLowValueModernFormatPromoCandidate(candidate)
    && !isLowValueModernCollectorStyleCandidate(candidate)
    && !isLowValueOrdinaryModernSetCandidate(candidate)
    && !isLowValueOrdinaryCollectorCard(candidate);
}

function hasSourceBackedPricedCollectorFallbackData(candidate: DiscoveryCandidate): boolean {
  if (!hasSomeRawMarketData(candidate)) return false;
  if (!isCollectorWorthyWeeklyCandidate(candidate)) return false;
  const marketTotal = discoveryMarketTotal(candidate);
  if (marketTotal === undefined || marketTotal < MIN_COLLECTOR_WORTHY_MODERN_PROMO_TOTAL) return false;
  return imageQualityRank(candidate) >= 3 || isExactNicheDiscoveryCandidate(candidate);
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
  return marketReadyShelfCandidatesWithOptions(candidates, hasFullDiscovery, profileConfidence);
}

export function marketReadyShelfCandidatesWithOptions(
  candidates: DiscoveryCandidate[],
  hasFullDiscovery: boolean,
  profileConfidence: DiscoveryProfileConfidence = discoveryProfileConfidence([]),
  options: MarketReadyShelfOptions = {}
): DiscoveryCandidate[] {
  const seenDisplayNames = new Set<string>();
  const displayableCandidates = candidates.filter((candidate) => {
    if (!isDisplayableDiscoveryCandidate(candidate)) return false;
    const displayNameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenDisplayNames.has(displayNameKey)) return false;
    seenDisplayNames.add(displayNameKey);
    return true;
  });
  const readyCandidates = displayableCandidates.filter(hasReliableMarketEstimate).filter(isCollectorWorthyWeeklyCandidate);
  const languageSignalTargetCount = Math.max(0, Math.min(profileConfidence.maxShelfSize, Math.floor(options.languageSignalTargetCount ?? 0)));
  const readyJapaneseCount = readyCandidates.filter(isJapaneseDiscoveryCandidate).length;
  const prioritizedPendingFallbacks: DiscoveryCandidate[] = [];
  const pendingFallbacks: DiscoveryCandidate[] = [];
  if (options.allowPendingExploration === false && options.allowLanguageSignalFallback === true && readyJapaneseCount < Math.max(1, languageSignalTargetCount)) {
    const languageFallbacks = displayableCandidates
      .filter((candidate) => isJapaneseDiscoveryCandidate(candidate) && hasLanguageSignalDisplayData(candidate))
      .filter(isCollectorWorthyWeeklyCandidate)
      .filter((candidate) => readyJapaneseCount === 0 || hasSomeRawMarketData(candidate))
      .filter((candidate) => !readyCandidates.some((readyCandidate) => discoveryDisplayNameKey(readyCandidate.suggestion.name) === discoveryDisplayNameKey(candidate.suggestion.name)))
      .slice(0, Math.max(1, Math.min(6, languageSignalTargetCount - readyJapaneseCount || Math.ceil(profileConfidence.maxShelfSize * 0.1))));
    prioritizedPendingFallbacks.push(...languageFallbacks);
  }
  if (options.allowPendingExploration === false && options.allowSourceBackedRetailEReaderFallback === true) {
    prioritizedPendingFallbacks.push(
      ...displayableCandidates
        .filter((candidate) => hasSourceBackedRetailEReaderDisplayData(candidate) || hasSourceBackedNicheJapaneseDisplayData(candidate))
        .filter(isCollectorWorthyWeeklyCandidate)
        .filter((candidate) => !readyCandidates.some((readyCandidate) => discoveryDisplayNameKey(readyCandidate.suggestion.name) === discoveryDisplayNameKey(candidate.suggestion.name)))
    );
  }
  if (options.allowPendingExploration === false && readyCandidates.length < Math.min(MIN_READY_SHELF_PAGE_SIZE, profileConfidence.maxShelfSize)) {
    pendingFallbacks.push(
      ...displayableCandidates
        .filter(hasSourceBackedPricedCollectorFallbackData)
        .filter((candidate) => !readyCandidates.some((readyCandidate) => discoveryDisplayNameKey(readyCandidate.suggestion.name) === discoveryDisplayNameKey(candidate.suggestion.name)))
    );
  }
  if (options.allowPendingExploration === false) {
    if (readyCandidates.length < profileConfidence.maxShelfSize) {
      pendingFallbacks.push(
        ...displayableCandidates
          .filter(hasSourceBackedPricedCollectorFallbackData)
          .filter((candidate) => !readyCandidates.some((readyCandidate) => discoveryDisplayNameKey(readyCandidate.suggestion.name) === discoveryDisplayNameKey(candidate.suggestion.name)))
      );
    }
    if (prioritizedPendingFallbacks.length > 0 || pendingFallbacks.length > 0) {
      return uniqueCandidatesByDisplayName([...prioritizedPendingFallbacks, ...readyCandidates, ...pendingFallbacks]).slice(0, profileConfidence.maxShelfSize);
    }
    return readyCandidates;
  }
  const collectorDisplayableCandidates = displayableCandidates.filter(isCollectorWorthyWeeklyCandidate);
  if (!hasFullDiscovery || collectorDisplayableCandidates.length <= DISCOVERY_SHELF_PAGE_SIZE) return collectorDisplayableCandidates;
  const visibleReadyCount = pagePolishedReadyCount(readyCandidates.length, profileConfidence.maxShelfSize);
  const targetFloor = Math.max(profileConfidence.minShelfSize, visibleReadyCount);
  const targetCount = Math.min(profileConfidence.maxShelfSize, collectorDisplayableCandidates.length, targetFloor);
  const selected = readyCandidates.slice(0, Math.min(visibleReadyCount, targetCount));
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  for (const candidate of collectorDisplayableCandidates) {
    if (selected.length >= targetCount) break;
    if (hasThinRawMarketEstimate(candidate)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
  }
  return selected;
}

export function orderCandidatesForMarketConfidence(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): DiscoveryCandidate[] {
  return [...candidates].sort((left, right) => {
    const grailShapeDelta = grailShapePriorityRank(right, chases) - grailShapePriorityRank(left, chases);
    if (grailShapeDelta !== 0) return grailShapeDelta;
    const evidenceDelta = marketEvidenceRank(right) - marketEvidenceRank(left);
    if (evidenceDelta !== 0) return evidenceDelta;
    const imageDelta = imageQualityRank(right) - imageQualityRank(left);
    if (imageDelta !== 0) return imageDelta;
    const noveltyDelta = adjacentThemeNoveltyPreferenceDelta(right, left, chases, negativeProfile);
    if (noveltyDelta !== 0) return noveltyDelta;
    const collectorDelta = collectorDiscoveryRankScore(right, chases, negativeProfile, learnedRankContext) - collectorDiscoveryRankScore(left, chases, negativeProfile, learnedRankContext);
    if (collectorDelta !== 0) return collectorDelta;
    return curiosityRankScore(right) - curiosityRankScore(left);
  });
}

export function collectorDiscoveryFeatures(candidate: DiscoveryCandidate, chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile): DiscoveryCollectorFeatures {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  const directSubjectSupport = directProfileSubjectSupportCount(candidate, positiveTasteSubjectChases(chases));
  const adjacentThemeNovelty = isAdjacentThemeNoveltyCandidate(candidate, chases);
  const japaneseAffinity = japaneseSignalWeightRatio(chases);
  const japaneseSignal = isJapaneseDiscoveryCandidate(candidate);
  const promoSignal = /\bpromo|black star|special delivery|futsal|toys r us|classic collection|celebrations|exclusive|mcdonald'?s\b/.test(text);
  const eReaderSignal = /\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(text);
  const retailEReaderSignal = isRetailEReaderDiscoveryCandidate(candidate);
  const nicheExclusiveSignal = isNicheJapaneseExclusiveDiscoveryCandidate(candidate);
  const exactNicheIdentity = isExactNicheDiscoveryCandidate(candidate);
  const premiumFormatContext = hasPremiumVmaxContextText(text) || /\b(?:sir|sar|ar|special illustration rare|illustration rare|alt art|alternate art|secret rare|trainer gallery|galarian gallery)\b/.test(text);
  const ordinaryFormatPenalty = isOrdinaryVmaxDiscoveryCandidate(candidate) || (/\b(?:gx|ex|vmax|vstar)\b/.test(text) && !premiumFormatContext && !exactNicheIdentity);
  const collectorTerms = collectorTermTokens(candidate);
  return {
    directSubjectSupport,
    adjacentThemeNovelty,
    japaneseAffinity,
    japaneseSignal,
    promoSignal,
    eReaderSignal,
    retailEReaderSignal,
    nicheExclusiveSignal,
    exactNicheIdentity,
    premiumFormatContext,
    ordinaryFormatPenalty,
    weakSubjectPenalty: isWeakSingleSubjectFromMultiSubjectProfile(candidate, chases),
    historyFallbackPenalty: isConcreteHistoryFallbackCandidate(candidate),
    negativeSignalPenalty: negativeProfileRankPenalty(candidate, negativeProfile),
    marketEvidence: marketEvidenceRank(candidate),
    imageEvidence: imageQualityRank(candidate),
    curiosity: candidate.suggestion.curiosityScore ?? 0,
    collectorTerms,
    collectorTraits: collectorTraitMap(candidate, collectorTerms)
  };
}

const COLLECTOR_TERM_PHRASES = [
  'special illustration rare',
  'illustration rare',
  'trainer gallery',
  'galarian gallery',
  'black star',
  'special delivery',
  'classic collection',
  'art rare',
  'alt art',
  'alternate art',
  'full art',
  'secret rare',
  'hyper rare',
  'rainbow rare',
  'gold star',
  'tag team',
  'shiny vault',
  'southern islands',
  'team rocket',
  'gym challenge',
  'gym heroes',
  'e-reader',
  'deck exclusive',
  'intro pack',
  'bulbasaur deck',
  'odd release',
  'oddball release',
  'limited release',
  'unique release',
  'magazine promo',
  'special set',
  'small set',
  'numbered set',
  'pokemon center',
  'coro coro',
  'corocoro',
  'magazine',
  'vending',
  'masaki',
  'munch',
  'poncho',
  'staff',
  'winner',
  'prerelease',
  'stamped',
  'stamp',
  'japanese',
  'promo',
  'exclusive',
  'vintage',
  'crystal',
  'shining',
  'sar',
  'sir',
  'vmax',
  'vstar',
  'gx',
  'ex'
];

function normalizeCollectorTerm(value: string): string {
  return normalize(value).replace(/\bcoro coro\b/g, 'corocoro').replace(/\boddball release\b/g, 'odd release');
}

function collectorTermTokens(candidate: DiscoveryCandidate): string[] {
  const text = normalizeCollectorTerm([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? [])].filter(Boolean).join(' '));
  const subjectTokens = new Set(candidateSpecificSubjectTokens(candidate));
  const terms = new Set<string>();
  for (const phrase of COLLECTOR_TERM_PHRASES) {
    const normalizedPhrase = normalizeCollectorTerm(phrase);
    if (new RegExp(`\\b${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) terms.add(normalizedPhrase);
  }
  for (const token of [...(candidate.suggestion.sourceTasteTokens ?? []), ...(candidate.suggestion.requiredEvidenceTokens ?? [])]) {
    const normalizedToken = normalizeCollectorTerm(token);
    if (!normalizedToken || normalizedToken.length < 2) continue;
    if (/^\d+$/.test(normalizedToken) || subjectTokens.has(normalizedToken)) continue;
    if (['card', 'cards', 'pokemon', 'collector'].includes(normalizedToken)) continue;
    terms.add(normalizedToken);
  }
  return Array.from(terms).sort();
}

function typedCollectorTrait(terms: string[], values: string[]): string[] {
  const termSet = new Set(terms);
  return values.filter((value) => termSet.has(value));
}

function collectorTraitMap(candidate: DiscoveryCandidate, collectorTerms: string[]): Record<string, string[]> {
  const text = normalizeCollectorTerm([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? []), ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' '));
  const collectorTermParts = new Set(collectorTerms.flatMap((term) => normalizedTokens(term)));
  const subject = uniqueValuesPreservingOrder(candidateSpecificSubjectTokens(candidate).filter((token) => token.length >= 3 && !collectorTermParts.has(token))).slice(0, 4);
  const setFamily = collectorSetFamilyLabel(text);
  const traits: Record<string, string[]> = {
    subject,
    region: typedCollectorTrait(collectorTerms, ['japanese']),
    channel: typedCollectorTrait(collectorTerms, ['corocoro', 'magazine', 'pokemon center', 'vending', 'masaki', 'munch', 'poncho']),
    releaseShape: typedCollectorTrait(collectorTerms, ['promo', 'black star', 'special delivery', 'classic collection', 'exclusive', 'deck exclusive', 'intro pack', 'odd release', 'limited release', 'unique release', 'magazine promo', 'special set', 'small set', 'numbered set', 'staff', 'winner', 'prerelease', 'stamped', 'stamp']),
    era: typedCollectorTrait(collectorTerms, ['vintage', 'e-reader', 'southern islands', 'team rocket', 'gym challenge', 'gym heroes']),
    artShape: typedCollectorTrait(collectorTerms, ['special illustration rare', 'illustration rare', 'trainer gallery', 'galarian gallery', 'art rare', 'alt art', 'alternate art', 'full art', 'secret rare', 'hyper rare', 'rainbow rare', 'gold star', 'shiny vault', 'sar', 'sir', 'crystal', 'shining']),
    format: typedCollectorTrait(collectorTerms, ['tag team', 'vmax', 'vstar', 'gx', 'ex']),
    identifierShape: [],
    setFamily: setFamily ? [setFamily] : [],
    laneShape: collectorLaneTrait(candidate)
  };
  if (BARE_COLLECTOR_NUMBER_PATTERN.test(text)) traits.identifierShape.push('compact-fraction');
  if (JAPANESE_PROMO_CODE_PATTERN.test(text)) traits.identifierShape.push('japanese-promo-code');
  if (/\b(?:no\.?|#)\s?\d{1,3}\b/.test(text)) traits.identifierShape.push('collector-number');
  return Object.fromEntries(Object.entries(traits).filter(([, values]) => values.length > 0));
}

function chaseCollectorTerms(chase: Chase): string[] {
  const text = normalizeCollectorTerm([chase.cardName, chase.targetNote].filter(Boolean).join(' '));
  const terms = new Set<string>();
  for (const phrase of COLLECTOR_TERM_PHRASES) {
    const normalizedPhrase = normalizeCollectorTerm(phrase);
    if (new RegExp(`\\b${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) terms.add(normalizedPhrase);
  }
  return Array.from(terms).sort();
}

function chaseCollectorTraits(chase: Chase): Record<string, string[]> {
  const text = normalizeCollectorTerm([chase.cardName, chase.targetNote].filter(Boolean).join(' '));
  const collectorTerms = chaseCollectorTerms(chase);
  const collectorTermParts = new Set(collectorTerms.flatMap((term) => normalizedTokens(term)));
  const subject = uniqueValuesPreservingOrder(chaseSpecificSubjectTokens(chase).filter((token) => token.length >= 3 && !collectorTermParts.has(token))).slice(0, 4);
  const setFamily = collectorSetFamilyLabel(text);
  const traits: Record<string, string[]> = {
    subject,
    region: typedCollectorTrait(collectorTerms, ['japanese']),
    channel: typedCollectorTrait(collectorTerms, ['corocoro', 'magazine', 'pokemon center', 'vending', 'masaki', 'munch', 'poncho']),
    releaseShape: typedCollectorTrait(collectorTerms, ['promo', 'black star', 'special delivery', 'classic collection', 'exclusive', 'deck exclusive', 'intro pack', 'odd release', 'limited release', 'unique release', 'magazine promo', 'special set', 'small set', 'numbered set', 'staff', 'winner', 'prerelease', 'stamped', 'stamp']),
    era: typedCollectorTrait(collectorTerms, ['vintage', 'e-reader', 'southern islands', 'team rocket', 'gym challenge', 'gym heroes']),
    artShape: typedCollectorTrait(collectorTerms, ['special illustration rare', 'illustration rare', 'trainer gallery', 'galarian gallery', 'art rare', 'alt art', 'alternate art', 'full art', 'secret rare', 'hyper rare', 'rainbow rare', 'gold star', 'shiny vault', 'sar', 'sir', 'crystal', 'shining']),
    format: typedCollectorTrait(collectorTerms, ['tag team', 'vmax', 'vstar', 'gx', 'ex']),
    identifierShape: [],
    setFamily: setFamily ? [setFamily] : []
  };
  if (BARE_COLLECTOR_NUMBER_PATTERN.test(text)) traits.identifierShape.push('compact-fraction');
  if (JAPANESE_PROMO_CODE_PATTERN.test(text)) traits.identifierShape.push('japanese-promo-code');
  if (/\b(?:no\.?|#)\s?\d{1,3}\b/.test(text)) traits.identifierShape.push('collector-number');
  return Object.fromEntries(Object.entries(traits).filter(([, values]) => values.length > 0));
}

function collectorSetFamilyLabel(value: string): string | undefined {
  const setLabel = SPECIAL_SET_LABEL_PATTERNS.find(({ pattern }) => pattern.test(value))?.label
    ?? /\b(Expedition Base Set|Aquapolis|Skyridge|Wizards Black Star Promos|XY Black Star Promos|BW Black Star Promos|SWSH Black Star Promos|SM Black Star Promos|Surging Sparks|Paldean Fates|Legendary Treasures|Destined Rivals|Journey Together|Stellar Crown|151)\b/i.exec(value)?.[1];
  if (!setLabel) return undefined;
  return normalize(setLabel).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function collectorLaneTrait(candidate: DiscoveryCandidate): string[] {
  const lane = normalize(candidate.suggestion.lane).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return lane ? [lane] : [];
}

function vaultTypedTraitEdgeWeights(chases: Chase[]): Record<string, number> {
  const edgeCounts = new Map<string, number>();
  for (const chase of positiveTasteSubjectChases(chases)) {
    const traits = typedCollectorTraitTokens(chaseCollectorTraits(chase));
    for (let outerIndex = 0; outerIndex < traits.length; outerIndex += 1) {
      for (let innerIndex = outerIndex + 1; innerIndex < traits.length; innerIndex += 1) {
        const edge = collectorTermEdgeKey(traits[outerIndex], traits[innerIndex]);
        edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
      }
    }
  }
  const weights: Record<string, number> = {};
  for (const [edge, count] of edgeCounts.entries()) weights[edge] = count >= 2 ? 10 : 5;
  return weights;
}

export const __discoveryLearningTestHooks = {
  vaultTypedTraitEdgeWeights
};

export const __discoveryPersistenceTestHooks = {
  scheduledDropItemsFromCandidates,
  isScheduledShelfPriorityCandidate,
  selectDiscoveryUniverseCandidatesForProfile,
  selectDiscoveryUserUniverseCandidatesFromEntries,
  buildFreshWeeklyShelfFromPool,
  weeklyJapaneseSignalTargetCount,
  scoreDiscoveryUniverseCardForProfile,
  saveWeeklyDiscoveryDrop,
  canonicalUniverseSeedParents
};

function learnedFeatureRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext || learnedRankContext.exampleCount < 3) return 0;
  let nudge = 0;
  for (const [feature, weight] of Object.entries(learnedRankContext.featureWeights)) {
    if ((features as unknown as Record<string, unknown>)[feature] === true) nudge += weight;
  }
  return Math.max(-48, Math.min(48, nudge));
}

function learnedTermRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext || learnedRankContext.exampleCount < 3) return 0;
  let nudge = 0;
  for (const term of features.collectorTerms) nudge += learnedRankContext.termWeights[term] ?? 0;
  return Math.max(-36, Math.min(36, nudge));
}

function collectorTermEdgeKey(first: string, second: string): string {
  return [first, second].sort().join('|');
}

function typedCollectorTraitTokens(traits: Record<string, string[]>): string[] {
  const tokens: string[] = [];
  for (const [type, values] of Object.entries(traits)) {
    for (const value of values) tokens.push(`${type}:${value}`);
  }
  return Array.from(new Set(tokens)).sort();
}

function learnedTermGraphRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext || learnedRankContext.exampleCount < 3 || !learnedRankContext.termEdgeWeights) return 0;
  let nudge = 0;
  const terms = Array.from(new Set(features.collectorTerms)).sort();
  for (let outerIndex = 0; outerIndex < terms.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < terms.length; innerIndex += 1) {
      nudge += learnedRankContext.termEdgeWeights[collectorTermEdgeKey(terms[outerIndex], terms[innerIndex])] ?? 0;
    }
  }
  return Math.max(-24, Math.min(24, nudge));
}

function learnedTypedTraitGraphRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext || learnedRankContext.exampleCount < 3 || !learnedRankContext.typedTraitEdgeWeights) return 0;
  let nudge = 0;
  const traits = typedCollectorTraitTokens(features.collectorTraits);
  for (let outerIndex = 0; outerIndex < traits.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < traits.length; innerIndex += 1) {
      nudge += learnedRankContext.typedTraitEdgeWeights[collectorTermEdgeKey(traits[outerIndex], traits[innerIndex])] ?? 0;
    }
  }
  return Math.max(-24, Math.min(24, nudge));
}

function globalTypedTraitGraphRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext || (learnedRankContext.globalExampleCount ?? 0) < 12 || !learnedRankContext.globalTypedTraitEdgeWeights) return 0;
  let nudge = 0;
  const traits = typedCollectorTraitTokens({ ...features.collectorTraits, subject: [] });
  for (let outerIndex = 0; outerIndex < traits.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < traits.length; innerIndex += 1) {
      nudge += learnedRankContext.globalTypedTraitEdgeWeights[collectorTermEdgeKey(traits[outerIndex], traits[innerIndex])] ?? 0;
    }
  }
  return Math.max(-12, Math.min(12, nudge));
}

function vaultTypedTraitGraphRankNudge(features: DiscoveryCollectorFeatures, learnedRankContext?: DiscoveryLearnedRankContext): number {
  if (!learnedRankContext?.vaultTypedTraitEdgeWeights) return 0;
  let nudge = 0;
  const traits = typedCollectorTraitTokens(features.collectorTraits);
  for (let outerIndex = 0; outerIndex < traits.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < traits.length; innerIndex += 1) {
      nudge += learnedRankContext.vaultTypedTraitEdgeWeights[collectorTermEdgeKey(traits[outerIndex], traits[innerIndex])] ?? 0;
    }
  }
  return Math.max(-18, Math.min(18, nudge));
}

export function collectorDiscoveryRankScore(candidate: DiscoveryCandidate, chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): number {
  const features = collectorDiscoveryFeatures(candidate, chases, negativeProfile);
  return (
    sourcePreferenceRankScore(candidate, chases, negativeProfile) +
    features.directSubjectSupport * 18 +
    (features.adjacentThemeNovelty ? 14 : 0) +
    (features.japaneseSignal ? Math.round(24 + features.japaneseAffinity * 36) : 0) +
    (features.promoSignal ? 10 : 0) +
    (features.eReaderSignal ? 18 : 0) +
    (features.retailEReaderSignal ? 32 : 0) +
    (features.nicheExclusiveSignal ? 34 : 0) +
    (features.exactNicheIdentity ? 42 : 0) +
    (features.premiumFormatContext ? 14 : 0) -
    (features.ordinaryFormatPenalty ? 40 : 0) -
    (features.weakSubjectPenalty ? 35 : 0) -
    (features.historyFallbackPenalty ? 45 : 0) +
    learnedFeatureRankNudge(features, learnedRankContext) +
    learnedTermRankNudge(features, learnedRankContext) +
    learnedTermGraphRankNudge(features, learnedRankContext) +
    learnedTypedTraitGraphRankNudge(features, learnedRankContext) +
    globalTypedTraitGraphRankNudge(features, learnedRankContext) +
    vaultTypedTraitGraphRankNudge(features, learnedRankContext)
  );
}

function marketEstimateTotal(candidate: DiscoveryCandidate): number | undefined {
  return candidate.typicalRawSoldTotal ?? candidate.typicalRawAskingTotal;
}

function isMarketEstimateInRange(candidate: DiscoveryCandidate, range?: { min: number; max: number }): boolean {
  if (!range) return true;
  const total = marketEstimateTotal(candidate);
  if (total === undefined || (total >= range.min && total <= range.max)) return true;
  if (candidate.typicalRawSoldTotal !== undefined) return false;
  if (!isExactNicheDiscoveryCandidate(candidate) || !hasReliableMarketEstimate(candidate)) return false;
  const stretchMax = Math.max(range.max, Math.min(range.max * NICHE_DISCOVERY_STRETCH_RATIO, range.max + NICHE_DISCOVERY_STRETCH_ABSOLUTE));
  return total >= range.min && total <= stretchMax;
}

const CACHE_BACKFILL_SUBJECT_STOP_WORDS = new Set([
  'aquapolis',
  'ascended',
  'base',
  'black',
  'bw',
  'card',
  'cards',
  'collection',
  'collector',
  'expedition',
  'ex',
  'gx',
  'heroes',
  'japanese',
  'legendary',
  'promo',
  'promos',
  'raw',
  'set',
  'skyridge',
  'sm',
  'star',
  'surging',
  'swsh',
  'trading',
  'treasures',
  'vmax',
  'wizards',
  'xy'
]);

function cacheBackfillSubjectTokens(value: string): string[] {
  return profileSubjectTokens(value).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token) && !/^[a-z]{1,4}\d+$/i.test(token));
}

function hasDirectProfileSubjectMatch(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  const profileTokens = new Set(chases.flatMap((chase) => profileSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token))));
  if (profileTokens.size === 0) return false;
  const candidateTokens = profileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token));
  return candidateTokens.some((token) => profileTokens.has(token));
}

function directProfileSubjectSupportCount(candidate: DiscoveryCandidate, chases: Chase[]): number {
  const candidateTokens = new Set(profileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token)));
  if (candidateTokens.size === 0) return 0;
  return chases.filter((chase) => {
    const chaseTokens = profileSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token));
    return chaseTokens.some((token) => candidateTokens.has(token));
  }).length;
}

function hasConcreteProfileSubjectMatch(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (/\bvmax\b/i.test(sourceCardText(candidate)) && !hasSupportedProfileVmaxSubjectMatch(candidate, chases)) return false;
  const profileTokens = new Set(chases.flatMap((chase) => expandedProfileSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token))));
  if (profileTokens.size === 0) return false;
  const candidateTokens = expandedProfileSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' ')).filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token));
  return candidateTokens.some((token) => profileTokens.has(token));
}

function isAdjacentThemeNoveltyCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  const positiveChases = positiveTasteSubjectChases(chases);
  if (positiveChases.length === 0) return false;
  if (!hasCollectorShapedScheduledSignal(candidate)) return false;
  const directSubjectSupport = directProfileSubjectSupportCount(candidate, positiveChases);
  if (directSubjectSupport === 0) return hasCollectorProfileTraitMatch(candidate, positiveChases);
  if (!candidate.suggestion.name.includes('&')) return false;
  const pairTokens = candidate.suggestion.name
    .split('&')
    .flatMap((part) => profileSubjectTokens(part))
    .filter((token) => !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token));
  if (pairTokens.length < 2) return false;
  const profileTokens = new Set(positiveChases.flatMap((chase) => chaseSpecificSubjectTokens(chase)));
  const sharedTokenCount = pairTokens.filter((token) => profileTokens.has(token)).length;
  const freshTokenCount = pairTokens.filter((token) => !profileTokens.has(token)).length;
  return sharedTokenCount > 0 && freshTokenCount > 0;
}

function hasCollectorProfileTraitMatch(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  const positiveChases = positiveTasteSubjectChases(chases);
  const profileTraits = distinctProfileKeys(positiveChases, profileTraitKeys);
  const candidateText = [sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' ');
  const candidateTraits = new Set(profileTraitKeys(candidateText));
  const sharedTraits = [...candidateTraits].filter((trait) => profileTraits.has(trait));
  const collectorSharedTraits = sharedTraits.filter((trait) => trait !== 'ex' && trait !== 'format' && trait !== 'modern');
  const text = normalize(candidateText);
  const profileSetLabels = profileSpecialSetLabels(positiveChases);
  const candidateSetLabels = candidateSpecialSetLabels(candidate);
  const premiumPromoAnchor = /\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release)\b/.test(text);
  const hasSharedSpecialSetLabel = [...candidateSetLabels].some((label) => profileSetLabels.has(label));
  if (hasSharedSpecialSetLabel) return true;
  if (collectorSharedTraits.includes('promo') && premiumPromoAnchor) return true;
  if (collectorSharedTraits.includes('promo') && premiumPromoAnchor && (collectorSharedTraits.includes('japanese') || collectorSharedTraits.includes('art') || collectorSharedTraits.includes('corocoro') || collectorSharedTraits.includes('publication'))) {
    return true;
  }
  const hasSharedStrongTrait = collectorSharedTraits.some((trait) => trait === 'japanese' || trait === 'art');
  if (hasSharedStrongTrait && collectorSharedTraits.length >= 2) {
    return !hasModernSetContextText(text) || hasSharedSpecialSetLabel || premiumPromoAnchor;
  }
  const hasSharedEraTrait = collectorSharedTraits.some((trait) => trait === 'e-reader' || trait === 'wotc');
  if (!hasSharedEraTrait) return false;
  const premiumEraAnchor = isExactNicheDiscoveryCandidate(candidate)
    || isJapaneseDiscoveryCandidate(candidate)
    || premiumPromoAnchor
    || /\b(?:illustration rare|special illustration rare|art rare|alt art|alternate art|full art|secret rare|trainer gallery|galarian gallery|sar|sir)\b/.test(text);
  return premiumEraAnchor;
}

function hasCollectorShapedScheduledSignal(candidate: DiscoveryCandidate): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' '));
  const highNumberMatch = /\b(\d{3})\b/.exec(text);
  const exactNicheSignal = isExactNicheDiscoveryCandidate(candidate);
  const japaneseSignal = isJapaneseDiscoveryCandidate(candidate);
  const specialPromoSignal = /\b(?:special delivery|futsal|toys r us|classic collection|celebrations|mcdonald'?s|staff|winner|prerelease|stamped|stamp|exclusive|unique|odd(?:ball)? release|limited release)\b/.test(text);
  const genericPromoSignal = /\b(?:promo|black star)\b/.test(text);
  const eraSignal = /\b(?:e[- ]?reader|expedition|aquapolis|skyridge|base set|team rocket(?!'s)|gym heroes|gym challenge|neo|wizards)\b/.test(text);
  const artSignal = /\b(?:illustration rare|special illustration rare|art rare|alt art|alternate art|full art|secret rare|trainer gallery|galarian gallery|sar|sir)\b/.test(text);
  const modernSecretLikeSignal = !!highNumberMatch && Number(highNumberMatch[1]) >= 180 && /\b(?:scarlet|violet|destined rivals|surging sparks|paldean fates|journey together|stellar crown|temporal forces|twilight masquerade|prismatic evolutions|obsidian flames|paradox rift)\b/.test(text);
  const formatSignal = /\b(?:tag team|gx|ex|vmax|vstar|radiant)\b/.test(text);
  if (formatSignal) return exactNicheSignal || japaneseSignal || specialPromoSignal || genericPromoSignal || eraSignal || artSignal || modernSecretLikeSignal;
  return exactNicheSignal || japaneseSignal || specialPromoSignal || genericPromoSignal || eraSignal || artSignal || modernSecretLikeSignal;
}

function isModernSubjectCallbackCandidate(candidate: DiscoveryCandidate, features: DiscoveryCollectorFeatures): boolean {
  if (features.directSubjectSupport <= 0) return false;
  if (features.adjacentThemeNovelty) return false;
  if (features.exactNicheIdentity || features.retailEReaderSignal || features.nicheExclusiveSignal || features.eReaderSignal) return false;
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' '));
  return /\b(?:vmax|vstar|gx|ex|trainer gallery|galarian gallery|illustration rare|special illustration rare|art rare|full art|secret rare|sar|sir)\b/.test(text);
}

function adjacentThemeNoveltyPreferenceDelta(
  right: DiscoveryCandidate,
  left: DiscoveryCandidate,
  chases: Chase[],
  negativeProfile?: DiscoveryNegativeProfile
): number {
  if (chases.length === 0) return 0;
  const rightFeatures = collectorDiscoveryFeatures(right, chases, negativeProfile);
  const leftFeatures = collectorDiscoveryFeatures(left, chases, negativeProfile);
  const rightNoveltyPreferred = rightFeatures.adjacentThemeNovelty && isModernSubjectCallbackCandidate(left, leftFeatures);
  const leftNoveltyPreferred = leftFeatures.adjacentThemeNovelty && isModernSubjectCallbackCandidate(right, rightFeatures);
  if (rightNoveltyPreferred === leftNoveltyPreferred) return 0;
  return rightNoveltyPreferred ? 1 : -1;
}

function isReliableDirectSubjectRefillCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (!hasReliableMarketEstimate(candidate)) return false;
  if (!isConcreteDiscoveryCandidate(candidate)) return false;
  if (isLowValueModernFormatPromoCandidate(candidate)) return false;
  if (!hasConcreteProfileSubjectMatch(candidate, positiveTasteSubjectChases(chases))) return false;
  if (isWeakSingleSubjectFromMultiSubjectProfile(candidate, chases)) return false;
  return true;
}

export function isBroadCollectorShelfFillerCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (!hasReliableMarketEstimate(candidate)) return false;
  if (!isConcreteDiscoveryCandidate(candidate)) return false;
  if (!isCollectorWorthyWeeklyCandidate(candidate)) return false;
  if (!hasCollectorShapedScheduledSignal(candidate)) return false;
  if (isWeakSingleSubjectFromMultiSubjectProfile(candidate, chases)) return false;
  if (!hasSourceBackedCardPresentation(candidate)) return false;
  if (chases.length > 0 && !hasCollectorProfileTraitMatch(candidate, chases)) return false;
  return true;
}

export function isScheduledProfileRelevantCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (chases.length === 0) return true;
  if (isWeakSingleSubjectFromMultiSubjectProfile(candidate, chases)) return false;
  if (!hasCollectorShapedScheduledSignal(candidate)) return false;
  return hasConcreteProfileSubjectMatch(candidate, chases)
    || hasCollectorProfileTraitMatch(candidate, chases)
    || (hasJapaneseWeightedProfile(chases) && hasSourceBackedNicheJapaneseDisplayData(candidate));
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
  const allowBroadCollectorBackfill = targetCount >= DISCOVERY_SHELF_PAGE_SIZE;
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const readyShelfCount = (items: DiscoveryCandidate[]): number => marketReadyShelfCandidatesWithOptions(items, true, profileConfidence, { allowPendingExploration: false }).length;
  const positiveSubjectChases = positiveTasteSubjectChases(tasteProfileChases);
  const isProfileAlignedBackfillCandidate = (candidate: DiscoveryCandidate): boolean =>
    hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases) || hasCollectorProfileTraitMatch(candidate, tasteProfileChases);
  const directProfileReadyShelfCount = (items: DiscoveryCandidate[]): number =>
    selectVisibleCandidatesForCount(
      marketReadyShelfCandidatesWithOptions(items, true, profileConfidence, { allowPendingExploration: false })
        .filter((candidate) => hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases))
        .filter((candidate) => isScheduledProfileRelevantCandidate(candidate, tasteProfileChases)),
      positiveSubjectChases,
      targetCount,
      negativeProfile
    ).length;
  const profileMatchedReadyShelfCount = (items: DiscoveryCandidate[]): number =>
    selectVisibleCandidatesForCount(
      marketReadyShelfCandidatesWithOptions(items, true, profileConfidence, { allowPendingExploration: false })
        .filter(isProfileAlignedBackfillCandidate)
        .filter((candidate) => isScheduledProfileRelevantCandidate(candidate, tasteProfileChases)),
      positiveSubjectChases,
      targetCount,
      negativeProfile
    ).length;
  const hasConcreteProfileSignals = positiveSubjectChases.some((chase) => cacheBackfillSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')).length > 0);
  const merged = candidates.filter((candidate) => !isDiscoveryNameExcluded(candidate.suggestion.name, excludedNameKeys));
  if (readyShelfCount(merged) >= targetCount && (!hasConcreteProfileSignals || profileMatchedReadyShelfCount(merged) >= targetCount)) return merged;
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const seenVariantFamilies = new Set(merged.map(candidateVariantFamilyKey).filter((key): key is string => !!key));
  const cacheEntries = listReliableDiscoveryMarketCacheEntries({
    displayCurrency: context.targetCurrency,
    destinationCountry: context.destination?.country,
    limit: 1000
  });
  const candidateFromCacheEntry = (entry: DiscoveryMarketCacheEntry): DiscoveryCandidate => {
    const suggestion = marketCacheSuggestionFromCardName(entry.suggestionName);
    const cachedCandidate = candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE + merged.length, entry, context.targetCurrency, context.activeChases, false);
    return {
      ...cachedCandidate,
      listing: listingFromDiscoveryMarketCache(entry),
      image: entry.imageUrl
        ? {
            name: suggestion.name,
            url: entry.imageUrl,
            sourceName: marketplaceImageSourceNameForCandidate({
              ...cachedCandidate,
              listing: listingFromDiscoveryMarketCache(entry)
            }),
            sourceKind: 'MARKET_LISTING' as const
          }
        : undefined
    } satisfies DiscoveryCandidate;
  };
  const concreteDirectRefillCandidate = (candidate: DiscoveryCandidate): DiscoveryCandidate => {
    if (!isGenericDiscoveryCardTitle(candidate.suggestion.name)) return candidate;
    const listingTitle = candidate.listing?.title?.trim();
    if (!listingTitle || !hasConcreteCardIdentifier(listingTitle) || isGenericDiscoveryCardTitle(listingTitle)) return candidate;
    return {
      ...candidate,
      suggestion: {
        ...candidate.suggestion,
        name: listingTitle,
        evidenceSearchTerm: `${listingTitle} Pokemon card`,
        evidenceAliases: uniqueValuesPreservingOrder([listingTitle, candidate.suggestion.name, ...(candidate.suggestion.evidenceAliases ?? [])])
      }
    };
  };
  const addBackfillCandidate = (candidate: DiscoveryCandidate, options: { allowVariantFamilyDuplicate?: boolean } = {}): boolean => {
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) return false;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    if (seenNames.has(nameKey) || (!options.allowVariantFamilyDuplicate && variantKey && seenVariantFamilies.has(variantKey))) return false;
    merged.push(candidate);
    seenNames.add(nameKey);
    if (variantKey) seenVariantFamilies.add(variantKey);
    return true;
  };
  for (const entry of cacheEntries) {
    if ((!hasConcreteProfileSignals && readyShelfCount(merged) >= targetCount) || (hasConcreteProfileSignals && directProfileReadyShelfCount(merged) >= targetCount)) break;
    if (isDiscoveryNameExcluded(entry.suggestionName, excludedNameKeys)) continue;
    const candidate = candidateFromCacheEntry(entry);
    if (!isDisplayableDiscoveryCandidate(candidate) || !isConcreteDiscoverySuggestion(candidate.suggestion)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    if (!hasReliableMarketEstimate(candidate) || !isMarketEstimateInRange(candidate, context.range)) continue;
    if (!hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases)) continue;
    if (!isScheduledProfileRelevantCandidate(candidate, tasteProfileChases)) continue;
    addBackfillCandidate(candidate);
  }
  for (const entry of cacheEntries) {
    if ((!hasConcreteProfileSignals && readyShelfCount(merged) >= targetCount) || (hasConcreteProfileSignals && profileMatchedReadyShelfCount(merged) >= targetCount)) break;
    if (isDiscoveryNameExcluded(entry.suggestionName, excludedNameKeys)) continue;
    const candidate = candidateFromCacheEntry(entry);
    if (!isDisplayableDiscoveryCandidate(candidate) || !isConcreteDiscoverySuggestion(candidate.suggestion)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    if (!hasReliableMarketEstimate(candidate) || !isMarketEstimateInRange(candidate, context.range)) continue;
    if (!isProfileAlignedBackfillCandidate(candidate)) continue;
    if (!isScheduledProfileRelevantCandidate(candidate, tasteProfileChases)) continue;
    addBackfillCandidate(candidate, { allowVariantFamilyDuplicate: true });
  }
  for (const entry of cacheEntries) {
    if (readyShelfCount(merged) >= targetCount) break;
    if (isDiscoveryNameExcluded(entry.suggestionName, excludedNameKeys)) continue;
    const candidate = candidateFromCacheEntry(entry);
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    if (!isMarketEstimateInRange(candidate, context.range)) continue;
    if (!isReliableDirectSubjectRefillCandidate(candidate, tasteProfileChases)) continue;
    const concreteCandidate = concreteDirectRefillCandidate(candidate);
    if (isDiscoveryNameExcluded(concreteCandidate.suggestion.name, excludedNameKeys)) continue;
    if (!isDisplayableDiscoveryCandidate(concreteCandidate)) continue;
    addBackfillCandidate(concreteCandidate, { allowVariantFamilyDuplicate: true });
  }
  if (allowBroadCollectorBackfill) {
    for (const entry of cacheEntries) {
      if (readyShelfCount(merged) >= targetCount) break;
      if (isDiscoveryNameExcluded(entry.suggestionName, excludedNameKeys)) continue;
      const candidate = candidateFromCacheEntry(entry);
      if (!isMarketEstimateInRange(candidate, context.range)) continue;
      if (!isBroadCollectorShelfFillerCandidate(candidate, tasteProfileChases)) continue;
      const concreteCandidate = concreteDirectRefillCandidate(candidate);
      if (isDiscoveryNameExcluded(concreteCandidate.suggestion.name, excludedNameKeys)) continue;
      if (!isDisplayableDiscoveryCandidate(concreteCandidate)) continue;
      addBackfillCandidate(concreteCandidate, { allowVariantFamilyDuplicate: true });
    }
  }
  return orderCandidatesForMarketConfidence(merged, tasteProfileChases, negativeProfile);
}

function backfillJapaneseMarketSignalCandidates(
  candidates: DiscoveryCandidate[],
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  },
  targetJapaneseCount: number,
  tasteProfileChases: Chase[],
  repeatGuardChases: Chase[] = context.activeChases,
  excludedNames: string[] = []
): DiscoveryCandidate[] {
  if (targetJapaneseCount <= 0 || candidates.filter(isJapaneseDiscoveryCandidate).length >= targetJapaneseCount) return candidates;
  const positiveSubjectChases = positiveTasteSubjectChases(tasteProfileChases);
  const genericJapaneseBackfillLimit = Math.max(0, targetJapaneseCount - candidates.filter(isJapaneseDiscoveryCandidate).length);
  let genericJapaneseBackfillCount = 0;
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const merged = [...candidates];
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  for (const entry of listDiscoveryMarketSignalCacheEntries({ displayCurrency: context.targetCurrency, destinationCountry: context.destination?.country, limit: 1000 })) {
    if (merged.filter(isJapaneseDiscoveryCandidate).length >= targetJapaneseCount) break;
    const suggestion = marketCacheSuggestionFromCardName(entry.suggestionName);
    if (!isJapaneseSourceSuggestion(suggestion)) continue;
    if (isDiscoveryNameExcluded(suggestion.name, excludedNameKeys)) continue;
    const candidate = candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE + merged.length, entry, context.targetCurrency, context.activeChases, false);
    if (!isDisplayableDiscoveryCandidate(candidate) || !isConcreteDiscoverySuggestion(candidate.suggestion)) continue;
    if (!hasSomeRawMarketData(candidate) || !isMarketEstimateInRange(candidate, context.range)) continue;
    const hasSubjectMatch = hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases);
    const isGenericJapaneseSignal = !hasSubjectMatch && /\bjapanese pokemon cards\b/i.test(candidate.suggestion.name);
    if (!hasSubjectMatch && !isGenericJapaneseSignal) continue;
    if (isGenericJapaneseSignal && genericJapaneseBackfillCount >= genericJapaneseBackfillLimit) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    merged.push(candidate);
    seenNames.add(nameKey);
    if (isGenericJapaneseSignal) genericJapaneseBackfillCount += 1;
  }
  return merged;
}

function blendJapaneseSignalCandidates(candidates: DiscoveryCandidate[], japanesePool: DiscoveryCandidate[], chases: Chase[], targetCount: number): DiscoveryCandidate[] {
  const targetJapaneseCount = weeklyJapaneseSignalTargetCount(chases, targetCount);
  if (targetJapaneseCount <= 0) return candidates;
  const selected = [...candidates];
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const currentJapaneseCount = selected.filter(isJapaneseDiscoveryCandidate).length;
  if (currentJapaneseCount >= targetJapaneseCount) return selected;
  const additions: DiscoveryCandidate[] = [];
  const additionNameKeys = new Set<string>();
  for (const candidate of japanesePool) {
    if (additions.length >= targetJapaneseCount - currentJapaneseCount) break;
    if (!isJapaneseDiscoveryCandidate(candidate) || !isDisplayableDiscoveryCandidate(candidate)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey) || additionNameKeys.has(nameKey)) continue;
    additions.push(candidate);
    additionNameKeys.add(nameKey);
  }
  if (additions.length === 0) return selected;
  const protectedNameKeys = new Set(additions.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const trimmed = selected
    .filter((candidate) => isJapaneseDiscoveryCandidate(candidate) || !protectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)))
    .slice(0, Math.max(0, targetCount - additions.length));
  return [...additions, ...trimmed];
}

type WeeklyTasteLane = 'japanese' | 'promo' | 'e-reader' | 'retail-e-reader' | 'niche-japanese';

function hasRetailEReaderPromoProfileSignal(chases: Chase[]): boolean {
  return distinctProfileKeys(chases, profileReleaseTypeKeys).has('promo') && distinctProfileKeys(chases, profileEraKeys).has('e-reader');
}

function hasNicheJapaneseExclusiveProfileSignal(chases: Chase[]): boolean {
  const releaseTypes = distinctProfileKeys(chases, profileReleaseTypeKeys);
  const eras = distinctProfileKeys(chases, profileEraKeys);
  return hasJapaneseWeightedProfile(chases) && (releaseTypes.has('promo') || eras.has('vintage') || eras.has('e-reader'));
}

function weeklyTasteLaneTargets(chases: Chase[], targetCount: number): Array<{ lane: WeeklyTasteLane; target: number }> {
  const targets: Array<{ lane: WeeklyTasteLane; target: number }> = [];
  const releaseTypes = distinctProfileKeys(chases, profileReleaseTypeKeys);
  const eras = distinctProfileKeys(chases, profileEraKeys);
  const japaneseTarget = weeklyJapaneseSignalTargetCount(chases, targetCount);
  if (japaneseTarget > 0) targets.push({ lane: 'japanese', target: japaneseTarget });
  if (hasNicheJapaneseExclusiveProfileSignal(chases)) targets.push({ lane: 'niche-japanese', target: 1 });
  if (hasRetailEReaderPromoProfileSignal(chases)) targets.push({ lane: 'retail-e-reader', target: 1 });
  if (releaseTypes.has('promo')) targets.push({ lane: 'promo', target: Math.max(3, Math.ceil(targetCount * 0.2)) });
  if (eras.has('e-reader')) targets.push({ lane: 'e-reader', target: Math.max(3, Math.ceil(targetCount * 0.2)) });
  return targets;
}

function isRetailEReaderDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  return /\bmcdonald'?s\b/.test(text) && /\be[- ]?reader\b/.test(text) && /\bpromo\b/.test(text);
}

function isExactNicheRetailEReaderCandidate(candidate: DiscoveryCandidate): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName].filter(Boolean).join(' '));
  return isRetailEReaderDiscoveryCandidate(candidate) && /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(text);
}

function isNicheJapaneseExclusiveDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, candidate.image?.sourceName].filter(Boolean).join(' '));
  return /\bjapanese\b/.test(text) && /\b(?:bulbasaur deck|intro pack|vhs|deck exclusive|exclusive|odd(?:ball)? release)\b/.test(text);
}

function isExactNicheJapaneseExclusiveCandidate(candidate: DiscoveryCandidate): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName].filter(Boolean).join(' '));
  return isNicheJapaneseExclusiveDiscoveryCandidate(candidate) && /\b(?:no\.?\s*)?0?\d{2,3}\b/.test(text);
}

function isExactNicheDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  return isExactNicheRetailEReaderCandidate(candidate) || isExactNicheJapaneseExclusiveCandidate(candidate);
}

function hasSourceBackedRetailEReaderDisplayData(candidate: DiscoveryCandidate): boolean {
  return isRetailEReaderDiscoveryCandidate(candidate) && (hasReliableMarketEstimate(candidate) || candidate.image?.sourceKind === 'CARD_REFERENCE' || !!candidate.suggestion.referenceImageUrl);
}

function hasSourceBackedNicheJapaneseDisplayData(candidate: DiscoveryCandidate): boolean {
  return isNicheJapaneseExclusiveDiscoveryCandidate(candidate) && (hasReliableMarketEstimate(candidate) || candidate.image?.sourceKind === 'CARD_REFERENCE' || isVettedMarketplaceImageCandidate(candidate) || !!candidate.suggestion.referenceImageUrl);
}

function isWeeklyTasteLaneCandidate(candidate: DiscoveryCandidate, lane: WeeklyTasteLane): boolean {
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane].join(' '));
  if (lane === 'japanese') return isJapaneseDiscoveryCandidate(candidate) && hasLanguageSignalDisplayData(candidate);
  if (lane === 'niche-japanese') return hasSourceBackedNicheJapaneseDisplayData(candidate);
  if (lane === 'retail-e-reader') return hasSourceBackedRetailEReaderDisplayData(candidate) || hasSourceBackedNicheJapaneseDisplayData(candidate);
  if (lane === 'promo') return hasReliableMarketEstimate(candidate) && /\bpromo|black star|special delivery|futsal|toys r us|exclusive|classic collection|celebrations|felt hat\b/.test(text);
  return hasReliableMarketEstimate(candidate) && /\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(text);
}

function uniqueCandidatesByDisplayName(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  const unique: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seen.has(nameKey)) continue;
    unique.push(candidate);
    seen.add(nameKey);
  }
  return unique;
}

function displayRepresentativeCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const bestByDisplayName = new Map<string, DiscoveryCandidate>();
  const score = (candidate: DiscoveryCandidate): number =>
    imageQualityRank(candidate) * 100
    + (hasSourceBackedCardPresentation(candidate) ? 40 : 0)
    + marketEvidenceRank(candidate) * 20
    + (isConcreteHistoryFallbackCandidate(candidate) ? -10 : 0);
  for (const candidate of candidates) {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const current = bestByDisplayName.get(nameKey);
    if (!current || score(candidate) > score(current)) bestByDisplayName.set(nameKey, candidate);
  }
  return candidates.filter((candidate) => bestByDisplayName.get(discoveryDisplayNameKey(candidate.suggestion.name)) === candidate);
}

export function blendWeeklyTasteLaneCandidates(candidates: DiscoveryCandidate[], candidatePool: DiscoveryCandidate[], chases: Chase[], targetCount: number, softAvoidNames: string[] = []): DiscoveryCandidate[] {
  const laneTargets = weeklyTasteLaneTargets(chases, targetCount);
  if (laneTargets.length === 0) return candidates;
  const softAvoidNameKeys = discoveryExclusionNameKeys(softAvoidNames);
  const selected = candidates.slice(0, targetCount);
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const additions: DiscoveryCandidate[] = [];
  const additionNameKeys = new Set<string>();
  const countLane = (lane: WeeklyTasteLane): number => [...selected, ...additions].filter((candidate) => isWeeklyTasteLaneCandidate(candidate, lane)).length;
  const canUseCandidate = (candidate: DiscoveryCandidate): boolean => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    return isDisplayableDiscoveryCandidate(candidate) && !isDiscoveryNameExcluded(candidate.suggestion.name, softAvoidNameKeys) && !selectedNameKeys.has(nameKey) && !additionNameKeys.has(nameKey);
  };
  const rankedPool = orderCandidatesForMarketConfidence(candidatePool, chases);
  for (const { lane, target } of laneTargets) {
    for (const candidate of rankedPool) {
      if (countLane(lane) >= target) break;
      if (!canUseCandidate(candidate) || !isWeeklyTasteLaneCandidate(candidate, lane)) continue;
      additions.push(candidate);
      additionNameKeys.add(discoveryDisplayNameKey(candidate.suggestion.name));
    }
  }
  if (additions.length === 0) return selected;
  return uniqueCandidatesByDisplayName([...additions, ...selected]).slice(0, targetCount);
}

function backfillWeeklyTasteLaneMarketCandidates(
  candidates: DiscoveryCandidate[],
  context: {
    activeChases: Chase[];
    destination?: { country?: string; postalCode?: string };
    targetCurrency: SupportedCurrency;
    range?: { min: number; max: number };
  },
  targetCount: number,
  tasteProfileChases: Chase[],
  repeatGuardChases: Chase[] = context.activeChases,
  excludedNames: string[] = []
): DiscoveryCandidate[] {
  const laneTargets = weeklyTasteLaneTargets(tasteProfileChases, targetCount);
  if (laneTargets.length === 0) return candidates;
  const positiveSubjectChases = positiveTasteSubjectChases(tasteProfileChases);
  if (positiveSubjectChases.length === 0) return candidates;
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const merged = candidates.filter((candidate) => !isDiscoveryNameExcluded(candidate.suggestion.name, excludedNameKeys));
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const cacheEntries = listReliableDiscoveryMarketCacheEntries({
    displayCurrency: context.targetCurrency,
    destinationCountry: context.destination?.country,
    limit: 500
  });
  for (const entry of cacheEntries) {
    const suggestion = marketCacheSuggestionFromCardName(entry.suggestionName);
    if (isDiscoveryNameExcluded(suggestion.name, excludedNameKeys)) continue;
    const candidate = {
      ...candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE + merged.length, entry, context.targetCurrency, context.activeChases, false),
      listing: listingFromDiscoveryMarketCache(entry),
      image: entry.imageUrl
        ? {
            name: suggestion.name,
            url: entry.imageUrl,
            sourceName: marketplaceImageSourceNameForCandidate({
              ...candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE + merged.length, entry, context.targetCurrency, context.activeChases, false),
              listing: listingFromDiscoveryMarketCache(entry)
            }),
            sourceKind: 'MARKET_LISTING' as const
          }
        : undefined
    } satisfies DiscoveryCandidate;
    if (!isDisplayableDiscoveryCandidate(candidate) || !isConcreteDiscoverySuggestion(candidate.suggestion)) continue;
    if (!hasReliableMarketEstimate(candidate) || !isMarketEstimateInRange(candidate, context.range)) continue;
    if (!hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    if (!laneTargets.some(({ lane }) => isWeeklyTasteLaneCandidate(candidate, lane))) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    merged.push(candidate);
    seenNames.add(nameKey);
  }
  return orderCandidatesForMarketConfidence(merged, tasteProfileChases);
}

export function profileSubjectMatchedReliableDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  chases: Chase[],
  targetCount: number,
  negativeProfile?: DiscoveryNegativeProfile
): DiscoveryCandidate[] {
  const reliableCandidates = candidates.filter(hasReliableMarketEstimate);
  const positiveSubjectChases = positiveTasteSubjectChases(chases);
  const profileMatchedCandidates = reliableCandidates.filter((candidate) => hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases));
  const selectedProfileMatchedCandidates = selectVisibleCandidatesForCount(profileMatchedCandidates, positiveSubjectChases, targetCount, negativeProfile);
  return selectedProfileMatchedCandidates.length >= Math.min(targetCount, DISCOVERY_SHELF_PAGE_SIZE) ? profileMatchedCandidates : reliableCandidates;
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
  const ordinaryVmaxPenalty = isOrdinaryVmaxDiscoveryCandidate(candidate) ? 110 : 0;
  const weakMultiSubjectPenalty = isWeakSingleSubjectFromMultiSubjectProfile(candidate, chases) ? 140 : 0;
  const nicheGrailShapeBoost = isExactNicheDiscoveryCandidate(candidate) ? 130 : 0;
  return japaneseBoost + nicheGrailShapeBoost + subjectProfileRankScore(candidate, chases) - blackStarPenalty - historyFallbackPenalty - ordinaryVmaxPenalty - weakMultiSubjectPenalty - negativeProfileRankPenalty(candidate, negativeProfile);
}

function grailShapePriorityRank(candidate: DiscoveryCandidate, chases: Chase[] = []): number {
  if (!isExactNicheDiscoveryCandidate(candidate) || !hasSomeRawMarketData(candidate)) return 0;
  return hasConcreteProfileSubjectMatch(candidate, positiveTasteSubjectChases(chases)) ? 3 : 2;
}

function hasGxTagTeamFormatSignal(value: string): boolean {
  return /\b(?:tag team|gx)\b/i.test(value);
}

function hasPremiumVmaxContextText(value: string): boolean {
  return /\bvmax\b/i.test(value) && /\b(?:alt art|alternate art|full art|gallery|trainer gallery|galarian gallery|rare secret|secret rare|hyper rare|rainbow rare|sar|sir|special delivery|munch|poncho|pokemon center|kanazawa|yokohama|sapporo)\b/i.test(value);
}

function isOrdinaryVmaxDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  const text = sourceCardText(candidate);
  return /\bvmax\b/i.test(text) && !hasPremiumVmaxContextText(text);
}

function candidateSpecificSubjectTokens(candidate: DiscoveryCandidate): string[] {
  return cacheBackfillSubjectTokens([candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm].filter(Boolean).join(' '));
}

function chaseSpecificSubjectTokens(chase: Chase): string[] {
  return cacheBackfillSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' '));
}

function hasOnlyBroadMultiSubjectSupport(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  const candidateTokens = candidateSpecificSubjectTokens(candidate);
  if (candidateTokens.length !== 1) return false;
  const [candidateToken] = candidateTokens;
  const supportingChases = positiveTasteSubjectChases(chases).filter((chase) => chaseSpecificSubjectTokens(chase).includes(candidateToken));
  if (supportingChases.length === 0) return false;
  return supportingChases.every((chase) => chaseSpecificSubjectTokens(chase).length >= 2);
}

function hasPremiumSingleSubjectContext(candidate: DiscoveryCandidate): boolean {
  const text = sourceCardText(candidate);
  return /\b(?:skyridge|aquapolis|expedition|h\d{1,2}|crystal|shining|ex|lv\.?x|legend|gold star|japanese|exclusive|alt art|sar|sir)\b/i.test(text);
}

function isWeakSingleSubjectFromMultiSubjectProfile(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  return hasOnlyBroadMultiSubjectSupport(candidate, chases) && !hasPremiumSingleSubjectContext(candidate);
}

function profileHasVmaxAffinity(chases: Chase[] = []): boolean {
  return chases.some((chase) => /\bvmax\b/i.test([chase.cardName, chase.targetNote].filter(Boolean).join(' ')));
}

function hasSupportedProfileVmaxSubjectMatch(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (!hasDirectProfileSubjectMatch(candidate, chases)) return false;
  if (profileHasVmaxAffinity(chases)) return true;
  return directProfileSubjectSupportCount(candidate, chases) >= 2;
}

function profileHasGxTagTeamAffinity(chases: Chase[] = []): boolean {
  return chases.some((chase) => hasGxTagTeamFormatSignal([chase.cardName, chase.targetNote].filter(Boolean).join(' ')));
}

function preferProfileFormatAffinity(candidates: DiscoveryCandidate[], chases: Chase[], count: number): DiscoveryCandidate[] {
  const hasGxTagTeamAffinity = profileHasGxTagTeamAffinity(chases);
  const positiveSubjectChases = positiveTasteSubjectChases(chases);
  const preferred = candidates.filter((candidate) => {
    const text = sourceCardText(candidate);
    if (/\bvmax\b/i.test(text) && !hasPremiumVmaxContextText(text)) return false;
    if (/\bvmax\b/i.test(text) && positiveSubjectChases.length > 0 && !hasSupportedProfileVmaxSubjectMatch(candidate, positiveSubjectChases)) return false;
    if (!hasGxTagTeamAffinity && hasGxTagTeamFormatSignal(text)) return false;
    return true;
  });
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

function expandedProfileSubjectTokens(value: string): string[] {
  return profileSubjectTokens(value);
}

function profileReleaseTypeKeys(value: string): string[] {
  const text = normalize(value);
  const keys: string[] = [];
  if (/\bpromo|black star|special delivery|futsal|celebrations|classic collection|exclusive|toys r us|retail|event\b/.test(text)) keys.push('promo');
  if (/\bjapanese|tcgdex|coro\s?coro|vending|masaki|munch|poncho\b/.test(text)) keys.push('japanese');
  if (/\bcoro\s?coro\b/.test(text)) keys.push('corocoro', 'publication');
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

function profileSpecialSetLabels(chases: Chase[]): Set<string> {
  const labels = new Set<string>();
  for (const chase of chases) {
    const label = chaseSpecialSetLabel(chase);
    if (label) labels.add(label);
  }
  return labels;
}

function candidateSpecialSetLabels(candidate: DiscoveryCandidate): Set<string> {
  const text = [sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, ...(candidate.suggestion.sourceTasteTokens ?? [])]
    .filter(Boolean)
    .join(' ');
  const labels = new Set<string>();
  for (const { label, pattern } of SPECIAL_SET_LABEL_PATTERNS) {
    if (pattern.test(text)) labels.add(label);
  }
  return labels;
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
  const positiveChases = positiveTasteSubjectChases(chases);
  const signalCount = positiveChases.length;
  const subjectCount = distinctProfileKeys(positiveChases, (value) => profileSubjectTokens(value).slice(0, 2)).size;
  const releaseTypeCount = distinctProfileKeys(positiveChases, profileReleaseTypeKeys).size;
  const eraCount = distinctProfileKeys(positiveChases, profileEraKeys).size;
  const diversityScore = [subjectCount >= 2, releaseTypeCount >= 2, eraCount >= 2].filter(Boolean).length;
  if (signalCount >= MIN_STRONG_PROFILE_CHASES && diversityScore >= 2) {
    return { tier: 'STRONG', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: DISCOVERY_WEEKLY_DROP_SIZE, maxShelfSize: DISCOVERY_WEEKLY_DROP_SIZE };
  }
  if (signalCount >= MIN_LEARNED_PROFILE_CHASES) return { tier: 'USABLE', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: 14, maxShelfSize: DISCOVERY_WEEKLY_DROP_SIZE };
  if (signalCount >= 3) return { tier: 'EMERGING', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: DISCOVERY_SHELF_PAGE_SIZE, maxShelfSize: 14 };
  return { tier: 'SEED', signalCount, subjectCount, releaseTypeCount, eraCount, minShelfSize: 5, maxShelfSize: DISCOVERY_SHELF_PAGE_SIZE };
}

export function discoveryShelfTighteningNote(): string {
  return '🔮 **Reading:** Vaultr is still learning from your chases, feedback, and collector patterns';
}

export function discoveryShelfMarketCheckNote(shelfSize: number): string {
  return `🧪 **Market Check:** showing ${shelfSize} picks with cleaner live market checks. Thinner comp rows will keep refreshing automatically`;
}

export function shouldShowDiscoveryShelfTighteningNote(hasFullDiscovery: boolean, shelfSize: number, proShelfSize = weeklyDiscoveryShelfSizeForPlan('PRO')): boolean {
  return hasFullDiscovery && shelfSize < Math.ceil(proShelfSize * 0.75);
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

function rankDiscoveryCandidatesForProfile(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): DiscoveryCandidate[] {
  if (chases.length === 0) {
    return [...candidates].sort((left, right) => {
      const sourceDelta = sourcePreferenceRankScore(right, chases, negativeProfile) - sourcePreferenceRankScore(left, chases, negativeProfile);
      return sourceDelta || curiosityRankScore(right) - curiosityRankScore(left);
    });
  }
  return [...candidates].sort((left, right) => {
    const collectorDelta = collectorDiscoveryRankScore(right, chases, negativeProfile, learnedRankContext) - collectorDiscoveryRankScore(left, chases, negativeProfile, learnedRankContext);
    return collectorDelta || curiosityRankScore(right) - curiosityRankScore(left);
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
    why: 'keeps the Weekly Shelf full with concrete source-backed cards while personalized market data catches up',
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

function japaneseSourceBackfillParents(chases: Chase[]): DiscoverySuggestion[] {
  const parent = (subject: string): DiscoverySuggestion => ({
    name: `${titleCase(subject)} Japanese Pokemon cards`,
    lane: 'Japanese Collector Trail',
    laneWhy: 'Japanese-language profile signal',
    why: 'keeps Japanese-language and regional print flavor represented in a profile that has Japanese collector signals',
    nearby: [],
    evidenceSearchTerm: `${subject} Japanese Pokemon card`,
    evidenceAliases: [`${subject} Japanese Pokemon`, `${subject} Japanese card`],
    requiredEvidenceTokens: [subject, 'japanese'],
    sourceTasteTokens: [subject, 'japanese'],
    curiosityScore: 4
  });
  const subjects = uniqueValuesPreservingOrder(
    chases
      .filter(hasJapaneseChaseSignal)
      .flatMap((chase) => profileSubjectTokens([chase.cardName, chase.targetNote].filter(Boolean).join(' ')))
      .filter((token) => token.length >= 3 && !['card', 'cards', 'japanese', 'pokemon', 'promo', 'shining'].includes(token))
  ).slice(0, 6);
  return subjects.map(parent);
}

type ProfileVariantSourceThread = {
  suffix: string;
  lane: string;
  laneWhy: string;
  tokens: string[];
  sourceTasteTokens?: string[];
  curiosityScore: number;
};

const SET_SIBLING_FAMILIES: string[][] = [
  ['eevee', 'vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon']
];

const SPECIAL_SET_LABEL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Terastal Festival', pattern: /\bterastal festival\b|\bsv8a\b/i },
  { label: 'Eevee Heroes', pattern: /\beevee heroes\b|\bs6a\b/i },
  { label: 'VSTAR Universe', pattern: /\bvstar universe\b|\bs12a\b/i },
  { label: 'Pokemon Card 151', pattern: /\bpokemon card 151\b|\bpokemon 151\b|\bsv2a\b/i },
  { label: 'Paldean Fates', pattern: /\bpaldean fates\b/i },
  { label: 'Crown Zenith', pattern: /\bcrown zenith\b/i },
  { label: 'Shiny Treasure ex', pattern: /\bshiny treasure ex\b|\bsv4a\b/i }
];

function chaseSpecialSetLabel(chase: Chase): string | undefined {
  const text = [chase.cardName, chase.targetNote].filter(Boolean).join(' ');
  return SPECIAL_SET_LABEL_PATTERNS.find(({ pattern }) => pattern.test(text))?.label;
}

function siblingSubjectsForChase(chase: Chase): string[] {
  const chaseSubjects = chaseSpecificSubjectTokens(chase);
  const siblings = new Set<string>();
  for (const family of SET_SIBLING_FAMILIES) {
    if (!chaseSubjects.some((subject) => family.includes(subject))) continue;
    for (const member of family) {
      if (!chaseSubjects.includes(member)) siblings.add(member);
    }
  }
  return [...siblings];
}

export function profileVariantSourceBackfillParents(chases: Chase[], targetCount = DISCOVERY_CANDIDATE_POOL_SIZE): DiscoverySuggestion[] {
  const subjectChases = positiveTasteSubjectChases(chases);
  const usefulSubjectToken = (token: string): boolean => token.length >= 3 && !CACHE_BACKFILL_SUBJECT_STOP_WORDS.has(token) && !/^[a-z]{1,5}\d+$/i.test(token) && !['corocoro', 'mega', 'pokemon', 'rus', 'shining', 'toys'].includes(token);
  const subjectTokens = subjectChases.flatMap((chase) => {
    const text = [chase.cardName, chase.targetNote].filter(Boolean).join(' ');
    return profileSubjectTokens(text).filter(usefulSubjectToken);
  });
  const releaseTypes = distinctProfileKeys(chases, profileReleaseTypeKeys);
  const eras = distinctProfileKeys(chases, profileEraKeys);
  const hasRetailEReaderPromoSignal = releaseTypes.has('promo') && eras.has('e-reader');
  const hasNicheJapaneseExclusiveSignal = hasJapaneseWeightedProfile(chases) && (releaseTypes.has('promo') || eras.has('vintage') || eras.has('e-reader'));
  const hasJapaneseSpecialSetSignal = hasJapaneseWeightedProfile(chases) && releaseTypes.has('promo');
  const hasCoroCoroPublicationSignal = hasJapaneseWeightedProfile(chases) && releaseTypes.has('corocoro');
  const subjectLimit = Math.max(4, Math.min(24, Math.ceil(targetCount / (hasNicheJapaneseExclusiveSignal ? 4 : 5))));
  const subjects = uniqueValuesPreservingOrder(subjectTokens).slice(0, subjectLimit);
  const nicheJapaneseExclusiveThread = { suffix: 'Japanese unique release Pokemon cards', lane: 'Japanese Collector Trail', laneWhy: 'Japanese exclusiveness and unusual-release signals', tokens: ['japanese', 'exclusive', 'unique'], curiosityScore: 9 };
  const japaneseSpecialSetThread = { suffix: 'Japanese special set Pokemon cards', lane: 'Japanese Collector Trail', laneWhy: 'Japanese small-set and numbered-release signals', tokens: ['japanese', 'special set', 'small set', 'numbered set'], curiosityScore: 9 };
  const coroCoroPublicationThread = { suffix: 'CoroCoro promo Pokemon cards', lane: 'Japanese Collector Trail', laneWhy: 'Japanese magazine-promo publication signals', tokens: ['corocoro'], sourceTasteTokens: ['japanese', 'promo', 'corocoro', 'magazine'], curiosityScore: 10 };
  const threads: ProfileVariantSourceThread[] = [
    ...(hasJapaneseWeightedProfile(chases) ? [{ suffix: 'Japanese Pokemon cards', lane: 'Japanese Collector Trail', laneWhy: 'same-subject Japanese print variants', tokens: ['japanese'], curiosityScore: 6 }] : []),
    ...(hasCoroCoroPublicationSignal ? [coroCoroPublicationThread] : []),
    ...(hasJapaneseSpecialSetSignal ? [japaneseSpecialSetThread] : []),
    ...(hasRetailEReaderPromoSignal ? [{ suffix: "McDonald's e-Reader promo Pokemon cards", lane: 'Retail Promo Trail', laneWhy: 'same-subject retail e-reader promo variants', tokens: ['promo', 'e-reader', 'mcdonalds'], curiosityScore: 7 }] : []),
    ...(hasNicheJapaneseExclusiveSignal ? [nicheJapaneseExclusiveThread] : []),
    { suffix: 'Pokemon promo cards', lane: 'Promo Trail', laneWhy: 'same-subject promo release variants', tokens: ['promo'], curiosityScore: 5 },
    { suffix: 'e-reader Pokemon cards', lane: 'E-Reader Era Trail', laneWhy: 'same-subject early-2000s set variants', tokens: ['e-reader'], curiosityScore: 4 },
    { suffix: 'illustration rare Pokemon cards', lane: 'Artwork Trail', laneWhy: 'same-subject artwork-led variants', tokens: ['illustration'], curiosityScore: 4 },
    { suffix: 'Pokemon collector cards', lane: 'Collector Compass', laneWhy: 'same-subject set and release variants', tokens: ['collector'], curiosityScore: 3 }
  ];
  const parents: DiscoverySuggestion[] = [];
  const pushParent = (subject: string, thread: ProfileVariantSourceThread): void => {
    const sourceTasteTokens = thread.sourceTasteTokens ?? thread.tokens;
    parents.push({
      name: `${titleCase(subject)} ${thread.suffix}`,
      lane: thread.lane,
      laneWhy: thread.laneWhy,
      why: `keeps the Weekly Shelf fresh with different ${titleCase(subject)} sets, promos, and release shapes instead of repeating the same prepared card`,
      nearby: [],
      evidenceSearchTerm: `${subject} ${thread.suffix.replace('Pokemon ', 'Pokemon card ')}`,
      evidenceAliases: [`${subject} Pokemon card`, `${subject} ${thread.tokens.join(' ')}`, `${subject} ${thread.suffix}`],
      requiredEvidenceTokens: [subject, ...thread.tokens],
      sourceTasteTokens: [subject, ...sourceTasteTokens],
      curiosityScore: thread.curiosityScore
    });
  };
  if (hasNicheJapaneseExclusiveSignal) {
    for (const subject of subjects) pushParent(subject, nicheJapaneseExclusiveThread);
  }
  if (hasJapaneseSpecialSetSignal) {
    for (const subject of subjects) pushParent(subject, japaneseSpecialSetThread);
  }
  if (hasCoroCoroPublicationSignal) {
    for (const subject of subjects) pushParent(subject, coroCoroPublicationThread);
  }
  for (const subject of subjects) {
    for (const thread of threads) {
      if (hasNicheJapaneseExclusiveSignal && thread === nicheJapaneseExclusiveThread) continue;
      if (hasJapaneseSpecialSetSignal && thread === japaneseSpecialSetThread) continue;
      if (hasCoroCoroPublicationSignal && thread === coroCoroPublicationThread) continue;
      pushParent(subject, thread);
    }
  }
  for (const chase of subjectChases) {
    const setLabel = chaseSpecialSetLabel(chase);
    if (!setLabel) continue;
    const siblingSubjects = siblingSubjectsForChase(chase);
    for (const sibling of siblingSubjects) {
      parents.push({
        name: `${titleCase(sibling)} ${setLabel} Pokemon cards`,
        lane: 'Set Companion Trail',
        laneWhy: `same-set collector companions from ${setLabel}`,
        why: `branches from ${titleCase(setLabel)} into other collector-relevant subjects from the same set instead of repeating the same card family`,
        nearby: [],
        evidenceSearchTerm: `${sibling} ${setLabel} Japanese Pokemon card`,
        evidenceAliases: [`${sibling} ${setLabel}`, `${sibling} ${setLabel} Pokemon card`],
        requiredEvidenceTokens: [sibling, 'japanese', setLabel, 'special set', 'small set', 'numbered set'],
        sourceTasteTokens: [sibling, 'japanese', setLabel, 'special set', 'small set', 'numbered set'],
        curiosityScore: 11
      });
    }
  }
  return parents.slice(0, Math.max(targetCount, DISCOVERY_SHELF_PAGE_SIZE));
}

function isJapaneseSourceSuggestion(suggestion: DiscoverySuggestion): boolean {
  return /\bjapanese\b/i.test([suggestion.name, suggestion.evidenceSearchTerm, suggestion.referenceSourceName, ...(suggestion.requiredEvidenceTokens ?? [])].filter(Boolean).join(' '));
}

function profileJapaneseMarketSeedSuggestions(chases: Chase[], targetCount: number): DiscoverySuggestion[] {
  if (!hasJapaneseWeightedProfile(chases)) return [];
  return profileVariantSourceBackfillParents(chases, targetCount)
    .filter(isJapaneseSourceSuggestion)
    .slice(0, targetCount);
}

function hasJapaneseWeightedProfile(chases: Chase[]): boolean {
  return japaneseSignalWeightRatio(chases) >= 0.35 || hasPriorityJapaneseChase(chases);
}

function weeklyJapaneseSignalTargetCount(chases: Chase[], maxShelfSize: number): number {
  if (!hasJapaneseWeightedProfile(chases)) return 0;
  const ratio = japaneseSignalWeightRatio(chases);
  const targetRatio = Math.max(0.08, Math.min(0.18, ratio * 0.6));
  return Math.max(1, Math.min(3, Math.ceil(maxShelfSize * targetRatio)));
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
    /\b(?:aquapolis|champion's path|celebrations|destined rivals|evolutions|expedition|fates collide|fusion strike|generations|gym challenge|gym heroes|hidden fates|journey together|legendary treasures|lost origin|paldean fates|power keepers|secret wonders|shiny vault|skyridge|surging sparks|unified minds|vivid voltage|futsal collection)\b.*\b\d{1,3}\b/i.test(value)
  );
}

function isGenericDiscoveryCardTitle(value: string): boolean {
  const normalized = normalize(value);
  return /\b(?:collector|e[- ]?reader|ex|full art|gx|illustration rare|japanese|promo|raw|sar|sir|special release|special set|tag team|unique release|vintage) pokemon cards?\b/.test(normalized) || /\b(?:collector|e[- ]?reader|ex|full art|gx|illustration rare|japanese|promo|raw|sar|sir|special release|special set|tag team|unique release|vintage) cards?\b/.test(normalized) || /\braw card\b/.test(normalized);
}

function hasUnverifiedHighRiskPromoIdentity(suggestion: DiscoverySuggestion): boolean {
  const text = [suggestion.name, suggestion.evidenceSearchTerm, suggestion.referenceSourceName, ...(suggestion.evidenceAliases ?? []), ...(suggestion.requiredEvidenceTokens ?? [])]
    .filter(Boolean)
    .join(' ');
  const hasJapanesePromoCode = /\b\d{3}\s*\/\s*[a-z-]+\b/i.test(text) || /\bsv-p\b/i.test(text);
  const promoLike = /\b(?:promo|promos|nintendo|black star|japanese)\b/i.test(text);
  if (!hasJapanesePromoCode || !promoLike) return false;
  return !(suggestion.referenceImageUrl || suggestion.referenceSourceCardId);
}

function isConcreteDiscoverySuggestion(suggestion: DiscoverySuggestion): boolean {
  if (hasUnverifiedHighRiskPromoIdentity(suggestion)) return false;
  return !!(suggestion.referenceImageUrl || suggestion.referenceSourceCardId || suggestion.referenceSourceName || (!isGenericDiscoveryCardTitle(suggestion.name) && hasConcreteCardIdentifier(suggestion.name)));
}

function isConcreteDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  if (isConcreteDiscoverySuggestion(candidate.suggestion)) return true;
  const listingTitle = candidate.listing?.title?.trim();
  return !!listingTitle && hasConcreteCardIdentifier(listingTitle) && !isGenericDiscoveryCardTitle(listingTitle);
}

function isDisplayableDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  if (hasUnverifiedHighRiskPromoIdentity(candidate.suggestion)) return false;
  return isConcreteDiscoverySuggestion(candidate.suggestion) || !isGenericDiscoveryCardTitle(candidate.suggestion.name);
}

function isFinishedShelfCandidate(candidate: DiscoveryCandidate): boolean {
  if (!isDisplayableDiscoveryCandidate(candidate)) return false;
  if (isGenericDiscoveryCardTitle(candidate.suggestion.name)) return false;
  return isConcreteDiscoveryCandidate(candidate);
}

function fallbackSuggestionFromCardName(name: string): DiscoverySuggestion {
  return {
    name,
    lane: 'Collector Compass',
    laneWhy: 'previously surfaced card from this collector profile',
    why: 'A concrete card Vaultr has already connected to this profile, kept as a fallback while fresh sources resolve',
    nearby: [],
    evidenceSearchTerm: `${name} Pokemon card`,
    evidenceAliases: [name],
    requiredEvidenceTokens: profileSubjectTokens(name).slice(0, 2)
  };
}

function inferredReferenceSourceNameFromCardName(name: string): string | undefined {
  const text = normalize(name);
  const specialSetLabel = SPECIAL_SET_LABEL_PATTERNS.find(({ pattern }) => pattern.test(text))?.label;
  const compactJapaneseSetMatch = /\b((?:S|SV|SM|XY)\d{1,3}[a-z]?)\b/i.exec(name)?.[1]?.toUpperCase();
  const knownSetMatch = /\b(Expedition Base Set|Aquapolis|Skyridge|Wizards Black Star Promos|XY Black Star Promos|BW Black Star Promos|SWSH Black Star Promos|SM Black Star Promos|Surging Sparks|Paldean Fates|Legendary Treasures|Destined Rivals|Journey Together|Stellar Crown|151)\b/i.exec(name)?.[1];
  const shorthandPromoSetMatch = /\b(XY|BW|SWSH|SM)\s+Promos?\b/i.exec(name)?.[1]?.toUpperCase();
  const japaneseSource = /\bjapanese\b|coro\s?coro|vending|masaki|munch|poncho/.test(text);
  if (japaneseSource && specialSetLabel) return `TCGdex Japanese (${specialSetLabel})`;
  if (japaneseSource && compactJapaneseSetMatch) return `TCGdex Japanese (${compactJapaneseSetMatch})`;
  if (knownSetMatch) return `Pokemon TCG (${knownSetMatch})`;
  if (shorthandPromoSetMatch) return `Pokemon TCG (${shorthandPromoSetMatch} Black Star Promos)`;
  return undefined;
}

function marketCacheExpansionLane(name: string): string {
  const text = normalize(name);
  if (/\bjapanese\b|coro\s?coro|vending|masaki|munch|poncho/.test(text)) return 'Japanese Collector Trail';
  if (/\bexpedition\b|\baquapolis\b|\bskyridge\b|e[- ]?reader/.test(text)) return 'E-Reader Era Trail';
  if (/\bpromo|black star|special delivery|futsal|toys r us|celebrations|classic collection\b/.test(text)) return 'Promo Trail';
  if (/\billustration|art rare|gallery|full art|sar|\bar\b/.test(text)) return 'Artwork Trail';
  if (/\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b|\bex\b/.test(text)) return 'Format Trail';
  return 'Value Watch';
}

function marketCacheSuggestionFromCardName(name: string): DiscoverySuggestion {
  const lane = marketCacheExpansionLane(name);
  const referenceSourceName = inferredReferenceSourceNameFromCardName(name);
  return {
    ...fallbackSuggestionFromCardName(name),
    lane,
    laneWhy: 'market-ready profile expansion',
    why: 'A market-ready adjacent card Vaultr connected to this collector profile from prepared pricing data',
    referenceSourceName
  };
}

function universeContextTokensFromSuggestion(suggestion: DiscoverySuggestion): string[] {
  return uniqueValuesPreservingOrder(
    profileSubjectTokens([
      suggestion.name,
      suggestion.evidenceSearchTerm,
      suggestion.referenceSourceName,
      ...(suggestion.requiredEvidenceTokens ?? []),
      ...(suggestion.sourceTasteTokens ?? []),
      ...(suggestion.evidenceAliases ?? [])
    ].filter(Boolean).join(' '))
  );
}

function universeSubjectTokensForCandidate(candidate: DiscoveryCandidate): string[] {
  const subjectTokens = candidateSubjectDiversityKeys(candidate);
  if (subjectTokens.length > 0) return uniqueValuesPreservingOrder(subjectTokens);
  return uniqueValuesPreservingOrder(profileSubjectTokens(candidate.suggestion.name).slice(0, 3));
}

function universeTraitTokensForCandidate(candidate: DiscoveryCandidate): string[] {
  return uniqueValuesPreservingOrder([
    ...candidateTraitKeys(candidate),
    ...profileTraitKeys([
      candidate.suggestion.lane,
      candidate.suggestion.referenceSourceName,
      ...(candidate.suggestion.sourceTasteTokens ?? [])
    ].filter(Boolean).join(' '))
  ]);
}

function persistDiscoveryUniverseCandidate(candidate: DiscoveryCandidate): void {
  if (!isFinishedShelfCandidate(candidate)) return;
  if (!isCollectorWorthyWeeklyCandidate(candidate)) return;
  if (isMarketplaceStyleDiscoveryName(candidate.suggestion.name)) return;
  upsertDiscoveryUniverseCard({
    canonicalName: candidate.suggestion.name,
    suggestion: candidate.suggestion,
    lane: candidate.suggestion.lane,
    sourceName: candidate.image?.sourceName ?? candidate.suggestion.referenceSourceName,
    imageUrl: candidate.image?.url ?? candidate.suggestion.referenceImageUrl,
    imageSourceName: candidate.image?.sourceName,
    sourceCardId: candidate.image?.sourceCardId ?? candidate.suggestion.referenceSourceCardId,
    subjectTokens: universeSubjectTokensForCandidate(candidate),
    traitTokens: universeTraitTokensForCandidate(candidate),
    marketTotal: discoveryMarketTotal(candidate),
    marketCurrency: candidate.displayCurrency
  });
}

function persistDiscoveryUniverseSuggestions(suggestions: DiscoverySuggestion[]): void {
  for (const suggestion of suggestions) {
    if (!isConcreteDiscoverySuggestion(suggestion)) continue;
    upsertDiscoveryUniverseCard({
      canonicalName: suggestion.name,
      suggestion,
      lane: suggestion.lane,
      sourceName: suggestion.referenceSourceName,
      imageUrl: suggestion.referenceImageUrl,
      imageSourceName: suggestion.referenceSourceName,
      sourceCardId: suggestion.referenceSourceCardId,
      subjectTokens: uniqueValuesPreservingOrder(profileSubjectTokens(suggestion.name).slice(0, 3)),
      traitTokens: uniqueValuesPreservingOrder([
        ...profileTraitKeys([
          suggestion.name,
          suggestion.lane,
          suggestion.referenceSourceName,
          ...(suggestion.sourceTasteTokens ?? [])
        ].filter(Boolean).join(' '))
      ])
    });
  }
}

function candidateFromDiscoveryUniverseCard(entry: DiscoveryUniverseCard, selectionIndex: number): DiscoveryCandidate {
  return {
    suggestion: {
      ...marketCacheSuggestionFromCardName(entry.canonicalName),
      ...entry.suggestion,
      lane: entry.suggestion.lane ?? entry.lane ?? marketCacheExpansionLane(entry.canonicalName),
      referenceSourceName: entry.suggestion.referenceSourceName ?? entry.sourceName,
      referenceImageUrl: entry.suggestion.referenceImageUrl ?? entry.imageUrl,
      referenceSourceCardId: entry.suggestion.referenceSourceCardId ?? entry.sourceCardId
    },
    image: entry.imageUrl
      ? {
          name: entry.canonicalName,
          url: entry.imageUrl,
          sourceName: entry.imageSourceName ?? entry.sourceName,
          sourceCardId: entry.sourceCardId,
          sourceKind: 'CARD_REFERENCE'
        }
      : undefined,
    typicalRawAskingTotal: entry.marketTotal,
    marketSampleSize: entry.marketTotal === undefined ? undefined : Math.max(MIN_ASK_ONLY_MARKET_SAMPLE_SIZE, Math.min(12, entry.observationCount)),
    displayCurrency: entry.marketCurrency as SupportedCurrency | undefined,
    selectionIndex
  };
}

function discoveryUniverseScoreComponents(entry: DiscoveryUniverseCard, chases: Chase[]): Record<string, number> {
  const profileSubjects = distinctProfileKeys(positiveTasteSubjectChases(chases), (value) => expandedProfileSubjectTokens(value).slice(0, 3));
  const profileTraits = distinctProfileKeys(positiveTasteSubjectChases(chases), profileTraitKeys);
  const profileSpecialSets = profileSpecialSetLabels(positiveTasteSubjectChases(chases));
  const entryContextTokens = new Set([
    ...entry.subjectTokens,
    ...universeContextTokensFromSuggestion(entry.suggestion)
  ]);
  const entryTraits = new Set(entry.traitTokens);
  const subjectOverlap = [...profileSubjects].filter((token) => entry.subjectTokens.includes(token)).length;
  const contextOverlap = [...profileSubjects].filter((token) => entryContextTokens.has(token)).length;
  const traitOverlap = [...profileTraits].filter((token) => entryTraits.has(token)).length;
  const setOverlap = [...profileSpecialSets].some((label) => cardTextHasToken(normalize([entry.canonicalName, entry.sourceName, entry.lane, entry.suggestion.referenceSourceName].filter(Boolean).join(' ')), label)) ? 1 : 0;
  const observation = Math.min(6, entry.observationCount);
  const image = entry.imageUrl ? 4 : 0;
  const market = entry.marketTotal !== undefined ? 4 : 0;
  return {
    subjectOverlap,
    contextOverlap,
    traitOverlap,
    setOverlap,
    observation,
    image,
    market
  };
}

function scoreDiscoveryUniverseCardForProfile(entry: DiscoveryUniverseCard, chases: Chase[]): number {
  const components = discoveryUniverseScoreComponents(entry, chases);
  const { subjectOverlap, contextOverlap, traitOverlap, setOverlap, observation, image, market } = components;
  if (subjectOverlap === 0 && contextOverlap === 0 && setOverlap === 0) return Number.NEGATIVE_INFINITY;
  return subjectOverlap * 18
    + contextOverlap * 10
    + traitOverlap * 7
    + setOverlap * 8
    + observation
    + image
    + market;
}

function selectDiscoveryUniverseCandidatesForProfile(
  chases: Chase[],
  excludedNames: string[],
  targetCount: number,
  repeatGuardChases: Chase[] = chases
): DiscoveryCandidate[] {
  if (chases.length === 0) return [];
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const ranked = listDiscoveryUniverseCards(Math.max(300, targetCount * 20))
    .filter((entry) => !isDiscoveryNameExcluded(entry.canonicalName, excludedNameKeys))
    .map((entry) => ({
      entry,
      score: scoreDiscoveryUniverseCardForProfile(entry, chases)
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score || right.entry.observationCount - left.entry.observationCount || left.entry.canonicalName.localeCompare(right.entry.canonicalName));

  const selected: DiscoveryCandidate[] = [];
  const seenNames = new Set<string>();
  for (const { entry } of ranked) {
    if (selected.length >= targetCount) break;
    const candidate = candidateFromDiscoveryUniverseCard(entry, selected.length);
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (isMarketplaceStyleDiscoveryName(candidate.suggestion.name)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    if (!isDisplayableDiscoveryCandidate(candidate)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    selected.push(candidate);
    seenNames.add(nameKey);
  }
  return selected;
}

function rebuildUserDiscoveryUniverse(userId: string, chases: Chase[], repeatGuardChases: Chase[] = chases): void {
  const ranked = listDiscoveryUniverseCards(2000)
    .map((entry) => ({
      entry,
      score: scoreDiscoveryUniverseCardForProfile(entry, chases)
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score || right.entry.observationCount - left.entry.observationCount || left.entry.canonicalName.localeCompare(right.entry.canonicalName));
  const selected: DiscoveryUniverseCard[] = [];
  const seenNames = new Set<string>();
  for (const { entry } of ranked) {
    if (selected.length >= 800) break;
    const candidate = candidateFromDiscoveryUniverseCard(entry, selected.length);
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    if (!isDisplayableDiscoveryCandidate(candidate)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    selected.push(entry);
    seenNames.add(nameKey);
  }
  replaceDiscoveryUserUniverseCards(userId, selected.map((entry) => ({
    userId,
    cardKey: entry.cardKey,
    canonicalName: entry.canonicalName,
    score: scoreDiscoveryUniverseCardForProfile(entry, chases),
    scoreComponents: discoveryUniverseScoreComponents(entry, chases),
    suggestion: entry.suggestion,
    imageUrl: entry.imageUrl,
    imageSourceName: entry.imageSourceName,
    sourceCardId: entry.sourceCardId,
    marketTotal: entry.marketTotal,
    marketCurrency: entry.marketCurrency
  })));
}

function selectDiscoveryUserUniverseCandidatesFromEntries(
  entries: DiscoveryUserUniverseCard[],
  excludedNames: string[],
  targetCount: number,
  profileChases: Chase[],
  repeatGuardChases: Chase[]
): DiscoveryCandidate[] {
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const eligible: DiscoveryCandidate[] = [];
  const seenNames = new Set<string>();
  for (const entry of entries) {
    if (isDiscoveryNameExcluded(entry.canonicalName, excludedNameKeys)) continue;
    const candidate: DiscoveryCandidate = {
      suggestion: {
        ...marketCacheSuggestionFromCardName(entry.canonicalName),
        ...entry.suggestion,
        referenceImageUrl: entry.suggestion.referenceImageUrl ?? entry.imageUrl,
        referenceSourceName: entry.suggestion.referenceSourceName ?? entry.imageSourceName,
        referenceSourceCardId: entry.suggestion.referenceSourceCardId ?? entry.sourceCardId
      },
      image: entry.imageUrl
        ? {
            name: entry.canonicalName,
            url: entry.imageUrl,
            sourceName: entry.imageSourceName,
            sourceCardId: entry.sourceCardId,
            sourceKind: 'CARD_REFERENCE'
          }
        : undefined,
      typicalRawAskingTotal: entry.marketTotal,
      marketSampleSize: entry.marketTotal === undefined ? undefined : MIN_ASK_ONLY_MARKET_SAMPLE_SIZE,
      displayCurrency: entry.marketCurrency as SupportedCurrency | undefined,
      selectionIndex: eligible.length
    };
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seenNames.has(nameKey)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    if (!isDisplayableDiscoveryCandidate(candidate)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    eligible.push(candidate);
    seenNames.add(nameKey);
  }
  if (eligible.length <= targetCount) return eligible;
  const prioritized = eligible.slice(0, Math.min(eligible.length, Math.max(targetCount * 4, DISCOVERY_SHELF_PAGE_SIZE * 4)));
  const diversifiedSeeds = takeDistinctThemes(
    prioritized,
    profileChases,
    Math.min(prioritized.length, Math.max(targetCount * 3, DISCOVERY_SHELF_PAGE_SIZE * 3))
  );
  const diversifiedNameKeys = new Set(diversifiedSeeds.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const supportPool = prioritized.filter((candidate) => !diversifiedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)));
  return orderCandidatesForCollectorPresentation(
    [...diversifiedSeeds, ...supportPool],
    profileChases,
    targetCount
  ).slice(0, targetCount);
}

function selectDiscoveryUserUniverseCandidates(
  userId: string,
  excludedNames: string[],
  targetCount: number,
  profileChases: Chase[],
  repeatGuardChases: Chase[]
): DiscoveryCandidate[] {
  return selectDiscoveryUserUniverseCandidatesFromEntries(
    listDiscoveryUserUniverseCards(userId, Math.max(300, targetCount * 20)),
    excludedNames,
    targetCount,
    profileChases,
    repeatGuardChases
  );
}

function canonicalUniverseSeedParents(chases: Chase[], targetCount = DISCOVERY_CANDIDATE_POOL_SIZE): DiscoverySuggestion[] {
  const discoverySelection = selectDiscoverySuggestionsForFocuses([], chases, Math.max(targetCount, DISCOVERY_SHELF_PAGE_SIZE));
  const profileParents = profileVariantSourceBackfillParents(chases, Math.max(targetCount, DISCOVERY_SHELF_PAGE_SIZE));
  const setCompanionParents = profileParents.filter((parent) => parent.lane === 'Set Companion Trail');
  const nonSetCompanionParents = profileParents.filter((parent) => parent.lane !== 'Set Companion Trail');
  const parents = uniqueValuesByName([
    ...broadSourceBackfillParents(),
    ...setCompanionParents,
    ...japaneseSourceBackfillParents(chases),
    ...discoverySelection.suggestions,
    ...nonSetCompanionParents
  ]);
  return parents.slice(0, Math.max(targetCount, DISCOVERY_SHELF_PAGE_SIZE));
}

function candidateFromReliableMarketCacheEntry(
  entry: DiscoveryMarketCacheEntry,
  targetCurrency: SupportedCurrency,
  activeChases: Chase[] = []
): DiscoveryCandidate {
  const suggestion = marketCacheSuggestionFromCardName(entry.suggestionName);
  const cachedCandidate = candidateFromCachedMarket(suggestion, DISCOVERY_CANDIDATE_POOL_SIZE, entry, targetCurrency, activeChases, false);
  return {
    ...cachedCandidate,
    listing: listingFromDiscoveryMarketCache(entry),
    image: entry.imageUrl
      ? {
          name: suggestion.name,
          url: entry.imageUrl,
          sourceName: marketplaceImageSourceNameForCandidate({
            ...cachedCandidate,
            listing: listingFromDiscoveryMarketCache(entry)
          }),
          sourceKind: 'MARKET_LISTING'
        }
      : undefined
  } satisfies DiscoveryCandidate;
}

function bootstrapDiscoveryUniverseForUser(
  userId: string,
  chases: Chase[],
  currency: SupportedCurrency,
  destinationCountry?: string
): void {
  const seededNameKeys = new Set<string>();
  const recentDrops = listRecentAvailableScheduledDiscoveryDrops(userId, 'WEEKLY_DISCOVERY', new Date().toISOString(), 8);
  for (const drop of recentDrops) {
    for (const candidate of candidatesFromScheduledDiscoveryDrop(drop)) {
      if (!isFinishedShelfCandidate(candidate)) continue;
      if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
      const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
      if (seededNameKeys.has(nameKey)) continue;
      persistDiscoveryUniverseCandidate(candidate);
      seededNameKeys.add(nameKey);
    }
  }

  const reliableCacheEntries = listReliableDiscoveryMarketCacheEntries({
    displayCurrency: currency,
    destinationCountry,
    limit: 400
  });
  for (const entry of reliableCacheEntries) {
    const candidate = candidateFromReliableMarketCacheEntry(entry, currency, []);
    if (!isDisplayableDiscoveryCandidate(candidate)) continue;
    if (!isCollectorWorthyWeeklyCandidate(candidate)) continue;
    if (!(hasConcreteProfileSubjectMatch(candidate, positiveTasteSubjectChases(chases)) || hasCollectorProfileTraitMatch(candidate, chases))) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (seededNameKeys.has(nameKey)) continue;
    persistDiscoveryUniverseCandidate(candidate);
    seededNameKeys.add(nameKey);
    if (seededNameKeys.size >= 200) break;
  }
}

async function ingestCanonicalDiscoveryUniverseForUser(
  userId: string,
  activeChases: Chase[],
  tasteProfileChases: Chase[],
  currency: SupportedCurrency,
  destinationCountry?: string
): Promise<void> {
  bootstrapDiscoveryUniverseForUser(userId, tasteProfileChases, currency, destinationCountry);
  const broadParents = canonicalUniverseSeedParents(tasteProfileChases, Math.max(DISCOVERY_CANDIDATE_POOL_SIZE, 96));
  await resolveAndPersistSourceBackedUniverseSuggestions(broadParents, activeChases, tasteProfileChases, {
    parentLimit: 48,
    perParentLimit: 8
  });
  rebuildUserDiscoveryUniverse(userId, tasteProfileChases, [...activeChases, ...repeatGuardTasteMemoryChases(listUserTasteMemoryChases(userId))]);
}

export function concreteDiscoveryFallbackSuggestions(names: string[], excludedNames: string[] = []): DiscoverySuggestion[] {
  const excludedNameKeys = discoveryExclusionNameKeys(excludedNames);
  const seenNameKeys = new Set<string>();
  const suggestions: DiscoverySuggestion[] = [];
  for (const name of names) {
    const nameKey = discoveryNameKey(name);
    if (!nameKey || seenNameKeys.has(nameKey) || isDiscoveryNameExcluded(name, excludedNameKeys)) continue;
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

function uniqueValuesByName(suggestions: DiscoverySuggestion[]): DiscoverySuggestion[] {
  const seenNameKeys = new Set<string>();
  const uniqueSuggestions: DiscoverySuggestion[] = [];
  for (const suggestion of suggestions) {
    const nameKey = discoveryNameKey(suggestion.name);
    if (!nameKey || seenNameKeys.has(nameKey)) continue;
    uniqueSuggestions.push(suggestion);
    seenNameKeys.add(nameKey);
  }
  return uniqueSuggestions;
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
  if (/japanese|vending|oddit/.test(normalizedLane)) return { icon: '◇', color: DISCOVERY_LANE_COLOR, path: 'Hidden release path' };
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

function recordDiscoveryShelfTrainingExamples(
  userId: string,
  candidates: DiscoveryCandidate[],
  chases: Chase[],
  startIndex: number,
  negativeProfile?: DiscoveryNegativeProfile,
  learnedRankContext?: DiscoveryLearnedRankContext,
  periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY')
): void {
  recordDiscoveryTrainingExamples(
    candidates.map((candidate, index) => ({
      userId,
      surface: 'WEEKLY_DISCOVERY_SHELF',
      periodKey,
      suggestionName: candidate.suggestion.name,
      lane: candidate.suggestion.lane,
      position: startIndex + index + 1,
      rankerVersion: DISCOVERY_COLLECTOR_RANKER_VERSION,
      features: collectorDiscoveryFeatures(candidate, chases),
      scores: {
        collectorRank: collectorDiscoveryRankScore(candidate, chases, negativeProfile, learnedRankContext),
        marketEvidence: marketEvidenceRank(candidate),
        imageQuality: imageQualityRank(candidate),
        curiosity: curiosityRankScore(candidate)
      }
    }))
  );
}

function sourceSetLabel(candidate: DiscoveryCandidate): string | undefined {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName;
  const match = /\(([^)]+)\)/.exec(sourceName ?? '');
  if (match?.[1]) return match[1];
  const text = candidate.suggestion.name;
  const knownSetMatch = /\b(Expedition Base Set|Aquapolis|Skyridge|Wizards Black Star Promos|XY Black Star Promos|BW Black Star Promos|SWSH Black Star Promos|SM Black Star Promos|Surging Sparks|Paldean Fates|Legendary Treasures|151)\b/i.exec(text);
  if (knownSetMatch?.[1]) return knownSetMatch[1];
  const shorthandPromoSetMatch = /\b(XY|BW|SWSH|SM)\s+Promos?\b/i.exec(text);
  if (shorthandPromoSetMatch?.[1]) return `${shorthandPromoSetMatch[1].toUpperCase()} Black Star Promos`;
  const compactJapaneseSetMatch = /\b((?:S|SV|SM|XY)\d{1,3}[a-z]?)\b/i.exec(text);
  return compactJapaneseSetMatch?.[1];
}

function sourceCardSubject(candidate: DiscoveryCandidate, setLabel: string | undefined): string {
  let subject = candidate.suggestion.name;
  if (setLabel) subject = subject.replace(new RegExp(`\\s+${setLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), '');
  subject = subject
    .replace(/\b(?:special delivery|with grey felt hat|grey felt hat|felt hat|illustration collection|toys r us|staff|winner|prerelease)\b/gi, ' ')
    .replace(/\b(?:xy|bw|swsh|sm)\s+(?:black star\s+)?promos?\b.*$/i, ' ')
    .replace(/\b(?:promo|promos|black star)\b/gi, ' ')
    .replace(/\s+Japanese\b.*$/i, '')
    .replace(/\s+\S*\d{1,4}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return subject || candidate.suggestion.name;
}

function sourceCardText(candidate: DiscoveryCandidate): string {
  return [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, candidate.listing?.title, ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
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
  'vmax',
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
  const sourceTasteText = normalize(sourceTasteTokens.join(' '));
  const isExactNicheCue = isExactNicheDiscoveryCandidate(candidate);
  const signals: string[] = [];

  if (!isExactNicheCue) signals.push(...tasteSignalTokenLabels(sourceTasteTokens, normalizedCardText));
  if (hasJapaneseCardEvidence(normalizedCardText)) signals.push('Japanese Prints');
  if (isExactNicheCue || /\b(?:exclusive|unique|unusual|odd(?:ball)? release|intro pack|bulbasaur deck|vhs)\b/.test(sourceTasteText)) signals.push('Unique Releases');
  if (/\bpromo|black star|special release|limited release\b/.test(cardAndSourceText)) signals.push('Promo Releases');
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
  const sourceContext = setLabel ?? 'This print';
  const hasPromoSignal = /\bpromo|black star|special release\b/.test(normalizedCardText);
  const hasFormatSignal = /\btag team\b|\bgx\b|\bvmax\b|\bvstar\b|\bradiant\b/.test(normalizedCardText);
  const reasons: string[] = [];
  if (/\bspecial delivery\b/.test(normalizedCardText)) reasons.push(`A promo with a real release story: ${candidate.suggestion.name.split(/\s+SWSH Black Star/i)[0]} feels more like a collector milestone than a standard set filler`);
  else if (/\bfelt hat\b/.test(normalizedCardText)) reasons.push(`A memorable promo story: the Felt Hat release gives ${subject} crossover appeal beyond the base promo set`);
  else if (hasJapaneseCardEvidence(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a regional print to compare against English runs instead of another generic copy`);
  else if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalizedCardText)) reasons.push(`${sourceContext} gives ${subject} a concrete early-2000s set identity, so the card has a clearer collecting shape than a broad vintage search`);
  else if (hasPromoSignal && hasFormatSignal) reasons.push(`${sourceContext} gives ${subject} a named promo release with side-collection appeal`);
  else if (hasPromoSignal) reasons.push(`${sourceContext} gives ${subject} a named release to track instead of a generic main-set copy`);
  if (/\billustration|\bart rare|\bsar\b|\bar\b|\bgallery\b|\bfull art\b/.test(normalizedCardText)) reasons.push(`${subject} has art-led treatment that can stand on its own visually in a binder page`);
  if (hasFormatSignal && !(hasPromoSignal && reasons.length > 0)) reasons.push(`${subject} fits a recognizable side-collection format with a different collecting shape than your current Vault`);
  if (reasons.length === 0 && /\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(normalized)) reasons.push('This gives your Vault an early-2000s print to compare by set texture, artwork, and binder feel');

  const uniqueReasons = uniqueValuesPreservingOrder(reasons).slice(0, 2);
  if (uniqueReasons.length === 0) return `${subject} gives your Vault a nearby card to compare by artwork, set feel, and release story without being another copy of the same chase`;
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

function candidateSubjectDiversityKeys(candidate: DiscoveryCandidate): string[] {
  return candidateSubjectBalanceKeys(candidate);
}

function candidateVariantFamilyKey(candidate: DiscoveryCandidate): string | undefined {
  const setLabel = sourceSetLabel(candidate);
  if (!setLabel) return undefined;
  const subjectKey = discoveryNameKey(sourceCardSubject(candidate, setLabel));
  const setKey = discoveryNameKey(setLabel);
  if (!subjectKey || !setKey) return undefined;
  return `${subjectKey}|${setKey}`;
}

function variantRepresentativeCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const bestByVariant = new Map<string, DiscoveryCandidate>();
  const score = (candidate: DiscoveryCandidate): number => imageQualityRank(candidate) * 100 + marketEvidenceRank(candidate);
  for (const candidate of candidates) {
    const variantKey = candidateVariantFamilyKey(candidate);
    if (!variantKey) continue;
    const current = bestByVariant.get(variantKey);
    if (!current || score(candidate) > score(current)) bestByVariant.set(variantKey, candidate);
  }
  return candidates.filter((candidate) => {
    const variantKey = candidateVariantFamilyKey(candidate);
    return !variantKey || bestByVariant.get(variantKey) === candidate;
  });
}

function isJapaneseDiscoveryCandidate(candidate: DiscoveryCandidate): boolean {
  return /\bjapanese\b|\btcgdex japanese\b/i.test(
    [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, candidate.suggestion.referenceSourceName, candidate.image?.sourceName, ...(candidate.suggestion.requiredEvidenceTokens ?? [])]
      .filter(Boolean)
      .join(' ')
  );
}

function isMarketplaceStyleDiscoveryName(name: string): boolean {
  const normalized = normalize(name);
  if (/^20\d{2}\s+pokemon tcg\b/.test(normalized)) return true;
  if (/^pokemon card\b/.test(normalized)) return true;
  if (/\b(?:near mint|raw card|pokemon card raw|pokemon card nm|common|rare)\b/.test(normalized)) return true;
  if (/_{3,}/.test(name)) return true;
  return false;
}

function scheduledShelfImageFromCandidate(candidate: DiscoveryCandidate): DiscoveryCardImage | undefined {
  if (candidate.image?.sourceKind === 'CARD_REFERENCE') return candidate.image;
  if (isVettedMarketplaceImageCandidate(candidate)) return candidate.image;
  if (candidate.image?.sourceKind === 'MARKET_LISTING' && candidate.listing && looksLikeCleanMarketplaceCardPhoto(candidate.listing)) {
    return {
      ...candidate.image,
      sourceName: VETTED_EBAY_MARKETPLACE_IMAGE_SOURCE_NAME
    };
  }
  if (candidate.suggestion.referenceImageUrl) {
    return {
      name: candidate.suggestion.name,
      url: candidate.suggestion.referenceImageUrl,
      sourceName: candidate.suggestion.referenceSourceName,
      sourceCardId: candidate.suggestion.referenceSourceCardId,
      sourceKind: 'CARD_REFERENCE'
    };
  }
  return undefined;
}

function ebaySearchHost(currencyHint: SupportedCurrency): string {
  return currencyHint === 'CAD' ? 'www.ebay.ca' : 'www.ebay.com';
}

function ebaySearchKeywords(candidate: DiscoveryCandidate): string {
  const chaseLikeSearch = buildEbaySearchKeywords({
    id: 'discovery-search',
    userId: 'discovery',
    cardName: candidate.suggestion.name,
    createdAt: new Date(0).toISOString()
  } satisfies Chase).trim();
  if (chaseLikeSearch.length > 0) return /\bpokemon card\b/i.test(chaseLikeSearch) ? chaseLikeSearch : `${chaseLikeSearch} Pokemon card`;
  return (candidate.suggestion.evidenceSearchTerm ?? `${candidate.suggestion.name} Pokemon card`).trim();
}

function applyEbayAffiliateParams(rawUrl: string, customId: string): string {
  const campaignId = process.env.EBAY_AFFILIATE_CAMPAIGN_ID?.trim();
  if (!campaignId) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('mkevt', '1');
    url.searchParams.set('mkcid', '1');
    url.searchParams.set('mkrid', process.env.EBAY_AFFILIATE_MARKETPLACE_ID?.trim() || '711-53200-19255-0');
    url.searchParams.set('campid', campaignId);
    url.searchParams.set('toolid', process.env.EBAY_AFFILIATE_TOOL_ID?.trim() || '10001');
    url.searchParams.set('customid', process.env.EBAY_AFFILIATE_CUSTOM_ID?.trim() || customId);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function discoveryCardClickUrl(candidate: DiscoveryCandidate, currencyHint: SupportedCurrency, displayIndex?: number): string {
  const rawUrl = `https://${ebaySearchHost(currencyHint)}/sch/i.html?_nkw=${encodeURIComponent(ebaySearchKeywords(candidate))}`;
  const customId = ['discovery', displayIndex, discoveryDisplayNameKey(candidate.suggestion.name)].filter((value) => value !== undefined && value !== '').join('-').slice(0, 64);
  return applyEbayAffiliateParams(rawUrl, customId || 'discovery');
}

function takeDistinctThemes(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = VISIBLE_DISCOVERY_COUNT): DiscoveryCandidate[] {
  candidates = variantRepresentativeCandidates(candidates);
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
  const japaneseLimit = shouldLeaveRoomForNonJapanese ? Math.max(1, Math.min(3, Math.ceil(count * 0.15))) : count;
  const trailLimit = Math.max(1, Math.ceil(count / 3));
  const profileSubjectCount = distinctProfileKeys(chases, (value) => expandedProfileSubjectTokens(value).slice(0, 2)).size;
  const subjectLimit = count >= DISCOVERY_SHELF_PAGE_SIZE
    ? 2
    : count >= 5 ? 2 : count;
  let japaneseCount = 0;
  const candidateSubjectIsUnderLimit = (candidate: DiscoveryCandidate): boolean => {
    const subjectKeys = candidateSubjectDiversityKeys(candidate);
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
    for (const subjectKey of candidateSubjectDiversityKeys(candidate)) subjectCounts.set(subjectKey, (subjectCounts.get(subjectKey) ?? 0) + 1);
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
  if (count >= DISCOVERY_SHELF_PAGE_SIZE) {
    for (const candidate of candidates) {
      if (selected.length >= count) break;
      const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
      if (seenNames.has(nameKey)) continue;
      if (!hasReliableMarketEstimate(candidate)) continue;
      pushCandidate(candidate);
    }
  }
  return selected;
}

export function selectVisibleCandidates(candidates: DiscoveryCandidate[], chases: Chase[] = [], negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): DiscoveryCandidate[] {
  candidates = displayRepresentativeCandidates(candidates);
  const profileAlignedCandidates = preferProfileFormatAffinity(candidates, chases, VISIBLE_DISCOVERY_COUNT);
  const strongRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter(hasEnoughRawMarketData), chases, negativeProfile, learnedRankContext);
  const partialRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases, negativeProfile, learnedRankContext);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases, negativeProfile, learnedRankContext);
  const strongSelection = takeDistinctThemes(strongRawData, chases);
  if (strongSelection.length >= VISIBLE_DISCOVERY_COUNT) return strongSelection;
  const selectedNameKeys = new Set(strongSelection.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const remainingCandidates = [...partialRawData, ...tasteRankedFallback].filter((candidate) => !selectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)));
  return takeDistinctThemes([...strongSelection, ...remainingCandidates], chases);
}

export function selectVisibleCandidatesForCount(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = VISIBLE_DISCOVERY_COUNT, negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): DiscoveryCandidate[] {
  candidates = displayRepresentativeCandidates(candidates);
  const profileAlignedCandidates = preferProfileFormatAffinity(candidates, chases, count);
  const strongRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter(hasEnoughRawMarketData), chases, negativeProfile, learnedRankContext);
  const partialRawData = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => hasSomeRawMarketData(candidate) && !strongRawData.includes(candidate)), chases, negativeProfile, learnedRankContext);
  const tasteRankedFallback = rankDiscoveryCandidatesForProfile(profileAlignedCandidates.filter((candidate) => !hasSomeRawMarketData(candidate)), chases, negativeProfile, learnedRankContext);
  const strongSelection = takeDistinctThemes(strongRawData, chases, count);
  if (strongSelection.length >= count) return strongSelection;
  const selectedNameKeys = new Set(strongSelection.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const remainingCandidates = [...partialRawData, ...tasteRankedFallback].filter((candidate) => !selectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)));
  return takeDistinctThemes([...strongSelection, ...remainingCandidates], chases, count);
}

export function selectFreshVisibleCandidatesForCount(
  candidates: DiscoveryCandidate[],
  chases: Chase[] = [],
  count = VISIBLE_DISCOVERY_COUNT,
  negativeProfile?: DiscoveryNegativeProfile,
  softAvoidNames: string[] = [],
  options: { allowAvoidedFiller?: boolean; learnedRankContext?: DiscoveryLearnedRankContext } = {}
): DiscoveryCandidate[] {
  if (softAvoidNames.length === 0) return selectVisibleCandidatesForCount(candidates, chases, count, negativeProfile, options.learnedRankContext);
  const softAvoidNameKeys = new Set(softAvoidNames.map(discoveryNameKey));
  const freshCandidates = candidates.filter((candidate) => !softAvoidNameKeys.has(discoveryNameKey(candidate.suggestion.name)));
  const avoidedCandidates = candidates.filter((candidate) => softAvoidNameKeys.has(discoveryNameKey(candidate.suggestion.name)));
  const selected = selectVisibleCandidatesForCount(freshCandidates, chases, count, negativeProfile, options.learnedRankContext);
  if (selected.length >= count || avoidedCandidates.length === 0 || options.allowAvoidedFiller === false) return selected;
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryNameKey(candidate.suggestion.name)));
  const filler = selectVisibleCandidatesForCount(avoidedCandidates.filter((candidate) => !selectedNameKeys.has(discoveryNameKey(candidate.suggestion.name))), chases, count - selected.length, negativeProfile, options.learnedRankContext);
  return [...selected, ...filler];
}

function orderCandidatesForCollectorPresentation(candidates: DiscoveryCandidate[], chases: Chase[] = [], count = candidates.length, negativeProfile?: DiscoveryNegativeProfile, learnedRankContext?: DiscoveryLearnedRankContext): DiscoveryCandidate[] {
  const confidenceOrdered = orderCandidatesForMarketConfidence(candidates, chases, negativeProfile, learnedRankContext);
  if (chases.length === 0 || confidenceOrdered.length <= DISCOVERY_SHELF_PAGE_SIZE) return confidenceOrdered;
  const anchoredNameKeys = new Set<string>();
  const exactNicheAnchors = confidenceOrdered.filter(isExactNicheDiscoveryCandidate).slice(0, 3);
  for (const candidate of exactNicheAnchors) anchoredNameKeys.add(discoveryDisplayNameKey(candidate.suggestion.name));
  const diversified = takeDistinctThemes(
    confidenceOrdered.filter((candidate) => !anchoredNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name))),
    chases,
    Math.max(0, count - exactNicheAnchors.length)
  );
  const selected = rebalanceWeeklySubjectDiversity(composeWeeklyShelfCandidates([...exactNicheAnchors, ...diversified], chases, count), chases, count);
  if (selected.length >= count) return selected;
  const selectedNameKeys = new Set(selected.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  for (const candidate of confidenceOrdered) {
    if (selected.length >= count) break;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) continue;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
  }
  return selected;
}

type WeeklyCompositionBucket = 'adjacent' | 'era-pivot' | 'modern' | 'anchor' | 'general';

function weeklyCompositionBucket(candidate: DiscoveryCandidate, chases: Chase[]): WeeklyCompositionBucket {
  const features = collectorDiscoveryFeatures(candidate, chases);
  const text = normalize([sourceCardText(candidate), candidate.suggestion.lane, candidate.suggestion.referenceSourceName, ...(candidate.suggestion.sourceTasteTokens ?? [])].filter(Boolean).join(' '));
  if (features.adjacentThemeNovelty || /\bset companion trail\b/.test(text)) return 'adjacent';
  if (features.eReaderSignal || /\bbase set\b|\bgym heroes\b|\bgym challenge\b|\bneo\b|\bvintage\b/.test(text)) return 'era-pivot';
  if (hasModernSetContextText(text)) return 'modern';
  if (features.directSubjectSupport > 0 || features.exactNicheIdentity || features.retailEReaderSignal || features.nicheExclusiveSignal) return 'anchor';
  return 'general';
}

export function composeWeeklyShelfCandidates(candidates: DiscoveryCandidate[], chases: Chase[], count: number): DiscoveryCandidate[] {
  if (count < DISCOVERY_SHELF_PAGE_SIZE || candidates.length <= DISCOVERY_SHELF_PAGE_SIZE) return candidates.slice(0, count);
  const selected: DiscoveryCandidate[] = [];
  const selectedNameKeys = new Set<string>();
  const maxModernCount = Math.max(2, Math.min(4, Math.floor(count * 0.2)));
  const bucketTargets: Array<{ bucket: WeeklyCompositionBucket; target: number }> = [
    { bucket: 'adjacent', target: Math.min(3, Math.max(2, Math.floor(count * 0.15))) },
    { bucket: 'era-pivot', target: Math.min(3, Math.max(2, Math.floor(count * 0.15))) }
  ];
  const countBucket = (bucket: WeeklyCompositionBucket): number => selected.filter((candidate) => weeklyCompositionBucket(candidate, chases) === bucket).length;
  const canAdd = (candidate: DiscoveryCandidate): boolean => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) return false;
    if (weeklyCompositionBucket(candidate, chases) === 'modern' && countBucket('modern') >= maxModernCount) return false;
    return true;
  };
  const pushCandidate = (candidate: DiscoveryCandidate): void => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) return;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
  };
  for (const { bucket, target } of bucketTargets) {
    for (const candidate of candidates) {
      if (selected.length >= count || countBucket(bucket) >= target) break;
      if (weeklyCompositionBucket(candidate, chases) !== bucket || !canAdd(candidate)) continue;
      pushCandidate(candidate);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!canAdd(candidate)) continue;
    pushCandidate(candidate);
  }
  return selected;
}

function rebalanceWeeklySubjectDiversity(candidates: DiscoveryCandidate[], chases: Chase[], count: number): DiscoveryCandidate[] {
  if (count < DISCOVERY_SHELF_PAGE_SIZE || candidates.length <= DISCOVERY_SHELF_PAGE_SIZE) return candidates.slice(0, count);
  const subjectLimit = 2;
  const selected: DiscoveryCandidate[] = [];
  const selectedNameKeys = new Set<string>();
  const subjectCounts = new Map<string, number>();
  const candidateFits = (candidate: DiscoveryCandidate): boolean => {
    const subjectKeys = candidateSubjectDiversityKeys(candidate);
    return subjectKeys.length === 0 || subjectKeys.every((subjectKey) => (subjectCounts.get(subjectKey) ?? 0) < subjectLimit);
  };
  const hasAlternative = (): boolean =>
    candidates.some((candidate) => !selectedNameKeys.has(discoveryDisplayNameKey(candidate.suggestion.name)) && candidateFits(candidate));
  const pushCandidate = (candidate: DiscoveryCandidate): void => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    if (selectedNameKeys.has(nameKey)) return;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
    for (const subjectKey of candidateSubjectDiversityKeys(candidate)) subjectCounts.set(subjectKey, (subjectCounts.get(subjectKey) ?? 0) + 1);
  };
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!candidateFits(candidate) && hasAlternative()) continue;
    pushCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    pushCandidate(candidate);
  }
  return selected;
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
  embed.setURL(discoveryCardClickUrl(candidate, currencyHint, displayIndex));

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
    maxPrice: candidate.typicalRawAskingTotal === undefined ? undefined : roundConvertedMaxPrice(candidate.typicalRawAskingTotal),
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
  const recentlySeenNameKeys = discoveryExclusionNameKeys(recentlySeenNames);
  const mergedCandidates = [...candidates];
  for (const candidate of fallbackCandidates) {
    const candidateNameKey = discoveryNameKey(candidate.suggestion.name);
    if (candidateNames.has(candidateNameKey) || isDiscoveryNameExcluded(candidate.suggestion.name, recentlySeenNameKeys)) continue;
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

function listingFromScheduledDiscoveryDropItem(item: ScheduledDiscoveryDrop['items'][number]): Listing | undefined {
  if (!item.market.listing) return undefined;
  return {
    source: 'EBAY',
    listingId: item.market.listing.id,
    title: item.market.listing.title,
    price: item.market.askingTotal ?? item.market.soldTotal ?? 0,
    currency: item.market.currency,
    url: item.market.listing.url,
    imageUrl: item.imageUrl,
    thumbnailUrl: item.imageUrl,
    region: 'OTHER',
    listingType: 'OTHER'
  };
}

function candidatesFromScheduledDiscoveryDrop(drop: ScheduledDiscoveryDrop): DiscoveryCandidate[] {
  return drop.items.map((item) => ({
    suggestion: item.suggestion,
    selectionIndex: item.position - 1,
    listing: listingFromScheduledDiscoveryDropItem(item),
    image: item.imageUrl && item.imageSourceName !== EBAY_LISTING_IMAGE_SOURCE_NAME
      ? {
          name: item.suggestion.name,
          url: item.imageUrl,
          sourceName: item.imageSourceName,
          sourceKind: item.imageSourceName === VETTED_EBAY_MARKETPLACE_IMAGE_SOURCE_NAME ? 'MARKET_LISTING' as const : 'CARD_REFERENCE' as const
        }
      : undefined,
    typicalRawAskingTotal: item.market.askingTotal,
    marketSampleSize: item.market.askingSampleSize,
    typicalRawSoldTotal: item.market.soldTotal,
    soldSampleSize: item.market.soldSampleSize,
    displayCurrency: item.market.currency,
    sourceStatus: sourceStatusFromScheduledMarketStatus(item.market.status)
  })).filter(isFinishedShelfCandidate);
}

export async function repairScheduledDiscoveryShelfImages(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  const repaired = await hydrateShelfCandidateImages(candidates);
  return repaired.map((candidate, index) => {
    if (candidate.image || !candidates[index]?.image) return candidate;
    return { ...candidate, image: candidates[index]?.image };
  }).filter(isFinishedShelfCandidate);
}

export function backfillScheduledDiscoveryShelfCandidates(
  candidates: DiscoveryCandidate[],
  fallbackDrop: ScheduledDiscoveryDrop | null,
  targetCount: number,
  repeatGuardChases: Chase[] = [],
  profileChases: Chase[] = repeatGuardChases,
  options: { maxImmediateNameCarryovers?: number } = {}
): DiscoveryCandidate[] {
  const merged = candidates
    .filter(isFinishedShelfCandidate)
    .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases));
  if (!fallbackDrop || merged.length >= targetCount) return rebalanceWeeklySubjectDiversity(merged, profileChases, targetCount);
  const seenNames = new Set(merged.map((candidate) => discoveryDisplayNameKey(candidate.suggestion.name)));
  const seenVariantFamilies = new Set(merged.map(candidateVariantFamilyKey).filter((key): key is string => !!key));
  const maxImmediateNameCarryovers = Math.max(0, options.maxImmediateNameCarryovers ?? Number.POSITIVE_INFINITY);
  let immediateNameCarryovers = 0;
  for (const candidate of candidatesFromScheduledDiscoveryDrop(fallbackDrop)) {
    if (merged.length >= targetCount) break;
    if (!isFinishedShelfCandidate(candidate) || !hasEnoughRawMarketData(candidate)) continue;
    if (isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)) continue;
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    if (seenNames.has(nameKey) || (variantKey && seenVariantFamilies.has(variantKey))) continue;
    if (immediateNameCarryovers >= maxImmediateNameCarryovers) continue;
    merged.push(candidate);
    seenNames.add(nameKey);
    if (variantKey) seenVariantFamilies.add(variantKey);
    immediateNameCarryovers += 1;
  }
  return rebalanceWeeklySubjectDiversity(merged, profileChases, targetCount);
}

export function preferFreshWeeklyCandidatesAgainstRecentShelves(candidates: DiscoveryCandidate[], recentDrops: ScheduledDiscoveryDrop[], chases: Chase[] = []): DiscoveryCandidate[] {
  if (candidates.length <= 1 || recentDrops.length === 0) return candidates;
  const recentNameKeys = new Set<string>();
  const recentVariantKeys = new Set<string>();
  const recentSubjectKeys = new Set<string>();
  const recentSubjectFrequency = new Map<string, number>();
  const recentSetFrequency = new Map<string, number>();
  const recentNameFreshnessPenalty = new Map<string, number>();
  const recentVariantFreshnessPenalty = new Map<string, number>();
  const positiveSubjectChases = positiveTasteSubjectChases(chases);
  for (const [index, drop] of recentDrops.entries()) {
    const recencyWeight = Math.max(1, recentDrops.length - index);
    for (const priorCandidate of candidatesFromScheduledDiscoveryDrop(drop)) {
      const priorNameKey = discoveryDisplayNameKey(priorCandidate.suggestion.name);
      recentNameKeys.add(priorNameKey);
      recentNameFreshnessPenalty.set(priorNameKey, (recentNameFreshnessPenalty.get(priorNameKey) ?? 0) + recencyWeight * 100);
      const variantKey = candidateVariantFamilyKey(priorCandidate);
      if (variantKey) {
        recentVariantKeys.add(variantKey);
        recentVariantFreshnessPenalty.set(variantKey, (recentVariantFreshnessPenalty.get(variantKey) ?? 0) + recencyWeight * 60);
      }
      const setLabel = sourceSetLabel(priorCandidate);
      if (setLabel) recentSetFrequency.set(discoveryNameKey(setLabel), (recentSetFrequency.get(discoveryNameKey(setLabel)) ?? 0) + recencyWeight);
      for (const subjectKey of candidateSubjectBalanceKeys(priorCandidate)) {
        recentSubjectKeys.add(subjectKey);
        recentSubjectFrequency.set(subjectKey, (recentSubjectFrequency.get(subjectKey) ?? 0) + recencyWeight);
      }
    }
  }
  const subjectFatigueScore = (candidate: DiscoveryCandidate): number =>
    candidateSubjectBalanceKeys(candidate).reduce((sum, subjectKey) => sum + (recentSubjectFrequency.get(subjectKey) ?? 0), 0);
  const freshnessPenalty = (candidate: DiscoveryCandidate): number => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    const setLabel = sourceSetLabel(candidate);
    const setPenalty = setLabel ? (recentSetFrequency.get(discoveryNameKey(setLabel)) ?? 0) * 8 : 0;
    const subjectPenalty = subjectFatigueScore(candidate) * 14;
    const features = collectorDiscoveryFeatures(candidate, chases);
    const directSupportPenalty = features.directSubjectSupport > 0 ? Math.max(8, features.directSubjectSupport * 4) : 0;
    const noveltyCredit = features.adjacentThemeNovelty ? 55 : 0;
    const nicheCredit = (features.exactNicheIdentity ? 28 : 0)
      + (features.retailEReaderSignal ? 18 : 0)
      + (features.nicheExclusiveSignal ? 18 : 0)
      + (features.promoSignal ? 12 : 0);
    return (recentNameFreshnessPenalty.get(nameKey) ?? 0)
      + (variantKey ? (recentVariantFreshnessPenalty.get(variantKey) ?? 0) : 0)
      + setPenalty
      + subjectPenalty
      + directSupportPenalty
      - noveltyCredit
      - nicheCredit;
  };
  const adjacentThemeNoveltyCandidates: DiscoveryCandidate[] = [];
  const freshDirectSubjectCandidates: DiscoveryCandidate[] = [];
  const repeatedSubjectCandidates: DiscoveryCandidate[] = [];
  const repeatedCandidates: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    const hasRecentSubjectOverlap = candidateSubjectBalanceKeys(candidate).some((subjectKey) => recentSubjectKeys.has(subjectKey));
    const hasDirectSubjectMatch = hasConcreteProfileSubjectMatch(candidate, positiveSubjectChases);
    const isAdjacentThemeNovelty = isAdjacentThemeNoveltyCandidate(candidate, chases);
    if (recentNameKeys.has(nameKey) || (variantKey && recentVariantKeys.has(variantKey))) {
      repeatedCandidates.push(candidate);
      continue;
    }
    if (!hasRecentSubjectOverlap && isAdjacentThemeNovelty) {
      adjacentThemeNoveltyCandidates.push(candidate);
      continue;
    }
    if (!hasRecentSubjectOverlap) {
      freshDirectSubjectCandidates.push(candidate);
      continue;
    }
    repeatedSubjectCandidates.push(candidate);
  }
  adjacentThemeNoveltyCandidates.sort((left, right) => freshnessPenalty(left) - freshnessPenalty(right));
  freshDirectSubjectCandidates.sort((left, right) => freshnessPenalty(left) - freshnessPenalty(right));
  repeatedSubjectCandidates.sort((left, right) => subjectFatigueScore(left) - subjectFatigueScore(right));
  repeatedCandidates.sort((left, right) => freshnessPenalty(left) - freshnessPenalty(right));
  return [...adjacentThemeNoveltyCandidates, ...freshDirectSubjectCandidates, ...repeatedSubjectCandidates, ...repeatedCandidates];
}

export function selectNovelWeeklyCandidates(
  candidates: DiscoveryCandidate[],
  recentDrops: ScheduledDiscoveryDrop[],
  targetCount: number,
  chases: Chase[] = []
): DiscoveryCandidate[] {
  if (targetCount <= 0 || candidates.length <= targetCount || recentDrops.length === 0) return candidates.slice(0, targetCount);
  const recentWindow = recentDrops.slice(0, 3);
  const immediateNameKeys = new Set<string>();
  const recentNameKeys = new Set<string>();
  const recentVariantKeys = new Set<string>();
  const recentSubjectKeys = new Set<string>();
  for (const [index, drop] of recentWindow.entries()) {
    for (const priorCandidate of candidatesFromScheduledDiscoveryDrop(drop)) {
      const nameKey = discoveryDisplayNameKey(priorCandidate.suggestion.name);
      recentNameKeys.add(nameKey);
      if (index === 0) immediateNameKeys.add(nameKey);
      const variantKey = candidateVariantFamilyKey(priorCandidate);
      if (variantKey) recentVariantKeys.add(variantKey);
      for (const subjectKey of candidateSubjectBalanceKeys(priorCandidate)) recentSubjectKeys.add(subjectKey);
    }
  }
  const maxImmediateRepeats = targetCount >= DISCOVERY_SHELF_PAGE_SIZE ? 0 : 1;
  const maxRecentNameRepeats = Math.max(2, Math.min(4, Math.floor(targetCount * 0.2)));
  const maxRecentVariantRepeats = Math.max(3, Math.min(5, Math.floor(targetCount * 0.25)));
  const maxRecentSubjectOverlapCount = Math.max(4, Math.min(6, Math.floor(targetCount * 0.3)));
  const selected: DiscoveryCandidate[] = [];
  const selectedNameKeys = new Set<string>();
  let immediateRepeatCount = 0;
  let recentNameRepeatCount = 0;
  let recentVariantRepeatCount = 0;
  let recentSubjectOverlapCount = 0;

  const candidateHasRecentSubjectOverlap = (candidate: DiscoveryCandidate): boolean =>
    candidateSubjectBalanceKeys(candidate).some((subjectKey) => recentSubjectKeys.has(subjectKey));

  const candidateNeedsImageFallback = (candidate: DiscoveryCandidate): boolean =>
    !candidate.image && !candidate.suggestion.referenceImageUrl && !imageUrlFromListing(candidate.listing);

  const candidateIsAllowed = (candidate: DiscoveryCandidate, mode: 'strict-fresh' | 'variant-fresh' | 'recent-repeat' | 'immediate-repeat'): boolean => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    const isImmediateRepeat = immediateNameKeys.has(nameKey);
    const isRecentNameRepeat = recentNameKeys.has(nameKey);
    const isRecentVariantRepeat = !!variantKey && recentVariantKeys.has(variantKey);
    const isRecentSubjectOverlap = candidateHasRecentSubjectOverlap(candidate);
    const isImageWeak = candidateNeedsImageFallback(candidate);
    if (selectedNameKeys.has(nameKey)) return false;
    if ((mode === 'strict-fresh' || mode === 'variant-fresh') && isRecentSubjectOverlap && recentSubjectOverlapCount >= maxRecentSubjectOverlapCount) return false;
    if ((mode === 'strict-fresh' || mode === 'variant-fresh') && isImageWeak && isRecentSubjectOverlap) return false;
    if (mode === 'strict-fresh') return !isRecentNameRepeat && !isRecentVariantRepeat;
    if (mode === 'variant-fresh') return !isRecentNameRepeat;
    if (mode === 'recent-repeat') {
      if (isImmediateRepeat) return false;
      if (!isRecentNameRepeat) return false;
      if (isImageWeak) return false;
      return recentNameRepeatCount < maxRecentNameRepeats;
    }
    if (!isImmediateRepeat) return false;
    if (isImageWeak) return false;
    return immediateRepeatCount < maxImmediateRepeats && recentNameRepeatCount < maxRecentNameRepeats;
  };

  const pushCandidate = (candidate: DiscoveryCandidate): void => {
    const nameKey = discoveryDisplayNameKey(candidate.suggestion.name);
    const variantKey = candidateVariantFamilyKey(candidate);
    if (selectedNameKeys.has(nameKey)) return;
    selected.push(candidate);
    selectedNameKeys.add(nameKey);
    if (immediateNameKeys.has(nameKey)) immediateRepeatCount += 1;
    if (recentNameKeys.has(nameKey)) recentNameRepeatCount += 1;
    if (variantKey && recentVariantKeys.has(variantKey)) recentVariantRepeatCount += 1;
    if (candidateHasRecentSubjectOverlap(candidate)) recentSubjectOverlapCount += 1;
  };

  for (const mode of ['strict-fresh', 'variant-fresh', 'recent-repeat', 'immediate-repeat'] as const) {
    for (const candidate of candidates) {
      if (selected.length >= targetCount) break;
      if (mode === 'variant-fresh' && recentVariantRepeatCount >= maxRecentVariantRepeats) break;
      if (!candidateIsAllowed(candidate, mode)) continue;
      pushCandidate(candidate);
    }
    if (selected.length >= targetCount) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= targetCount) break;
    pushCandidate(candidate);
  }
  return rebalanceWeeklySubjectDiversity(selected, chases, targetCount);
}

function buildFreshWeeklyShelfFromPool(
  candidates: DiscoveryCandidate[],
  pool: DiscoveryCandidate[],
  recentDrops: ScheduledDiscoveryDrop[],
  targetCount: number,
  chases: Chase[] = []
): DiscoveryCandidate[] {
  const mergedPool = uniqueCandidatesByDisplayName([...candidates, ...pool]).filter(isFinishedShelfCandidate);
  if (mergedPool.length === 0) return [];
  return selectNovelWeeklyCandidates(
    preferFreshWeeklyCandidatesAgainstRecentShelves(mergedPool, recentDrops, chases),
    recentDrops,
    targetCount,
    chases
  );
}

function scheduledMarketStatusFromCandidate(candidate: DiscoveryCandidate): string {
  if (hasEnoughRawMarketData(candidate)) return 'READY';
  return candidate.sourceStatus ?? 'PENDING';
}

function scheduledDropItemsFromCandidates(candidates: DiscoveryCandidate[], currency: SupportedCurrency): ScheduledDiscoveryDropItem[] {
  return candidates.map((candidate, index) => ({
    position: index + 1,
    suggestion: candidate.suggestion,
    imageUrl: scheduledShelfImageFromCandidate(candidate)?.url,
    imageSourceName: scheduledShelfImageFromCandidate(candidate)?.sourceName,
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
  const rejectedNameKeys = discoveryExclusionNameKeys(listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME').map((item) => item.suggestionName));
  const finishedCandidates = candidates
    .filter(isFinishedShelfCandidate)
    .filter((candidate) => !isDiscoveryNameExcluded(candidate.suggestion.name, rejectedNameKeys));
  const cleanNamedCandidates = finishedCandidates.filter((candidate) => !isMarketplaceStyleDiscoveryName(candidate.suggestion.name));
  const namePolishedCandidates = cleanNamedCandidates.length >= DISCOVERY_SHELF_PAGE_SIZE
    ? [...cleanNamedCandidates, ...finishedCandidates.filter((candidate) => !cleanNamedCandidates.includes(candidate))]
    : finishedCandidates;
  const imagePolishedCandidates = namePolishedCandidates.filter((candidate) => !!scheduledShelfImageFromCandidate(candidate));
  const polishedCandidates = imagePolishedCandidates.length >= DISCOVERY_SHELF_PAGE_SIZE
    ? [...imagePolishedCandidates, ...namePolishedCandidates.filter((candidate) => !imagePolishedCandidates.includes(candidate))]
    : namePolishedCandidates;
  for (const candidate of polishedCandidates) persistDiscoveryUniverseCandidate(candidate);
  const items = scheduledDropItemsFromCandidates(polishedCandidates, currency);
  if (items.length === 0) return;
  const readyCount = items.filter((item) => item.market.status === 'READY').length;
  const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date);
  const availability = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  upsertScheduledDiscoveryDrop({
    userId,
    dropType: 'WEEKLY_DISCOVERY',
    periodKey,
    status: readyCount === items.length ? 'READY' : 'PARTIAL',
    title: 'Weekly Shelf',
    summary: 'A collector shelf tuned from your Vault and recent taste signals',
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
  const hardExcludedNameKeys = discoveryExclusionNameKeys(options.hardExcludedNames ?? []);
  const softAvoidNameKeys = discoveryExclusionNameKeys(options.softAvoidNames ?? []);
  for (const name of persistedNames) {
    const nameKey = discoveryNameKey(name);
    const candidate = candidatesByName.get(nameKey);
    if (!candidate || selectedNames.has(nameKey) || isDiscoveryNameExcluded(candidate.suggestion.name, hardExcludedNameKeys)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
    if (selected.length >= count) return selected;
  }
  for (const candidate of candidates) {
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (selectedNames.has(nameKey) || isDiscoveryNameExcluded(candidate.suggestion.name, hardExcludedNameKeys) || isDiscoveryNameExcluded(candidate.suggestion.name, softAvoidNameKeys)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
    if (selected.length >= count) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const nameKey = discoveryNameKey(candidate.suggestion.name);
    if (selectedNames.has(nameKey) || isDiscoveryNameExcluded(candidate.suggestion.name, hardExcludedNameKeys)) continue;
    selected.push(candidate);
    selectedNames.add(nameKey);
  }
  return selected;
}

async function discoverCandidatesForUser(
  userId: string,
  count: number,
  options: { preferScheduledDrop?: boolean; requireScheduledDrop?: boolean; saveScheduledDrop?: boolean; scheduledDate?: Date; hydrateScheduledMarketInline?: boolean; usePersistedState?: boolean; softAvoidNames?: string[]; hardAvoidNames?: string[]; allowSoftAvoidFiller?: boolean; skipSourceCatalogFetch?: boolean; skipReferenceImageFetch?: boolean; ingestCanonicalUniverse?: boolean; ignoreSeenExclusions?: boolean } = {}
): Promise<{
  chases: Chase[];
  tasteProfileChases: Chase[];
  settings: ReturnType<typeof getUserAlertSettings>;
  hasFullDiscovery: boolean;
  hasLearnedProfile: boolean;
  profileConfidence: DiscoveryProfileConfidence;
  negativeProfile: DiscoveryNegativeProfile;
  learnedRankContext?: DiscoveryLearnedRankContext;
  usesScheduledDrop: boolean;
  lane: string;
  candidates: DiscoveryCandidate[];
  hiddenVaultPickCount: number;
}> {
  const preferScheduledDrop = options.preferScheduledDrop ?? true;
  const requireScheduledDrop = options.requireScheduledDrop ?? false;
  const shouldSaveScheduledDrop = options.saveScheduledDrop ?? true;
  const hydrateScheduledMarketInline = options.hydrateScheduledMarketInline ?? true;
  const usePersistedState = options.usePersistedState ?? true;
  const skipSourceCatalogFetch = options.skipSourceCatalogFetch ?? false;
  const skipReferenceImageFetch = options.skipReferenceImageFetch ?? false;
  const ingestCanonicalUniverse = options.ingestCanonicalUniverse ?? false;
  const ignoreSeenExclusions = options.ignoreSeenExclusions ?? false;
  const softAvoidNames = uniqueValuesPreservingOrder(options.softAvoidNames ?? []);
  const hardAvoidNames = uniqueValuesPreservingOrder(options.hardAvoidNames ?? []);
  const allowSoftAvoidFiller = options.allowSoftAvoidFiller ?? true;
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
  const repeatGuardChases = [...storedChases, ...repeatGuardTasteMemoryChases(tasteMemoryChases)];
  const profileConfidence = discoveryProfileConfidence(tasteProfileChases);
  const targetVisibleCount = hasFullDiscovery ? Math.min(visibleCount, profileConfidence.maxShelfSize) : visibleCount;
  const hasLearnedProfile = hasFullDiscovery && (profileConfidence.tier === 'USABLE' || profileConfidence.tier === 'STRONG');
  const recentlyRejected = listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME');
  const rejectedNames = recentlyRejected.map((item) => item.suggestionName);
  const negativeProfile = discoveryNegativeProfile(recentlyRejected, tasteProfileChases);
  const learnedRankContext = hasFullDiscovery
    ? (() => {
        const userSummary = getDiscoveryLearnedSignalSummary(userId);
        const globalSummary = getDiscoveryGlobalCollectorGrammarSummary();
        return {
          ...userSummary,
          globalTypedTraitEdgeWeights: globalSummary.typedTraitEdgeWeights,
          globalExampleCount: globalSummary.exampleCount,
          vaultTypedTraitEdgeWeights: vaultTypedTraitEdgeWeights(tasteProfileChases)
        };
      })()
    : undefined;
  const recentlySeenNames = ignoreSeenExclusions ? [] : listRecentUserDiscoverySeenNames(userId, DISCOVERY_SEEN_EXCLUSION_LIMIT);
  const seenExcludedNames = uniqueValuesPreservingOrder([...rejectedNames, ...recentlySeenNames, ...hardAvoidNames]);
  const scheduledSeenExcludedNames = shouldSaveScheduledDrop
    ? uniqueValuesPreservingOrder([
        ...rejectedNames,
        ...hardAvoidNames,
        ...(allowSoftAvoidFiller === false ? softAvoidNames : [])
      ])
    : seenExcludedNames;
  const profileFingerprint = discoveryProfileFingerprint(tasteProfileChases, rejectedNames, activeTier, targetVisibleCount);
  const stateKey = discoveryStateKey(activeTier, targetVisibleCount);
  const latestDrop = hasFullDiscovery && preferScheduledDrop ? getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY') : null;
  if (latestDrop && latestDrop.items.length > 0) {
    const scheduledPersistedNames = latestDrop.items.map((item) => item.suggestion.name);
    const scheduledDropCandidates = candidatesFromScheduledDiscoveryDrop(latestDrop)
      .filter(isDisplayableDiscoveryCandidate);
    const hiddenVaultPickCount = scheduledDropCandidates.filter((candidate) => isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)).length;
    const scheduledCandidates = scheduledDropCandidates
      .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases));
    const orderedScheduledCandidates = orderCandidatesFromPersistedState(
      scheduledCandidates,
      scheduledPersistedNames,
      Math.max(targetVisibleCount, scheduledCandidates.length)
    );
    return {
      chases,
      tasteProfileChases,
      settings,
      hasFullDiscovery,
      hasLearnedProfile,
      profileConfidence,
      negativeProfile,
      learnedRankContext,
      usesScheduledDrop: true,
      lane: 'weekly discovery',
      candidates: orderedScheduledCandidates,
      hiddenVaultPickCount
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
      negativeProfile,
      learnedRankContext,
      usesScheduledDrop: true,
      lane: 'weekly discovery',
      candidates: [],
      hiddenVaultPickCount: 0
    };
  }
  const selectAndEnrich = async () => {
    if (hasFullDiscovery && tasteProfileChases.length > 0) {
      bootstrapDiscoveryUniverseForUser(userId, tasteProfileChases, settings.alertCurrency, settings.shippingCountry);
    }
    if (hasFullDiscovery && ingestCanonicalUniverse && !skipSourceCatalogFetch && tasteProfileChases.length > 0) {
      await ingestCanonicalDiscoveryUniverseForUser(userId, chases, tasteProfileChases, settings.alertCurrency, settings.shippingCountry);
    }
    const combinedExcludedNames = uniqueValuesPreservingOrder(seenExcludedNames);
    const combinedSourceExcludedNames = uniqueValuesPreservingOrder(seenExcludedNames);
    const persistedState = usePersistedState && hasFullDiscovery && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT ? getUserDiscoveryState(userId, stateKey) : null;
    const selection = selectDiscoverySuggestionsForFocuses([], tasteProfileChases, DISCOVERY_CANDIDATE_POOL_SIZE, {
      excludedNames: combinedExcludedNames,
      excludeLanesForExcludedNames: combinedExcludedNames.length > 0
    });
    const discoverySelectionCount = discoveryCandidateSelectionCount(hasFullDiscovery, targetVisibleCount);
    const activeSafeSuggestions = selection.suggestions.filter((suggestion) => !isActiveChaseEchoSuggestion(suggestion, repeatGuardChases));
    const sourceBackedSuggestions = skipSourceCatalogFetch
      ? []
      : await expandSourceBackedSuggestions(activeSafeSuggestions, chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
    const japaneseSourceBackedSuggestions = skipSourceCatalogFetch
      ? []
      : hasFullDiscovery && hasJapaneseWeightedProfile(tasteProfileChases)
        ? await expandSourceBackedSuggestions(japaneseSourceBackfillParents(tasteProfileChases), chases, tasteProfileChases, Math.min(DISCOVERY_SHELF_PAGE_SIZE, discoverySelectionCount), repeatGuardChases)
        : [];
    const profileVariantSourceBackedSuggestions = skipSourceCatalogFetch
      ? []
      : hasLearnedProfile
        ? await expandSourceBackedSuggestions(profileVariantSourceBackfillParents(tasteProfileChases, discoverySelectionCount), chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases)
        : [];
    const excludedSourceNameKeys = new Set(combinedSourceExcludedNames.map(discoveryNameKey));
    const marketContext = {
      userId,
      activeChases: chases,
      destination: settings.shippingCountry ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode } : undefined,
      targetCurrency: settings.alertCurrency,
      range: discoveryMarketRangeFromChases(tasteProfileChases)
    };
    const concreteFallbackSuggestions = orderConcreteDiscoveryFallbackSuggestionsForMarket(
      concreteDiscoveryFallbackSuggestions([...(persistedState?.suggestionNames ?? []), ...recentlySeenNames], [...combinedSourceExcludedNames, ...softAvoidNames]),
      marketContext
    );
    const sourceBackedFreshSuggestions = uniqueValuesByName([...japaneseSourceBackedSuggestions, ...profileVariantSourceBackedSuggestions, ...sourceBackedSuggestions])
      .filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name)) && !isActiveChaseEchoSuggestion(suggestion, repeatGuardChases));
    let concreteSourceBackedSuggestions = uniqueValuesByName([
      ...sourceBackedFreshSuggestions,
      ...profileJapaneseMarketSeedSuggestions(tasteProfileChases, weeklyJapaneseSignalTargetCount(tasteProfileChases, targetVisibleCount))
    ]).filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name)) && !isActiveChaseEchoSuggestion(suggestion, repeatGuardChases));
    if (!skipSourceCatalogFetch && concreteSourceBackedSuggestions.length < discoverySelectionCount) {
      const starterSelection = selectDiscoverySuggestionsForFocuses([], [], DISCOVERY_CANDIDATE_POOL_SIZE, {
        excludedNames: [...combinedSourceExcludedNames, ...concreteSourceBackedSuggestions.map((suggestion) => suggestion.name)]
      });
      const starterSourceBackedSuggestions = await expandSourceBackedSuggestions(starterSelection.suggestions, chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
      concreteSourceBackedSuggestions = backfillSourceBackedDiscoverySuggestions(concreteSourceBackedSuggestions, starterSourceBackedSuggestions, discoverySelectionCount);
    }
    if (!skipSourceCatalogFetch && hasLearnedProfile && concreteSourceBackedSuggestions.length < discoverySelectionCount) {
      const broadSourceBackedSuggestions = await expandSourceBackedSuggestions(broadSourceBackfillParents(), chases, tasteProfileChases, discoverySelectionCount, repeatGuardChases);
      concreteSourceBackedSuggestions = backfillSourceBackedDiscoverySuggestions(concreteSourceBackedSuggestions, broadSourceBackedSuggestions, discoverySelectionCount);
    }
    const freshSourceBackedSuggestions = backfillDiscoverySuggestions(
      concreteSourceBackedSuggestions,
      activeSafeSuggestions.filter((suggestion) => !excludedSourceNameKeys.has(discoveryNameKey(suggestion.name))),
      concreteFallbackSuggestions,
      discoverySelectionCount
    );
    persistDiscoveryUniverseSuggestions(concreteSourceBackedSuggestions);
    const indexedUniverseCandidates = hasFullDiscovery
      ? selectDiscoveryUserUniverseCandidates(
          userId,
          combinedSourceExcludedNames,
          discoverySelectionCount,
          tasteProfileChases,
          repeatGuardChases
        )
      : [];
    const universeCandidates = indexedUniverseCandidates.length > 0
      ? indexedUniverseCandidates
      : selectDiscoveryUniverseCandidatesForProfile(
          tasteProfileChases,
          combinedSourceExcludedNames,
          discoverySelectionCount,
          repeatGuardChases
        );
    const enriched = [
      ...universeCandidates,
      ...freshSourceBackedSuggestions.map((suggestion, index) => tasteOnlyCandidate(suggestion, index + universeCandidates.length))
    ];
    const rankedCandidates = selectVisibleCandidatesForCount(
      uniqueCandidatesByDisplayName(enriched),
      tasteProfileChases,
      discoverySelectionCount,
      negativeProfile,
      learnedRankContext
    );
    const persistedCandidates =
      persistedState?.profileFingerprint === profileFingerprint && persistedState.suggestionNames.length >= targetVisibleCount
        ? orderCandidatesFromPersistedState(rankedCandidates, persistedState.suggestionNames, targetVisibleCount, { hardExcludedNames: seenExcludedNames })
        : null;
    const discoveryCandidatePool =
      persistedCandidates ??
      orderCandidatesFromPersistedState(rankedCandidates, [], discoverySelectionCount, {
        hardExcludedNames: rejectedNames,
        softAvoidNames: hasFullDiscovery ? softAvoidNames : [...recentlySeenNames, ...softAvoidNames]
      });
    const cacheCandidates = candidatesFromDiscoveryMarketCache(discoveryCandidatePool, marketContext);
    const marketCandidates = hasFullDiscovery && hydrateScheduledMarketInline
      ? await hydratePendingDiscoveryMarketCandidates(cacheCandidates, marketContext)
      : cacheCandidates;
    const selectionPool = hasFullDiscovery
      ? backfillMarketReadyDiscoveryCandidates(marketCandidates, marketContext, targetVisibleCount, tasteProfileChases, profileConfidence, negativeProfile, repeatGuardChases, seenExcludedNames)
      : marketCandidates;
    const japaneseSignalPool = hasFullDiscovery && hasJapaneseWeightedProfile(tasteProfileChases)
      ? backfillJapaneseMarketSignalCandidates(
          [...enriched.filter(isJapaneseDiscoveryCandidate), ...marketCandidates, ...selectionPool],
          marketContext,
          weeklyJapaneseSignalTargetCount(tasteProfileChases, targetVisibleCount),
          tasteProfileChases,
          repeatGuardChases,
          seenExcludedNames
        )
      : [];
    const reliableSelectionPool = profileSubjectMatchedReliableDiscoveryCandidates(selectionPool, tasteProfileChases, targetVisibleCount, negativeProfile);
    const reliableCandidates = hasFullDiscovery && hydrateScheduledMarketInline && !persistedCandidates
      ? selectFreshVisibleCandidatesForCount(reliableSelectionPool, tasteProfileChases, targetVisibleCount, negativeProfile, softAvoidNames, { allowAvoidedFiller: allowSoftAvoidFiller, learnedRankContext })
      : [];
    let visibleCandidates = hasFullDiscovery && !persistedCandidates
      ? reliableCandidates.length >= Math.min(targetVisibleCount, DISCOVERY_SHELF_PAGE_SIZE)
        ? reliableCandidates
        : selectFreshVisibleCandidatesForCount(selectionPool, tasteProfileChases, targetVisibleCount, negativeProfile, softAvoidNames, { allowAvoidedFiller: allowSoftAvoidFiller, learnedRankContext })
      : selectionPool.slice(0, targetVisibleCount);
    let freshBackfilledCandidates: DiscoveryCandidate[] = [];
    if (hasFullDiscovery && !persistedCandidates) {
      freshBackfilledCandidates = backfillMarketReadyDiscoveryCandidates(
        visibleCandidates,
        marketContext,
        targetVisibleCount,
        tasteProfileChases,
        profileConfidence,
        negativeProfile,
        repeatGuardChases,
        scheduledSeenExcludedNames
      );
      const freshReadyCount = marketReadyShelfCandidatesWithOptions(freshBackfilledCandidates, true, profileConfidence, { allowPendingExploration: false }).length;
      const freshShelfFloor = Math.min(targetVisibleCount, DISCOVERY_SHELF_PAGE_SIZE);
      visibleCandidates = freshReadyCount >= freshShelfFloor
        ? freshBackfilledCandidates
        : backfillMarketReadyDiscoveryCandidates(visibleCandidates, marketContext, targetVisibleCount, tasteProfileChases, profileConfidence, negativeProfile, repeatGuardChases, scheduledSeenExcludedNames);
    }
    if (hasFullDiscovery && !persistedCandidates) {
      const weeklyTasteLanePool = backfillWeeklyTasteLaneMarketCandidates(
        [...japaneseSignalPool, ...freshBackfilledCandidates, ...selectionPool, ...marketCandidates],
        marketContext,
        targetVisibleCount,
        tasteProfileChases,
        repeatGuardChases,
        scheduledSeenExcludedNames
      );
      visibleCandidates = blendJapaneseSignalCandidates(visibleCandidates, japaneseSignalPool, tasteProfileChases, targetVisibleCount);
      visibleCandidates = blendWeeklyTasteLaneCandidates(
        visibleCandidates,
        weeklyTasteLanePool,
        tasteProfileChases,
        targetVisibleCount,
        softAvoidNames
      );
    }
    if (hasFullDiscovery && seenExcludedNames.length > 0) {
      const seenExcludedNameKeys = discoveryExclusionNameKeys(seenExcludedNames);
      visibleCandidates = visibleCandidates.filter((candidate) => !isDiscoveryNameExcluded(candidate.suggestion.name, seenExcludedNameKeys));
    }
    if (hasFullDiscovery && hydrateScheduledMarketInline) visibleCandidates = await settlePendingDiscoveryMarketCandidates(visibleCandidates, marketContext);
    const referencedCandidates = skipReferenceImageFetch ? visibleCandidates : await attachReferenceImages(visibleCandidates);
    const hiddenVaultPickCount = referencedCandidates.filter((candidate) => isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases)).length;
    const scheduledRelevantCandidates = referencedCandidates
      .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases))
      .filter(isCollectorWorthyWeeklyCandidate)
      .filter((candidate) => isScheduledShelfPriorityCandidate(candidate, tasteProfileChases))
      .filter(isDisplayableDiscoveryCandidate);
    const scheduledShortfall = Math.max(0, targetVisibleCount - scheduledRelevantCandidates.length);
    const finalSelectionPool = hasFullDiscovery && scheduledRelevantCandidates.length < targetVisibleCount
      ? ((skipReferenceImageFetch ? backfillMarketReadyDiscoveryCandidates(
          scheduledRelevantCandidates,
          marketContext,
          targetVisibleCount,
          tasteProfileChases,
          profileConfidence,
          negativeProfile,
          repeatGuardChases,
          scheduledSeenExcludedNames
        ) : await attachReferenceImages(backfillMarketReadyDiscoveryCandidates(
          scheduledRelevantCandidates,
          marketContext,
          targetVisibleCount,
          tasteProfileChases,
          profileConfidence,
          negativeProfile,
          repeatGuardChases,
          scheduledSeenExcludedNames
        ))))
          .filter((candidate) => !isActiveChaseEchoSuggestion(candidate.suggestion, repeatGuardChases))
          .filter(isCollectorWorthyWeeklyCandidate)
          .filter((candidate) => isScheduledShelfFallbackCandidate(candidate, tasteProfileChases))
          .filter(isDisplayableDiscoveryCandidate)
      : scheduledRelevantCandidates;
    const finalCandidates = scheduledShortfall > 0 && targetVisibleCount >= DISCOVERY_SHELF_PAGE_SIZE
      ? uniqueCandidatesByDisplayName([
          ...scheduledRelevantCandidates,
          ...finalSelectionPool.filter((candidate) => isScheduledShelfFallbackCandidate(candidate, tasteProfileChases))
        ])
      : finalSelectionPool;
    const candidates = orderCandidatesForCollectorPresentation(
      finalCandidates,
      tasteProfileChases,
      targetVisibleCount,
      negativeProfile,
      learnedRankContext
    );
    if (hasFullDiscovery && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT && candidates.length >= targetVisibleCount) {
      upsertUserDiscoveryState({ userId, mode: stateKey, profileFingerprint, suggestionNames: candidates.map((candidate) => candidate.suggestion.name) });
    }
    if (hasFullDiscovery && shouldSaveScheduledDrop && targetVisibleCount >= VISIBLE_DISCOVERY_COUNT) {
      saveWeeklyDiscoveryDrop(userId, candidates, settings.alertCurrency, persistedState?.updatedAt, options.scheduledDate);
    }
    return {
      lane: selection.lane,
      candidates,
      hiddenVaultPickCount
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
    negativeProfile,
    learnedRankContext,
    usesScheduledDrop: false,
    lane,
    candidates,
    hiddenVaultPickCount: preferred.hiddenVaultPickCount
  };
}

function hiddenVaultPickNote(count: number): string {
  const pickLabel = count === 1 ? 'pick' : 'picks';
  return `Already in your Vault: ${count} ${pickLabel} tucked out of this shelf`;
}

function isScheduledShelfPriorityCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  if (isReliableDirectSubjectRefillCandidate(candidate, chases)) return true;
  if (!isScheduledProfileRelevantCandidate(candidate, chases)) return false;
  return hasSourceBackedCardPresentation(candidate);
}

function isScheduledShelfFallbackCandidate(candidate: DiscoveryCandidate, chases: Chase[]): boolean {
  return isScheduledShelfPriorityCandidate(candidate, chases) || isBroadCollectorShelfFillerCandidate(candidate, chases);
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
  const scheduledDisplayCandidates = discovery.usesScheduledDrop
    ? discovery.candidates
        .filter(isCollectorWorthyWeeklyCandidate)
    : [];
  const shelfCandidates = discovery.usesScheduledDrop && scheduledDisplayCandidates.length > 0
    ? scheduledDisplayCandidates
    : marketReadyShelfCandidatesWithOptions(discovery.candidates, discovery.hasFullDiscovery, discovery.profileConfidence, {
        allowPendingExploration: !discovery.usesScheduledDrop,
        allowLanguageSignalFallback: discovery.usesScheduledDrop && hasJapaneseWeightedProfile(discovery.tasteProfileChases),
        allowSourceBackedRetailEReaderFallback: discovery.usesScheduledDrop && hasRetailEReaderPromoProfileSignal(discovery.tasteProfileChases),
        languageSignalTargetCount: weeklyJapaneseSignalTargetCount(discovery.tasteProfileChases, discovery.profileConfidence.maxShelfSize)
      });
  if (shelfCandidates.length === 0) {
    return {
      embeds: [infoEmbed('Weekly Shelf', '🔮 Your Weekly Shelf is still being curated\nVaultr is waiting for fresh, market-ready picks instead of repeating cards you have already seen').setColor(DISCOVERY_OVERVIEW_COLOR).setFooter({ text: 'Vaultr • Weekly Shelf' })],
      components: [],
      candidateNames: [],
      hasFullDiscovery: discovery.hasFullDiscovery
    };
  }
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
  const lines = [
    discovery.hasFullDiscovery
      ? `🪄 **Personal Picks:** ${shelfCandidates.length} new ${shelfCandidates.length === 1 ? 'find' : 'finds'} shaped by ${personalPicksProfileSummary(profileSummary)}`
      : `🎬 **Preview:** ${shelfCandidates.length} ${shelfPickLabel} shaped by ${profileSummary}`,
    `🧵 **Threads:** ${pathSummary}`
  ];
  if (discovery.hiddenVaultPickCount > 0) lines.push(hiddenVaultPickNote(discovery.hiddenVaultPickCount));
  if (discovery.hasFullDiscovery && hiddenCandidateCount > 0) {
    lines.push('', discoveryShelfMarketCheckNote(shelfCandidates.length));
  } else if (shouldShowDiscoveryShelfTighteningNote(discovery.hasFullDiscovery, shelfCandidates.length)) {
    lines.push(discoveryShelfTighteningNote());
  }
  if (!discovery.hasFullDiscovery) {
    lines.push('A quick peek: Full Vault gets the deeper Weekly Shelf with feedback-powered taste profile memory, live market reads on every card, and custom exclusion controls for future drops');
  }
  const actionRows = discoveryActionRows(userId, visibleCandidates, discovery.hasFullDiscovery, pageState.start);
  const headerEmbed = discoveryShelfHeaderEmbed(title, lines);
  const cardEmbeds = discoveryCardEmbeds(visibleCandidates, discovery.settings.alertCurrency, discovery.hasFullDiscovery, pageState.start);
  if (discovery.hasFullDiscovery) recordDiscoveryShelfTrainingExamples(userId, visibleCandidates, discovery.tasteProfileChases, pageState.start, discovery.negativeProfile, discovery.learnedRankContext);
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
  let discovery = await discoverCandidatesForUser(userId, weeklyDiscoveryShelfSizeForPlan(activeTier), {
    preferScheduledDrop: activeTier === 'PRO',
    requireScheduledDrop: activeTier === 'PRO',
    saveScheduledDrop: false,
    hydrateScheduledMarketInline: false
  });
  if (activeTier === 'PRO' && discovery.candidates.length === 0) {
    discovery = await discoverCandidatesForUser(userId, weeklyDiscoveryShelfSizeForPlan(activeTier), {
      preferScheduledDrop: false,
      requireScheduledDrop: false,
      saveScheduledDrop: false,
      hydrateScheduledMarketInline: false
    });
  }
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

export async function prepareWeeklyDiscoveryDropForUser(userId: string, date = new Date(), options: { force?: boolean; hydrateMarketInline?: boolean; allowRecentRepeatFiller?: boolean } = {}): Promise<{
  prepared: boolean;
  itemCount: number;
  hasFullDiscovery: boolean;
}> {
  const quickRefresh = options.hydrateMarketInline === false;
  const availability = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  const previousDropLookupDate = new Date(Date.parse(availability.availableAt) - 1);
  const fallbackDrop = getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', previousDropLookupDate.toISOString());
  const recentDrops = listRecentAvailableScheduledDiscoveryDrops(userId, 'WEEKLY_DISCOVERY', previousDropLookupDate.toISOString(), 6);
  const immediatePreviousDropNames = recentDrops
    .slice(0, 1)
    .flatMap((drop) => drop.items.map((item) => item.suggestion.name));
  const previousDropNames = recentDrops
    .slice(0, 3)
    .flatMap((drop) => drop.items.map((item) => item.suggestion.name));
  const existing = !options.force ? getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date)) : null;
  if (existing && (existing.status === 'READY' || existing.status === 'PARTIAL') && existing.itemCount > 0) {
    return {
      prepared: true,
      itemCount: existing.itemCount,
      hasFullDiscovery: getEntitlementsForTier(activePlanTier(getUserPlan(userId))).discoveryDepth === 'full'
    };
  }
  const discovery = await discoverCandidatesForUser(userId, DISCOVERY_WEEKLY_DROP_SIZE, {
    preferScheduledDrop: false,
    saveScheduledDrop: false,
    scheduledDate: date,
    hydrateScheduledMarketInline: options.hydrateMarketInline ?? true,
    usePersistedState: false,
    ignoreSeenExclusions: true,
    hardAvoidNames: immediatePreviousDropNames,
    softAvoidNames: previousDropNames,
    allowSoftAvoidFiller: options.allowRecentRepeatFiller ?? false,
    skipSourceCatalogFetch: quickRefresh,
    skipReferenceImageFetch: quickRefresh,
    ingestCanonicalUniverse: !quickRefresh
  });
  const targetCount = discovery.hasFullDiscovery ? DISCOVERY_WEEKLY_DROP_SIZE : discovery.candidates.length;
  const marketContext = {
    activeChases: discovery.chases,
    destination: discovery.settings.shippingCountry
      ? { country: discovery.settings.shippingCountry, postalCode: discovery.settings.shippingPostalCode }
      : undefined,
    targetCurrency: discovery.settings.alertCurrency,
    range: discoveryMarketRangeFromChases(discovery.tasteProfileChases)
  };
  const repeatGuardChases = [...discovery.chases, ...repeatGuardTasteMemoryChases(listUserTasteMemoryChases(userId))];
  const freshExcludedNames = uniqueValuesPreservingOrder(previousDropNames);
  const supplementalUniverseTarget = Math.max(targetCount * 8, DISCOVERY_SHELF_PAGE_SIZE * 8);
  const supplementalCacheTarget = Math.max(targetCount * 6, DISCOVERY_SHELF_PAGE_SIZE * 6);
  const indexedSupplementalUniverseCandidates = discovery.hasFullDiscovery
    ? selectDiscoveryUserUniverseCandidates(
        userId,
        freshExcludedNames,
        supplementalUniverseTarget,
        discovery.tasteProfileChases,
        repeatGuardChases
      )
    : [];
  const supplementalUniverseCandidates = indexedSupplementalUniverseCandidates.length > 0
    ? indexedSupplementalUniverseCandidates
    : discovery.hasFullDiscovery
      ? selectDiscoveryUniverseCandidatesForProfile(
          discovery.tasteProfileChases,
          freshExcludedNames,
          supplementalUniverseTarget,
          repeatGuardChases
        )
      : [];
  const supplementalCacheCandidates = discovery.hasFullDiscovery
    ? backfillMarketReadyDiscoveryCandidates(
        [],
        marketContext,
        supplementalCacheTarget,
        discovery.tasteProfileChases,
        discovery.profileConfidence,
        discovery.negativeProfile,
        repeatGuardChases,
        freshExcludedNames
      )
    : [];
  const weeklyCandidatePool = orderCandidatesForCollectorPresentation(
    uniqueCandidatesByDisplayName([
      ...supplementalUniverseCandidates,
      ...supplementalCacheCandidates,
      ...discovery.candidates
    ]),
    discovery.tasteProfileChases,
    Math.max(
      targetCount,
      supplementalUniverseCandidates.length + supplementalCacheCandidates.length + discovery.candidates.length
    ),
    discovery.negativeProfile,
    discovery.learnedRankContext
  );
  const carryoverCap = options.allowRecentRepeatFiller === true ? Math.max(4, Math.floor(targetCount * 0.2)) : Math.max(2, Math.floor(targetCount * 0.1));
  let candidates = buildFreshWeeklyShelfFromPool(
    [],
    weeklyCandidatePool,
    recentDrops,
    targetCount,
    discovery.tasteProfileChases
  );
  if (discovery.hasFullDiscovery && candidates.length < targetCount) {
    const freshRescuePool = uniqueCandidatesByDisplayName([
      ...weeklyCandidatePool,
      ...backfillMarketReadyDiscoveryCandidates(
        [],
        marketContext,
        supplementalCacheTarget,
        discovery.tasteProfileChases,
        discovery.profileConfidence,
        discovery.negativeProfile,
        repeatGuardChases,
        uniqueValuesPreservingOrder([
          ...previousDropNames,
          ...freshExcludedNames,
          ...candidates.map((candidate) => candidate.suggestion.name)
        ])
      )
    ]);
    candidates = buildFreshWeeklyShelfFromPool(
      candidates,
      freshRescuePool,
      recentDrops,
      targetCount,
      discovery.tasteProfileChases
    );
  }
  if (discovery.hasFullDiscovery && candidates.length < targetCount) {
    const toppedUpCandidates = backfillMarketReadyDiscoveryCandidates(
      [],
      marketContext,
      supplementalCacheTarget,
      discovery.tasteProfileChases,
      discovery.profileConfidence,
      discovery.negativeProfile,
      repeatGuardChases,
      uniqueValuesPreservingOrder([
        ...previousDropNames,
        ...candidates.map((candidate) => candidate.suggestion.name)
      ])
    );
    candidates = buildFreshWeeklyShelfFromPool(
      candidates,
      toppedUpCandidates,
      recentDrops,
      targetCount,
      discovery.tasteProfileChases
    );
  }
  if (candidates.length < targetCount) {
    candidates = backfillScheduledDiscoveryShelfCandidates(
      candidates,
      fallbackDrop,
      targetCount,
      repeatGuardChases,
      discovery.tasteProfileChases,
      { maxImmediateNameCarryovers: carryoverCap }
    );
  }
  if (!quickRefresh) candidates = await hydrateShelfCandidateImages(candidates);
  if (options.force === true && discovery.hasFullDiscovery && candidates.length === 0 && options.allowRecentRepeatFiller !== true) {
    const repairedCandidates = backfillMarketReadyDiscoveryCandidates(
      [],
      marketContext,
      targetCount,
      discovery.tasteProfileChases,
      discovery.profileConfidence,
      discovery.negativeProfile,
      discovery.chases,
      uniqueValuesPreservingOrder(previousDropNames)
    );
    const freshRepairCandidates = quickRefresh ? repairedCandidates : await hydrateShelfCandidateImages(repairedCandidates);
    if (freshRepairCandidates.length > 0) {
      const freshnessOrderedRepairCandidates = backfillScheduledDiscoveryShelfCandidates(
        selectNovelWeeklyCandidates(
          preferFreshWeeklyCandidatesAgainstRecentShelves(freshRepairCandidates, recentDrops, discovery.tasteProfileChases),
          recentDrops,
          targetCount,
          discovery.tasteProfileChases
        ),
        fallbackDrop,
        targetCount,
        repeatGuardChases,
        discovery.tasteProfileChases,
        { maxImmediateNameCarryovers: carryoverCap }
      );
      saveWeeklyDiscoveryDrop(userId, freshnessOrderedRepairCandidates, discovery.settings.alertCurrency, undefined, date);
      return {
        prepared: true,
        itemCount: freshnessOrderedRepairCandidates.length,
        hasFullDiscovery: true
      };
    }
  }
  if (candidates.length > 0) saveWeeklyDiscoveryDrop(userId, candidates, discovery.settings.alertCurrency, undefined, date);
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
    await interaction.reply({ embeds: [warningEmbed('Drop Unavailable', 'That Weekly Shelf is not ready yet')], flags: MessageFlags.Ephemeral });
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
    await interaction.reply({ content: 'Only the original requester can page through this Discovery shelf', flags: MessageFlags.Ephemeral });
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
      .setLabel('Peek Inside')
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
      content: 'Only the original requester can add this discovery to their Vault',
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
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh cards to add to your Vault')],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const existingChases = listChases(interaction.user.id);
  if (existingChases.some((chase) => normalize(chase.cardName) === normalize(pick.cardName))) {
    await interaction.reply({
      embeds: [warningEmbed('Already In Vault', `**${pick.cardName}** is already an active chase`)],
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
        ? `You have reached your Pro limit of ${maxChases} active chases. Remove one with /chase remove before adding another`
        : freeVaultLimitMessage('Remove one with `/chase remove` or run `/upgrade`');
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
    'Nice find. Added to your Vault, and Vaultr will keep watch',
    'It will shape future Weekly Shelves once the next drop is packed',
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
      content: 'Only the original requester can tune this Discovery path',
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
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh cards to tune')],
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
      ? `Vaultr will treat **${pick.cardName}** as a stronger preference signal for your next Discovery release`
      : `Noted. Vaultr will keep **${pick.cardName}** off future Shelves and favor sharper grail signals around your Vault`;
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
      content: 'Only the original requester can undo this Discovery feedback',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Undo Expired', 'Open the latest Weekly Shelf again to tune fresh cards')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const undone = undoDiscoveryFeedback({ userId: interaction.user.id, cardName: pick.cardName });
  const description = undone
    ? `Removed your feedback for **${pick.cardName}**. Your next Discovery release will ignore that signal`
    : `No active Discovery feedback was found for **${pick.cardName}**`;
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
      content: 'Only the original requester can use this Discovery menu',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pick = getDiscoveryVaultAction(interaction.user.id, token);
  if (!pick) {
    await interaction.reply({
      embeds: [warningEmbed('Shelf Action Expired', 'Open the latest Weekly Shelf again for fresh card actions')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const activeTier = activePlanTier(getUserPlan(interaction.user.id));
  const includeFeedbackActions = activeTier === 'PRO';
  const lines = [
    'Choose an action for this shelf card',
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
