import { afterEach, describe, expect, it } from 'vitest';
import { addChase, removeAllChases, setUserPlan } from '../chase-store.js';
import { getWeeklyDiscoveryPreparationHealth, shouldPrepareWeeklyDrop, weeklyPreparationTargetDate } from '../discovery-drop-scheduler.js';
import { deleteScheduledDiscoveryDrop, scheduledDiscoveryAvailability, scheduledDiscoveryPeriodKey, upsertScheduledDiscoveryDrop } from '../scheduled-discovery-drops.js';

const userIds: string[] = [];
const drops: Array<{ userId: string; periodKey: string }> = [];

afterEach(() => {
  for (const { userId, periodKey } of drops.splice(0)) deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey);
  for (const userId of userIds.splice(0)) removeAllChases(userId);
});

function proCollector(userId: string): void {
  userIds.push(userId);
  setUserPlan(userId, 'PRO');
  addChase({ userId, cardName: `Gardevoir ex ${userId}`, priority: 'GRAIL', maxPrice: 250 });
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
    expect(health.prepared).toBe(1);
    expect(health.ready).toBe(1);
    expect(health.missing).toBe(1);
    expect(health.refreshDue).toBe(1);
    expect(health.overdueUnprepared).toBe(0);
    expect(health.oldestPreparedUpdatedAt).toBe('2026-06-20T00:00:00.000Z');
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
    expect(health.prepared).toBe(1);
    expect(health.partial).toBe(1);
    expect(health.failed).toBe(1);
    expect(health.overdueUnprepared).toBe(1);
    expect(health.oldestPendingUpdatedAt).toBe('2026-06-22T09:00:00.000Z');
  });
});
