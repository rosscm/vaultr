import { afterEach, describe, expect, it } from 'vitest';
import {
  claimWeeklyDiscoveryPreparationLease,
  completeWeeklyDiscoveryPreparationState,
  deleteWeeklyDiscoveryPreparationState,
  getWeeklyDiscoveryPreparationState
} from '../weekly-discovery-preparation-state.js';

const rows: Array<{ userId: string; periodKey: string }> = [];

afterEach(() => {
  for (const row of rows.splice(0)) deleteWeeklyDiscoveryPreparationState(row.userId, row.periodKey);
});

describe('weekly discovery preparation state', () => {
  it('claims a preparation lease once until the lease expires', () => {
    const userId = `weekly-lease-${Date.now()}`;
    const periodKey = '2026-W31';
    rows.push({ userId, periodKey });

    const first = claimWeeklyDiscoveryPreparationLease({
      userId,
      periodKey,
      now: '2026-07-27T12:00:00.000Z',
      leaseExpiresAt: '2026-07-27T12:10:00.000Z',
      releasePassed: true
    });
    const second = claimWeeklyDiscoveryPreparationLease({
      userId,
      periodKey,
      now: '2026-07-27T12:01:00.000Z',
      leaseExpiresAt: '2026-07-27T12:11:00.000Z',
      releasePassed: true
    });

    expect(first?.state).toBe('PREPARING');
    expect(first?.attemptCount).toBe(1);
    expect(second).toBeNull();
  });

  it('does not let a stale generation overwrite a newer retry state', () => {
    const userId = `weekly-generation-${Date.now()}`;
    const periodKey = '2026-W31';
    rows.push({ userId, periodKey });

    const first = claimWeeklyDiscoveryPreparationLease({
      userId,
      periodKey,
      now: '2026-07-27T12:00:00.000Z',
      leaseExpiresAt: '2026-07-27T12:01:00.000Z',
      releasePassed: true
    });
    const reclaimed = claimWeeklyDiscoveryPreparationLease({
      userId,
      periodKey,
      now: '2026-07-27T12:02:00.000Z',
      leaseExpiresAt: '2026-07-27T12:12:00.000Z',
      releasePassed: true
    });

    const staleCompletion = completeWeeklyDiscoveryPreparationState({
      userId,
      periodKey,
      generation: first?.preparationGeneration ?? 0,
      state: 'READY',
      lastOutcome: 'PREPARED',
      releasePassed: true,
      deliveryState: 'PENDING',
      now: '2026-07-27T12:03:00.000Z'
    });
    const current = getWeeklyDiscoveryPreparationState(userId, periodKey);

    expect(reclaimed?.preparationGeneration).toBeGreaterThan(first?.preparationGeneration ?? 0);
    expect(staleCompletion).toBeNull();
    expect(current?.state).toBe('PREPARING');
    expect(current?.attemptCount).toBe(2);
  });
});
