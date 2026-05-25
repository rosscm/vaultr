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

async function buildChaseDebugLines(chase: Chase, itemId: string): Promise<string[]> {
  const settings = getUserAlertSettings(chase.userId);
  const listings = await searchEbayListings(chase);
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
  const wouldAlert =
    match.isMatch && !unratedSuppressed && !minScoreSuppressed && !cooldownSuppressed && !hourlySuppressed && !duplicate;

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
