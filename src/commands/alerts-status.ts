import { MessageFlags } from 'discord.js';
import {
  countUserAlertsSince,
  getChaseLastPollCheckAt,
  getUserAlertSettings,
  getUserPlan,
  listChases
} from '../services/chase-store.js';
import { activePlanChases, activePlanTier, formatActivePlanAccess, pausedPlanChases, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';
import type { Chase, ListingSourceModePreference, UserAlertSettings } from '../types.js';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function displaySourceMode(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  if (activeTier === 'FREE' && (value === 'EBAY_SHOPIFY' || value === 'SHOPIFY')) return 'eBay';
  if (value === 'EBAY_SHOPIFY') return 'eBay + trusted shops';
  if (value === 'SHOPIFY') return 'trusted shops';
  return 'eBay';
}

function displayShipTo(settings: UserAlertSettings): string {
  if (!settings.shippingCountry) return 'not set';
  return [settings.shippingCountry, settings.shippingPostalCode ? `${settings.shippingPostalCode} region` : undefined].filter(Boolean).join(' ');
}

function lastSweepAt(activeChases: Chase[]): string | undefined {
  const checkedTimes = activeChases
    .map((chase) => getChaseLastPollCheckAt(chase.id))
    .filter((value): value is string => value !== undefined)
    .sort((a, b) => b.localeCompare(a));
  return checkedTimes[0];
}

function nextSweepSeconds(activeChases: Chase[], intervalSeconds: number, nowMs: number): number | undefined {
  if (activeChases.length === 0) return undefined;
  const dueSeconds = activeChases.map((chase) => {
    const lastCheckedAt = getChaseLastPollCheckAt(chase.id);
    if (!lastCheckedAt) return 0;
    const lastCheckedAtMs = new Date(lastCheckedAt).getTime();
    if (!Number.isFinite(lastCheckedAtMs)) return 0;
    return Math.ceil((lastCheckedAtMs + intervalSeconds * 1000 - nowMs) / 1000);
  });
  return Math.max(0, Math.min(...dueSeconds));
}

function quietRead(activeCount: number, alerts24h: number, alerts7d: number, pausedCount: number): string {
  if (activeCount === 0) return 'Add a chase and Vaultr will start watching for matching listings.';
  if (alerts24h > 0) return 'Vaultr is watching and has surfaced fresh matches recently.';
  if (alerts7d > 0) return 'Vaultr is watching; your latest matches are older, so current listings have not cleared your filters yet.';
  if (pausedCount > 0) return 'Vaultr is watching your active chases; some extra chases are paused by your plan limit.';
  return 'Vaultr is watching, but nothing new has cleared your price, grade, seller, and shipping filters yet.';
}

export function buildAlertsStatusEmbed(userId: string, now = new Date()) {
  const plan = getUserPlan(userId);
  const activeTier = activePlanTier(plan);
  const settings = getUserAlertSettings(userId);
  const chases = listChases(userId);
  const activeChases = activePlanChases(chases, plan);
  const pausedChases = pausedPlanChases(chases, plan);
  const intervalSeconds = PLAN_LIMITS[activeTier].pollIntervalSeconds;
  const nowMs = now.getTime();
  const lastSweep = lastSweepAt(activeChases);
  const nextSweep = nextSweepSeconds(activeChases, intervalSeconds, nowMs);
  const alerts24h = countUserAlertsSince(userId, new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());
  const alerts7d = countUserAlertsSince(userId, new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString());

  const embed = activeChases.length > 0
    ? infoEmbed('🟢 Vaultr Watch Status', 'Your active chases are in the watch rotation.')
    : warningEmbed('Vaultr Watch Status', 'No active chases are currently being watched.');

  embed.addFields(
    {
      name: 'Watching',
      value: [
        `**Active Chases:** ${activeChases.length}/${PLAN_LIMITS[activeTier].maxActiveChases}`,
        `**Paused Chases:** ${pausedChases.length}`,
        `**Access:** ${formatActivePlanAccess(plan)}`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Sweep Rhythm',
      value: [
        `**Last Sweep:** ${lastSweep ? formatTimeWithAge(lastSweep) : 'Not yet checked'}`,
        `**Next Sweep:** ${nextSweep === undefined ? 'Add a chase to start watching' : nextSweep <= 0 ? 'due now' : `about ${formatDuration(nextSweep)}`}`,
        `**Watch Speed:** about every ${formatDuration(intervalSeconds)} per active chase`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Recent Finds',
      value: [`**Last 24h:** ${alerts24h}`, `**Last 7d:** ${alerts7d}`].join('\n'),
      inline: false
    },
    {
      name: 'Quiet Read',
      value: quietRead(activeChases.length, alerts24h, alerts7d, pausedChases.length),
      inline: false
    },
    {
      name: 'Alert Rules',
      value: [
        `**Currency:** ${settings.alertCurrency}`,
        `**Ship-to:** ${displayShipTo(settings)}`,
        `**Source:** ${displaySourceMode(settings.listingSourceMode, activeTier)}`,
        `**Confidence:** ${settings.minScore}+`
      ].join('\n'),
      inline: false
    }
  );

  embed.setFooter({ text: 'Vaultr • quiet stretches are normal for precise chases' });
  return embed;
}

export const alertsStatus = {
  async execute(interaction: any) {
    await interaction.reply({
      embeds: [buildAlertsStatusEmbed(interaction.user.id)],
      flags: MessageFlags.Ephemeral
    });
  }
};