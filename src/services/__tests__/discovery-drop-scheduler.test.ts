import { describe, expect, it } from 'vitest';
import { shouldPrepareWeeklyDrop, weeklyPreparationTargetDate } from '../discovery-drop-scheduler.js';
import { scheduledDiscoveryPeriodKey } from '../scheduled-discovery-drops.js';

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
});