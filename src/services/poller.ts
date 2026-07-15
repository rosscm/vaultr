import { Client, EmbedBuilder } from 'discord.js';
import {
  getGuildCommunityStatsToday,
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getChaseLastPollCheckAt,
  getUserPlan,
  getUserAlertSettings,
  getGuildCommunityFeedMode,
  hasAlertBeenSent,
  hasPostedGuildDailyStats,
  listGuildCommandChannels,
  listAllChases,
  isListingFingerprintIgnored,
  getSourceObservationForItem,
  claimAlertForSending,
  claimUserAlertFingerprintForSending,
  markPostedGuildDailyStats,
  markChasesPollAttempted,
  markChasesPollChecked,
  releaseIncompleteAlertSendClaim,
  releaseUserAlertFingerprintSendClaim,
  updateSentAlertDetails,
  pruneSourceObservations,
  recordSourceObservations
} from './chase-store.js';
import { enrichEbayListingDetails, searchEbayListings, type ShippingDestination } from './ebay.js';
import { searchTrustedShopifyListings } from './shopify.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from './currency.js';
import { activePlanChases, activePlanTier, getRuntimePollIntervalSeconds, PLAN_LIMITS } from './plans.js';
import { CHASE_ALERT_COOLDOWN_MINUTES, SHOW_ALERT_IMAGES, USE_COMPACT_ALERT_LAYOUT } from './alert-policy.js';
import { getEntitlementsForTier } from './entitlements.js';
import {
  getPollerState,
  initializePollerState,
  markSourceSuccessNow,
  markPollerError,
  markPollerMatchSent,
  markPollerOverlapSkip,
  markPollerRunStart,
  markPollerRunSuccess,
  markRateLimitSkip,
  markMinScoreSuppression,
  markChaseCooldownSuppression,
  markFingerprintSuppression,
  setBackoffUntil,
  setPollerCoverageSnapshot,
  setSourceCallsLastMinute
} from './poller-state.js';
import { alertFeedbackButtons, keyValue, listingLinkButton, warningEmbed } from '../ui/embeds.js';
import { makeListingFingerprint } from './listing-fingerprint.js';
import type { Chase, Listing, ListingSourceModePreference } from '../types.js';

function formatReasons(reasons: string[]): string {
  return reasons
    .map((r) => {
      if (r.startsWith('suspicious_terms:')) {
        const terms = r.split(':')[1] ?? '';
        return `suspicious terms (${terms})`;
      }
      if (r === 'card_name_match_exact') return 'exact card name';
      if (r === 'card_name_match_tokens') return 'card name aligned';
      if (r === 'card_number_match') return 'card number';
      if (r === 'ungraded_match') return 'raw/ungraded';
      if (r === 'grade_match') return 'requested grade';
      if (r === 'listing_type_match') return 'listing type';
      if (r === 'price_within_max') return 'within your max';
      if (r === 'seller_quality_boost') return 'high seller feedback';
      if (r === 'new_seller_penalty') return 'new or unrated seller';
      if (r === 'low_seller_feedback_count_penalty') return 'limited seller history';
      if (r === 'low_seller_feedback_percent_penalty') return 'lower seller feedback';
      if (r === 'suspicious_title_penalty') return 'suspicious title terms';
      return r.replaceAll('_', ' ');
    })
    .join(', ');
}

function splitReasons(reasons: string[]): { positive: string; risk: string } {
  const riskSignals = reasons.filter(
    (r) => r.includes('penalty') || r.startsWith('suspicious_terms:') || r.includes('miss') || r.includes('block')
  );
  const positiveSignals = reasons.filter((r) => !riskSignals.includes(r) && r !== 'price_within_max');
  return {
    positive: positiveSignals.length > 0 ? formatReasons(positiveSignals) : 'None',
    risk: riskSignals.length > 0 ? formatReasons(riskSignals) : 'None'
  };
}

function sightingPresentation(priority: Chase['priority']): { icon: string; label: string } {
  switch (priority ?? 'NORMAL') {
    case 'GRAIL':
      return { icon: '🏆', label: 'Grail Alert' };
    case 'HIGH':
      return { icon: '🔥', label: 'Priority Alert' };
    case 'NORMAL':
    default:
      return { icon: '🚨', label: 'Chase Alert' };
  }
}

function formatListingType(listingType: string | undefined): string {
  if (!listingType) return 'Unknown';
  if (listingType === 'AUCTION') return 'Auction';
  if (listingType === 'BUY_IT_NOW') return 'Buy It Now';
  return 'Other';
}

function formatPostedAge(postedAt: string | undefined): string {
  if (!postedAt) return 'Unknown';
  const then = new Date(postedAt).getTime();
  if (Number.isNaN(then)) return 'Unknown';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function alertLatencySeconds(listingPostedAt: string | undefined, sentAtMs = Date.now()): number | undefined {
  if (!listingPostedAt) return undefined;
  const postedAtMs = new Date(listingPostedAt).getTime();
  if (!Number.isFinite(postedAtMs)) return undefined;
  return Math.max(0, Math.floor((sentAtMs - postedAtMs) / 1000));
}

function sourceObservationRetentionDays(): number {
  const value = Number(process.env.SOURCE_OBSERVATION_RETENTION_DAYS ?? '14');
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 14;
}

function postedAgeSeconds(postedAt: string | undefined): number | null {
  if (!postedAt) return null;
  const then = new Date(postedAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}

function comparablePrice(price: number, shippingCost: number | undefined): number {
  return shippingCost === undefined || Number.isNaN(shippingCost) ? price : price + shippingCost;
}

function maxAlertsPerChasePerPoll(): number {
  const value = Number(process.env.MAX_ALERTS_PER_CHASE_PER_POLL ?? '3');
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 3;
}

function formatPriceVsMax(listingPrice: number, shippingCost: number | undefined, chaseMax: number | undefined, currency: string): string {
  if (chaseMax === undefined) return 'No max set';
  const diff = chaseMax - comparablePrice(listingPrice, shippingCost);
  if (diff >= 0) return `${Math.abs(diff).toFixed(2)} ${currency} under max`;
  return `${Math.abs(diff).toFixed(2)} ${currency} over max`;
}

function formatSellerFeedbackPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return 'Unknown';
  return `${value.toFixed(1)}%`;
}

function formatShippingCost(cost: number | undefined, currency: string | undefined): string {
  if (cost === undefined || Number.isNaN(cost)) return 'Unknown';
  return `${cost.toFixed(2)} ${currency ?? ''}`.trim();
}

function formatTotalCost(price: number, shippingCost: number | undefined): number | undefined {
  if (shippingCost === undefined || Number.isNaN(shippingCost)) return undefined;
  return price + shippingCost;
}

function formatMoney(amount: number | undefined, currency: string): string {
  if (amount === undefined || Number.isNaN(amount)) return 'Unknown';
  return `${amount.toFixed(2)} ${currency}`;
}

function alertListingEnrichmentTimeoutMs(): number {
  const value = Number(process.env.ALERT_LISTING_ENRICHMENT_TIMEOUT_MS ?? '5000');
  return Number.isFinite(value) ? Math.max(500, Math.floor(value)) : 5000;
}

function normalizeListingCurrency(listing: Listing, targetCurrency: ReturnType<typeof normalizeSupportedCurrency>): Listing {
  return {
    ...listing,
    price: convertCurrencyAmount(listing.price, listing.currency, targetCurrency),
    currency: targetCurrency,
    shippingCost:
      listing.shippingCost === undefined
        ? undefined
        : convertCurrencyAmount(listing.shippingCost, listing.shippingCurrency ?? listing.currency, targetCurrency),
    shippingCurrency: targetCurrency
  };
}

export async function enrichSelectedAlertListing(listing: Listing, destination?: ShippingDestination): Promise<Listing> {
  if (listing.source !== 'EBAY') return listing;
  if (!destination?.country && listing.shippingCost !== undefined) return listing;
  const listingForEnrichment = destination?.country
    ? {
        ...listing,
        shippingCost: undefined,
        shippingCurrency: undefined,
        shippingDestinationCountry: undefined,
        shippingDestinationPostalCode: undefined,
        shippingEligibility: undefined,
        shippingEligibilityMessage: undefined
      }
    : listing;
  return withTimeout(
    enrichEbayListingDetails(listingForEnrichment, destination),
    alertListingEnrichmentTimeoutMs(),
    'Alert listing enrichment timeout'
  ).catch(() => listingForEnrichment);
}

export function shouldSuppressForDestinationShipping(listing: Listing, destination?: ShippingDestination): boolean {
  if (!destination?.country) return false;
  if (listing.source !== 'EBAY') return false;
  if (listing.shippingEligibility === 'MAY_NOT_SHIP') return true;
  if (listing.shippingEligibility === 'AVAILABLE' || listing.shippingCost !== undefined) return false;
  return listing.shippingEligibility === undefined || listing.shippingEligibility === 'UNKNOWN';
}

function formatDealQuality(score: number): string {
  if (score >= 85) return 'strong';
  if (score >= 60) return 'good';
  return 'speculative';
}

function explainDealQuality(score: number): string {
  if (score >= 85) return 'closely matches your chase criteria';
  if (score >= 60) return 'meets the core chase criteria';
  return 'some criteria line up; review details before acting';
}

function formatScoreWithQuality(score: number): string {
  return `${formatDealQuality(score)} (${score})`;
}

function truncateTitle(title: string, maxLen = 110): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}



const VAULTR_ALERT_COLOR = 0xf59e0b;

type AlertCandidate = {
  listing: Listing;
  normalizedListing: Listing;
  match: ReturnType<typeof matchChaseToListing>;
  targetCurrency: ReturnType<typeof normalizeSupportedCurrency>;
  listingFingerprint: string;
  rankScore: number;
};

function sellerTrustScore(listing: Listing): number {
  const feedbackScore = listing.sellerFeedbackScore;
  const feedbackPercent = listing.sellerFeedbackPercent;
  if (feedbackScore !== undefined && feedbackScore <= 0) return -1000;
  if (feedbackScore !== undefined && feedbackScore < 10) return -250;
  if (feedbackPercent !== undefined && feedbackPercent < 95) return -150;
  if (feedbackPercent !== undefined && feedbackPercent >= 99 && feedbackScore !== undefined && feedbackScore >= 50) return 250;
  if (feedbackScore !== undefined && feedbackScore >= 10) return 100;
  return 0;
}

function priceFitScore(listingPrice: number, shippingCost: number | undefined, chaseMax: number | undefined): number {
  if (chaseMax === undefined || chaseMax <= 0) return 0;
  const total = comparablePrice(listingPrice, shippingCost);
  if (total > chaseMax) return -1000;
  return Math.min(250, Math.round(((chaseMax - total) / chaseMax) * 250));
}

function freshnessScore(postedAt: string | undefined): number {
  const ageSeconds = postedAgeSeconds(postedAt);
  if (ageSeconds === null) return 0;
  const ageHours = ageSeconds / 3600;
  if (ageHours <= 1) return 50;
  if (ageHours <= 24) return 30;
  if (ageHours <= 72) return 15;
  return 0;
}

function rankAlertCandidate(candidate: Omit<AlertCandidate, 'rankScore'>, chase: Chase): number {
  return (
    candidate.match.score * 1000 +
    sellerTrustScore(candidate.listing) +
    priceFitScore(candidate.normalizedListing.price, candidate.normalizedListing.shippingCost, chase.maxPrice) +
    freshnessScore(candidate.listing.postedAt)
  );
}

export function orderAlertCandidatesForSending(candidates: AlertCandidate[]): AlertCandidate[] {
  const sources = new Set(candidates.map((candidate) => candidate.listing.source));
  if (sources.size <= 1) return candidates;

  const selected = new Set<AlertCandidate>();
  const sourceLeaders: AlertCandidate[] = [];
  for (const candidate of candidates) {
    if (sourceLeaders.some((leader) => leader.listing.source === candidate.listing.source)) continue;
    sourceLeaders.push(candidate);
    selected.add(candidate);
  }

  sourceLeaders.sort((a, b) => {
    if (a.listing.source === b.listing.source) return b.rankScore - a.rankScore;
    if (a.listing.source === 'EBAY') return 1;
    if (b.listing.source === 'EBAY') return -1;
    return b.rankScore - a.rankScore;
  });

  return [...sourceLeaders, ...candidates.filter((candidate) => !selected.has(candidate))];
}

function summarizeWhyMatched(
  score: number,
  listingPrice: number,
  shippingCost: number | undefined,
  chaseMax: number | undefined,
  currency = 'USD',
  postedAt?: string
): string {
  const fitQuality = formatDealQuality(score);
  const matchLabel = `${fitQuality.charAt(0).toUpperCase()}${fitQuality.slice(1)} fit`;
  const total = comparablePrice(listingPrice, shippingCost);
  const pricePart =
    chaseMax === undefined
      ? 'No max set'
      : total <= chaseMax
        ? `Under max by ${(chaseMax - total).toFixed(2)} ${currency}`
        : `Over max by ${(total - chaseMax).toFixed(2)} ${currency}`;
  const postedPart = `Posted ${formatPostedAge(postedAt)}`;
  return `${matchLabel} • ${pricePart} • ${postedPart}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const sourceCallTimestamps: number[] = [];
const throttleNoticeTimestampsByUser = new Map<string, number>();
const chaseTuningNoticeTimestamps = new Map<string, number>();
const recentFingerprintTimestamps = new Map<string, number>();
const lastSourceFetchAtMsByQueryKey = new Map<string, number>();
let backoffUntilMs = 0;

type ActiveGroup = {
  members: Array<{ chase: Chase; settings: ReturnType<typeof getUserAlertSettings> }>;
  sourceMode: string;
  oldestCreatedAt: string;
  oldestDueAtMs: number;
  oldestChaseName?: string;
};

type CoverageAccumulator = {
  dueGroups: number;
  dueChases: number;
  checkedGroups: number;
  checkedChases: number;
  deferredGroups: number;
  deferredChases: number;
  rateLimitedGroups: number;
  backoffGroups: number;
  sourceTimeoutGroups: number;
  sourceErrorGroups: number;
  oldestDue?: { queryKey: string; chaseName?: string; chaseCount: number; overdueSeconds: number };
  oldestDeferred?: { queryKey: string; chaseName?: string; chaseCount: number; overdueSeconds: number; reason?: string; sourceCallsAtDeferral?: number; sourceBudget?: number };
};

export function orderGroupsForRun(
  groups: ReadonlyArray<{ queryKey: string; group: ActiveGroup; lastSourceFetchAtMs?: number }>
): Array<{ queryKey: string; group: ActiveGroup; lastSourceFetchAtMs?: number }> {
  return [...groups].sort((left, right) => {
    if (left.group.oldestDueAtMs !== right.group.oldestDueAtMs) {
      return left.group.oldestDueAtMs - right.group.oldestDueAtMs;
    }

    if (left.lastSourceFetchAtMs === undefined && right.lastSourceFetchAtMs !== undefined) return -1;
    if (left.lastSourceFetchAtMs !== undefined && right.lastSourceFetchAtMs === undefined) return 1;
    if (left.lastSourceFetchAtMs !== undefined && right.lastSourceFetchAtMs !== undefined) {
      if (left.lastSourceFetchAtMs !== right.lastSourceFetchAtMs) {
        return left.lastSourceFetchAtMs - right.lastSourceFetchAtMs;
      }
    }

    if (left.group.oldestCreatedAt !== right.group.oldestCreatedAt) {
      return left.group.oldestCreatedAt.localeCompare(right.group.oldestCreatedAt);
    }

    return left.queryKey.localeCompare(right.queryKey);
  });
}

export function isDueForPollInterval(
  lastCheckedAtMs: number | undefined,
  intervalSeconds: number,
  nowMs: number
): boolean {
  if (lastCheckedAtMs === undefined) return true;
  return nowMs - lastCheckedAtMs >= intervalSeconds * 1000;
}

function groupDisplayName(queryKey: string): string {
  return queryKey.split('|')[0] || queryKey;
}

function overdueSeconds(dueAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - dueAtMs) / 1000));
}

function maybeReplaceOldestCoverageGroup<T extends { overdueSeconds: number }>(current: T | undefined, next: T): T {
  if (!current || next.overdueSeconds > current.overdueSeconds) return next;
  return current;
}

function markCoverageChecked(coverage: CoverageAccumulator, group: ActiveGroup): void {
  coverage.checkedGroups += 1;
  coverage.checkedChases += group.members.length;
}

function markCoverageDeferred(
  coverage: CoverageAccumulator,
  queryKey: string,
  group: ActiveGroup,
  nowMs: number,
  reason: string,
  sourceBudgetState?: { calls: number; budget: number }
): void {
  coverage.deferredGroups += 1;
  coverage.deferredChases += group.members.length;
  if (reason === 'Rate limit') coverage.rateLimitedGroups += 1;
  if (reason === 'Backoff') coverage.backoffGroups += 1;
  if (reason === 'Source timeout') coverage.sourceTimeoutGroups += 1;
  if (reason === 'Source error') coverage.sourceErrorGroups += 1;
  coverage.oldestDeferred = maybeReplaceOldestCoverageGroup(coverage.oldestDeferred, {
    queryKey: groupDisplayName(queryKey),
    chaseName: group.oldestChaseName ?? group.members[0]?.chase.cardName,
    chaseCount: group.members.length,
    overdueSeconds: overdueSeconds(group.oldestDueAtMs, nowMs),
    reason,
    sourceCallsAtDeferral: sourceBudgetState?.calls,
    sourceBudget: sourceBudgetState?.budget
  });
}

function maxEbayRequestsPerMinute(): number {
  const value = Number(process.env.EBAY_MAX_REQUESTS_PER_MINUTE ?? '6');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 6;
}

function clearExpiredBackoff(nowMs: number): void {
  if (backoffUntilMs > 0 && nowMs >= backoffUntilMs) {
    backoffUntilMs = 0;
    setBackoffUntil(null);
  }
}

function logSourceGroupDeferral(queryKey: string, group: ActiveGroup, reason: string, sourceBudgetState: { calls: number; budget: number }): void {
  const chaseName = group.oldestChaseName ?? group.members[0]?.chase.cardName ?? 'Unknown chase';
  console.warn(
    `[Poller] Deferred source group ${groupDisplayName(queryKey)} / ${chaseName}: ${reason} ` +
      `(source budget ${sourceBudgetState.calls}/${sourceBudgetState.budget}, ${group.members.length} chase${group.members.length === 1 ? '' : 's'})`
  );
}

function finishCoverageSnapshot(coverage: CoverageAccumulator): void {
  setPollerCoverageSnapshot(coverage);
}

function pruneSourceCallWindow(nowMs: number): void {
  const oneMinuteAgo = nowMs - 60_000;
  while (sourceCallTimestamps.length > 0 && sourceCallTimestamps[0] < oneMinuteAgo) {
    sourceCallTimestamps.shift();
  }
  setSourceCallsLastMinute(sourceCallTimestamps.length);
}

function canCallSource(nowMs: number, maxRequestsPerMinute: number): boolean {
  pruneSourceCallWindow(nowMs);
  return sourceCallTimestamps.length < maxRequestsPerMinute;
}

function markSourceCall(nowMs: number): void {
  sourceCallTimestamps.push(nowMs);
  pruneSourceCallWindow(nowMs);
}

function wasFingerprintSeenRecently(chaseId: string, fingerprint: string, nowMs: number): boolean {
  const key = `${chaseId}:${fingerprint}`;
  const prior = recentFingerprintTimestamps.get(key);
  const ttlMs = 6 * 60 * 60 * 1000;
  for (const [mapKey, mapTs] of recentFingerprintTimestamps) {
    if (nowMs - mapTs > ttlMs) recentFingerprintTimestamps.delete(mapKey);
  }
  if (!prior) return false;
  return nowMs - prior <= ttlMs;
}

function markFingerprintSeen(chaseId: string, fingerprint: string, nowMs: number): void {
  recentFingerprintTimestamps.set(`${chaseId}:${fingerprint}`, nowMs);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function shippingDestinationFromSettings(settings: ReturnType<typeof getUserAlertSettings>): ShippingDestination | undefined {
  if (!settings.shippingCountry) return undefined;
  return {
    country: settings.shippingCountry,
    postalCode: settings.shippingPostalCode
  };
}

export function effectiveListingSourceMode(
  configuredSourceMode: string,
  planTier: ReturnType<typeof getUserPlan>['tier'],
  preference: ListingSourceModePreference = 'EBAY'
): string {
  const normalizedMode = configuredSourceMode.toUpperCase();
  if (normalizedMode === 'MOCK') return 'MOCK';
  const preferredMode = preference;
  if (getEntitlementsForTier(planTier).storefrontMonitoring) return preferredMode;
  if (sourceModeIncludesTrustedShops(preferredMode)) return 'EBAY';
  return preferredMode;
}

function sourceQueryKey(chase: Chase, settings: ReturnType<typeof getUserAlertSettings>, sourceMode: string): string {
  const destination = shippingDestinationFromSettings(settings);
  return [
    sourceMode,
    chase.cardName.trim().toLowerCase(),
    chase.grade?.trim().toLowerCase() ?? '',
    destination?.country?.trim().toUpperCase() ?? '',
    destination?.postalCode?.trim().toUpperCase() ?? ''
  ].join('|');
}

function sourceModeIncludesTrustedShops(sourceMode: string): boolean {
  return sourceMode === 'SHOPIFY' || sourceMode === 'EBAY_SHOPIFY';
}

export function didFetchRequiredListingSource(sourceMode: string, sourceCallsBefore: number, sourceCallsAfter: number): boolean {
  if (sourceMode === 'MOCK' || sourceMode === 'SHOPIFY') return true;
  return sourceCallsAfter > sourceCallsBefore;
}

export function alertEbaySearchOptions(chase?: Chase, alertCurrency?: string): { enrichMissingShipping: false; maxPrice?: number; maxPriceCurrency?: string } {
  const maxPrice = Number(chase?.maxPrice);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return { enrichMissingShipping: false };
  return { enrichMissingShipping: false, maxPrice, maxPriceCurrency: normalizeSupportedCurrency(alertCurrency) };
}

export function listingSourceFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return 'Source timeout';
  if (/429|rate limit|quota|ratelimiter/i.test(message)) return 'Rate limit';
  return 'Source error';
}

async function fetchListingsWithRetry(
  chase: Chase,
  sourceMode: string,
  destination?: ShippingDestination,
  alertCurrency?: string
): Promise<Listing[]> {
  const maxRequestsPerMinute = maxEbayRequestsPerMinute();
  const backoffBaseSeconds = Number(process.env.EBAY_BACKOFF_BASE_SECONDS ?? '900');
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (sourceMode === 'MOCK') return searchMockListings(chase, destination);
      if (sourceMode === 'SHOPIFY') return searchTrustedShopifyListings(chase);

      const includeEbay = sourceMode === 'EBAY' || sourceMode === 'EBAY_SHOPIFY';
      const includeShopify = sourceModeIncludesTrustedShops(sourceMode);
      if (!includeEbay) return [];

      const shopifyListingsPromise = includeShopify ? searchTrustedShopifyListings(chase) : Promise.resolve([]);
      const nowMs = Date.now();
      clearExpiredBackoff(nowMs);
      if (nowMs < backoffUntilMs) {
        return shopifyListingsPromise;
      }
      if (!canCallSource(nowMs, maxRequestsPerMinute)) {
        markRateLimitSkip();
        return shopifyListingsPromise;
      }
      markSourceCall(nowMs);
      const [ebayListings, shopifyListings] = await Promise.all([
        withTimeout(searchEbayListings(chase, destination, alertEbaySearchOptions(chase, alertCurrency)), 30000, 'Listing source timeout'),
        shopifyListingsPromise
      ]);
      markSourceSuccessNow();
      return [...ebayListings, ...shopifyListings];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('429') || /rate limit|quota|ratelimiter|listing source timeout/i.test(message)) {
        const backoffMs = backoffBaseSeconds * 1000 * attempt;
        backoffUntilMs = Date.now() + backoffMs;
        setBackoffUntil(new Date(backoffUntilMs));
      }
      if (attempt === attempts) throw error;
      await sleep(300 * attempt);
    }
  }
  return [];
}

async function sendThrottleNoticeIfNeeded(client: Client, userId: string, maxAlertsPerHour: number): Promise<void> {
  const nowMs = Date.now();
  const lastNotifiedAt = throttleNoticeTimestampsByUser.get(userId) ?? 0;
  const throttleNoticeCooldownMs = 60 * 60 * 1000;
  if (nowMs - lastNotifiedAt < throttleNoticeCooldownMs) return;

  try {
    const user = await client.users.fetch(userId);
    await withTimeout(
      user.send({
        embeds: [
          warningEmbed(
            'Alerts Temporarily Throttled',
            `Vaultr sent ${maxAlertsPerHour} alerts in the last hour. To reduce volume, add card details, raise \`min_score\`, or tighten available chase filters.`
          )
        ]
      }),
      10000,
      'Throttle DM send timeout'
    );
    throttleNoticeTimestampsByUser.set(userId, nowMs);
  } catch (error) {
    console.error(`Failed to send throttle notice to user ${userId}`, error);
  }
}

export function shouldSendChaseTuningNotice(sentForChaseThisPoll: number, eligibleCandidates: number, maxForChaseThisPoll: number): boolean {
  return sentForChaseThisPoll >= maxForChaseThisPoll && eligibleCandidates > sentForChaseThisPoll;
}

export function chaseTuningNoticeLines(
  chase: Pick<Chase, 'cardName'>,
  activeTier: ReturnType<typeof activePlanTier>,
  sentForChaseThisPoll: number,
  eligibleCandidates: number
): string[] {
  const intro = `**${truncateTitle(chase.cardName, 80)}** surfaced ${eligibleCandidates} eligible listings, so Vaultr sent the strongest ${sentForChaseThisPoll} this pass.`;
  if (activeTier === 'PRO') {
    return [
      intro,
      'If that feels noisy, tighten the chase name, lower the max price, add condition or grade details, or use custom exclusions for variants you do not want.',
      'You can also use `/alerts settings` to raise confidence or lower alert volume.'
    ];
  }

  return [
    intro,
    'If that feels noisy, tighten the chase name or lower the max price so Vaultr has a clearer target.',
    'For precision controls and custom exclusions, `/upgrade` opens the Full Vault.'
  ];
}

async function sendChaseTuningNoticeIfNeeded(
  client: Client,
  chase: Chase,
  sentForChaseThisPoll: number,
  eligibleCandidates: number,
  maxForChaseThisPoll: number
): Promise<void> {
  if (!shouldSendChaseTuningNotice(sentForChaseThisPoll, eligibleCandidates, maxForChaseThisPoll)) return;

  const nowMs = Date.now();
  const key = `${chase.userId}:${chase.id}`;
  const lastNotifiedAt = chaseTuningNoticeTimestamps.get(key) ?? 0;
  const tuningNoticeCooldownMs = 24 * 60 * 60 * 1000;
  if (nowMs - lastNotifiedAt < tuningNoticeCooldownMs) return;
  const activeTier = activePlanTier(getUserPlan(chase.userId));

  try {
    const user = await client.users.fetch(chase.userId);
    await withTimeout(
      user.send({
        embeds: [
          warningEmbed(
            'High-Volume Chase',
            chaseTuningNoticeLines(chase, activeTier, sentForChaseThisPoll, eligibleCandidates).join('\n')
          )
        ]
      }),
      10000,
      'Chase tuning DM send timeout'
    );
    chaseTuningNoticeTimestamps.set(key, nowMs);
  } catch (error) {
    console.error(`Failed to send chase tuning notice to user ${chase.userId}`, error);
  }
}

async function runPoll(client: Client): Promise<void> {
  const startedAt = Date.now();
  const nowMs = Date.now();
  markPollerRunStart();
  clearExpiredBackoff(nowMs);
  pruneSourceCallWindow(nowMs);
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  const chases = listAllChases();
  if (chases.length === 0) {
    finishCoverageSnapshot({
      dueGroups: 0,
      dueChases: 0,
      checkedGroups: 0,
      checkedChases: 0,
      deferredGroups: 0,
      deferredChases: 0,
      rateLimitedGroups: 0,
      backoffGroups: 0,
      sourceTimeoutGroups: 0,
      sourceErrorGroups: 0
    });
    markPollerRunSuccess(Date.now() - startedAt);
    return;
  }

  const activeChaseIds = new Set<string>();
  const chasesByUser = new Map<string, Chase[]>();
  for (const chase of chases) {
    const userChases = chasesByUser.get(chase.userId) ?? [];
    userChases.push(chase);
    chasesByUser.set(chase.userId, userChases);
  }
  for (const [userId, userChases] of chasesByUser.entries()) {
    const userPlan = getUserPlan(userId);
    for (const chase of activePlanChases(userChases, userPlan)) {
      activeChaseIds.add(chase.id);
    }
  }

  const activeGroups = new Map<string, ActiveGroup>();
  for (const chase of chases) {
    if (!activeChaseIds.has(chase.id)) continue;
    const userPlan = getUserPlan(chase.userId);
    const tier = activePlanTier(userPlan);
    const intervalSeconds = PLAN_LIMITS[tier].pollIntervalSeconds;
    const lastCheckedAtIso = getChaseLastPollCheckAt(chase.id);
    const lastCheckedAtMs = lastCheckedAtIso ? new Date(lastCheckedAtIso).getTime() : undefined;
    if (!isDueForPollInterval(Number.isFinite(lastCheckedAtMs) ? lastCheckedAtMs : undefined, intervalSeconds, nowMs)) continue;
    const createdAtMs = new Date(chase.createdAt).getTime();
    const dueAtMs = Number.isFinite(lastCheckedAtMs)
      ? (lastCheckedAtMs as number) + intervalSeconds * 1000
      : Number.isFinite(createdAtMs)
        ? createdAtMs
        : nowMs;

    const settings = getUserAlertSettings(chase.userId);
    const memberSourceMode = effectiveListingSourceMode(sourceMode, tier, settings.listingSourceMode);
    const key = sourceQueryKey(chase, settings, memberSourceMode);
    const group = activeGroups.get(key) ?? { members: [], sourceMode: memberSourceMode, oldestCreatedAt: chase.createdAt, oldestDueAtMs: dueAtMs, oldestChaseName: chase.cardName };
    group.members.push({ chase, settings });
    if (chase.createdAt.localeCompare(group.oldestCreatedAt) < 0) {
      group.oldestCreatedAt = chase.createdAt;
    }
    if (dueAtMs < group.oldestDueAtMs) {
      group.oldestDueAtMs = dueAtMs;
      group.oldestChaseName = chase.cardName;
    }
    activeGroups.set(key, group);
  }

  const orderedGroups = orderGroupsForRun(
    [...activeGroups.entries()].map(([queryKey, group]) => ({
      queryKey,
      group,
      lastSourceFetchAtMs: lastSourceFetchAtMsByQueryKey.get(queryKey)
    }))
  );
  const coverage: CoverageAccumulator = {
    dueGroups: orderedGroups.length,
    dueChases: orderedGroups.reduce((total, entry) => total + entry.group.members.length, 0),
    checkedGroups: 0,
    checkedChases: 0,
    deferredGroups: 0,
    deferredChases: 0,
    rateLimitedGroups: 0,
    backoffGroups: 0,
    sourceTimeoutGroups: 0,
    sourceErrorGroups: 0
  };
  for (const { queryKey, group } of orderedGroups) {
    coverage.oldestDue = maybeReplaceOldestCoverageGroup(coverage.oldestDue, {
      queryKey: groupDisplayName(queryKey),
      chaseName: group.oldestChaseName ?? group.members[0]?.chase.cardName,
      chaseCount: group.members.length,
      overdueSeconds: overdueSeconds(group.oldestDueAtMs, nowMs)
    });
  }

  for (const { queryKey, group } of orderedGroups) {
    const representative = group.members[0]?.chase;
    const representativeSettings = group.members[0]?.settings;
    if (!representative || !representativeSettings) continue;
    const touchedChaseIds = group.members.map(({ chase }) => chase.id);
    let listings: Listing[];
    try {
      const sourceCallsBefore = sourceCallTimestamps.length;
      listings = await fetchListingsWithRetry(
        representative,
        group.sourceMode,
        shippingDestinationFromSettings(representativeSettings),
        representativeSettings.alertCurrency
      );
      const didFetchListings = didFetchRequiredListingSource(group.sourceMode, sourceCallsBefore, sourceCallTimestamps.length);
      if (didFetchListings) {
        const checkedAtIso = new Date().toISOString();
        lastSourceFetchAtMsByQueryKey.set(queryKey, Date.now());
        markChasesPollChecked(touchedChaseIds, checkedAtIso);
        for (const { chase } of group.members) {
          recordSourceObservations({
            chaseId: chase.id,
            userId: chase.userId,
            sourceMode: group.sourceMode,
            queryKey,
            listings,
            observedAt: checkedAtIso
          });
        }
        markCoverageChecked(coverage, group);
      } else {
        markChasesPollAttempted(touchedChaseIds);
        const reason = group.sourceMode !== 'MOCK' && Date.now() < backoffUntilMs ? 'Backoff' : 'Rate limit';
        pruneSourceCallWindow(Date.now());
        const sourceBudgetState = { calls: sourceCallTimestamps.length, budget: maxEbayRequestsPerMinute() };
        markCoverageDeferred(coverage, queryKey, group, nowMs, reason, sourceBudgetState);
        logSourceGroupDeferral(queryKey, group, reason, sourceBudgetState);
      }
    } catch (error) {
      markChasesPollAttempted(touchedChaseIds);
      const reason = listingSourceFailureReason(error);
      pruneSourceCallWindow(Date.now());
      const sourceBudgetState = { calls: sourceCallTimestamps.length, budget: maxEbayRequestsPerMinute() };
      markCoverageDeferred(coverage, queryKey, group, nowMs, reason, sourceBudgetState);
      finishCoverageSnapshot(coverage);
      console.error(`Listing source group failed for ${groupDisplayName(queryKey)}`, error);
      continue;
    }


  finishCoverageSnapshot(coverage);
    for (const { chase, settings } of group.members) {
      const recentForChase = countChaseAlertsWithinMinutes(chase.userId, chase.id, CHASE_ALERT_COOLDOWN_MINUTES);
      if (recentForChase > 0) {
        markChaseCooldownSuppression();
        continue;
      }

      let sentForChaseThisPoll = 0;
      const maxForChaseThisPoll = maxAlertsPerChasePerPoll();
      const candidates: AlertCandidate[] = [];

      for (const listing of listings) {
      const targetCurrency = normalizeSupportedCurrency(settings.alertCurrency);
      const normalizedListing = normalizeListingCurrency(listing, targetCurrency);

      const match = matchChaseToListing(chase, normalizedListing);
      if (!match.isMatch) continue;
      if (match.score < settings.minScore) {
        markMinScoreSuppression();
        continue;
      }

      if (hasAlertBeenSent(chase.id, listing.listingId, listing.source)) continue;
      const nowMs = Date.now();
      const listingFingerprint = makeListingFingerprint(listing.title);
      if (listingFingerprint && isListingFingerprintIgnored(chase.userId, chase.id, listingFingerprint)) {
        markFingerprintSuppression();
        continue;
      }
      if (listingFingerprint && wasFingerprintSeenRecently(chase.id, listingFingerprint, nowMs)) {
        markFingerprintSuppression();
        continue;
      }

      const candidateBase = {
        listing,
        normalizedListing,
        match,
        targetCurrency,
        listingFingerprint
      };
      candidates.push({
        ...candidateBase,
        rankScore: rankAlertCandidate(candidateBase, chase)
      });
      }

      candidates.sort((a, b) => b.rankScore - a.rankScore);
      const orderedCandidates = orderAlertCandidatesForSending(candidates);

      for (const candidate of orderedCandidates) {
      if (sentForChaseThisPoll >= maxForChaseThisPoll) {
        markChaseCooldownSuppression();
        break;
      }

      const maxAlertsPerHour = settings.maxAlertsPerHour;
      if (countUserAlertsInLastHour(chase.userId) >= maxAlertsPerHour) {
        await sendThrottleNoticeIfNeeded(client, chase.userId, maxAlertsPerHour);
        break;
      }

      const targetCurrency = candidate.targetCurrency;
      const destination = shippingDestinationFromSettings(settings);
      const listing = await enrichSelectedAlertListing(candidate.listing, destination);
      if (shouldSuppressForDestinationShipping(listing, destination)) continue;
      const normalizedListing = normalizeListingCurrency(listing, targetCurrency);
      const match = matchChaseToListing(chase, normalizedListing);
      if (!match.isMatch || match.score < settings.minScore) continue;
      const listingFingerprint = candidate.listingFingerprint;
      const nowMs = Date.now();
      if (listingFingerprint && wasFingerprintSeenRecently(chase.id, listingFingerprint, nowMs)) {
        markFingerprintSuppression();
        continue;
      }
      if (!claimAlertForSending(chase.id, chase.userId, listing.listingId, listing.source)) {
        markFingerprintSuppression();
        continue;
      }
      if (
        listingFingerprint &&
        !claimUserAlertFingerprintForSending(chase.userId, listingFingerprint, listing.listingId, listing.source)
      ) {
        releaseIncompleteAlertSendClaim(chase.id, listing.listingId, listing.source);
        markFingerprintSuppression();
        continue;
      }
      if (listingFingerprint) markFingerprintSeen(chase.id, listingFingerprint, nowMs);

      const sourceLabel = listing.source === 'EBAY' ? 'eBay' : listing.seller ?? 'Trusted shop';
      const { icon: sightingIcon, label: sightingLabel } = sightingPresentation(chase.priority);
      const reasonSummary = splitReasons(match.reasons);
      const watchoutLines = reasonSummary.risk === 'None' ? [] : [`**Watchouts:** ${reasonSummary.risk}`];
      const embed = new EmbedBuilder()
        .setColor(VAULTR_ALERT_COLOR)
        .setTitle(`${sightingIcon} ${sightingLabel} · ${sourceLabel}`)
        .setDescription(
          `**${truncateTitle(listing.title)}**\n${summarizeWhyMatched(
            match.score,
            normalizedListing.price,
            normalizedListing.shippingCost,
            chase.maxPrice,
            targetCurrency,
            listing.postedAt
          )}`
        );

      if (USE_COMPACT_ALERT_LAYOUT) {
        embed.addFields(
          {
            name: '📌 Summary',
            value: [
              `**Chase:** ${truncateTitle(chase.cardName, 60)}`,
              `**Price:** ${formatMoney(normalizedListing.price, targetCurrency)}`,
              `**Total:** ${
                formatTotalCost(normalizedListing.price, normalizedListing.shippingCost) !== undefined
                  ? formatMoney(formatTotalCost(normalizedListing.price, normalizedListing.shippingCost), targetCurrency)
                  : 'Unknown'
              }`,
              `**Posted:** ${formatPostedAge(listing.postedAt)}`,
              `**Source:** ${sourceLabel}`,
              `**Confidence:** ${formatScoreWithQuality(match.score)}`,
              `**Signals:** ${reasonSummary.positive}`,
              ...watchoutLines,
              `**Takeaway:** ${explainDealQuality(match.score)}`
            ].join('\n'),
            inline: false
          }
        );
      } else {
        embed.addFields(
          {
            name: '🎯 Chase Details',
            value: [
              `**Chase:** ${truncateTitle(chase.cardName, 60)}`,
              `**Priority:** ${chase.priority ?? 'NORMAL'}`,
              `**Note:** ${chase.targetNote ? truncateTitle(chase.targetNote, 80) : 'None'}`
            ].join('\n'),
            inline: false
          },
          {
            name: '💰 Pricing Breakdown',
            value: [
              `**Price:** ${formatMoney(normalizedListing.price, targetCurrency)}`,
              `**Shipping:** ${formatShippingCost(normalizedListing.shippingCost, targetCurrency)}`,
              `**Total:** ${
                formatTotalCost(normalizedListing.price, normalizedListing.shippingCost) !== undefined
                  ? formatMoney(formatTotalCost(normalizedListing.price, normalizedListing.shippingCost), targetCurrency)
                  : 'Unknown'
              }`,
              `**Total vs Max:** ${formatPriceVsMax(
                normalizedListing.price,
                normalizedListing.shippingCost,
                chase.maxPrice,
                targetCurrency
              )}`,
              `**Listing Type:** ${formatListingType(normalizedListing.listingType)}`
            ].join('\n'),
            inline: false
          },
          {
            name: '📸 Listing Snapshot',
            value: [
              `**Posted:** ${formatPostedAge(listing.postedAt)}`,
              `**Source:** ${sourceLabel}`,
              `**Region:** ${listing.region}`,
              `**Seller:** ${listing.seller ?? 'Unavailable from source'}`,
              `**Seller Feedback:** ${formatSellerFeedbackPercent(listing.sellerFeedbackPercent)}${
                listing.sellerFeedbackScore !== undefined ? ` (${listing.sellerFeedbackScore})` : ''
              }`
            ].join('\n'),
            inline: false
          },
          {
            name: '🧠 Match Insight',
            value: [
              `**Confidence:** ${formatScoreWithQuality(match.score)}`,
              `**Signals:** ${reasonSummary.positive}`,
              ...watchoutLines,
              `**Takeaway:** ${explainDealQuality(match.score)}`
            ].join('\n'),
            inline: false
          }
        );
      }

      embed.setTimestamp().setFooter({ text: `Vaultr • ${sightingLabel}` });

      if (SHOW_ALERT_IMAGES) {
        if (listing.imageUrl && /^https?:\/\//i.test(listing.imageUrl)) {
          embed.setImage(listing.imageUrl);
        } else if (listing.thumbnailUrl && /^https?:\/\//i.test(listing.thumbnailUrl)) {
          embed.setThumbnail(listing.thumbnailUrl);
        }
      }

      try {
        const user = await client.users.fetch(chase.userId);
        await withTimeout(
          user.send({
            embeds: [embed],
            components: [listingLinkButton(listing.url), alertFeedbackButtons(chase.id, listing.listingId)]
          }),
          10000,
          'DM send timeout'
        );
        const sourceObservation = getSourceObservationForItem(chase.id, listing.listingId);
        const sentAtMs = Date.now();
        updateSentAlertDetails(chase.id, listing.listingId, listing.source, {
          guildId: chase.guildId,
          listingTitle: listing.title,
          listingPrice: normalizedListing.price,
          listingCurrency: targetCurrency,
          priceDelta:
            chase.maxPrice !== undefined &&
            comparablePrice(normalizedListing.price, normalizedListing.shippingCost) <= chase.maxPrice
              ? Number((chase.maxPrice - comparablePrice(normalizedListing.price, normalizedListing.shippingCost)).toFixed(2))
              : undefined,
          listingUrl: listing.url,
          matchScore: match.score,
          listingPostedAt: listing.postedAt,
          alertLatencySeconds: alertLatencySeconds(listing.postedAt, sentAtMs),
          sourceFirstSeenAt: sourceObservation?.firstSeenAt,
          sourceLastSeenAt: sourceObservation?.lastSeenAt,
          sourceRank: sourceObservation?.sourceRank
        });
        sentForChaseThisPoll += 1;
        markPollerMatchSent();
      } catch (error) {
        releaseIncompleteAlertSendClaim(chase.id, listing.listingId, listing.source);
        if (listingFingerprint) {
          releaseUserAlertFingerprintSendClaim(chase.userId, listingFingerprint, listing.listingId, listing.source);
        }
        console.error(`Failed to send DM alert to user ${chase.userId}`, error);
      }
    }
      await sendChaseTuningNoticeIfNeeded(client, chase, sentForChaseThisPoll, orderedCandidates.length, maxForChaseThisPoll);
    }
  }

  markPollerRunSuccess(Date.now() - startedAt);
  pruneSourceObservations(sourceObservationRetentionDays());
}

function currentDayKeyLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentWeekKeyLocal(now = new Date()): string {
  const local = new Date(now);
  const day = local.getDay();
  const shiftToMonday = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + shiftToMonday);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-W-${m}-${d}`;
}

function localStartOfWeekIso(now = new Date()): string {
  const local = new Date(now);
  const day = local.getDay();
  const shiftToMonday = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + shiftToMonday);
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function truncateForEmbed(value: string, maxLength = 200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function dailyPulseLine(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  const parts: string[] = [];
  if (stats.newVaultrs > 0) parts.push(`${pluralize(stats.newVaultrs, 'new Vault')} opened`);
  if (stats.matches > 0) parts.push(`${pluralize(stats.matches, 'chase alert')} reached ${pluralize(stats.usersAlerted, 'collector')}`);
  else if (stats.usersAlerted > 0) parts.push(`${pluralize(stats.usersAlerted, 'collector')} received chase alerts`);
  if (stats.grailsSurfaced > 0) parts.push(`${pluralize(stats.grailsSurfaced, 'grail')} surfaced`);
  if (parts.length === 0) return 'Quiet day in the Vault';
  return parts.join(' • ');
}

function dailyPulseMood(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  if (stats.grailsSurfaced > 0) return `The day's sharpest movement centered on ${stats.topTrackedTheme.toLowerCase()}`;
  if (stats.newVaultrs > 0 && stats.usersAlerted > 0) return 'New Vaults joined while active chases found fresh listings';
  if (stats.usersAlerted > 0) return 'Fresh listings crossed the feed today';
  if (stats.newVaultrs > 0) return 'New collectors joined the chase board today';
  return 'No new alerts or joins today';
}

function dailyPulseActivityLines(stats: ReturnType<typeof getGuildCommunityStatsToday>): string[] {
  const lines: string[] = [];
  if (stats.newVaultrs > 0) lines.push(`• New Vaults: ${pluralize(stats.newVaultrs, 'collector')} joined`);
  if (stats.usersAlerted > 0) {
    const sightingDetail = stats.matches > 0 ? `${pluralize(stats.matches, 'listing')} reached ${pluralize(stats.usersAlerted, 'collector')}` : `${pluralize(stats.usersAlerted, 'collector')} received a chase alert`;
    lines.push(`• ${sightingDetail}`);
  }
  if (stats.grailsSurfaced > 0) lines.push(`• Grail watch: ${pluralize(stats.grailsSurfaced, 'grail')} surfaced`);
  if (stats.activeVaults > 0 || stats.activeChases > 0) lines.push(`• ${pluralize(stats.activeChases, 'chase', 'chases')} stayed active across ${pluralize(stats.activeVaults, 'Vault')}`);
  return lines.length > 0 ? lines : ['• No active watchlist yet'];
}

function dailyPulseWatchlistDensity(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  if (stats.activeVaults <= 0 || stats.activeChases <= 0) return 'light';
  const density = stats.activeChases / Math.max(1, stats.activeVaults);
  if (density >= 8) return 'stacked';
  if (density >= 5) return 'busy';
  if (density >= 3) return 'steady';
  return 'light';
}

function dailyPulseCollectorBoardShape(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  if (stats.activeTrackedFamily !== 'Mixed collections') return stats.activeTrackedFamily;
  if (stats.topTrackedFamily !== 'Mixed collections') return stats.topTrackedFamily;
  return 'Mixed collections';
}

function dailyPulseCollectorCurrent(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  const hasAlertsToday = stats.matches > 0 || stats.usersAlerted > 0 || stats.grailsSurfaced > 0;
  const boardShape = dailyPulseCollectorBoardShape(stats);
  const density = dailyPulseWatchlistDensity(stats);
  const boardIsMixed = boardShape === 'Mixed collections';
  const themeIsMixed = stats.topTrackedTheme === 'Varied styles';
  const alertSignal = stats.todayAlertFamily === 'Mixed finds'
    ? stats.todayAlertTheme
    : `${stats.todayAlertTheme} in ${stats.todayAlertFamily}`;

  if (hasAlertsToday && !boardIsMixed) {
    if (stats.grailsSurfaced > 0) {
      return `Today's alerts leaned ${alertSignal}, while the wider board still sits around ${boardShape}.`;
    }
    return `Fresh movement came through ${alertSignal}; the watchlist behind it is still ${density} around ${boardShape}.`;
  }

  if (hasAlertsToday && boardIsMixed) {
    if (themeIsMixed) return `Fresh movement came through ${alertSignal}, but the board still reads broad rather than locked onto one lane.`;
    return `Fresh movement came through ${alertSignal}; the wider board still tilts toward ${stats.topTrackedTheme.toLowerCase()}.`;
  }

  if (!boardIsMixed) {
    if (stats.activeVaults > 0 && stats.activeChases > 0) {
      return `${pluralize(stats.activeChases, 'chase', 'chases')} are keeping the board ${density} around ${boardShape}, even on a quieter day.`;
    }
    return `The board is still centered on ${boardShape}.`;
  }

  if (themeIsMixed) {
    if (stats.activeVaults > 0 && stats.activeChases > 0) {
      return `${pluralize(stats.activeChases, 'chase', 'chases')} are still spread across ${pluralize(stats.activeVaults, 'Vault')}; no single collector lane took over today.`;
    }
    return 'The board stayed mixed; no single path led today.';
  }

  return `The board stayed broad, with the strongest pull still landing around ${stats.topTrackedTheme.toLowerCase()}.`;
}

function dailyPulseSpotlight(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  const spotlight = truncateForEmbed(stats.hiddenDiscovery, 180).replace(/\.+$/, '');
  if (spotlight !== 'No standout listing today') return spotlight;

  const boardShape = dailyPulseCollectorBoardShape(stats);
  const density = dailyPulseWatchlistDensity(stats);
  const boardIsMixed = boardShape === 'Mixed collections';
  const themeIsMixed = stats.topTrackedTheme === 'Varied styles';

  if (!boardIsMixed && stats.activeChases > 0) {
    return `Quiet alert-wise, but ${boardShape} still carries the board with a ${density} watchlist behind it.`;
  }

  if (!themeIsMixed && stats.activeChases > 0) {
    return `Quiet alert-wise, but the board still leans ${stats.topTrackedTheme.toLowerCase()} across ${pluralize(stats.activeChases, 'chase', 'chases')}.`;
  }

  if (stats.activeVaults > 0 && stats.activeChases > 0) {
    return `${pluralize(stats.activeChases, 'chase', 'chases')} stayed active across ${pluralize(stats.activeVaults, 'Vault')}, even without a single standout listing today.`;
  }

  return spotlight;
}

export function buildDailyPulseEmbed(stats: ReturnType<typeof getGuildCommunityStatsToday>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle('💓 Vault Pulse')
    .setDescription([dailyPulseLine(stats), dailyPulseMood(stats)].join('\n'))
    .addFields(
      keyValue('Today’s Movement', dailyPulseActivityLines(stats).join('\n')),
      keyValue('Collector Signal', dailyPulseCollectorCurrent(stats)),
      keyValue('Spotlight', dailyPulseSpotlight(stats))
    )
    .setFooter({ text: 'Vaultr • Pulse' })
    .setTimestamp();
}

export function shouldPostDailyPulse(stats: ReturnType<typeof getGuildCommunityStatsToday>): boolean {
  return stats.newVaultrs > 0 || stats.usersAlerted > 0 || stats.matches > 0 || stats.grailsSurfaced > 0 || stats.activeVaults > 0 || stats.activeChases > 0;
}

async function maybePostDailyCommunityStats(client: Client): Promise<void> {
  const enabled = (process.env.COMMUNITY_STATS_DAILY_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) return;

  const hour = Number(process.env.COMMUNITY_STATS_DAILY_HOUR_LOCAL ?? '20');
  const minute = Number(process.env.COMMUNITY_STATS_DAILY_MINUTE_LOCAL ?? '0');
  const now = new Date();

  if (now.getHours() !== hour || now.getMinutes() !== minute) return;

  const dayKey = currentDayKeyLocal(now);
  const guildChannels = listGuildCommandChannels();

  for (const { guildId, channelId } of guildChannels) {
    if (getGuildCommunityFeedMode(guildId) === 'OFF') continue;
    if (hasPostedGuildDailyStats(guildId, dayKey)) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('send' in channel)) continue;

    const stats = getGuildCommunityStatsToday(guildId);
    if (!shouldPostDailyPulse(stats)) continue;
    await channel.send({ embeds: [buildDailyPulseEmbed(stats)] });

    markPostedGuildDailyStats(guildId, dayKey);
  }
}

export function startPoller(client: Client): void {
  const pollIntervalSeconds = getRuntimePollIntervalSeconds();
  const intervalMs = pollIntervalSeconds * 1000;
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  initializePollerState(sourceMode, intervalMs / 1000);
  setBackoffUntil(null);

  const runWithGuard = async () => {
    if (getPollerState().isRunning) {
      markPollerOverlapSkip();
      return;
    }
    try {
      await runPoll(client);
    } catch (error) {
      console.error('Poller run failed', error);
      markPollerError(error);
    }
  };

  setInterval(() => {
    void runWithGuard();
  }, intervalMs);

  setInterval(() => {
    void maybePostDailyCommunityStats(client);
  }, 60 * 1000);

  void runWithGuard();

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
