import { ChannelType } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as discover from '../../commands/discover.js';
import { addChase, removeAllChases, setGuildCommandChannel, setUserPlan } from '../chase-store.js';
import { db } from '../db.js';
import { getWeeklyDiscoveryPreparationHealth, runDiscoveryDropSchedulerOnce, runWeeklyDiscoveryPreparationAttempt, shouldPrepareWeeklyDrop, weeklyPreparationTargetDate } from '../discovery-drop-scheduler.js';
import { deleteScheduledDiscoveryDrop, deleteScheduledDiscoveryDropAnnouncement, hasScheduledDiscoveryDropAnnouncement, scheduledDiscoveryAvailability, scheduledDiscoveryPeriodKey, upsertScheduledDiscoveryDrop } from '../scheduled-discovery-drops.js';
import { deleteWeeklyDiscoveryPreparationStatesForPeriod, listWeeklyDiscoveryPreparationStates } from '../weekly-discovery-preparation-state.js';

const userIds: string[] = [];
const drops: Array<{ userId: string; periodKey: string }> = [];
const announcements: Array<{ guildId: string; periodKey: string }> = [];
const guildIds = new Set<string>();
const deleteGuildAlertChannelStmt = db.prepare('DELETE FROM guild_alert_channels WHERE guild_id = ?');

afterEach(() => {
  const periods = new Set(drops.map((drop) => drop.periodKey).concat(announcements.map((announcement) => announcement.periodKey)));
  for (const { userId, periodKey } of drops.splice(0)) deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey);
  for (const { guildId, periodKey } of announcements.splice(0)) deleteScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey);
  for (const periodKey of periods) deleteWeeklyDiscoveryPreparationStatesForPeriod(periodKey);
  for (const guildId of guildIds) deleteGuildAlertChannelStmt.run(guildId);
  guildIds.clear();
  for (const userId of userIds.splice(0)) removeAllChases(userId);
});

function proCollector(userId: string): void {
  userIds.push(userId);
  setUserPlan(userId, 'PRO');
  for (let index = 1; index <= 5; index += 1) {
    addChase({ userId, cardName: `Gardevoir ex ${userId} ${index}`, priority: index === 1 ? 'GRAIL' : 'NORMAL', maxPrice: 250 });
  }
}

describe('discovery drop scheduler', () => {
  it('starts preparing the next Weekly Shelf before Monday delivery day', () => {
    const fridayBeforeDrop = new Date('2026-06-19T13:00:00.000Z');
    const wednesdayBeforeDrop = new Date('2026-06-17T13:00:00.000Z');

    expect(scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(fridayBeforeDrop, 3))).toBe('2026-W26');
    expect(scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(wednesdayBeforeDrop, 3))).toBe('2026-W25');
  });

  it('refreshes stale prepared shelves before delivery but not after release', () => {
    const targetDate = new Date('2026-06-22T12:00:00.000Z');
    const staleDrop = { status: 'PARTIAL' as const, itemCount: 8, updatedAt: '2026-06-20T12:00:00.000Z' };
    const freshDrop = { status: 'READY' as const, itemCount: 20, updatedAt: '2026-06-21T18:00:00.000Z' };

    expect(shouldPrepareWeeklyDrop(staleDrop, targetDate, new Date('2026-06-21T13:00:00.000Z'), 12)).toBe(true);
    expect(shouldPrepareWeeklyDrop(freshDrop, targetDate, new Date('2026-06-22T01:00:00.000Z'), 12)).toBe(false);
    expect(shouldPrepareWeeklyDrop(staleDrop, targetDate, new Date('2026-06-22T13:00:00.000Z'), 12)).toBe(false);
  });

  it('summarizes weekly prep coverage for Pro collectors before release', () => {
    const now = new Date('2026-06-21T13:00:00.000Z');
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const readyUserId = `weekly-ready-${Date.now()}`;
    const missingUserId = `weekly-missing-${Date.now()}`;

    proCollector(readyUserId);
    proCollector(missingUserId);

    drops.push({ userId: readyUserId, periodKey });
    upsertScheduledDiscoveryDrop({
      userId: readyUserId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'READY',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: { name: 'Mew RC24', lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
          imageUrl: 'https://example.com/mew.png',
          market: { status: 'READY', currency: 'CAD', askingTotal: 120, updatedAt: '2026-06-21T00:00:00.000Z' }
        }
      ]
    }, '2026-06-20T00:00:00.000Z');

    const health = getWeeklyDiscoveryPreparationHealth(now);

    expect(health.periodKey).toBe(periodKey);
    expect(health.proUsers).toBe(2);
    expect(health.ineligible).toBe(0);
    expect(health.prepared).toBe(1);
    expect(health.ready).toBe(1);
    expect(health.missing).toBe(1);
    expect(health.refreshDue).toBe(1);
    expect(health.overdueUnprepared).toBe(0);
    expect(health.oldestPreparedUpdatedAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('excludes thin Pro profiles from scheduled weekly prep coverage', () => {
    const now = new Date('2026-06-21T13:00:00.000Z');
    const thinUserId = `weekly-thin-${Date.now()}`;
    const readyUserId = `weekly-ready-thin-test-${Date.now()}`;
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));

    userIds.push(thinUserId);
    setUserPlan(thinUserId, 'PRO');
    addChase({ userId: thinUserId, cardName: 'Gardevoir ex Paldean Fates 233', priority: 'NORMAL', maxPrice: 200 });
    addChase({ userId: thinUserId, cardName: 'Origin Forme Palkia V Astral Radiance 167', priority: 'NORMAL', maxPrice: 135 });
    proCollector(readyUserId);

    drops.push({ userId: readyUserId, periodKey });
    upsertScheduledDiscoveryDrop({
      userId: readyUserId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'READY',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: { name: 'Mew RC24', lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
          imageUrl: 'https://example.com/mew.png',
          market: { status: 'READY', currency: 'CAD', askingTotal: 120, updatedAt: '2026-06-21T00:00:00.000Z' }
        }
      ]
    }, '2026-06-20T00:00:00.000Z');

    const health = getWeeklyDiscoveryPreparationHealth(now);

    expect(health.proUsers).toBe(1);
    expect(health.ineligible).toBe(1);
    expect(health.prepared).toBe(1);
    expect(health.missing).toBe(0);
  });

  it('flags overdue unprepared shelves after release', () => {
    const now = new Date('2026-06-22T13:00:00.000Z');
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const partialUserId = `weekly-partial-${Date.now()}`;
    const failedUserId = `weekly-failed-${Date.now()}`;

    proCollector(partialUserId);
    proCollector(failedUserId);

    drops.push({ userId: partialUserId, periodKey });
    drops.push({ userId: failedUserId, periodKey });

    upsertScheduledDiscoveryDrop({
      userId: partialUserId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'PARTIAL',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: { name: 'Gardevoir Nintendo Promo', lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
          imageUrl: 'https://example.com/gardevoir.png',
          market: { status: 'READY', currency: 'CAD', askingTotal: 140, updatedAt: '2026-06-22T10:00:00.000Z' }
        }
      ]
    }, '2026-06-22T10:00:00.000Z');

    upsertScheduledDiscoveryDrop({
      userId: failedUserId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'FAILED',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: { name: 'Espeon Delta Species', lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
          market: { status: 'MISSING', currency: 'CAD', updatedAt: '2026-06-22T09:00:00.000Z' }
        }
      ]
    }, '2026-06-22T09:00:00.000Z');

    const health = getWeeklyDiscoveryPreparationHealth(now);

    expect(health.periodKey).toBe(periodKey);
    expect(health.proUsers).toBe(2);
    expect(health.ineligible).toBe(0);
    expect(health.prepared).toBe(1);
    expect(health.partial).toBe(1);
    expect(health.failed).toBe(1);
    expect(health.overdueUnprepared).toBe(1);
    expect(health.oldestPendingUpdatedAt).toBe('2026-06-22T09:00:00.000Z');
  });

  it('delivers a ready weekly shelf announcement exactly once and marks delivery durable', async () => {
    const now = new Date('2026-06-22T13:00:00.000Z');
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const userId = `weekly-delivery-${Date.now()}`;
    const guildId = `guild-${Date.now()}`;
    announcements.push({ guildId, periodKey });
    drops.push({ userId, periodKey });

    proCollector(userId);
    guildIds.add(guildId);
    setGuildCommandChannel(guildId, `channel-${Date.now()}`);
    upsertScheduledDiscoveryDrop({
      userId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'READY',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: Array.from({ length: 5 }, (_, index) => ({
        position: index + 1,
        suggestion: { name: `Mew RC24 ${index + 1}`, lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
        imageUrl: `https://example.com/mew-${index + 1}.png`,
        imageSourceKind: 'CARD_REFERENCE' as const,
        market: { status: 'READY', currency: 'CAD', askingTotal: 120 + index, updatedAt: '2026-06-22T10:00:00.000Z' }
      }))
    }, '2026-06-22T10:00:00.000Z');

    let sendCount = 0;
    const client = {
      channels: {
        fetch: async () => ({
          type: ChannelType.GuildText,
          send: async () => {
            sendCount += 1;
            return { id: `message-${sendCount}` };
          }
        })
      }
    } as any;

    await runDiscoveryDropSchedulerOnce(client, now);
    await runDiscoveryDropSchedulerOnce(client, now);

    const state = listWeeklyDiscoveryPreparationStates(periodKey).find((entry) => entry.userId === userId);
    expect(sendCount).toBe(1);
    expect(hasScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey)).toBe(true);
    expect(state?.deliveryState).toBe('DELIVERED');
  });

  it('records retryable preparation failure instead of treating it as a skip', async () => {
    const now = new Date('2026-07-27T13:00:00.000Z');
    const userId = `weekly-retry-${Date.now()}`;
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', now);
    proCollector(userId);

    const prepareSpy = vi.spyOn(discover, 'prepareWeeklyDiscoveryDropForUser').mockResolvedValue({
      outcome: 'RETRYABLE_FAILURE',
      code: 'PREPARATION_TIMEOUT',
      summary: 'Weekly discovery refresh deadline exceeded',
      itemCount: 0,
      hasFullDiscovery: true,
      prepared: false
    });

    try {
      const result = await runWeeklyDiscoveryPreparationAttempt(userId, now, { force: true });
      const state = listWeeklyDiscoveryPreparationStates(periodKey).find((entry) => entry.userId === userId);

      expect(result.result.outcome).toBe('RETRYABLE_FAILURE');
      expect(state?.state).toBe('RETRY_SCHEDULED');
      expect(state?.failureCode).toBe('PREPARATION_TIMEOUT');
      expect(state?.attemptCount).toBe(1);
      expect(state?.nextRetryAt).toBeTruthy();
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it('retries failed weekly announcement delivery and does not duplicate success', async () => {
    const now = new Date('2026-07-27T13:00:00.000Z');
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', weeklyPreparationTargetDate(now, 3));
    const userId = `weekly-delivery-retry-${Date.now()}`;
    const guildId = `guild-retry-${Date.now()}`;
    announcements.push({ guildId, periodKey });
    drops.push({ userId, periodKey });

    proCollector(userId);
    guildIds.add(guildId);
    setGuildCommandChannel(guildId, `channel-retry-${Date.now()}`);
    upsertScheduledDiscoveryDrop({
      userId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'READY',
      title: 'Weekly Shelf',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: Array.from({ length: 5 }, (_, index) => ({
        position: index + 1,
        suggestion: { name: `Retry Card ${index + 1}`, lane: 'Collector Compass', laneWhy: 'profile fit', why: 'profile fit', nearby: [] },
        imageUrl: `https://example.com/retry-${index + 1}.png`,
        imageSourceKind: 'CARD_REFERENCE' as const,
        market: { status: 'READY', currency: 'CAD', askingTotal: 120 + index, updatedAt: '2026-07-27T10:00:00.000Z' }
      }))
    }, '2026-07-27T10:00:00.000Z');

    let sendCount = 0;
    const client = {
      channels: {
        fetch: async () => ({
          type: ChannelType.GuildText,
          send: async () => {
            sendCount += 1;
            if (sendCount === 1) throw new Error('discord send failed');
            return { id: `message-${sendCount}` };
          }
        })
      }
    } as any;

    await runDiscoveryDropSchedulerOnce(client, now);
    let state = listWeeklyDiscoveryPreparationStates(periodKey).find((entry) => entry.userId === userId);
    expect(state?.deliveryState).toBe('PENDING');
    expect(state?.deliveryAttemptCount).toBe(1);
    expect(state?.deliveryError).toContain('discord send failed');
    expect(hasScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey)).toBe(false);

    await runDiscoveryDropSchedulerOnce(client, now);
    state = listWeeklyDiscoveryPreparationStates(periodKey).find((entry) => entry.userId === userId);
    expect(sendCount).toBe(2);
    expect(hasScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey)).toBe(true);
    expect(state?.deliveryState).toBe('DELIVERED');
    expect(state?.deliveryAttemptCount).toBe(2);
  });
});
