import { ChannelType, Client, EmbedBuilder } from 'discord.js';
import { discoveryDropOpenButton, prepareWeeklyDiscoveryDropForUser } from '../commands/discover.js';
import { getUserPlan, listGuildCommandChannels, listUsersWithChases } from './chase-store.js';
import { activePlanTier } from './plans.js';
import {
  countAnnounceableScheduledDiscoveryDrops,
  countPreparedScheduledDiscoveryDrops,
  getScheduledDiscoveryDrop,
  hasScheduledDiscoveryDropAnnouncement,
  markScheduledDiscoveryDropAnnouncement,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  type ScheduledDiscoveryDrop
} from './scheduled-discovery-drops.js';

const WEEKLY_DROP_TYPE = 'WEEKLY_DISCOVERY' as const;

let schedulerTimer: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function envHours(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function minMarketReadyItemsForAnnouncement(): number {
  return envNumber('DISCOVERY_DROP_ANNOUNCE_MIN_READY_ITEMS', 5, 1, 20);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function weeklyPreparationTargetDate(now: Date, leadDays = envNumber('DISCOVERY_DROP_PREPARE_LEAD_DAYS', 3, 0, 6)): Date {
  const currentAvailability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, now);
  if (now.getTime() < Date.parse(currentAvailability.availableAt)) return now;

  const nextWeek = addDays(now, 7);
  const nextAvailability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, nextWeek);
  const leadMs = leadDays * 24 * 60 * 60 * 1000;
  return Date.parse(nextAvailability.availableAt) - now.getTime() <= leadMs ? nextWeek : now;
}

export function shouldPrepareWeeklyDrop(
  existing: Pick<ScheduledDiscoveryDrop, 'status' | 'itemCount' | 'updatedAt'> | null,
  targetDate: Date,
  now: Date,
  refreshHours = envHours('DISCOVERY_DROP_PREPARE_REFRESH_HOURS', 12, 1, 168)
): boolean {
  if (!existing || existing.itemCount <= 0) return true;
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, targetDate);
  if (now.getTime() >= Date.parse(availability.availableAt)) return false;

  const updatedAtMs = Date.parse(existing.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return now.getTime() - updatedAtMs >= refreshHours * 60 * 60 * 1000;
}

function weeklyDropAnnouncementEmbed(_periodKey: string, _preparedCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('💫 Vaultr Weekly Discovery')
    .setDescription([
      'Collector picks are freshly brewed and ready to browse!',
      '',
      'Full Vault gets a deeper Weekly Shelf shaped by your Vault and taste profile memory, while Free gets a tasty appetizer 🫰'
    ].join('\n'))
    .setFooter({ text: 'Vaultr • Weekly Shelf' })
    .setTimestamp();
}

function proUsersWithChases(): string[] {
  return listUsersWithChases().filter((userId) => activePlanTier(getUserPlan(userId)) === 'PRO');
}

async function prepareWeeklyDrops(now: Date): Promise<{ periodKey: string; prepared: number; skipped: number; failed: number }> {
  const targetDate = weeklyPreparationTargetDate(now);
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, targetDate);
  const batchSize = envNumber('DISCOVERY_DROP_PREPARE_BATCH_SIZE', 3, 1, 25);
  let prepared = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of proUsersWithChases()) {
    const existing = getScheduledDiscoveryDrop(userId, WEEKLY_DROP_TYPE, periodKey);
    if (!shouldPrepareWeeklyDrop(existing, targetDate, now)) {
      skipped += 1;
      continue;
    }
    if (prepared >= batchSize) break;

    try {
      const result = await prepareWeeklyDiscoveryDropForUser(userId, targetDate, { force: !!existing });
      if (result.prepared && result.itemCount > 0) prepared += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[DiscoveryDrops] Failed to prepare weekly drop for ${userId}`, error);
    }
  }

  return { periodKey, prepared, skipped, failed };
}

async function announceWeeklyDrop(client: Client, now: Date): Promise<{ periodKey: string; announced: number; skipped: number }> {
  if (!envFlag('DISCOVERY_DROP_ANNOUNCEMENTS_ENABLED', true)) {
    return { periodKey: scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, now), announced: 0, skipped: 0 };
  }

  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, now);
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, now);
  if (Date.parse(availability.availableAt) > now.getTime()) return { periodKey, announced: 0, skipped: 0 };

  const preparedCount = countAnnounceableScheduledDiscoveryDrops(WEEKLY_DROP_TYPE, periodKey, minMarketReadyItemsForAnnouncement());
  if (preparedCount === 0) return { periodKey, announced: 0, skipped: 0 };

  let announced = 0;
  let skipped = 0;
  for (const { guildId, channelId } of listGuildCommandChannels()) {
    if (hasScheduledDiscoveryDropAnnouncement(guildId, WEEKLY_DROP_TYPE, periodKey)) {
      skipped += 1;
      continue;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        skipped += 1;
        continue;
      }
      const message = await channel.send({
        embeds: [weeklyDropAnnouncementEmbed(periodKey, preparedCount)],
        components: [discoveryDropOpenButton(WEEKLY_DROP_TYPE, periodKey)]
      });
      if (markScheduledDiscoveryDropAnnouncement({ guildId, dropType: WEEKLY_DROP_TYPE, periodKey, channelId, messageId: message.id })) {
        announced += 1;
      }
    } catch (error) {
      skipped += 1;
      console.warn(`[DiscoveryDrops] Failed to announce weekly drop for guild ${guildId}`, error);
    }
  }

  return { periodKey, announced, skipped };
}

export async function sendWeeklyDropTestAnnouncement(channel: { type: ChannelType; send: (options: { embeds: EmbedBuilder[]; components: ReturnType<typeof discoveryDropOpenButton>[] }) => Promise<{ id: string }> }, now = new Date()): Promise<{
  periodKey: string;
  preparedCount: number;
  messageId: string;
}> {
  if (channel.type !== ChannelType.GuildText) {
    throw new Error('Weekly Shelf test announcements can only be posted in text channels');
  }
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, now);
  const preparedCount = countPreparedScheduledDiscoveryDrops(WEEKLY_DROP_TYPE, periodKey);
  const message = await channel.send({
    embeds: [weeklyDropAnnouncementEmbed(periodKey, preparedCount)],
    components: [discoveryDropOpenButton(WEEKLY_DROP_TYPE, periodKey)]
  });
  return { periodKey, preparedCount, messageId: message.id };
}

export async function runDiscoveryDropSchedulerOnce(client: Client, now = new Date()): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const prepared = await prepareWeeklyDrops(now);
    const announced = await announceWeeklyDrop(client, now);
    if (prepared.prepared > 0 || prepared.failed > 0 || announced.announced > 0) {
      console.log(
        `[DiscoveryDrops] weekly=${prepared.periodKey} prepared=${prepared.prepared} skipped=${prepared.skipped} failed=${prepared.failed} announced=${announced.announced}`
      );
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startDiscoveryDropScheduler(client: Client): void {
  if (!envFlag('DISCOVERY_DROP_SCHEDULER_ENABLED', true)) return;
  if (schedulerTimer) return;

  const intervalSeconds = envNumber('DISCOVERY_DROP_SCHEDULER_INTERVAL_SECONDS', 900, 60, 86_400);
  void runDiscoveryDropSchedulerOnce(client);
  schedulerTimer = setInterval(() => {
    void runDiscoveryDropSchedulerOnce(client);
  }, intervalSeconds * 1000);
}
