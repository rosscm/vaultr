import { Client } from 'discord.js';
import { countUserAlertsInLastHour, getUserAlertSettings, hasAlertBeenSent, listAllChases, markAlertSent } from './chase-store.js';
import { searchEbayListings } from './ebay.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { initializePollerState, markPollerError, markPollerMatchSent, markPollerRunStart } from './poller-state.js';
import { keyValue, listingLinkButton, successEmbed } from '../ui/embeds.js';

function formatReasons(reasons: string[]): string {
  return reasons.map((r) => r.replaceAll('_', ' ')).join(', ');
}

function isInQuietHours(start: number | undefined, end: number | undefined): boolean {
  if (start === undefined || end === undefined) return false;
  const hour = new Date().getHours();
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

async function runPoll(client: Client): Promise<void> {
  markPollerRunStart();
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  const chases = listAllChases();
  if (chases.length === 0) return;

  for (const chase of chases) {
    const settings = getUserAlertSettings(chase.userId);
    if (isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) continue;

    const listings = sourceMode === 'MOCK' ? searchMockListings(chase) : await searchEbayListings(chase);

    for (const listing of listings) {
      const match = matchChaseToListing(chase, listing);
      if (!match.isMatch) continue;
      if (match.score < settings.minScore) continue;

      if (countUserAlertsInLastHour(chase.userId) >= settings.maxAlertsPerHour) continue;

      if (hasAlertBeenSent(chase.id, listing.listingId, listing.source)) continue;

      const embed = successEmbed('🚨 Chase Match Found')
        .setDescription(`**${listing.title}**`)
        .addFields(
          keyValue('💵 Price', `**${listing.price} ${listing.currency}**`),
          keyValue('🌎 Region', `**${listing.region}**`),
          keyValue('🎯 Score', `**${match.score}**`),
          keyValue('🛒 Seller', `**${listing.seller ?? 'unknown'}**`),
          keyValue('🧠 Match Reasons', formatReasons(match.reasons))
        )
        .setFooter({ text: 'Vaultr • Collector Alert' });

      try {
        const user = await client.users.fetch(chase.userId);
        await user.send({ embeds: [embed], components: [listingLinkButton(listing.url)] });
        markAlertSent(chase.id, chase.userId, listing.listingId, listing.source);
        markPollerMatchSent();
      } catch (error) {
        console.error(`Failed to send DM alert to user ${chase.userId}`, error);
      }
    }
  }
}

export function startPoller(client: Client): void {
  const pollIntervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS ?? '180');
  const intervalMs = Math.max(30, pollIntervalSeconds) * 1000;
  const sourceMode = (process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase();
  initializePollerState(sourceMode, intervalMs / 1000);

  setInterval(() => {
    runPoll(client).catch((error) => {
      console.error('Poller run failed', error);
      markPollerError(error);
    });
  }, intervalMs);

  runPoll(client).catch((error) => {
    console.error('Initial poller run failed', error);
    markPollerError(error);
  });

  console.log(`Poller started. Interval: ${intervalMs / 1000}s | source: ${sourceMode}`);
}
