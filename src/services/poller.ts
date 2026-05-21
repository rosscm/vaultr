import { Client, EmbedBuilder } from 'discord.js';
import {
  getGuildCommunityStatsToday,
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getUserAlertSettings,
  getGuildCommunityFeedMode,
  hasAlertBeenSent,
  hasPostedGuildDailyStats,
  listGuildCommandChannels,
  listAllChases,
  markPostedGuildDailyStats,
  markAlertSentWithDetails
} from './chase-store.js';
import { searchEbayListings } from './ebay.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from './currency.js';
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
import { keyValue, listingLinkButton, warningEmbed } from '../ui/embeds.js';
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
      if (r === 'card_number_match') return 'card number match';
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
  const positiveSignals = reasons.filter((r) => !riskSignals.includes(r) && r !== 'price_within_max');
  return {
    positive: positiveSignals.length > 0 ? formatReasons(positiveSignals) : 'None',
    risk: riskSignals.length > 0 ? formatReasons(riskSignals) : 'None'
  };
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

function formatPriceVsMax(listingPrice: number, chaseMax: number | undefined, currency: string): string {
  if (chaseMax === undefined) return 'No max set';
  const diff = chaseMax - listingPrice;
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

function formatDealQuality(score: number): string {
  if (score >= 85) return 'Strong Match';
  if (score >= 60) return 'Good Match';
  return 'Speculative Match';
}

function explainDealQuality(score: number): string {
  if (score >= 85) return 'strong alignment with your chase filters';
  if (score >= 60) return 'good alignment with your chase filters';
  return 'partial alignment; review details before acting';
}

function formatScoreWithQuality(score: number): string {
  return `${score} (${formatDealQuality(score)})`;
}

function truncateTitle(title: string, maxLen = 110): string {
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

function deriveRiskLevel(matchReasons: string[], sellerFeedbackPercent: number | undefined): 'low' | 'medium' | 'high' {
  const hasSuspiciousTerms = matchReasons.some((r) => r.startsWith('suspicious_terms:') || r.includes('penalty'));
  const sellerWeak = sellerFeedbackPercent !== undefined && sellerFeedbackPercent < 95;
  if (hasSuspiciousTerms && sellerWeak) return 'high';
  if (hasSuspiciousTerms || sellerWeak) return 'medium';
  return 'low';
}

function colorForListingAge(postedAt?: string): number {
  const age = postedAgeSeconds(postedAt);
  if (age === null) return 0x3b82f6; // blue (unknown age)
  if (age <= 60 * 60) return 0x22c55e; // green (<1h)
  if (age <= 24 * 60 * 60) return 0xf59e0b; // amber (<24h)
  return 0x3b82f6; // blue (older)
}

function formatFreshness(postedAt?: string): string {
  const age = postedAgeSeconds(postedAt);
  if (age === null) return 'unknown';
  if (age <= 60 * 60) return 'new';
  if (age <= 24 * 60 * 60) return 'recent';
  return 'older';
}

function summarizeWhyMatched(score: number, listingPrice: number, chaseMax: number | undefined, currency = 'USD', postedAt?: string): string {
  const dealQuality = formatDealQuality(score);
  const pricePart =
    chaseMax === undefined
      ? 'No max set'
      : listingPrice <= chaseMax
        ? `Under max by ${(chaseMax - listingPrice).toFixed(2)} ${currency}`
        : `Over max by ${(listingPrice - chaseMax).toFixed(2)} ${currency}`;
  const postedPart = `Posted ${formatPostedAge(postedAt)}`;
  return `${dealQuality} • ${pricePart} • ${postedPart}`;
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
      if (listingFingerprint && wasFingerprintSeenRecently(chase.id, listingFingerprint, nowMs)) {
        markFingerprintSuppression();
        continue;
      }

      const sourceLabel = listing.source === 'EBAY' ? 'eBay' : listing.source;
      const embed = new EmbedBuilder()
        .setColor(colorForListingAge(listing.postedAt))
        .setTitle(`${chase.priority === 'GRAIL' ? '🏆 Grail Match Found' : '🚨 Chase Match Found'} · ${sourceLabel}`)
        .setDescription(
          `**${truncateTitle(listing.title)}**\n${summarizeWhyMatched(match.score, normalizedListing.price, chase.maxPrice, targetCurrency, listing.postedAt)}`
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
              `**Freshness:** ${formatFreshness(listing.postedAt)}`,
              `**Score:** ${formatScoreWithQuality(match.score)}`,
              `**Risk Level:** ${deriveRiskLevel(match.reasons, listing.sellerFeedbackPercent)}`,
              `**Match Signals:** ${splitReasons(match.reasons).positive}`,
              `**Confidence Summary:** ${explainDealQuality(match.score)}`
            ].join('\n'),
            inline: false
          }
        );
      } else {
        embed.addFields(
          {
            name: '🎯 Chase Context',
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
              `**Price vs Max:** ${formatPriceVsMax(normalizedListing.price, chase.maxPrice, targetCurrency)}`,
              `**Listing Type:** ${formatListingType(normalizedListing.listingType)}`
            ].join('\n'),
            inline: false
          },
          {
            name: '📸 Listing Snapshot',
            value: [
              `**Posted:** ${formatPostedAge(listing.postedAt)}`,
              `**Source:** ${sourceLabel}`,
              `**Freshness:** ${formatFreshness(listing.postedAt)}`,
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
              `**Score:** ${formatScoreWithQuality(match.score)}`,
              `**Risk Level:** ${deriveRiskLevel(match.reasons, listing.sellerFeedbackPercent)}`,
              `**Match Signals:** ${splitReasons(match.reasons).positive}`,
              `**Confidence Summary:** ${explainDealQuality(match.score)}`
            ].join('\n'),
            inline: false
          }
        );
      }

      embed.setTimestamp().setFooter({ text: 'Vaultr • Collector Alert' });

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
          user.send({ embeds: [embed], components: [listingLinkButton(listing.url)] }),
          10000,
          'DM send timeout'
        );
        markAlertSentWithDetails(chase.id, chase.userId, listing.listingId, listing.source, {
          guildId: chase.guildId,
          listingTitle: listing.title,
          listingPrice: normalizedListing.price,
          listingCurrency: targetCurrency,
          priceDelta:
            chase.maxPrice !== undefined && normalizedListing.price <= chase.maxPrice
              ? Number((chase.maxPrice - normalizedListing.price).toFixed(2))
              : undefined,
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

function currentDayKeyLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    const bestDelta = stats.bestPriceDelta
      ? `${stats.bestPriceDelta.amount.toFixed(2)} ${stats.bestPriceDelta.currency}`
      : 'none';

    await channel.send(
      [
        '📊 **Vaultr Stats**',
        '**Today**',
        `• **New Vaultrs:** ${stats.newVaultrs}`,
        `• **Users Alerted:** ${stats.usersAlerted}`,
        `• **Matches:** ${stats.matches}`,
        `• **Best Price Delta:** ${bestDelta}`
      ].join('\n')
    );

    markPostedGuildDailyStats(guildId, dayKey);
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

  void runWithGuard();

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
