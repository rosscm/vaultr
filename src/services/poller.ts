import { Client, EmbedBuilder } from 'discord.js';
import {
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getUserAlertSettings,
  hasAlertBeenSent,
  isListingFingerprintIgnored,
  listAllChases,
  markAlertSentWithDetails
} from './chase-store.js';
import { searchEbayListings } from './ebay.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
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
import { keyValue, listingLinkButton, markNotRelevantButton, warningEmbed } from '../ui/embeds.js';
import { makeListingFingerprint } from './listing-fingerprint.js';

function formatReasons(reasons: string[]): string {
  return reasons
    .map((r) => {
      if (r.startsWith('suspicious_terms:')) {
        const terms = r.split(':')[1] ?? '';
        return `suspicious terms (${terms})`;
      }
      if (r.startsWith('token_overlap:')) {
        return `token overlap ${r.split(':')[1]}%`;
      }
      if (r === 'card_name_match_exact') return 'exact card name match';
      if (r === 'card_name_match_tokens') return 'card name token match';
      if (r === 'price_within_max') return 'within your max';
      if (r === 'seller_quality_boost') return 'high seller feedback';
      if (r === 'low_token_overlap_penalty') return 'low token overlap';
      if (r === 'suspicious_title_penalty') return 'suspicious title terms';
      return r.replaceAll('_', ' ');
    })
    .join(', ');
}

function splitReasons(reasons: string[]): { positive: string; risk: string } {
  const riskSignals = reasons.filter(
    (r) => r.includes('penalty') || r.startsWith('suspicious_terms:') || r.includes('miss') || r.includes('block')
  );
  const positiveSignals = reasons.filter((r) => !riskSignals.includes(r));
  return {
    positive: positiveSignals.length > 0 ? formatReasons(positiveSignals) : 'none',
    risk: riskSignals.length > 0 ? formatReasons(riskSignals) : 'none'
  };
}

function formatListingType(listingType: string | undefined): string {
  if (!listingType) return 'unknown';
  if (listingType === 'AUCTION') return 'Auction';
  if (listingType === 'BUY_IT_NOW') return 'Buy It Now';
  return 'Other';
}

function formatPostedAge(postedAt: string | undefined): string {
  if (!postedAt) return 'unknown';
  const then = new Date(postedAt).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatPriceVsMax(listingPrice: number, chaseMax: number | undefined): string {
  if (chaseMax === undefined) return 'No max set';
  const diff = chaseMax - listingPrice;
  if (diff >= 0) return `${Math.abs(diff).toFixed(2)} under max`;
  return `${Math.abs(diff).toFixed(2)} over max`;
}

function formatSellerFeedbackPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return 'unknown';
  return `${value.toFixed(1)}%`;
}

function formatShippingCost(cost: number | undefined, currency: string | undefined): string {
  if (cost === undefined || Number.isNaN(cost)) return 'unknown';
  return `${cost} ${currency ?? ''}`.trim();
}

function formatDealQuality(score: number): string {
  if (score >= 90) return 'Elite';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Watch';
  return 'Speculative';
}

function truncateTitle(title: string, maxLen = 110): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

function deriveRiskLevel(matchReasons: string[], sellerFeedbackPercent: number | undefined): 'Low' | 'Medium' | 'High' {
  const hasSuspiciousTerms = matchReasons.some((r) => r.startsWith('suspicious_terms:') || r.includes('penalty'));
  const sellerWeak = sellerFeedbackPercent !== undefined && sellerFeedbackPercent < 95;
  if (hasSuspiciousTerms && sellerWeak) return 'High';
  if (hasSuspiciousTerms || sellerWeak) return 'Medium';
  return 'Low';
}

function summarizeWhyMatched(score: number, listingPrice: number, chaseMax: number | undefined, postedAt?: string): string {
  const dealQuality = formatDealQuality(score);
  const pricePart =
    chaseMax === undefined
      ? 'No max set'
      : listingPrice <= chaseMax
        ? `Under max by ${(chaseMax - listingPrice).toFixed(2)}`
        : `Over max by ${(listingPrice - chaseMax).toFixed(2)}`;
  const postedPart = `Posted ${formatPostedAge(postedAt)}`;
  return `${dealQuality} match • ${pricePart} • ${postedPart}`;
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
let backoffUntilMs = 0;

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

async function fetchListingsWithRetry(chase: any, sourceMode: string): Promise<any[]> {
  const maxRequestsPerMinute = Number(process.env.EBAY_MAX_REQUESTS_PER_MINUTE ?? '20');
  const backoffBaseSeconds = Number(process.env.EBAY_BACKOFF_BASE_SECONDS ?? '30');
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (sourceMode === 'MOCK') return searchMockListings(chase);
      const nowMs = Date.now();
      if (nowMs < backoffUntilMs) {
        return [];
      }
      if (!canCallSource(nowMs, maxRequestsPerMinute)) {
        markRateLimitSkip();
        return [];
      }
      markSourceCall(nowMs);
      const listings = await withTimeout(searchEbayListings(chase), 10000, 'Listing source timeout');
      markSourceSuccessNow();
      return listings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('429')) {
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
            `You reached your current limit of ${maxAlertsPerHour} alerts/hour. Increase it with \`/alerts-settings\` if needed.`
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
  markPollerRunStart();
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  const chases = listAllChases();
  if (chases.length === 0) {
    markPollerRunSuccess(Date.now() - startedAt);
    return;
  }

  for (const chase of chases) {
    const settings = getUserAlertSettings(chase.userId);
    if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) continue;

    const listings = await fetchListingsWithRetry(chase, sourceMode);

    for (const listing of listings) {
      const match = matchChaseToListing(chase, listing);
      if (!match.isMatch) continue;
      if (match.score < settings.minScore) {
        markMinScoreSuppression();
        continue;
      }
      if (settings.chaseCooldownMinutes > 0) {
        const recentForChase = countChaseAlertsWithinMinutes(chase.userId, chase.id, settings.chaseCooldownMinutes);
        if (recentForChase > 0) {
          markChaseCooldownSuppression();
          continue;
        }
      }

      if (countUserAlertsInLastHour(chase.userId) >= settings.maxAlertsPerHour) {
        await sendThrottleNoticeIfNeeded(client, chase.userId, settings.maxAlertsPerHour);
        continue;
      }

      if (hasAlertBeenSent(chase.id, listing.listingId, listing.source)) continue;
      const nowMs = Date.now();
      const listingFingerprint = makeListingFingerprint(listing.title);
      if (listingFingerprint && isListingFingerprintIgnored(chase.userId, chase.id, listingFingerprint)) continue;
      if (listingFingerprint && wasFingerprintSeenRecently(chase.id, listingFingerprint, nowMs)) {
        markFingerprintSuppression();
        continue;
      }

      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle(chase.priority === 'GRAIL' ? '🏆 Grail Match Found' : '🚨 Chase Match Found')
        .setDescription(`**${truncateTitle(listing.title)}**\n${summarizeWhyMatched(match.score, listing.price, chase.maxPrice, listing.postedAt)}`)
        .addFields(
          keyValue('Chase', `**${truncateTitle(chase.cardName, 60)}**`),
          keyValue('Priority', `**${chase.priority ?? 'NORMAL'}**`),
          keyValue('Note', chase.targetNote ? `**${truncateTitle(chase.targetNote, 80)}**` : '**none**'),
          keyValue('Deal Quality', `**${formatDealQuality(match.score)}**`),
          keyValue('Risk Level', `**${deriveRiskLevel(match.reasons, listing.sellerFeedbackPercent)}**`),
          keyValue('Price', `**${listing.price} ${listing.currency}**`),
          keyValue('Shipping', `**${formatShippingCost(listing.shippingCost, listing.shippingCurrency)}**`),
          keyValue('Price vs Max', `**${formatPriceVsMax(listing.price, chase.maxPrice)}**`),
          keyValue('Score', `**${match.score}**`),
          keyValue('Listing Type', `**${formatListingType(listing.listingType)}**`),
          keyValue('Posted', `**${formatPostedAge(listing.postedAt)}**`),
          keyValue('Seller', `**${listing.seller ?? 'unknown'}**`),
          keyValue(
            'Seller Feedback',
            `**${formatSellerFeedbackPercent(listing.sellerFeedbackPercent)}${
              listing.sellerFeedbackScore !== undefined ? ` (${listing.sellerFeedbackScore})` : ''
            }**`
          ),
          keyValue('Region', `**${listing.region}**`),
          keyValue('Why It Matched', splitReasons(match.reasons).positive),
          keyValue('Risk Signals', splitReasons(match.reasons).risk)
        )
        .setTimestamp()
        .setFooter({ text: 'Vaultr • Collector Alert' });

      try {
        const user = await client.users.fetch(chase.userId);
        await withTimeout(
          user.send({ embeds: [embed], components: [listingLinkButton(listing.url), markNotRelevantButton(chase.id, listing.listingId)] }),
          10000,
          'DM send timeout'
        );
        markAlertSentWithDetails(chase.id, chase.userId, listing.listingId, listing.source, {
          listingTitle: listing.title,
          listingPrice: listing.price,
          listingCurrency: listing.currency,
          listingUrl: listing.url,
          matchScore: match.score
        });
        if (listingFingerprint) markFingerprintSeen(chase.id, listingFingerprint, nowMs);
        markPollerMatchSent();
      } catch (error) {
        console.error(`Failed to send DM alert to user ${chase.userId}`, error);
      }
    }
  }

  markPollerRunSuccess(Date.now() - startedAt);
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

  void runWithGuard();

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
