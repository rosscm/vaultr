import { ChannelType, Client, EmbedBuilder } from 'discord.js';
import {
  discoveryDropOpenButton,
  prepareWeeklyDiscoveryDropForUser,
  type WeeklyPreparationStructuredResult
} from '../commands/discover.js';
import { listGuildCommandChannels } from './chase-store.js';
import {
  getScheduledDiscoveryDrop,
  listScheduledDiscoveryDropAnnouncements,
  markScheduledDiscoveryDropAnnouncement,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  type ScheduledDiscoveryDrop
} from './scheduled-discovery-drops.js';
import {
  claimWeeklyDiscoveryPreparationLease,
  completeWeeklyDiscoveryPreparationState,
  getWeeklyDiscoveryPreparationState,
  listWeeklyDiscoveryPreparationStates,
  markWeeklyDiscoveryDeliveryAttempt,
  markWeeklyDiscoveryDeliveredForPeriod,
  upsertWeeklyDiscoveryPreparationState,
  type WeeklyDiscoveryDeliveryState,
  type WeeklyDiscoveryPreparationState,
  type WeeklyDiscoveryPreparationStateStatus
} from './weekly-discovery-preparation-state.js';
import { countProUsersIneligibleForWeeklyDiscovery, listProUsersEligibleForWeeklyDiscovery } from './weekly-discovery-eligibility.js';

const WEEKLY_DROP_TYPE = 'WEEKLY_DISCOVERY' as const;

let schedulerTimer: NodeJS.Timeout | undefined;
let schedulerRunning = false;

export type WeeklyDiscoveryPreparationHealth = {
  periodKey: string;
  targetDate: Date;
  availableAt: string;
  proUsers: number;
  ineligible: number;
  prepared: number;
  ready: number;
  partial: number;
  delivered: number;
  deliveryPending: number;
  preparing: number;
  retryScheduled: number;
  failedFinal: number;
  failed: number;
  missing: number;
  overdueUnresolved: number;
  overdueUnprepared: number;
  staleLeases: number;
  lateRecoveries: number;
  ownerAlertSent: number;
  refreshDue: number;
  oldestPreparedUpdatedAt?: string;
  oldestPendingUpdatedAt?: string;
  lastAttemptAt?: string;
  lastFailure?: string;
  nextRetryAt?: string;
  automaticRecoveryActive: boolean;
};

export type WeeklyPreparationAttemptExecution = {
  leaseGeneration?: number;
  result: WeeklyPreparationStructuredResult;
  state: WeeklyDiscoveryPreparationState | null;
};

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

function minMarketReadyItemsForAnnouncement(): number {
  return envNumber('DISCOVERY_DROP_ANNOUNCE_MIN_READY_ITEMS', 5, 1, 20);
}

function preparationLeaseMs(): number {
  return envNumber('DISCOVERY_DROP_PREPARATION_LEASE_MS', 10 * 60 * 1000, 60_000, 30 * 60 * 1000);
}

function retryIntervalsMs(): number[] {
  return [
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000
  ];
}

function ownerAlertGraceMs(): number {
  return envNumber('DISCOVERY_DROP_OWNER_ALERT_GRACE_MS', 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function validScheduledDrop(drop: ScheduledDiscoveryDrop | null): boolean {
  return !!drop && drop.itemCount > 0 && (drop.status === 'READY' || drop.status === 'PARTIAL');
}

function releasePassed(availableAt: string, now: Date): boolean {
  return now.getTime() >= Date.parse(availableAt);
}

function nextRetryAtForAttempt(attemptCount: number, now = new Date()): string {
  const intervals = retryIntervalsMs();
  const intervalMs = intervals[Math.min(intervals.length - 1, Math.max(0, attemptCount - 1))];
  return new Date(now.getTime() + intervalMs).toISOString();
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
  refreshHours = envNumber('DISCOVERY_DROP_PREPARE_REFRESH_HOURS', 12, 1, 168)
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
    .setTitle('Vaultr Weekly Discovery')
    .setDescription([
      '💫 **Vaultr Weekly Discovery**',
      '',
      'Collector picks are freshly brewed and ready to browse!',
      '',
      'Full Vault gets a deeper Weekly Shelf shaped by your Vault and taste profile memory, while Free gets a tasty appetizer 🫰'
    ].join('\n'))
    .setFooter({ text: 'Vaultr • Weekly Shelf' })
    .setTimestamp();
}

function stateFromDrop(
  userId: string,
  periodKey: string,
  availableAt: string,
  now: Date,
  current: WeeklyDiscoveryPreparationState | null
): WeeklyDiscoveryPreparationState {
  const drop = getScheduledDiscoveryDrop(userId, WEEKLY_DROP_TYPE, periodKey);
  const hasAnnouncement = listScheduledDiscoveryDropAnnouncements(WEEKLY_DROP_TYPE, periodKey).length > 0;
  const isReleased = releasePassed(availableAt, now);
  if (validScheduledDrop(drop)) {
    const deliveryState: WeeklyDiscoveryDeliveryState = isReleased
      ? (hasAnnouncement ? 'DELIVERED' : 'PENDING')
      : 'NONE';
    return upsertWeeklyDiscoveryPreparationState({
      userId,
      periodKey,
      state: 'READY',
      attemptCount: current?.attemptCount ?? 0,
      firstAttemptAt: current?.firstAttemptAt,
      lastAttemptAt: current?.lastAttemptAt,
      nextRetryAt: undefined,
      lastOutcome: current?.lastOutcome ?? 'PREPARED',
      failureCode: undefined,
      failureSummary: undefined,
      preparationGeneration: current?.preparationGeneration ?? 0,
      leaseExpiresAt: undefined,
      releasePassed: isReleased,
      ownerAlertSent: current?.ownerAlertSent ?? false,
      recoveredAfterRelease: current?.recoveredAfterRelease ?? false,
      deliveryState,
      deliveryAttemptCount: current?.deliveryAttemptCount ?? 0,
      lastDeliveryAttemptAt: current?.lastDeliveryAttemptAt,
      deliveryError: deliveryState === 'DELIVERED' ? undefined : current?.deliveryError,
      deliveredAt: deliveryState === 'DELIVERED' ? current?.deliveredAt ?? now.toISOString() : current?.deliveredAt,
      announcementGuildId: current?.announcementGuildId,
      announcementMessageId: current?.announcementMessageId
    });
  }

  const inferredState: WeeklyDiscoveryPreparationStateStatus =
    drop?.status === 'FAILED'
      ? 'FAILED_FINAL'
      : drop?.status === 'PREPARING'
        ? 'PREPARING'
        : 'PENDING';

  return upsertWeeklyDiscoveryPreparationState({
    userId,
    periodKey,
    state: current?.state ?? inferredState,
    attemptCount: current?.attemptCount ?? 0,
    firstAttemptAt: current?.firstAttemptAt,
    lastAttemptAt: current?.lastAttemptAt,
    nextRetryAt: current?.nextRetryAt ?? now.toISOString(),
    lastOutcome: current?.lastOutcome,
    failureCode: current?.failureCode,
    failureSummary: current?.failureSummary,
    preparationGeneration: current?.preparationGeneration ?? 0,
    leaseExpiresAt: current?.leaseExpiresAt,
    releasePassed: isReleased,
    ownerAlertSent: current?.ownerAlertSent ?? false,
    recoveredAfterRelease: current?.recoveredAfterRelease ?? false,
    deliveryState: current?.deliveryState ?? 'NONE',
    deliveryAttemptCount: current?.deliveryAttemptCount ?? 0,
    lastDeliveryAttemptAt: current?.lastDeliveryAttemptAt,
    deliveryError: current?.deliveryError,
    deliveredAt: current?.deliveredAt,
    announcementGuildId: current?.announcementGuildId,
    announcementMessageId: current?.announcementMessageId
  });
}

function shouldAttemptPreparation(state: WeeklyDiscoveryPreparationState, targetDate: Date, now: Date): boolean {
  if (state.state === 'FAILED_FINAL') return false;
  if (state.state === 'READY') {
    const existing = getScheduledDiscoveryDrop(state.userId, WEEKLY_DROP_TYPE, state.periodKey);
    return shouldPrepareWeeklyDrop(existing, targetDate, now);
  }
  if (state.state === 'PREPARING' && state.leaseExpiresAt && Date.parse(state.leaseExpiresAt) > now.getTime()) return false;
  if (state.state === 'RETRY_SCHEDULED' && state.nextRetryAt && Date.parse(state.nextRetryAt) > now.getTime()) return false;
  return true;
}

export async function runWeeklyDiscoveryPreparationAttempt(
  userId: string,
  date = new Date(),
  options: { force?: boolean; hydrateMarketInline?: boolean; allowRecentRepeatFiller?: boolean } = {}
): Promise<WeeklyPreparationAttemptExecution> {
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, date);
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, date);
  const now = new Date();
  const lease = claimWeeklyDiscoveryPreparationLease({
    userId,
    periodKey,
    now: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + preparationLeaseMs()).toISOString(),
    releasePassed: releasePassed(availability.availableAt, now)
  });

  if (!lease) {
    return {
      result: {
        outcome: 'RETRYABLE_FAILURE',
        code: 'STALE_PREPARATION_LEASE',
        summary: 'Another preparation attempt is already active',
        itemCount: 0,
        hasFullDiscovery: true,
        prepared: false
      },
      state: getWeeklyDiscoveryPreparationState(userId, periodKey)
    };
  }

  const result = await prepareWeeklyDiscoveryDropForUser(userId, date, {
    ...options,
    preparationGeneration: lease.preparationGeneration,
    abortSignal: undefined,
    isCurrentGeneration: () => getWeeklyDiscoveryPreparationState(userId, periodKey)?.preparationGeneration === lease.preparationGeneration
  });

  const deliveredAlready = listScheduledDiscoveryDropAnnouncements(WEEKLY_DROP_TYPE, periodKey).length > 0;
  const nextState = completeWeeklyDiscoveryPreparationState({
    userId,
    periodKey,
    generation: lease.preparationGeneration,
    state:
      result.outcome === 'PREPARED' || result.outcome === 'NOT_REQUIRED'
        ? 'READY'
        : result.outcome === 'TERMINAL_FAILURE'
          ? 'FAILED_FINAL'
          : 'RETRY_SCHEDULED',
    lastOutcome:
      result.outcome === 'PREPARED'
        ? 'PREPARED'
        : result.outcome === 'TERMINAL_FAILURE'
          ? 'TERMINAL_FAILURE'
          : result.outcome === 'NOT_REQUIRED'
            ? 'NOT_REQUIRED'
            : 'RETRYABLE_FAILURE',
    failureCode:
      result.outcome === 'RETRYABLE_FAILURE' || result.outcome === 'TERMINAL_FAILURE'
        ? result.code
        : undefined,
    failureSummary:
      result.outcome === 'RETRYABLE_FAILURE' || result.outcome === 'TERMINAL_FAILURE'
        ? result.summary
        : undefined,
    nextRetryAt: result.outcome === 'RETRYABLE_FAILURE' ? nextRetryAtForAttempt(lease.attemptCount, now) : undefined,
    releasePassed: releasePassed(availability.availableAt, now),
    deliveryState:
      result.outcome === 'PREPARED' || result.outcome === 'NOT_REQUIRED'
        ? (releasePassed(availability.availableAt, now) ? (deliveredAlready ? 'DELIVERED' : 'PENDING') : 'NONE')
        : 'NONE',
    now: now.toISOString()
  });

  return { leaseGeneration: lease.preparationGeneration, result, state: nextState };
}

function reconcileWeeklyPreparationStates(now: Date): WeeklyDiscoveryPreparationState[] {
  const targetDate = weeklyPreparationTargetDate(now);
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, targetDate);
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, targetDate);
  const eligibleUsers = listProUsersEligibleForWeeklyDiscovery();
  const states: WeeklyDiscoveryPreparationState[] = [];

  for (const userId of eligibleUsers) {
    const current = getWeeklyDiscoveryPreparationState(userId, periodKey);
    states.push(stateFromDrop(userId, periodKey, availability.availableAt, now, current));
  }

  return states;
}

async function prepareWeeklyDrops(now: Date): Promise<{ periodKey: string; prepared: number; scheduled: number; failed: number }> {
  const targetDate = weeklyPreparationTargetDate(now);
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, targetDate);
  const batchSize = envNumber('DISCOVERY_DROP_PREPARE_BATCH_SIZE', 3, 1, 25);
  const reconciled = reconcileWeeklyPreparationStates(now);
  let prepared = 0;
  let scheduled = 0;
  let failed = 0;

  for (const state of reconciled) {
    if (!shouldAttemptPreparation(state, targetDate, now)) continue;
    if (scheduled >= batchSize) break;
    scheduled += 1;

    const result = await runWeeklyDiscoveryPreparationAttempt(state.userId, targetDate, { force: true });
    if (result.result.outcome === 'PREPARED' || result.result.outcome === 'NOT_REQUIRED') prepared += 1;
    else failed += 1;
  }

  return { periodKey, prepared, scheduled, failed };
}

async function announceWeeklyDrop(client: Client, now: Date): Promise<{ periodKey: string; announced: number; skipped: number }> {
  if (!envFlag('DISCOVERY_DROP_ANNOUNCEMENTS_ENABLED', true)) {
    return { periodKey: scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, now), announced: 0, skipped: 0 };
  }

  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, now);
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, now);
  if (Date.parse(availability.availableAt) > now.getTime()) return { periodKey, announced: 0, skipped: 0 };

  const preparedStates = listWeeklyDiscoveryPreparationStates(periodKey)
    .filter((state) => state.state === 'READY' && state.deliveryState !== 'DELIVERED');
  if (preparedStates.length === 0) return { periodKey, announced: 0, skipped: 0 };

  const announceableUsers = preparedStates.filter((state) => {
    const drop = getScheduledDiscoveryDrop(state.userId, WEEKLY_DROP_TYPE, periodKey);
    return !!drop && drop.marketReadyCount >= minMarketReadyItemsForAnnouncement();
  });
  if (announceableUsers.length === 0) return { periodKey, announced: 0, skipped: 0 };

  const existingAnnouncements = listScheduledDiscoveryDropAnnouncements(WEEKLY_DROP_TYPE, periodKey);
  if (existingAnnouncements.length > 0) {
    markWeeklyDiscoveryDeliveredForPeriod({ periodKey, userIds: preparedStates.map((state) => state.userId), now: now.toISOString() });
    return { periodKey, announced: 0, skipped: existingAnnouncements.length };
  }

  let announced = 0;
  let skipped = 0;
  const userIds = preparedStates.map((state) => state.userId);
  for (const { guildId, channelId } of listGuildCommandChannels()) {
    if (listScheduledDiscoveryDropAnnouncements(WEEKLY_DROP_TYPE, periodKey).some((row) => row.guildId === guildId)) {
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
        embeds: [weeklyDropAnnouncementEmbed(periodKey, announceableUsers.length)],
        components: [discoveryDropOpenButton(WEEKLY_DROP_TYPE, periodKey)]
      });
      for (const state of preparedStates) {
        markWeeklyDiscoveryDeliveryAttempt({
          userId: state.userId,
          periodKey,
          state: 'PENDING',
          now: now.toISOString()
        });
      }
      if (markScheduledDiscoveryDropAnnouncement({ guildId, dropType: WEEKLY_DROP_TYPE, periodKey, channelId, messageId: message.id })) {
        announced += 1;
        markWeeklyDiscoveryDeliveredForPeriod({
          periodKey,
          userIds,
          guildId,
          messageId: message.id,
          now: now.toISOString()
        });
      }
    } catch (error) {
      skipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      for (const state of preparedStates) {
        markWeeklyDiscoveryDeliveryAttempt({
          userId: state.userId,
          periodKey,
          state: 'PENDING',
          error: message.slice(0, 280),
          now: now.toISOString()
        });
      }
      console.warn(`[DiscoveryDrops] Failed to announce weekly drop for guild ${guildId}`, error);
    }
  }

  return { periodKey, announced, skipped };
}

export function getWeeklyDiscoveryPreparationHealth(now = new Date()): WeeklyDiscoveryPreparationHealth {
  const targetDate = weeklyPreparationTargetDate(now);
  const periodKey = scheduledDiscoveryPeriodKey(WEEKLY_DROP_TYPE, targetDate);
  const availability = scheduledDiscoveryAvailability(WEEKLY_DROP_TYPE, targetDate);
  const availableAtMs = Date.parse(availability.availableAt);
  const eligibleUsers = listProUsersEligibleForWeeklyDiscovery();
  const ineligible = countProUsersIneligibleForWeeklyDiscovery();
  const states = eligibleUsers.map((userId) => stateFromDrop(userId, periodKey, availability.availableAt, now, getWeeklyDiscoveryPreparationState(userId, periodKey)));

  let prepared = 0;
  let ready = 0;
  let partial = 0;
  let delivered = 0;
  let deliveryPending = 0;
  let preparing = 0;
  let retryScheduled = 0;
  let failedFinal = 0;
  let missing = 0;
  let overdueUnresolved = 0;
  let overdueUnprepared = 0;
  let staleLeases = 0;
  let lateRecoveries = 0;
  let ownerAlertSent = 0;
  let oldestPreparedUpdatedAt: string | undefined;
  let oldestPendingUpdatedAt: string | undefined;
  let lastAttemptAt: string | undefined;
  let nextRetryAt: string | undefined;
  let lastFailure: string | undefined;

  for (const state of states) {
    if (state.lastAttemptAt && (!lastAttemptAt || Date.parse(state.lastAttemptAt) > Date.parse(lastAttemptAt))) lastAttemptAt = state.lastAttemptAt;
    if (state.nextRetryAt && (!nextRetryAt || Date.parse(state.nextRetryAt) < Date.parse(nextRetryAt))) nextRetryAt = state.nextRetryAt;
    if (state.failureSummary && (!state.nextRetryAt || !lastFailure)) lastFailure = state.failureSummary;
    if (state.ownerAlertSent) ownerAlertSent += 1;
    if (state.recoveredAfterRelease) lateRecoveries += 1;
    if (state.state === 'PREPARING' && state.leaseExpiresAt && Date.parse(state.leaseExpiresAt) <= now.getTime()) staleLeases += 1;
    const drop = getScheduledDiscoveryDrop(state.userId, WEEKLY_DROP_TYPE, periodKey);

    switch (state.state) {
      case 'READY':
        prepared += 1;
        if (drop?.status === 'PARTIAL') partial += 1;
        else ready += 1;
        if (drop?.updatedAt && (!oldestPreparedUpdatedAt || Date.parse(drop.updatedAt) < Date.parse(oldestPreparedUpdatedAt))) {
          oldestPreparedUpdatedAt = drop.updatedAt;
        }
        if (state.deliveryState === 'DELIVERED') delivered += 1;
        else if (state.deliveryState === 'PENDING') deliveryPending += 1;
        break;
      case 'PREPARING':
        preparing += 1;
        if (!oldestPendingUpdatedAt || Date.parse(drop?.updatedAt ?? state.updatedAt) < Date.parse(oldestPendingUpdatedAt)) {
          oldestPendingUpdatedAt = drop?.updatedAt ?? state.updatedAt;
        }
        break;
      case 'RETRY_SCHEDULED':
        retryScheduled += 1;
        if (!oldestPendingUpdatedAt || Date.parse(drop?.updatedAt ?? state.updatedAt) < Date.parse(oldestPendingUpdatedAt)) {
          oldestPendingUpdatedAt = drop?.updatedAt ?? state.updatedAt;
        }
        break;
      case 'FAILED_FINAL':
        failedFinal += 1;
        if (!oldestPendingUpdatedAt || Date.parse(drop?.updatedAt ?? state.updatedAt) < Date.parse(oldestPendingUpdatedAt)) {
          oldestPendingUpdatedAt = drop?.updatedAt ?? state.updatedAt;
        }
        break;
      case 'PENDING':
        missing += 1;
        if (!oldestPendingUpdatedAt || Date.parse(drop?.updatedAt ?? state.updatedAt) < Date.parse(oldestPendingUpdatedAt)) {
          oldestPendingUpdatedAt = drop?.updatedAt ?? state.updatedAt;
        }
        break;
    }

    const unresolved = state.state !== 'READY' || state.deliveryState !== 'DELIVERED';
    if (now.getTime() >= availableAtMs && unresolved) overdueUnresolved += 1;
    if (now.getTime() >= availableAtMs && state.state !== 'READY') overdueUnprepared += 1;
  }

  return {
    periodKey,
    targetDate,
    availableAt: availability.availableAt,
    proUsers: eligibleUsers.length,
    ineligible,
    prepared,
    ready,
    partial,
    delivered,
    deliveryPending,
    preparing,
    retryScheduled,
    failedFinal,
    failed: failedFinal,
    missing,
    overdueUnresolved,
    overdueUnprepared,
    staleLeases,
    lateRecoveries,
    ownerAlertSent,
    refreshDue: retryScheduled + missing,
    oldestPreparedUpdatedAt,
    oldestPendingUpdatedAt,
    lastAttemptAt,
    lastFailure,
    nextRetryAt,
    automaticRecoveryActive: retryScheduled > 0 || preparing > 0
  };
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
  const preparedCount = getWeeklyDiscoveryPreparationHealth(now).prepared;
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
        `[DiscoveryDrops] weekly=${prepared.periodKey} prepared=${prepared.prepared} scheduled=${prepared.scheduled} failed=${prepared.failed} announced=${announced.announced}`
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

export { ownerAlertGraceMs };
