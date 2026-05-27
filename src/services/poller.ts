import { Client, EmbedBuilder } from 'discord.js';
import {
  getGuildCommunityStatsToday,
  getUserWeeklyReflectionSummary,
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getChaseLastPollCheckAt,
  getUserPlan,
  getUserAlertSettings,
  getGuildCommunityFeedMode,
  hasAlertBeenSent,
  hasPostedGuildDailyStats,
  hasPostedUserWeeklyReflection,
  listGuildCommandChannels,
  listUsersWithChases,
  listAllChases,
  isListingFingerprintIgnored,
  markPostedGuildDailyStats,
  markPostedUserWeeklyReflection,
  markChasesPollChecked,
  markAlertSentWithDetails
} from './chase-store.js';
import { searchEbayListings, type ShippingDestination } from './ebay.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from './currency.js';
import { PLAN_LIMITS } from './plans.js';
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
  setSourceCallsLastMinute
} from './poller-state.js';
import { alertFeedbackButtons, keyValue, listingLinkButton, warningEmbed } from '../ui/embeds.js';
import { makeListingFingerprint } from './listing-fingerprint.js';
import type { Chase, Listing } from '../types.js';

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
      return { icon: '🏆', label: 'Grail Sighting' };
    case 'HIGH':
      return { icon: '🔥', label: 'Priority Sighting' };
    case 'NORMAL':
    default:
      return { icon: '🚨', label: 'Chase Sighting' };
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

function formatShippingEligibility(listing: Listing): string {
  if (!listing.shippingEligibility) return 'Unknown';
  if (listing.shippingEligibilityMessage) return listing.shippingEligibilityMessage;
  if (listing.shippingEligibility === 'AVAILABLE') return 'Shipping shown for your location';
  if (listing.shippingEligibility === 'MAY_NOT_SHIP') return 'May not ship to your location';
  return 'Shipping availability is unknown';
}

function formatTotalCost(price: number, shippingCost: number | undefined): number | undefined {
  if (shippingCost === undefined || Number.isNaN(shippingCost)) return undefined;
  return price + shippingCost;
}

function formatMoney(amount: number | undefined, currency: string): string {
  if (amount === undefined || Number.isNaN(amount)) return 'Unknown';
  return `${amount.toFixed(2)} ${currency}`;
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

function isInQuietHours(start: number | undefined, end: number | undefined): boolean {
  if (start === undefined || end === undefined) return false;
  const hour = new Date().getHours();
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const sourceCallTimestamps: number[] = [];
const throttleNoticeTimestampsByUser = new Map<string, number>();
const recentFingerprintTimestamps = new Map<string, number>();
const lastSourceFetchAtMsByQueryKey = new Map<string, number>();
let backoffUntilMs = 0;

type ActiveGroup = {
  members: Array<{ chase: Chase; settings: ReturnType<typeof getUserAlertSettings> }>;
  oldestCreatedAt: string;
};

export function orderGroupsForRun(
  groups: ReadonlyArray<{ queryKey: string; group: ActiveGroup; lastSourceFetchAtMs?: number }>
): Array<{ queryKey: string; group: ActiveGroup; lastSourceFetchAtMs?: number }> {
  return [...groups].sort((left, right) => {
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

function shippingDestinationFromSettings(settings: ReturnType<typeof getUserAlertSettings>): ShippingDestination | undefined {
  if (!settings.shippingCountry) return undefined;
  return {
    country: settings.shippingCountry,
    postalCode: settings.shippingPostalCode
  };
}

function sourceQueryKey(chase: Chase, settings: ReturnType<typeof getUserAlertSettings>): string {
  const destination = shippingDestinationFromSettings(settings);
  return [
    chase.cardName.trim().toLowerCase(),
    chase.grade?.trim().toLowerCase() ?? '',
    destination?.country?.trim().toUpperCase() ?? '',
    destination?.postalCode?.trim().toUpperCase() ?? ''
  ].join('|');
}

async function fetchListingsWithRetry(chase: Chase, sourceMode: string, destination?: ShippingDestination): Promise<Listing[]> {
  const maxRequestsPerMinute = Number(process.env.EBAY_MAX_REQUESTS_PER_MINUTE ?? '20');
  const backoffBaseSeconds = Number(process.env.EBAY_BACKOFF_BASE_SECONDS ?? '30');
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (sourceMode === 'MOCK') return searchMockListings(chase, destination);
      const nowMs = Date.now();
      if (nowMs < backoffUntilMs) {
        return [];
      }
      if (!canCallSource(nowMs, maxRequestsPerMinute)) {
        markRateLimitSkip();
        return [];
      }
      markSourceCall(nowMs);
      const listings = await withTimeout(searchEbayListings(chase, destination), 10000, 'Listing source timeout');
      markSourceSuccessNow();
      return listings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
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
            `Your Vault surfaced ${maxAlertsPerHour} sightings in the last hour. To quiet the signal, add card details, raise \`min_score\`, or tighten available chase filters.`
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

async function runPoll(client: Client): Promise<void> {
  const startedAt = Date.now();
  const nowMs = Date.now();
  markPollerRunStart();
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  const chases = listAllChases();
  if (chases.length === 0) {
    markPollerRunSuccess(Date.now() - startedAt);
    return;
  }

  const activeGroups = new Map<string, ActiveGroup>();
  for (const chase of chases) {
    const userPlan = getUserPlan(chase.userId);
    const intervalSeconds = PLAN_LIMITS[userPlan.tier].pollIntervalSeconds;
    const lastCheckedAtIso = getChaseLastPollCheckAt(chase.id);
    const lastCheckedAtMs = lastCheckedAtIso ? new Date(lastCheckedAtIso).getTime() : undefined;
    if (!isDueForPollInterval(Number.isFinite(lastCheckedAtMs) ? lastCheckedAtMs : undefined, intervalSeconds, nowMs)) continue;

    const settings = getUserAlertSettings(chase.userId);
    if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) continue;
    const key = sourceQueryKey(chase, settings);
    const group = activeGroups.get(key) ?? { members: [], oldestCreatedAt: chase.createdAt };
    group.members.push({ chase, settings });
    if (chase.createdAt.localeCompare(group.oldestCreatedAt) < 0) {
      group.oldestCreatedAt = chase.createdAt;
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

  for (const { queryKey, group } of orderedGroups) {
    const representative = group.members[0]?.chase;
    const representativeSettings = group.members[0]?.settings;
    if (!representative || !representativeSettings) continue;
    const sourceCallsBefore = sourceCallTimestamps.length;
    const listings = await fetchListingsWithRetry(
      representative,
      sourceMode,
      shippingDestinationFromSettings(representativeSettings)
    );
    const didFetchListings = sourceMode === 'MOCK' || sourceCallTimestamps.length > sourceCallsBefore;
    if (didFetchListings) {
      const checkedAtIso = new Date().toISOString();
      lastSourceFetchAtMsByQueryKey.set(queryKey, Date.now());
      markChasesPollChecked(group.members.map(({ chase }) => chase.id), checkedAtIso);
    }

    for (const { chase, settings } of group.members) {
      if (settings.chaseCooldownMinutes > 0) {
        const recentForChase = countChaseAlertsWithinMinutes(chase.userId, chase.id, settings.chaseCooldownMinutes);
        if (recentForChase > 0) {
          markChaseCooldownSuppression();
          continue;
        }
      }

      let sentForChaseThisPoll = 0;
      const maxForChaseThisPoll = maxAlertsPerChasePerPoll();
      const candidates: AlertCandidate[] = [];

      for (const listing of listings) {
      const targetCurrency = normalizeSupportedCurrency(settings.alertCurrency);
      const normalizedListing = {
        ...listing,
        price: convertCurrencyAmount(listing.price, listing.currency, targetCurrency),
        currency: targetCurrency,
        shippingCost:
          listing.shippingCost === undefined
            ? undefined
            : convertCurrencyAmount(listing.shippingCost, listing.shippingCurrency ?? listing.currency, targetCurrency),
        shippingCurrency: targetCurrency
      };

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

      for (const candidate of candidates) {
      if (sentForChaseThisPoll >= maxForChaseThisPoll) {
        markChaseCooldownSuppression();
        break;
      }

      if (countUserAlertsInLastHour(chase.userId) >= settings.maxAlertsPerHour) {
        await sendThrottleNoticeIfNeeded(client, chase.userId, settings.maxAlertsPerHour);
        break;
      }

      const { listing, normalizedListing, match, targetCurrency, listingFingerprint } = candidate;
      const nowMs = Date.now();
      if (listingFingerprint && wasFingerprintSeenRecently(chase.id, listingFingerprint, nowMs)) {
        markFingerprintSuppression();
        continue;
      }

      const sourceLabel = listing.source === 'EBAY' ? 'eBay' : listing.source;
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

      if (settings.compactMode) {
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
              `**Shipping Destination:** ${listing.shippingDestinationPostalCode ?? 'Unknown'}`,
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
               `**Shipping Destination:** ${listing.shippingDestinationPostalCode ?? 'Unknown'}`,
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

      if (settings.showImages) {
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
        markAlertSentWithDetails(chase.id, chase.userId, listing.listingId, listing.source, {
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
          matchScore: match.score
        });
        if (listingFingerprint) markFingerprintSeen(chase.id, listingFingerprint, nowMs);
        sentForChaseThisPoll += 1;
        markPollerMatchSent();
      } catch (error) {
        console.error(`Failed to send DM alert to user ${chase.userId}`, error);
      }
    }
    }
  }

  markPollerRunSuccess(Date.now() - startedAt);
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
  if (stats.newVaultrs > 0) parts.push(`${pluralize(stats.newVaultrs, 'collector')} opened a Vault`);
  if (stats.usersAlerted > 0) parts.push(`${pluralize(stats.usersAlerted, 'collector')} received a sighting`);
  if (stats.grailsSurfaced > 0) parts.push(`${pluralize(stats.grailsSurfaced, 'grail')} surfaced`);
  if (parts.length === 0) return 'A quiet day in the Vault. Chases kept watching in the background.';
  return parts.join(' • ');
}

export function buildDailyPulseMessage(stats: ReturnType<typeof getGuildCommunityStatsToday>): string {
  return [
    '🗝️ **Vault Pulse**',
    dailyPulseLine(stats),
    '',
    '**Collector Current**',
    `• Thread: ${stats.topTrackedTheme}`,
    `• Family: ${stats.topTrackedFamily}`,
    '',
    '**Today\'s Spotlight**',
    `• ${truncateForEmbed(stats.hiddenDiscovery, 180)}`
  ].join('\n');
}

function weeklyReflectionIntro(summary: ReturnType<typeof getUserWeeklyReflectionSummary>): string {
  if (summary.alertsReceived === 0) {
    return 'Your Vault stayed quiet this week, but every chase still helped shape what Vaultr understands about your taste.';
  }
  return `Vaultr surfaced ${pluralize(summary.alertsReceived, 'sighting')} this week and kept tuning your collector profile around ${summary.topTasteTheme}.`;
}

function weeklyReflectionNote(summary: ReturnType<typeof getUserWeeklyReflectionSummary>): string {
  const notes: string[] = [];
  if (summary.newChasesAdded > 0) notes.push(`${pluralize(summary.newChasesAdded, 'new chase')} added new signal`);
  if (summary.grailsSurfaced > 0) notes.push(`${pluralize(summary.grailsSurfaced, 'grail')} surfaced`);
  if (notes.length === 0) return 'No major shifts this week. Your existing chases kept teaching Vaultr in the background.';
  return notes.join(' • ');
}

export function buildWeeklyReflectionEmbed(summary: ReturnType<typeof getUserWeeklyReflectionSummary>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🗝️ Vaultr Weekly')
    .setDescription(weeklyReflectionIntro(summary))
    .addFields(
      keyValue('Collector Thread', `${summary.topTasteTheme} • ${summary.topTasteFamily}`),
      keyValue('Taste Signals', weeklyReflectionNote(summary)),
      keyValue('Discovery Thread', truncateForEmbed(summary.recentDiscovery)),
      keyValue('Next Week', 'Keep your chases active. Every sighting and Tune Out helps Vaultr sharpen your collector profile.')
    )
    .setFooter({ text: 'Vaultr • Weekly collector profile' })
    .setTimestamp();
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
    await channel.send(buildDailyPulseMessage(stats));

    markPostedGuildDailyStats(guildId, dayKey);
  }
}

async function maybeSendWeeklyReflections(client: Client): Promise<void> {
  const enabled = (process.env.WEEKLY_REFLECTION_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) return;

  const targetDay = Number(process.env.WEEKLY_REFLECTION_DAY_LOCAL ?? '0');
  const hour = Number(process.env.WEEKLY_REFLECTION_HOUR_LOCAL ?? '11');
  const minute = Number(process.env.WEEKLY_REFLECTION_MINUTE_LOCAL ?? '0');
  const now = new Date();
  if (now.getDay() !== targetDay || now.getHours() !== hour || now.getMinutes() !== minute) return;

  const weekKey = currentWeekKeyLocal(now);
  const sinceIso = localStartOfWeekIso(now);
  const userIds = listUsersWithChases();

  for (const userId of userIds) {
    if (hasPostedUserWeeklyReflection(userId, weekKey)) continue;
    const summary = getUserWeeklyReflectionSummary(userId, sinceIso);
    if (summary.alertsReceived === 0 && summary.newChasesAdded === 0) {
      markPostedUserWeeklyReflection(userId, weekKey);
      continue;
    }

    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [buildWeeklyReflectionEmbed(summary)] });
      markPostedUserWeeklyReflection(userId, weekKey);
    } catch (error) {
      console.error(`Failed to send weekly reflection to user ${userId}`, error);
    }
  }
}

export function startPoller(client: Client): void {
  const pollIntervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS ?? '180');
  const intervalMs = Math.max(30, pollIntervalSeconds) * 1000;
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

  setInterval(() => {
    void maybeSendWeeklyReflections(client);
  }, 60 * 1000);

  void runWithGuard();

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
