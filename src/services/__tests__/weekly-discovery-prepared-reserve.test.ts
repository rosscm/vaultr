import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteWeeklyDiscoveryPreparedReserve,
  getWeeklyDiscoveryPreparedReserve,
  upsertWeeklyDiscoveryPreparedReserve
} from '../weekly-discovery-prepared-reserve.js';

const rows: Array<{ userId: string; periodKey: string }> = [];

afterEach(() => {
  for (const row of rows.splice(0)) deleteWeeklyDiscoveryPreparedReserve(row.userId, row.periodKey);
});

describe('weekly discovery prepared reserve', () => {
  it('stores a durable per-period reserve with readiness diagnostics', () => {
    const userId = `prepared-reserve-${Date.now()}`;
    const periodKey = '2026-W32';
    rows.push({ userId, periodKey });

    upsertWeeklyDiscoveryPreparedReserve({
      userId,
      periodKey,
      preparationGeneration: 3,
      reserveCandidates: [{ suggestion: { name: 'Mew Expedition 19/165' } }],
      canonicalLookupEvidence: { 'Mew Expedition 19/165': { provider: 'Pokemon TCG' } },
      reserveCount: 27,
      canonicalReadyCount: 24,
      imageReadyCount: 23,
      marketReadyCount: 20,
      personallyDefensibleCount: 21,
      projectedSelectableCount: 20,
      projectedMarketResolvedCount: 18,
      viableAlternativeCount: 6,
      pendingMarketJobCount: 2,
      failedMarketJobCount: 1,
      blockingShortages: ['headroom shortfall 1 viable alternatives'],
      lastCompletedStage: 'post-topoff-supply-readiness',
      sourceFingerprint: 'fingerprint-1',
      lastMeaningfulProgressAt: '2026-08-03T12:00:00.000Z'
    });

    const saved = getWeeklyDiscoveryPreparedReserve<{ suggestion: { name: string } }, Record<string, unknown>>(userId, periodKey);

    expect(saved).toMatchObject({
      userId,
      periodKey,
      preparationGeneration: 3,
      reserveCount: 27,
      canonicalReadyCount: 24,
      imageReadyCount: 23,
      marketReadyCount: 20,
      projectedSelectableCount: 20,
      projectedMarketResolvedCount: 18,
      pendingMarketJobCount: 2,
      failedMarketJobCount: 1,
      blockingShortages: ['headroom shortfall 1 viable alternatives'],
      lastCompletedStage: 'post-topoff-supply-readiness',
      sourceFingerprint: 'fingerprint-1'
    });
    expect(saved?.reserveCandidates[0]).toMatchObject({ suggestion: { name: 'Mew Expedition 19/165' } });
  });

  it('does not let an older generation overwrite a newer prepared reserve snapshot', () => {
    const userId = `prepared-reserve-stale-${Date.now()}`;
    const periodKey = '2026-W32';
    rows.push({ userId, periodKey });

    const current = upsertWeeklyDiscoveryPreparedReserve({
      userId,
      periodKey,
      preparationGeneration: 5,
      reserveCandidates: [{ suggestion: { name: 'Current Reserve Card' } }],
      canonicalLookupEvidence: {},
      reserveCount: 25,
      canonicalReadyCount: 22,
      imageReadyCount: 22,
      marketReadyCount: 19,
      personallyDefensibleCount: 20,
      projectedSelectableCount: 20,
      projectedMarketResolvedCount: 18,
      viableAlternativeCount: 4,
      pendingMarketJobCount: 0,
      failedMarketJobCount: 0,
      blockingShortages: [],
      lastCompletedStage: 'initial-supply-readiness',
      lastMeaningfulProgressAt: '2026-08-03T12:00:00.000Z'
    });
    const stale = upsertWeeklyDiscoveryPreparedReserve({
      userId,
      periodKey,
      preparationGeneration: 4,
      reserveCandidates: [{ suggestion: { name: 'Stale Reserve Card' } }],
      canonicalLookupEvidence: {},
      reserveCount: 10,
      canonicalReadyCount: 8,
      imageReadyCount: 8,
      marketReadyCount: 7,
      personallyDefensibleCount: 7,
      projectedSelectableCount: 6,
      projectedMarketResolvedCount: 6,
      viableAlternativeCount: 0,
      pendingMarketJobCount: 4,
      failedMarketJobCount: 3,
      blockingShortages: ['projected shelf shortfall 6/20'],
      lastCompletedStage: 'initial-reserve-prune',
      lastMeaningfulProgressAt: '2026-08-03T12:01:00.000Z'
    });

    expect(current.saved).toBe(true);
    expect(stale.saved).toBe(false);
    expect(stale.record?.preparationGeneration).toBe(5);
    expect(stale.record?.reserveCandidates[0]).toMatchObject({ suggestion: { name: 'Current Reserve Card' } });
  });
});
