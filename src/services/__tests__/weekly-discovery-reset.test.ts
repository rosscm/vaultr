import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db.js';
import { addChase, listChases, listRecentUserDiscoveryFeedback, listRecentUserDiscoverySeenNames, listUserTasteMemoryChases, markUserDiscoverySuggestionsSeen, recordDiscoveryAddTaste, recordDiscoveryFeedback, recordDiscoveryTrainingExamples, removeAllChases, setUserPlan, upsertUserDiscoveryState } from '../chase-store.js';
import { upsertDiscoveryUniverseCard, getDiscoveryUniverseCard } from '../discovery-card-universe.js';
import { discoveryMarketCacheKey, getDiscoveryMarketCache, upsertDiscoveryMarketCache } from '../discovery-market-cache.js';
import { replaceDiscoveryUserUniverseCards, listDiscoveryUserUniverseCards } from '../discovery-user-universe.js';
import { getScheduledDiscoveryDrop, markScheduledDiscoveryDropAnnouncement, scheduledDiscoveryAvailability, upsertScheduledDiscoveryDrop } from '../scheduled-discovery-drops.js';
import { parseWeeklyDiscoveryResetArgs, runWeeklyDiscoveryResetCli } from '../../weekly-discovery-reset.js';
import { applyWeeklyDiscoveryReset, buildWeeklyDiscoveryResetPlan } from '../weekly-discovery-reset.js';
import { deleteWeeklyDiscoveryPreparationState, getWeeklyDiscoveryPreparationState, upsertWeeklyDiscoveryPreparationState } from '../weekly-discovery-preparation-state.js';
import { deleteWeeklyDiscoveryPreparedReserve, getWeeklyDiscoveryPreparedReserve, upsertWeeklyDiscoveryPreparedReserve } from '../weekly-discovery-prepared-reserve.js';

const PERIOD_ONE = '2026-W32';
const PERIOD_TWO = '2026-W33';
const TEST_GUILD_ID = 'weekly-reset-guild';

function cleanupUser(userId: string): void {
  removeAllChases(userId);
  db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_alert_settings WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_discovery_feedback WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_discovery_seen WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_training_examples WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_discovery_state WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_user_universe WHERE user_id = ?').run(userId);
  deleteWeeklyDiscoveryPreparationState(userId, PERIOD_ONE);
  deleteWeeklyDiscoveryPreparationState(userId, PERIOD_TWO);
  deleteWeeklyDiscoveryPreparedReserve(userId, PERIOD_ONE);
  deleteWeeklyDiscoveryPreparedReserve(userId, PERIOD_TWO);
  db.prepare('DELETE FROM discovery_scheduled_drops WHERE user_id = ?').run(userId);
}

function cleanupGlobal(): void {
  db.prepare('DELETE FROM discovery_scheduled_drop_announcements WHERE guild_id = ?').run(TEST_GUILD_ID);
  db.prepare('DELETE FROM discovery_market_cache WHERE cache_key LIKE ?').run('["weekly-reset-%');
  db.prepare('DELETE FROM discovery_card_universe WHERE card_key LIKE ?').run('weekly reset %');
}

afterEach(() => {
  cleanupUser('weekly-reset-user-a');
  cleanupUser('weekly-reset-user-b');
  cleanupGlobal();
});

function seedScheduledDrop(userId: string, periodKey: string, dropType: 'WEEKLY_DISCOVERY' | 'MARKET_RADAR' = 'WEEKLY_DISCOVERY'): void {
  const { availableAt, expiresAt } = scheduledDiscoveryAvailability(dropType, new Date(`${periodKey.slice(0, 4)}-08-03T12:00:00.000Z`));
  upsertScheduledDiscoveryDrop(
    {
      userId,
      dropType,
      periodKey,
      status: 'READY',
      title: 'Weekly Discovery',
      currency: 'CAD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: {
            name: `Weekly Reset ${periodKey} 1`,
            lane: 'Collector Compass',
            laneWhy: 'test drop',
            why: 'test drop',
            nearby: []
          },
          imageUrl: 'https://images.example/weekly-reset.png',
          imageSourceName: 'Pokemon TCG API',
          imageSourceKind: 'CARD_REFERENCE',
          market: {
            status: 'READY',
            currency: 'CAD'
          }
        }
      ]
    },
    '2026-08-06T12:00:00.000Z'
  );
}

function seedPreparationState(userId: string, periodKey: string): void {
  upsertWeeklyDiscoveryPreparationState({
    userId,
    periodKey,
    state: 'READY',
    attemptCount: 2,
    firstAttemptAt: '2026-08-04T12:00:00.000Z',
    lastAttemptAt: '2026-08-05T12:00:00.000Z',
    nextRetryAt: '2026-08-06T13:00:00.000Z',
    lastOutcome: 'DELIVERED',
    failureCode: 'ANNOUNCEMENT_SEND_FAILED',
    failureSummary: 'test delivery marker state',
    preparationGeneration: 3,
    leaseExpiresAt: '2026-08-05T12:10:00.000Z',
    releasePassed: true,
    ownerAlertSent: true,
    recoveredAfterRelease: true,
    deliveryState: 'DELIVERED',
    deliveryAttemptCount: 1,
    lastDeliveryAttemptAt: '2026-08-05T12:20:00.000Z',
    deliveryError: 'none',
    deliveredAt: '2026-08-05T12:25:00.000Z',
    announcementGuildId: TEST_GUILD_ID,
    announcementMessageId: `msg-${userId}-${periodKey}`,
    updatedAt: '2026-08-05T12:25:00.000Z'
  });
}

function seedPreparedReserve(userId: string, periodKey: string): void {
  upsertWeeklyDiscoveryPreparedReserve({
    userId,
    periodKey,
    preparationGeneration: 3,
    reserveCandidates: [{ name: `Weekly Reset ${periodKey} Reserve` }],
    canonicalLookupEvidence: { source: 'test' },
    reserveCount: 1,
    canonicalReadyCount: 1,
    imageReadyCount: 1,
    marketReadyCount: 1,
    personallyDefensibleCount: 1,
    projectedSelectableCount: 1,
    projectedMarketResolvedCount: 1,
    viableAlternativeCount: 0,
    pendingMarketJobCount: 0,
    failedMarketJobCount: 0,
    blockingShortages: [],
    lastCompletedStage: 'test',
    sourceFingerprint: `fingerprint-${userId}-${periodKey}`,
    sourceStateUpdatedAt: '2026-08-05T12:00:00.000Z',
    lastMeaningfulProgressAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z'
  });
}

function seedPreservedData(userId: string): { marketKey: string } {
  setUserPlan(userId, 'PRO');
  addChase({ userId, cardName: 'Mew RC24', priority: 'NORMAL', region: 'ANY', listingType: 'ANY' });
  recordDiscoveryAddTaste(userId, 'Mew RC24', 120);
  recordDiscoveryFeedback({
    userId,
    cardName: 'Mew RC24',
    lane: 'Collector Compass',
    feedback: 'MORE_LIKE_THIS',
    maxPrice: 120
  });
  recordDiscoveryTrainingExamples([
    {
      userId,
      surface: 'WEEKLY_DISCOVERY_SHELF',
      periodKey: PERIOD_ONE,
      suggestionName: 'Mew RC24',
      lane: 'Collector Compass',
      position: 1,
      rankerVersion: 'test',
      features: { collectorTerms: ['mew'] },
      scores: { total: 1 }
    }
  ]);
  markUserDiscoverySuggestionsSeen(userId, ['Mew RC24']);
  upsertUserDiscoveryState({
    userId,
    mode: 'ambient:test',
    profileFingerprint: 'fp',
    suggestionNames: ['Mew RC24']
  });
  const marketKey = discoveryMarketCacheKey(`weekly-reset-${userId}`, 'CAD', 'CA');
  upsertDiscoveryMarketCache({
    cacheKey: marketKey,
    suggestionName: `weekly-reset-${userId}`,
    displayCurrency: 'CAD',
    destinationCountry: 'CA',
    typicalRawAskingTotal: 100,
    marketSampleSize: 4
  });
  upsertDiscoveryUniverseCard({
    canonicalName: `Weekly Reset Universe ${userId}`,
    suggestion: { name: `Weekly Reset Universe ${userId}`, lane: 'Collector Compass', laneWhy: 'test', why: 'test', nearby: [] },
    subjectTokens: ['mew'],
    traitTokens: ['promo']
  });
  replaceDiscoveryUserUniverseCards(userId, [
    {
      userId,
      cardKey: `weekly-reset-user-card-${userId}`,
      canonicalName: `Weekly Reset User Universe ${userId}`,
      score: 10,
      scoreComponents: { total: 10 },
      suggestion: { name: `Weekly Reset User Universe ${userId}`, lane: 'Collector Compass', laneWhy: 'test', why: 'test', nearby: [] }
    }
  ]);
  return { marketKey };
}

describe('weekly discovery reset utility', () => {
  it('dry run performs no writes', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);

    const result = applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE }
    });

    expect(result.confirmed).toBe(false);
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).not.toBeNull();
  });

  it('missing --confirm leaves all rows intact', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);

    const output = runWeeklyDiscoveryResetCli(['--user', 'weekly-reset-user-a', '--period', PERIOD_ONE]);

    expect(output.confirmed).toBe(false);
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).not.toBeNull();
  });

  it('rejects placeholder user ids', () => {
    expect(() => parseWeeklyDiscoveryResetArgs(['--user', 'USER_ID', '--all-periods'])).toThrow(/placeholder user ids/i);
  });

  it('requires exactly one period scope', () => {
    expect(() => parseWeeklyDiscoveryResetArgs(['--user', 'weekly-reset-user-a'])).toThrow(/exactly one/i);
    expect(() => parseWeeklyDiscoveryResetArgs(['--user', 'weekly-reset-user-a', '--period', PERIOD_ONE, '--all-periods'])).toThrow(/exactly one/i);
  });

  it('single-period reset deletes only that user and period', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    seedScheduledDrop('weekly-reset-user-a', PERIOD_TWO);
    seedPreparationState('weekly-reset-user-a', PERIOD_TWO);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_TWO);

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_TWO)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_TWO)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_TWO)).not.toBeNull();
  });

  it('all-periods deletes all weekly periods for the named user', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedScheduledDrop('weekly-reset-user-a', PERIOD_TWO);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_TWO);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_TWO);

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'ALL_PERIODS' },
      confirm: true
    });

    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_TWO)).toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_TWO)).toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_TWO)).toBeNull();
  });

  it('leaves other users unchanged', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    seedScheduledDrop('weekly-reset-user-b', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-b', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-b', PERIOD_ONE);

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getScheduledDiscoveryDrop('weekly-reset-user-b', 'WEEKLY_DISCOVERY', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-b', PERIOD_ONE)).not.toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-b', PERIOD_ONE)).not.toBeNull();
  });

  it('keeps other scheduled drop types unchanged', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedScheduledDrop('weekly-reset-user-a', '2026-W32-FRI', 'MARKET_RADAR');
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'MARKET_RADAR', '2026-W32-FRI')).not.toBeNull();
  });

  it('preserves vault, taste memory, feedback, universe data, and market cache', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    const { marketKey } = seedPreservedData('weekly-reset-user-a');

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'ALL_PERIODS' },
      confirm: true
    });

    expect(listChases('weekly-reset-user-a')).toHaveLength(1);
    expect(listUserTasteMemoryChases('weekly-reset-user-a').length).toBeGreaterThanOrEqual(1);
    expect(listRecentUserDiscoveryFeedback('weekly-reset-user-a', 'MORE_LIKE_THIS')).toHaveLength(1);
    expect(listRecentUserDiscoverySeenNames('weekly-reset-user-a')).toContain('Mew RC24');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM discovery_training_examples WHERE user_id = ?').get('weekly-reset-user-a') as { count: number }
    ).toMatchObject({ count: 1 });
    expect(getDiscoveryMarketCache(marketKey)).not.toBeNull();
    expect(getDiscoveryUniverseCard('weekly reset universe weekly-reset-user-a')).not.toBeNull();
    expect(listDiscoveryUserUniverseCards('weekly-reset-user-a')).toHaveLength(1);
  });

  it('removes preparation state, prepared reserve, scheduled drop, and delivery markers', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    markScheduledDiscoveryDropAnnouncement({
      guildId: TEST_GUILD_ID,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey: PERIOD_ONE,
      channelId: 'channel-1',
      messageId: 'msg-1'
    });

    const plan = buildWeeklyDiscoveryResetPlan({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE }
    });
    const result = applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(plan.deliveryPublicationMarkerCount).toBeGreaterThanOrEqual(2);
    expect(result.deleted.deliveryPublicationMarkers).toBe(plan.deliveryPublicationMarkerCount);
    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM discovery_scheduled_drop_announcements WHERE guild_id = ? AND drop_type = ? AND period_key = ?')
        .get(TEST_GUILD_ID, 'WEEKLY_DISCOVERY', PERIOD_ONE) as { count: number }
    ).toMatchObject({ count: 0 });
  });

  it('succeeds idempotently when confirmed twice', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);

    const first = applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });
    const second = applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(first.deleted.scheduledDrops).toBe(1);
    expect(second.deleted.scheduledDrops).toBe(0);
    expect(second.deleted.preparationStates).toBe(0);
    expect(second.deleted.preparedReserves).toBe(0);
  });

  it('clears the old shelf and preparation state that would otherwise short-circuit later weekly preparation', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(getScheduledDiscoveryDrop('weekly-reset-user-a', 'WEEKLY_DISCOVERY', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparationState('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
    expect(getWeeklyDiscoveryPreparedReserve('weekly-reset-user-a', PERIOD_ONE)).toBeNull();
  });

  it('does not delete shared announcements when another user still has the weekly drop', () => {
    seedScheduledDrop('weekly-reset-user-a', PERIOD_ONE);
    seedPreparationState('weekly-reset-user-a', PERIOD_ONE);
    seedPreparedReserve('weekly-reset-user-a', PERIOD_ONE);
    seedScheduledDrop('weekly-reset-user-b', PERIOD_ONE);
    markScheduledDiscoveryDropAnnouncement({
      guildId: TEST_GUILD_ID,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey: PERIOD_ONE,
      channelId: 'channel-1',
      messageId: 'msg-1'
    });

    const plan = buildWeeklyDiscoveryResetPlan({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE }
    });

    applyWeeklyDiscoveryReset({
      userIds: ['weekly-reset-user-a'],
      scope: { kind: 'PERIOD', periodKey: PERIOD_ONE },
      confirm: true
    });

    expect(plan.periodAnnouncements[0]?.willDelete).toBe(false);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM discovery_scheduled_drop_announcements WHERE guild_id = ? AND drop_type = ? AND period_key = ?')
        .get(TEST_GUILD_ID, 'WEEKLY_DISCOVERY', PERIOD_ONE) as { count: number }
    ).toMatchObject({ count: 1 });
  });
});
