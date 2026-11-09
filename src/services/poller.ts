import {
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getChaseLastPollCheckAt,
  getUserPlan,
  getUserAlertSettings,
  hasAlertBeenSent,
  listAllChases,
  isListingFingerprintIgnored,
  getSourceObservationForItem,
  claimAlertForSending,
  claimUserAlertFingerprintForSending,
  markChasesPollAttempted,
  markChasesPollChecked,
  enqueueAlertDelivery,
  getAlertEventById,
  listPendingAlertDeliveries,
  markAlertDeliveryFailed,
  markAlertDeliverySuppressed,
  markAlertDeliverySent,
  markAlertSentWithDetails,
  releaseIncompleteAlertSendClaim,
  upsertAlertEvent,
  pruneSourceObservations,
  recordSourceObservations
} from './chase-store.js';
import { ebayRateLimitRetryAfterMs, enrichEbayListingDetails, getCachedEbayListings, searchEbayListings, type ShippingDestination } from './ebay.js';
import { searchTrustedShopifyListingsDetailed, startTrustedShopifyCatalogWorker, type TrustedShopifySearchResult } from './shopify.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from './currency.js';
import { activePlanTier, getRuntimePollIntervalSeconds, monitoringPlanChases, PLAN_LIMITS } from './plans.js';
import { getEntitlementsForTier, type PlanEntitlements } from './entitlements.js';
import { CHASE_ALERT_COOLDOWN_MINUTES } from './alert-policy.js';
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
import { makeListingFingerprint } from './listing-fingerprint.js';
import { resolveDiscordUserId } from './accounts.js';
import { getUserNotificationSettings } from './notification-settings.js';
import { DiscordRestDeliveryError, sendDiscordDirectMessage } from './discord-rest-delivery.js';
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

function structuredReasonEvidence(reasons: string[]): { positiveSignals: string[]; warnings: string[] } {
  const warnings = reasons.filter(
    (reason) => reason.includes('penalty') || reason.startsWith('suspicious_terms:') || reason.includes('miss') || reason.includes('block')
  );
  const positiveSignals = reasons.filter((reason) => !warnings.includes(reason) && reason !== 'price_within_max');
  return {
    positiveSignals: positiveSignals.map((reason) => formatReasons([reason])),
    warnings: warnings.map((reason) => formatReasons([reason]))
  };
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

function truncateTitle(title: string, maxLen = 110): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}



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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const sourceCallTimestamps: number[] = [];
const recentFingerprintTimestamps = new Map<string, number>();
const lastSourceFetchAtMsByQueryKey = new Map<string, number>();
let backoffUntilMs = 0;

type ActiveGroup = {
  members: Array<{
    chase: Chase;
    settings: ReturnType<typeof getUserAlertSettings>;
    monitoringPriority: PlanEntitlements['monitoringPriority'];
  }>;
  sourceMode: string;
  oldestCreatedAt: string;
  oldestDueAtMs: number;
  oldestChaseName?: string;
  monitoringPriority?: PlanEntitlements['monitoringPriority'];
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
    const priorityDelta = (left.group.monitoringPriority === 'PRIORITY' ? 0 : 1)
      - (right.group.monitoringPriority === 'PRIORITY' ? 0 : 1);
    if (priorityDelta !== 0) return priorityDelta;

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

export function orderGroupMembersForRun<T extends { monitoringPriority?: PlanEntitlements['monitoringPriority'] }>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => {
    if (left.monitoringPriority === right.monitoringPriority) return 0;
    return left.monitoringPriority === 'PRIORITY' ? -1 : 1;
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

export function sourceQueryKey(chase: Chase, settings: ReturnType<typeof getUserAlertSettings>, sourceMode: string): string {
  const destination = shippingDestinationFromSettings(settings);
  return [
    sourceMode,
    chase.cardName.trim().toLowerCase(),
    chase.queryName?.trim().toLowerCase() ?? '',
    chase.grade?.trim().toLowerCase() ?? '',
    chase.condition?.trim().toLowerCase() ?? '',
    chase.listingType ?? 'ANY',
    Number.isFinite(Number(chase.maxPrice)) ? Number(chase.maxPrice).toFixed(2) : '',
    normalizeSupportedCurrency(settings.alertCurrency),
    destination?.country?.trim().toUpperCase() ?? '',
    destination?.postalCode?.trim().toUpperCase() ?? ''
  ].join('|');
}

function sourceModeIncludesTrustedShops(sourceMode: string): boolean {
  return sourceMode === 'SHOPIFY' || sourceMode === 'EBAY_SHOPIFY';
}

export type ListingProviderOutcome = {
  provider: 'MOCK' | 'EBAY' | 'SHOPIFY';
  status: 'SUCCESS' | 'EMPTY' | 'PARTIAL' | 'FAILURE' | 'DEFERRED';
  listingCount: number;
  reason?: string;
  diagnostics?: TrustedShopifySearchResult['shops'];
};

export type ListingSourceSearchResult = {
  listings: Listing[];
  providers: ListingProviderOutcome[];
  complete: boolean;
};

export function didFetchRequiredListingSource(result: ListingSourceSearchResult): boolean {
  return result.complete;
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

export function shouldApplyEbayBackoff(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|quota|ratelimiter/i.test(message);
}

function shopifyProviderOutcome(result: TrustedShopifySearchResult): ListingProviderOutcome {
  return {
    provider: 'SHOPIFY',
    status: result.status,
    listingCount: result.listings.length,
    reason: result.status === 'PARTIAL' ? 'Partial shop coverage' : result.status === 'FAILURE' ? 'Shop retrieval failed' : undefined,
    diagnostics: result.shops
  };
}

function sourceResult(listings: Listing[], providers: ListingProviderOutcome[]): ListingSourceSearchResult {
  return {
    listings,
    providers,
    complete: providers.every((provider) => provider.status === 'SUCCESS' || provider.status === 'EMPTY')
  };
}

function sourceOutcomeReason(result: ListingSourceSearchResult): string {
  if (result.providers.some((provider) => provider.status === 'DEFERRED' && provider.reason === 'Backoff')) return 'Backoff';
  if (result.providers.some((provider) => provider.status === 'DEFERRED' && provider.reason === 'Rate limit')) return 'Rate limit';
  if (result.providers.some((provider) => provider.reason === 'Source timeout')) return 'Source timeout';
  if (result.providers.some((provider) => provider.status === 'PARTIAL')) return 'Partial source coverage';
  return 'Source error';
}

export function listingSourceDiagnosticSummary(result: ListingSourceSearchResult): string {
  return result.providers.map((provider) => `${provider.provider}:${provider.status}:${provider.listingCount}`).join(',');
}

async function fetchListingsWithRetry(
  chase: Chase,
  sourceMode: string,
  destination?: ShippingDestination,
  alertCurrency?: string
): Promise<ListingSourceSearchResult> {
  const maxRequestsPerMinute = maxEbayRequestsPerMinute();
  const backoffBaseSeconds = Number(process.env.EBAY_BACKOFF_BASE_SECONDS ?? '900');
  const attempts = 2;
  if (sourceMode === 'MOCK') {
    const listings = searchMockListings(chase, destination);
    return sourceResult(listings, [{ provider: 'MOCK', status: listings.length > 0 ? 'SUCCESS' : 'EMPTY', listingCount: listings.length }]);
  }

  const includeShopify = sourceModeIncludesTrustedShops(sourceMode);
  const shopifyPromise = includeShopify ? searchTrustedShopifyListingsDetailed(chase) : undefined;
  if (sourceMode === 'SHOPIFY') {
    const shopify = await (shopifyPromise as Promise<TrustedShopifySearchResult>);
    return sourceResult(shopify.listings, [shopifyProviderOutcome(shopify)]);
  }

  let ebayOutcome: ListingProviderOutcome | undefined;
  let ebayListings: Listing[] = [];
  const ebayOptions = alertEbaySearchOptions(chase, alertCurrency);
  const cachedEbayListings = getCachedEbayListings(chase, destination, ebayOptions);
  const nowMs = Date.now();
  clearExpiredBackoff(nowMs);
  if (cachedEbayListings !== null) {
    ebayListings = cachedEbayListings;
    ebayOutcome = { provider: 'EBAY', status: ebayListings.length > 0 ? 'SUCCESS' : 'EMPTY', listingCount: ebayListings.length, reason: 'Cache hit' };
  } else if (nowMs < backoffUntilMs) {
    ebayOutcome = { provider: 'EBAY', status: 'DEFERRED', listingCount: 0, reason: 'Backoff' };
  } else if (!canCallSource(nowMs, maxRequestsPerMinute)) {
    markRateLimitSkip();
    ebayOutcome = { provider: 'EBAY', status: 'DEFERRED', listingCount: 0, reason: 'Rate limit' };
  }

  for (let attempt = 1; !ebayOutcome && attempt <= attempts; attempt += 1) {
    try {
      markSourceCall(Date.now());
      ebayListings = await withTimeout(searchEbayListings(chase, destination, ebayOptions), 30000, 'Listing source timeout');
      markSourceSuccessNow();
      ebayOutcome = { provider: 'EBAY', status: ebayListings.length > 0 ? 'SUCCESS' : 'EMPTY', listingCount: ebayListings.length };
    } catch (error) {
      if (shouldApplyEbayBackoff(error)) {
        const retryAfterMs = ebayRateLimitRetryAfterMs(error);
        const backoffMs = retryAfterMs ?? backoffBaseSeconds * 1000 * attempt;
        backoffUntilMs = Date.now() + backoffMs;
        setBackoffUntil(new Date(backoffUntilMs), retryAfterMs === undefined ? 'eBay rate limit' : 'eBay Retry-After');
      }
      if (attempt === attempts) {
        ebayOutcome = { provider: 'EBAY', status: 'FAILURE', listingCount: 0, reason: listingSourceFailureReason(error) };
        break;
      }
      await sleep(300 * attempt);
    }
  }

  const providers = [ebayOutcome as ListingProviderOutcome];
  let shopifyListings: Listing[] = [];
  if (shopifyPromise) {
    const shopify = await shopifyPromise;
    shopifyListings = shopify.listings;
    providers.push(shopifyProviderOutcome(shopify));
  }
  return sourceResult([...ebayListings, ...shopifyListings], providers);
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
  const intro = `**${truncateTitle(chase.cardName, 80)}** surfaced ${eligibleCandidates} eligible listings, so KeepSeek sent the strongest ${sentForChaseThisPoll} this pass.`;
  if (activeTier === 'PRO') {
    return [
      intro,
      'If that feels noisy, tighten the chase name, lower the max price, add condition or grade details, or use custom exclusions for variants you do not want.',
      'You can also use `/alerts settings` to raise confidence or lower alert volume.'
    ];
  }

  return [
    intro,
    'If that feels noisy, tighten the chase name or lower the max price so KeepSeek has a clearer target.',
    'For precision controls and custom exclusions, `/upgrade` explains KeepSeek Plus.'
  ];
}

function alertEventDeliveryDetails(event: NonNullable<ReturnType<typeof getAlertEventById>>): Parameters<typeof markAlertSentWithDetails>[4] {
  return {
    guildId: event.guildId,
    listingTitle: event.listingTitle,
    listingPrice: event.listingPrice,
    listingCurrency: event.listingCurrency,
    priceDelta: event.priceDelta,
    listingUrl: event.listingUrl,
    matchScore: event.matchScore,
    listingPostedAt: event.listingPostedAt,
    alertLatencySeconds: event.alertLatencySeconds,
    sourceFirstSeenAt: event.sourceFirstSeenAt,
    sourceLastSeenAt: event.sourceLastSeenAt,
    sourceRank: event.sourceRank
  };
}

type DiscordAlertSender = (input: {
  token: string;
  discordUserId: string;
  event: NonNullable<ReturnType<typeof getAlertEventById>>;
  webBaseUrl: string;
}) => Promise<{ messageId: string }>;

let lastDiscordDeliveryConfigurationIssue: string | undefined;

function discordDeliveryConfiguration(): { token: string; webBaseUrl: string } | { issue: string } {
  const token = process.env.DISCORD_TOKEN?.trim();
  const webBaseUrl = process.env.VAULTR_WEB_BASE_URL?.trim();
  const missing = [!token ? 'DISCORD_TOKEN' : '', !webBaseUrl ? 'VAULTR_WEB_BASE_URL' : ''].filter(Boolean);
  return missing.length > 0 ? { issue: `Missing ${missing.join(' and ')}` } : { token: token!, webBaseUrl: webBaseUrl! };
}

export function resetDiscordDeliveryConfigurationWarningForTests(): void {
  lastDiscordDeliveryConfigurationIssue = undefined;
}

export function discordDeliveryRetryPlan(
  error: unknown,
  attempts: number,
  nowMs = Date.now()
): { nextAttemptAt?: string; incrementAttempt: boolean } {
  if (error instanceof DiscordRestDeliveryError && !error.retryable) {
    return { incrementAttempt: true };
  }
  const rateLimited = error instanceof DiscordRestDeliveryError && error.statusCode === 429;
  const incrementAttempt = !rateLimited;
  if (incrementAttempt && attempts + 1 >= 5) return { incrementAttempt };
  const exponentialDelayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts));
  const delayMs = rateLimited
    ? Math.min(24 * 60 * 60_000, Math.max(1_000, error.retryAfterMs ?? 60_000))
    : exponentialDelayMs;
  return { incrementAttempt, nextAttemptAt: new Date(nowMs + delayMs).toISOString() };
}

export async function processPendingDiscordAlertDeliveries(
  limit = 10,
  sender: DiscordAlertSender = sendDiscordDirectMessage,
  now = new Date()
): Promise<{ sent: number; failed: number; skipped: number }> {
  const deliveries = listPendingAlertDeliveries('DISCORD_DM', limit, now.toISOString());
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  if (deliveries.length === 0) return { sent, failed, skipped };

  const deliverable: Array<{
    delivery: (typeof deliveries)[number];
    event: NonNullable<ReturnType<typeof getAlertEventById>>;
    discordUserId: string;
  }> = [];
  for (const delivery of deliveries) {
    const event = getAlertEventById(delivery.alertId);
    if (!event) {
      markAlertDeliveryFailed(delivery.id, new Error('Missing alert event for pending delivery'));
      failed += 1;
      continue;
    }
    if (!event.listingUrl) {
      markAlertDeliveryFailed(delivery.id, new Error('Missing listing URL for pending delivery'));
      failed += 1;
      continue;
    }

    const notificationSettings = getUserNotificationSettings(event.userId);
    if (!notificationSettings.discordCardAlertsEnabled || !notificationSettings.discordLinked) {
      markAlertDeliverySuppressed(delivery.id, notificationSettings.discordCardAlertsEnabled ? 'Discord identity not linked' : 'Discord card alerts disabled');
      skipped += 1;
      continue;
    }

    const discordUserId = resolveDiscordUserId(event.userId);
    if (!discordUserId) {
      markAlertDeliveryFailed(delivery.id, new Error('Missing linked Discord identity for pending delivery'));
      failed += 1;
      continue;
    }
    deliverable.push({ delivery, event, discordUserId });
  }
  if (deliverable.length === 0) return { sent, failed, skipped };

  const configuration = discordDeliveryConfiguration();
  if ('issue' in configuration) {
    if (lastDiscordDeliveryConfigurationIssue !== configuration.issue) {
      console.warn(`[discord-delivery] Pausing queued DMs: ${configuration.issue}`);
      lastDiscordDeliveryConfigurationIssue = configuration.issue;
    }
    return { sent, failed, skipped };
  }
  if (lastDiscordDeliveryConfigurationIssue) {
    console.info('[discord-delivery] Discord DM configuration restored; queued delivery resumed');
    lastDiscordDeliveryConfigurationIssue = undefined;
  }

  for (const { delivery, event, discordUserId } of deliverable) {
    try {
      const message = await withTimeout(
        sender({ token: configuration.token, discordUserId, event, webBaseUrl: configuration.webBaseUrl }),
        10000,
        'Pending DM delivery timeout'
      );
      markAlertSentWithDetails(event.chaseId, event.userId, event.listingId, event.source, alertEventDeliveryDetails(event));
      markAlertDeliverySent(delivery.id, { externalMessageId: message.messageId });
      sent += 1;
    } catch (error) {
      const retry = discordDeliveryRetryPlan(error, delivery.attempts, now.getTime());
      markAlertDeliveryFailed(delivery.id, error, now.toISOString(), retry);
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}

export async function runPoll(): Promise<void> {
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
    for (const chase of monitoringPlanChases(userChases, userPlan)) {
      activeChaseIds.add(chase.id);
    }
  }

  const activeGroups = new Map<string, ActiveGroup>();
  for (const chase of chases) {
    if (!activeChaseIds.has(chase.id)) continue;
    const userPlan = getUserPlan(chase.userId);
    const tier = activePlanTier(userPlan);
    const monitoringPriority = getEntitlementsForTier(tier).monitoringPriority;
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
    const group = activeGroups.get(key) ?? {
      members: [],
      sourceMode: memberSourceMode,
      oldestCreatedAt: chase.createdAt,
      oldestDueAtMs: dueAtMs,
      oldestChaseName: chase.cardName,
      monitoringPriority
    };
    group.members.push({ chase, settings, monitoringPriority });
    if (monitoringPriority === 'PRIORITY') group.monitoringPriority = 'PRIORITY';
    if (chase.createdAt.localeCompare(group.oldestCreatedAt) < 0) {
      group.oldestCreatedAt = chase.createdAt;
    }
    if (dueAtMs < group.oldestDueAtMs) {
      group.oldestDueAtMs = dueAtMs;
      group.oldestChaseName = chase.cardName;
    }
    activeGroups.set(key, group);
  }

  for (const group of activeGroups.values()) {
    group.members = orderGroupMembersForRun(group.members);
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
      const sourceResult = await fetchListingsWithRetry(
        representative,
        group.sourceMode,
        shippingDestinationFromSettings(representativeSettings),
        representativeSettings.alertCurrency
      );
      listings = sourceResult.listings;
      const didFetchListings = didFetchRequiredListingSource(sourceResult);
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
        lastSourceFetchAtMsByQueryKey.set(queryKey, Date.now());
        const observedAt = new Date().toISOString();
        if (sourceResult.providers.some((provider) => provider.status === 'SUCCESS' || provider.status === 'EMPTY' || provider.status === 'PARTIAL')) {
          for (const { chase } of group.members) {
            recordSourceObservations({
              chaseId: chase.id,
              userId: chase.userId,
              sourceMode: group.sourceMode,
              queryKey,
              listings,
              observedAt
            });
          }
        }
        const reason = sourceOutcomeReason(sourceResult);
        pruneSourceCallWindow(Date.now());
        const sourceBudgetState = { calls: sourceCallTimestamps.length, budget: maxEbayRequestsPerMinute() };
        markCoverageDeferred(coverage, queryKey, group, nowMs, reason, sourceBudgetState);
        logSourceGroupDeferral(queryKey, group, reason, sourceBudgetState);
        console.warn(`[Poller] Source outcome ${listingSourceDiagnosticSummary(sourceResult)}`);
        if (listings.length === 0) continue;
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
      const reasonSummary = splitReasons(match.reasons);
      const reasonEvidence = structuredReasonEvidence(match.reasons);

      const alertImageUrl = listing.imageUrl && /^https?:\/\//i.test(listing.imageUrl)
        ? listing.imageUrl
        : listing.thumbnailUrl && /^https?:\/\//i.test(listing.thumbnailUrl)
          ? listing.thumbnailUrl
          : undefined;

      const sourceObservation = getSourceObservationForItem(chase.id, listing.listingId);
      const sentAtMs = Date.now();
      const priceDelta =
        chase.maxPrice !== undefined &&
        comparablePrice(normalizedListing.price, normalizedListing.shippingCost) <= chase.maxPrice
          ? Number((chase.maxPrice - comparablePrice(normalizedListing.price, normalizedListing.shippingCost)).toFixed(2))
          : undefined;
      const verifiedTotal = normalizedListing.shippingCost === undefined
        ? undefined
        : Number((normalizedListing.price + normalizedListing.shippingCost).toFixed(2));
      const comparisonBasis = verifiedTotal === undefined ? 'ITEM_PRICE' : 'VERIFIED_TOTAL';
      const alertDetails = {
        guildId: chase.guildId,
        listingTitle: listing.title,
        listingPrice: normalizedListing.price,
        listingCurrency: targetCurrency,
        priceDelta,
        listingUrl: listing.url,
        listingImageUrl: alertImageUrl,
        matchScore: match.score,
        listingPostedAt: listing.postedAt,
        alertLatencySeconds: alertLatencySeconds(listing.postedAt, sentAtMs),
        sourceFirstSeenAt: sourceObservation?.firstSeenAt,
        sourceLastSeenAt: sourceObservation?.lastSeenAt,
        sourceRank: sourceObservation?.sourceRank
      };
      const { alertId } = upsertAlertEvent({
        userId: chase.userId,
        chaseId: chase.id,
        listingId: listing.listingId,
        source: listing.source,
        chaseName: chase.cardName,
        chasePriority: chase.priority,
        ...alertDetails,
        payload: {
          sourceLabel,
          reasonSummary,
          matchReasons: match.reasons,
          details: {
            chase: {
              targetNote: chase.targetNote,
              maxPrice: chase.maxPrice,
              condition: chase.condition,
              grade: chase.grade,
              listingType: chase.listingType
            },
            pricing: {
              itemPrice: normalizedListing.price,
              shipping: normalizedListing.shippingCost,
              total: verifiedTotal,
              currency: targetCurrency,
              comparisonBasis,
              amountUnderMax: priceDelta
            },
            listing: {
              sourceLabel,
              seller: listing.seller,
              sellerFeedbackPercent: listing.sellerFeedbackPercent,
              sellerFeedbackScore: listing.sellerFeedbackScore,
              region: listing.region,
              listingType: listing.listingType,
              condition: listing.condition
            },
            match: {
              score: match.score,
              positiveSignals: reasonEvidence.positiveSignals,
              warnings: reasonEvidence.warnings,
              explanation: reasonSummary.positive === 'None'
                ? 'This listing cleared your saved Watchlist filters.'
                : `Matched because of ${reasonSummary.positive}.`
            }
          }
        }
      });
      const notificationSettings = getUserNotificationSettings(chase.userId);
      const discordUserId = notificationSettings.discordCardAlertsEnabled ? resolveDiscordUserId(chase.userId) : null;
      if (!discordUserId) {
        sentForChaseThisPoll += 1;
        markPollerMatchSent();
        continue;
      }
      enqueueAlertDelivery({
        alertId,
        userId: chase.userId,
        channel: 'DISCORD_DM'
      });
      sentForChaseThisPoll += 1;
      markPollerMatchSent();
    }
    }
  }

  markPollerRunSuccess(Date.now() - startedAt);
  pruneSourceObservations(sourceObservationRetentionDays());
}

export function startPoller(): void {
  const pollIntervalSeconds = getRuntimePollIntervalSeconds();
  const intervalMs = pollIntervalSeconds * 1000;
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  initializePollerState(sourceMode, intervalMs / 1000);
  setBackoffUntil(null);
  startTrustedShopifyCatalogWorker();

  const runWithGuard = async () => {
    if (getPollerState().isRunning) {
      markPollerOverlapSkip();
      return;
    }
    try {
      await runPoll();
      await processPendingDiscordAlertDeliveries();
    } catch (error) {
      console.error('Poller run failed', error);
      markPollerError(error);
    }
  };

  setInterval(() => {
    void runWithGuard();
  }, intervalMs);

  void runWithGuard();

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
