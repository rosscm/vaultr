import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  countChaseAlertsWithinMinutes,
  countUserAlertsInLastHour,
  getChaseLastPollCheckAt,
  getUserAlertSettings,
  getUserPlan,
  hasAlertBeenSent,
  listAllChases
} from '../services/chase-store.js';
import { convertCurrencyAmount, normalizeSupportedCurrency } from '../services/currency.js';
import { searchEbayListings } from '../services/ebay.js';
import { matchChaseToListing } from '../services/matcher.js';
import { PLAN_LIMITS } from '../services/plans.js';
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatCoverageGroup(group: { queryKey: string; chaseCount: number; overdueSeconds: number; reason?: string } | undefined): string {
  if (!group) return 'None';
  const reason = group.reason ? `, ${group.reason.toLowerCase()}` : '';
  return `${group.queryKey} (${group.chaseCount} chase${group.chaseCount === 1 ? '' : 's'}, ${formatDuration(group.overdueSeconds)} overdue${reason})`;
}

function formatRelativeDue(seconds: number): string {
  if (seconds <= 0) return `${formatDuration(Math.abs(seconds))} overdue`;
  return `in ${formatDuration(seconds)}`;
}

function truncateValue(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function buildEligibilityLines(chases: Chase[], nowMs: number): string[] {
  let dueNow = 0;
  let notYetDue = 0;
  let neverChecked = 0;
  let nextDue: { chase: Chase; tier: string; secondsUntilDue: number } | undefined;
  let oldestEligible: { chase: Chase; tier: string; secondsUntilDue: number } | undefined;

  for (const chase of chases) {
    const plan = getUserPlan(chase.userId);
    const intervalSeconds = PLAN_LIMITS[plan.tier].pollIntervalSeconds;
    const lastCheckedAt = getChaseLastPollCheckAt(chase.id);
    const lastCheckedAtMs = lastCheckedAt ? new Date(lastCheckedAt).getTime() : undefined;
    const secondsUntilDue = lastCheckedAtMs !== undefined && Number.isFinite(lastCheckedAtMs)
      ? Math.ceil((lastCheckedAtMs + intervalSeconds * 1000 - nowMs) / 1000)
      : 0;

    if (!lastCheckedAt) neverChecked += 1;

    const summary = { chase, tier: plan.tier, secondsUntilDue };
    if (secondsUntilDue <= 0) {
      dueNow += 1;
      if (!oldestEligible || secondsUntilDue < oldestEligible.secondsUntilDue) oldestEligible = summary;
    } else {
      notYetDue += 1;
      if (!nextDue || secondsUntilDue < nextDue.secondsUntilDue) nextDue = summary;
    }
  }

  const formatChaseDue = (summary: { chase: Chase; tier: string; secondsUntilDue: number } | undefined): string => {
    if (!summary) return 'None';
    return `${truncateValue(summary.chase.cardName, 54)} (${summary.tier}, ${formatRelativeDue(summary.secondsUntilDue)})`;
  };

  return [
    '**Current Eligibility:**',
    `**Eligible Now:** ${dueNow}`,
    `**Not Yet Due:** ${notYetDue}`,
    `**Never Checked:** ${neverChecked}`,
    `**Next Eligible:** ${formatChaseDue(nextDue)}`,
    `**Oldest Eligible:** ${formatChaseDue(oldestEligible)}`
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
  const sellerRisk = match.reasons.includes('new_seller_penalty')
    ? 'New/unrated seller downweighted'
    : match.reasons.includes('low_seller_feedback_count_penalty')
      ? 'Limited seller history downweighted'
      : match.reasons.includes('low_seller_feedback_percent_penalty')
        ? 'Lower seller feedback downweighted'
        : 'None';
  const minScoreSuppressed = match.isMatch && match.score < settings.minScore;
  const cooldownSuppressed = recentForChase > 0;
  const hourlySuppressed = recentForUser >= settings.maxAlertsPerHour;
  const rankedCandidates = listings
    .map((sourceListing) => {
      const normalized = normalizeListingCurrency(sourceListing, targetCurrency);
      const candidateMatch = matchChaseToListing(chase, normalized);
      const candidateDuplicate = hasAlertBeenSent(chase.id, sourceListing.listingId, sourceListing.source);
      if (!candidateMatch.isMatch || candidateDuplicate || candidateMatch.score < settings.minScore) {
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
    `**Seller Risk:** ${sellerRisk}`,
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
    .setDescription('Owner: inspect Vaultr runtime health')
    .addStringOption((opt) =>
      opt.setName('chase_id').setDescription('Owner debug: chase ID to inspect').setMaxLength(80)
    )
    .addStringOption((opt) =>
      opt.setName('item_id').setDescription('Owner debug: eBay item/listing ID to inspect').setMaxLength(120)
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
    const coverage = state.lastRunCoverage;
    const duration = state.lastRunDurationMs === undefined ? 'n/a' : `${state.lastRunDurationMs}ms`;
    const nowMs = Date.now();
    const chases = listAllChases();
    const backoffUntilMs = state.backoffUntil ? new Date(state.backoffUntil).getTime() : undefined;
    const isBackoffActive = backoffUntilMs !== undefined && Number.isFinite(backoffUntilMs) && backoffUntilMs > nowMs;
    const lines = [
      `**Source:** ${state.sourceMode}`,
      `**Poller Wake:** every ${state.pollIntervalSeconds}s`,
      `**Running:** ${state.isRunning ? 'Yes' : 'No'}`,
      `**Rate Limited / Backing Off:** ${isBackoffActive ? 'Yes' : 'No'}`,
      `**Active Chases:** ${chases.length}`,
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

    lines.push(
      '',
      '**Source Coverage:**',
      `**Due Groups:** ${coverage.dueGroups} (${coverage.dueChases} chase${coverage.dueChases === 1 ? '' : 's'})`,
      `**Checked Groups:** ${coverage.checkedGroups} (${coverage.checkedChases} chase${coverage.checkedChases === 1 ? '' : 's'})`,
      `**Deferred Groups:** ${coverage.deferredGroups} (${coverage.deferredChases} chase${coverage.deferredChases === 1 ? '' : 's'})`,
      `**Deferred Reasons:** ${coverage.rateLimitedGroups} rate limit, ${coverage.backoffGroups} backoff`,
      `**Oldest Due:** ${formatCoverageGroup(coverage.oldestDue)}`,
      `**Oldest Deferred:** ${formatCoverageGroup(coverage.oldestDeferred)}`
    );

    lines.push('', ...buildEligibilityLines(chases, nowMs));

    await interaction.reply({
      embeds: [infoEmbed('🩺 Vaultr Health', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
