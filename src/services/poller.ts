import { Client } from 'discord.js';
import { countUserAlertsInLastHour, getUserAlertSettings, hasAlertBeenSent, listAllChases, markAlertSentWithDetails } from './chase-store.js';
import { searchEbayListings } from './ebay.js';
import { matchChaseToListing } from './matcher.js';
import { searchMockListings } from './mock-listings.js';
import { getPollerState, initializePollerState, markPollerError, markPollerMatchSent, markPollerOverlapSkip, markPollerRunStart, markPollerRunSuccess } from './poller-state.js';
import { keyValue, listingLinkButton, successEmbed } from '../ui/embeds.js';

function formatReasons(reasons: string[]): string {
  return reasons
    .map((r) => {
      if (r.startsWith('suspicious_terms:')) {
        const terms = r.split(':')[1] ?? '';
        return `suspicious terms (${terms})`;
      }
      return r.replaceAll('_', ' ');
    })
    .join(', ');
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
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (sourceMode === 'MOCK') return searchMockListings(chase);
      return await withTimeout(searchEbayListings(chase), 10000, 'Listing source timeout');
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(300 * attempt);
    }
  }
  return [];
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
      if (match.score < settings.minScore) continue;

      if (countUserAlertsInLastHour(chase.userId) >= settings.maxAlertsPerHour) continue;

      if (hasAlertBeenSent(chase.id, listing.listingId, listing.source)) continue;

      const embed = successEmbed('🚨 Chase Match Found')
        .setDescription(`**${listing.title}**`)
        .addFields(
          keyValue('Price', `**${listing.price} ${listing.currency}**`),
          keyValue('Region', `**${listing.region}**`),
          keyValue('Score', `**${match.score}**`),
          keyValue('Seller', `**${listing.seller ?? 'unknown'}**`),
          keyValue('Reasons', formatReasons(match.reasons))
        )
        .setFooter({ text: 'Vaultr • Collector Alert' });

      try {
        const user = await client.users.fetch(chase.userId);
        await withTimeout(
          user.send({ embeds: [embed], components: [listingLinkButton(listing.url)] }),
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
