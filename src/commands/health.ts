import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getUserAlertSettings,
  hasAlertBeenSent,
  listAllChases
} from '../services/chase-store.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from '../services/currency.js';
import { searchEbayListings } from '../services/ebay.js';
import { matchChaseToListing } from '../services/matcher.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';
import type { Chase, Listing } from '../types.js';

function comparablePrice(listing: Listing): number {
  return listing.shippingCost === undefined ? listing.price : listing.price + listing.shippingCost;
}

function maxAlertsPerChasePerPoll(): number {
  const value = Number(process.env.MAX_ALERTS_PER_CHASE_PER_POLL ?? '3');
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 3;
}

function listingMatchesItemId(listing: Listing, itemId: string): boolean {
  const needle = itemId.trim();
  if (!needle) return false;
  return listing.listingId === needle || listing.listingId.includes(needle) || listing.url.includes(needle);
}

function formatMoney(amount: number | undefined, currency: string): string {
  if (amount === undefined || Number.isNaN(amount)) return 'Unknown';
  return `${amount.toFixed(2)} ${currency}`;
}

function formatListingDebug(listing: Listing | undefined, rank: number | null): string[] {
  if (!listing) return ['**Source Visible:** No'];
  return [
    '**Source Visible:** Yes',
    `**Source Rank:** ${rank === null ? 'Unknown' : rank}`,
    `**Listing ID:** ${listing.listingId}`,
    `**Title:** ${listing.title}`,
    `**Seller:** ${listing.seller ?? 'Unknown'}`,
    `**Seller Feedback:** ${listing.sellerFeedbackPercent ?? 'Unknown'}% (${listing.sellerFeedbackScore ?? 'Unknown'})`,
    `**Condition:** ${listing.condition ?? 'Unknown'}`,
    `**Listing Type:** ${listing.listingType ?? 'Unknown'}`
  ];
}

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
  const total = comparablePrice({ price: listingPrice, shippingCost } as Listing);
  if (total > chaseMax) return -1000;
  return Math.min(250, Math.round(((chaseMax - total) / chaseMax) * 250));
}

function freshnessScore(postedAt: string | undefined): number {
  if (!postedAt) return 0;
  const then = new Date(postedAt).getTime();
  if (Number.isNaN(then)) return 0;
  const ageHours = Math.max(0, Date.now() - then) / 3_600_000;
  if (ageHours <= 1) return 50;
  if (ageHours <= 24) return 30;
  if (ageHours <= 72) return 15;
  return 0;
}

function candidateRankScore(listing: Listing, normalizedListing: Listing, matchScore: number, chase: Chase): number {
  return (
    matchScore * 1000 +
    sellerTrustScore(listing) +
    priceFitScore(normalizedListing.price, normalizedListing.shippingCost, chase.maxPrice) +
    freshnessScore(listing.postedAt)
  );
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

async function buildChaseDebugLines(chase: Chase, itemId: string): Promise<string[]> {
  const settings = getUserAlertSettings(chase.userId);
  const listings = await searchEbayListings(
    chase,
    settings.shippingCountry
      ? { country: settings.shippingCountry, postalCode: settings.shippingPostalCode }
      : undefined
  );
  const sourceIndex = listings.findIndex((listing) => listingMatchesItemId(listing, itemId));
  const listing = sourceIndex >= 0 ? listings[sourceIndex] : undefined;

  const lines = [
    `**Chase:** ${chase.cardName}`,
    `**Chase ID:** ${chase.id}`,
    `**User ID:** ${chase.userId}`,
    `**Settings:** min score ${settings.minScore}, cooldown ${settings.chaseCooldownMinutes}m, max/hour ${settings.maxAlertsPerHour}, currency ${settings.alertCurrency}`,
    `**Fetched Listings:** ${listings.length}`,
    ...formatListingDebug(listing, sourceIndex >= 0 ? sourceIndex + 1 : null)
  ];

  if (!listing) {
    lines.push('**Would Alert:** No');
    lines.push('**Reason:** listing was not returned by the source query window');
    return lines;
  }

  const targetCurrency = normalizeSupportedCurrency(settings.alertCurrency);
  const normalizedListing = normalizeListingCurrency(listing, targetCurrency);
  const match = matchChaseToListing(chase, normalizedListing);
  const recentForChase =
    settings.chaseCooldownMinutes > 0
      ? countChaseAlertsWithinMinutes(chase.userId, chase.id, settings.chaseCooldownMinutes)
      : 0;
  const recentForUser = countUserAlertsInLastHour(chase.userId);
  const duplicate = hasAlertBeenSent(chase.id, listing.listingId, listing.source);
  const suppressUnrated = (process.env.SUPPRESS_UNRATED_SELLERS ?? 'true').toLowerCase() !== 'false';
  const unratedSuppressed = suppressUnrated && match.reasons.includes('new_seller_penalty');
  const minScoreSuppressed = match.isMatch && match.score < settings.minScore;
  const cooldownSuppressed = recentForChase > 0;
  const hourlySuppressed = recentForUser >= settings.maxAlertsPerHour;
  const rankedCandidates = listings
    .map((sourceListing) => {
      const normalized = normalizeListingCurrency(sourceListing, targetCurrency);
      const candidateMatch = matchChaseToListing(chase, normalized);
      const candidateDuplicate = hasAlertBeenSent(chase.id, sourceListing.listingId, sourceListing.source);
      const candidateUnratedSuppressed = suppressUnrated && candidateMatch.reasons.includes('new_seller_penalty');
      if (!candidateMatch.isMatch || candidateDuplicate || candidateUnratedSuppressed || candidateMatch.score < settings.minScore) {
        return null;
      }

      return {
        listingId: sourceListing.listingId,
        rankScore: candidateRankScore(sourceListing, normalized, candidateMatch.score, chase)
      };
    })
    .filter((candidate): candidate is { listingId: string; rankScore: number } => candidate !== null)
    .sort((a, b) => b.rankScore - a.rankScore);
  const candidateRank = rankedCandidates.findIndex((candidate) => candidate.listingId === listing.listingId) + 1;
  const selectedByPerPollCap = candidateRank > 0 && candidateRank <= maxAlertsPerChasePerPoll();
  const wouldAlert =
    match.isMatch &&
    !unratedSuppressed &&
    !minScoreSuppressed &&
    !cooldownSuppressed &&
    !hourlySuppressed &&
    !duplicate &&
    selectedByPerPollCap;

  lines.push(
    `**Converted Price:** ${formatMoney(normalizedListing.price, targetCurrency)}`,
    `**Converted Shipping:** ${formatMoney(normalizedListing.shippingCost, targetCurrency)}`,
    `**Converted Total:** ${formatMoney(comparablePrice(normalizedListing), targetCurrency)}`,
    `**Max Price:** ${chase.maxPrice === undefined ? 'Any' : formatMoney(chase.maxPrice, targetCurrency)}`,
    `**Matched:** ${match.isMatch ? 'Yes' : 'No'}`,
    `**Score:** ${match.score}`,
    `**Reasons:** ${match.reasons.join(', ') || 'None'}`,
    `**Duplicate Sent:** ${duplicate ? 'Yes' : 'No'}`,
    `**Recent Chase Alerts:** ${recentForChase}`,
    `**Recent User Alerts/hour:** ${recentForUser}`,
    `**Alert Candidate Rank:** ${candidateRank || 'Not ranked'}`,
    `**Per-Poll Cap:** ${maxAlertsPerChasePerPoll()}`,
    `**Selected By Per-Poll Cap:** ${selectedByPerPollCap ? 'Yes' : 'No'}`,
    `**Unrated Seller Suppressed:** ${unratedSuppressed ? 'Yes' : 'No'}`,
    `**Min Score Suppressed:** ${minScoreSuppressed ? 'Yes' : 'No'}`,
    `**Cooldown Suppressed:** ${cooldownSuppressed ? 'Yes' : 'No'}`,
    `**Hourly Limit Suppressed:** ${hourlySuppressed ? 'Yes' : 'No'}`,
    `**Would Alert:** ${wouldAlert ? 'Yes' : 'No'}`
  );

  return lines;
}

export const health = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Owner: show Vaultr runtime health')
    .addStringOption((opt) =>
      opt.setName('chase_id').setDescription('Owner debug: chase id to inspect').setMaxLength(80)
    )
    .addStringOption((opt) =>
      opt.setName('item_id').setDescription('Owner debug: eBay item id or listing id to inspect').setMaxLength(120)
    ),
  async execute(interaction: any) {
    const ownerId = process.env.OWNER_USER_ID;
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({
        embeds: [warningEmbed('Owner Only', 'This command is reserved for the Vaultr owner')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const chaseId = interaction.options.getString('chase_id');
    const itemId = interaction.options.getString('item_id');
    if (chaseId || itemId) {
      if (!chaseId || !itemId) {
        await interaction.reply({
          embeds: [warningEmbed('Missing Debug Input', 'Provide both `chase_id` and `item_id` to inspect a listing.')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const chase = listAllChases().find((c) => c.id === chaseId);
      if (!chase) {
        await interaction.reply({
          embeds: [warningEmbed('Chase Not Found', `No active chase found for \`${chaseId}\`.`)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const lines = await buildChaseDebugLines(chase, itemId);
      await interaction.reply({
        embeds: [infoEmbed('🔎 Chase Debug', lines.join('\n').slice(0, 4000))],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const state = getPollerState();
    const duration = state.lastRunDurationMs === undefined ? 'n/a' : `${state.lastRunDurationMs}ms`;
    const nowMs = Date.now();
    const backoffUntilMs = state.backoffUntil ? new Date(state.backoffUntil).getTime() : undefined;
    const isBackoffActive = backoffUntilMs !== undefined && Number.isFinite(backoffUntilMs) && backoffUntilMs > nowMs;
    const lines = [
      `**Source:** ${state.sourceMode}`,
      `**Listing Check Cadence:** every ${state.pollIntervalSeconds}s`,
      `**Running:** ${state.isRunning ? 'Yes' : 'No'}`,
      `**Rate Limited / Backing Off:** ${isBackoffActive ? 'Yes' : 'No'}`,
      `**Active Chases:** ${listAllChases().length}`,
      `**Last Run:** ${formatTimeWithAge(state.lastRunAt)}`,
      `**Last Completion:** ${formatTimeWithAge(state.lastRunCompletedAt)}`,
      `**Last Duration:** ${duration}`,
      `**Source Calls (60s):** ${state.sourceCallsLastMinute}`,
      `**Rate Limit Skips:** ${state.rateLimitSkips}`,
      `**Consecutive Failures:** ${state.consecutiveFailures}`,
      `**Backoff Until:** ${state.backoffUntil ? formatTimeWithAge(state.backoffUntil) : 'None'}`,
      `**Last Source Success:** ${state.lastSourceSuccessAt ? formatTimeWithAge(state.lastSourceSuccessAt) : 'None'}`,
      `**Last Error:** ${state.lastError ?? 'None'}`
    ];

    await interaction.reply({
      embeds: [infoEmbed('🩺 Vaultr Health', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
