import { ChannelType, Client, EmbedBuilder } from 'discord.js';
import { discoveryDropOpenButton, prepareWeeklyDiscoveryDropForUser, weeklyDiscoveryShelfSizeForPlan } from '../commands/discover.js';
import { getUserPlan, listGuildCommandChannels, listUsersWithChases } from './chase-store.js';
import { activePlanTier } from './plans.js';
import {
  countPreparedScheduledDiscoveryDrops,
  getScheduledDiscoveryDrop,
  hasScheduledDiscoveryDropAnnouncement,
  markScheduledDiscoveryDropAnnouncement,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey
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

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weeklyPreparationTargetDate(now: Date): Date {
  return now.getUTCDay() === 0 ? addDays(now, 1) : now;
}

function weeklyDropAnnouncementEmbed(periodKey: string, preparedCount: number): EmbedBuilder {
  const shelfLabel = preparedCount === 1 ? 'private shelf' : 'private shelves';
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('✨ Weekly Shelf drop is live')
    .setDescription([
      'Fresh collector picks are on the table',
      'Pro gets the full shelf, Free gets the preview cut',
      'Tap below for a private pull when you have a minute',
      '',
      `**🗓️ Drop:** ${periodKey}`,
      `**🧺 Shelves packed:** ${preparedCount} ${shelfLabel}`
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
    if (existing && (existing.status === 'READY' || existing.status === 'PARTIAL') && existing.itemCount >= weeklyDiscoveryShelfSizeForPlan('PRO')) {
      skipped += 1;
      continue;
    }
    if (prepared >= batchSize) break;

    try {
      const result = await prepareWeeklyDiscoveryDropForUser(userId, targetDate);
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

  const preparedCount = countPreparedScheduledDiscoveryDrops(WEEKLY_DROP_TYPE, periodKey);
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
