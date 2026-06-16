import { MessageFlags } from 'discord.js';
import {
  countUserAlertsSince,
  getChaseLastPollCheckAt,
  getUserPlan,
  listChases
} from '../services/chase-store.js';
import { activePlanChases, activePlanTier, pausedPlanChases, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';
import type { Chase } from '../types.js';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
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

function watchSummary(activeCount: number, alerts24h: number, alerts7d: number, pausedCount: number): string {
  if (activeCount === 0) return 'Add a chase to start the watch rotation';
  if (alerts24h > 0) return 'Watching now; fresh matches surfaced today';
  if (alerts7d > 0) return 'Watching now; recent listings have been quiet';
  if (pausedCount > 0) return 'Watching active chases; extras are paused by plan limit';
  return 'Watching now; no listings have cleared your filters yet';
}

export function buildAlertsStatusEmbed(userId: string, now = new Date()) {
  const plan = getUserPlan(userId);
  const activeTier = activePlanTier(plan);
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
    ? infoEmbed('🟢 Vaultr Watch Status', watchSummary(activeChases.length, alerts24h, alerts7d, pausedChases.length))
    : warningEmbed('Vaultr Watch Status', watchSummary(activeChases.length, alerts24h, alerts7d, pausedChases.length));

  embed.addFields(
    {
      name: 'Watching',
      value: [
        `**Active:** ${activeChases.length}/${PLAN_LIMITS[activeTier].maxActiveChases}`,
        `**Paused:** ${pausedChases.length}`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Sweeps',
      value: [
        `**Last:** ${lastSweep ? formatTimeWithAge(lastSweep) : 'Not yet checked'}`,
        `**Next:** ${nextSweep === undefined ? 'Add a chase first' : nextSweep <= 0 ? 'due now' : `about ${formatDuration(nextSweep)}`}`,
        `**Pace:** ~${formatDuration(intervalSeconds)} per chase`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Finds',
      value: [`**Last 24h:** ${alerts24h}`, `**Last 7d:** ${alerts7d}`].join('\n'),
      inline: false
    }
  );

  embed.setFooter({ text: 'Vaultr • Alerts' });
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