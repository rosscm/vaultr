import { describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import {
  getDiscoveryLearnedSignalSummary,
  getUserDiscoveryFeedback,
  getUserPlan,
  recordDiscoveryFeedback,
  recordDiscoveryFeedbackWithTrainingExample,
  recordDiscoveryTrainingExamples,
  setUserPlan
} from '../chase-store.js';
import { db } from '../db.js';
import { applyPreparedDiscoveryFeedback } from '../discovery-feedback.js';
import { discoveryLearningFeatures } from '../discovery-learning-features.js';
import { parseStagingDiscoveryFixtureArgs } from '../../staging-discovery-fixture.js';
import {
  STAGING_DISCOVERY_FIXTURE_MARKER,
  installStagingDiscoveryFixture,
  removeStagingDiscoveryFixture
} from '../staging-discovery-fixture.js';
import { getScheduledDiscoveryDrop, scheduledDiscoveryPeriodKey, upsertScheduledDiscoveryDrop } from '../scheduled-discovery-drops.js';

function stagingEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    VAULTR_ENVIRONMENT: 'staging',
    VAULTR_STAGING_ROOT: '/tmp/vaultr-fixture-staging',
    DATABASE_PATH: '/tmp/vaultr-fixture-staging/data/vaultr.db',
    CARD_CATALOG_PATH: '/tmp/vaultr-fixture-staging/catalog/card-catalog.db',
    VAULTR_STAGING_LOG_PATH: '/tmp/vaultr-fixture-staging/logs/web.log',
    VAULTR_PRODUCTION_DATA_DIR: '/tmp/vaultr-fixture-production',
    VAULTR_PRODUCTION_DATABASE_PATH: '/tmp/vaultr-fixture-production/vaultr.db',
    VAULTR_PRODUCTION_CARD_CATALOG_PATH: '/tmp/vaultr-fixture-production/card-catalog.db',
    VAULTR_WEB_HOST: '127.0.0.1',
    VAULTR_WEB_PORT: '8791',
    VAULTR_PRODUCTION_WEB_PORT: '8787',
    VAULTR_WEB_BASE_URL: 'https://staging.vaultr.example',
    VAULTR_PRODUCTION_WEB_BASE_URL: 'https://vaultr.example',
    VAULTR_WEB_COOKIE_NAMESPACE: 'staging',
    VAULTR_WEB_ENVIRONMENT_LABEL: 'Staging',
    DISCORD_CLIENT_ID: 'staging-client',
    DISCORD_CLIENT_SECRET: 'staging-secret',
    DISCOVERY_DROP_SCHEDULER_ENABLED: 'false',
    ...overrides
  };
}

describe('staging personalized Display Case fixture', () => {
  it('requires an explicit account and parses cleanup deliberately', () => {
    expect(parseStagingDiscoveryFixtureArgs(['--user', 'usr_fixture', '--cleanup'])).toEqual({ userId: 'usr_fixture', cleanup: true });
    expect(() => parseStagingDiscoveryFixtureArgs([])).toThrow('explicit --user');
  });

  it('is explicit, idempotent, account-isolated, and removes fixture feedback', () => {
    const user = createUser({ displayName: 'Fixture Owner' });
    const other = createUser({ displayName: 'Other Account' });
    const now = new Date('2026-10-21T18:00:00.000Z');
    const periodKey = `${scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', now)}-STAGING`;
    setUserPlan(user.id, 'PRO');
    const originalPlan = getUserPlan(user.id);

    const created = installStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/', now });
    expect(created.action).toBe('CREATED');
    expect(created.drop).toMatchObject({
      userId: user.id,
      periodKey,
      status: 'PARTIAL',
      summary: STAGING_DISCOVERY_FIXTURE_MARKER,
      marketReadyCount: 0,
      itemCount: 3
    });
    expect(created.drop.items.every((item) => item.market.status === 'MISSING' && item.imageSourceKind === 'CARD_REFERENCE')).toBe(true);
    expect(created.drop.items.map((item) => ({
      role: item.suggestion.discoveryRole,
      why: item.suggestion.why
    }))).toEqual([
      {
        role: 'CORE_MATCH',
        why: 'A distinctive Japanese Mew promo that lines up with your interest in unusual collector releases.'
      },
      {
        role: 'ADJACENT_DISCOVERY',
        why: 'An e-Reader-era Pichu that explores a vintage side of the artwork and eras you tend to like.'
      },
      {
        role: 'CONTROLLED_EXPLORATION',
        why: 'A modern special-art Sylveon that takes your taste in expressive artwork in a newer direction.'
      }
    ]);
    expect(installStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/', now }).action).toBe('UNCHANGED');
    expect(getScheduledDiscoveryDrop(other.id, 'WEEKLY_DISCOVERY', periodKey)).toBeNull();
    expect(getUserPlan(user.id)).toEqual(originalPlan);

    const firstFeedback = applyPreparedDiscoveryFeedback({
      userId: user.id,
      periodKey,
      position: 1,
      action: 'MORE_LIKE_THIS'
    });
    expect(firstFeedback.ok).toBe(true);
    expect(getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)?.feedback).toBe('MORE_LIKE_THIS');
    const firstVersion = getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)!.version;
    expect(applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'MORE_LIKE_THIS' })).toEqual(firstFeedback);
    expect(db.prepare('SELECT COUNT(*) AS count FROM discovery_training_examples WHERE user_id = ? AND surface = ?').get(user.id, 'WEB_DISPLAY_CASE')).toEqual({ count: 1 });
    const training = db.prepare('SELECT feature_json, outcome FROM discovery_training_examples WHERE user_id = ? AND surface = ?').get(user.id, 'WEB_DISPLAY_CASE') as { feature_json: string; outcome: string };
    expect(JSON.parse(training.feature_json)).toMatchObject({
      japaneseSignal: true,
      promoSignal: true,
      collectorTraits: { region: ['japanese'], releaseShape: ['promo'] }
    });
    expect(training.outcome).toBe('MORE_LIKE_THIS');

    expect(applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'UNDO', expectedVersion: firstVersion })).toEqual({ ok: true, feedback: null });
    const replacement = applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'NOT_FOR_ME' });
    expect(replacement.ok).toBe(true);
    const replacementVersion = getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)!.version;
    expect(replacementVersion).toBeGreaterThan(firstVersion);
    expect(applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'UNDO', expectedVersion: firstVersion })).toEqual({ ok: false, code: 'STALE_FEEDBACK' });
    expect(getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)?.feedback).toBe('NOT_FOR_ME');
    expect(getDiscoveryLearnedSignalSummary(user.id)).toMatchObject({ exampleCount: 1, likedCount: 0, rejectedCount: 1 });

    setUserPlan(user.id, 'FREE');
    expect(applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'MORE_LIKE_THIS' })).toEqual({ ok: false, code: 'PLUS_REQUIRED' });
    expect(applyPreparedDiscoveryFeedback({ userId: user.id, periodKey, position: 1, action: 'UNDO', expectedVersion: replacementVersion })).toEqual({ ok: true, feedback: null });
    expect(getDiscoveryLearnedSignalSummary(user.id)).toMatchObject({ exampleCount: 0, likedCount: 0, rejectedCount: 0 });

    expect(removeStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/' })).toEqual({ action: 'REMOVED', count: 1 });
    expect(getScheduledDiscoveryDrop(user.id, 'WEEKLY_DISCOVERY', periodKey)).toBeNull();
    expect(getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)).toBeNull();
  });

  it('labels a new web context from existing feedback without reinforcing the choice', () => {
    const user = createUser({ displayName: 'Existing Feedback Owner' });
    const now = new Date('2026-10-21T18:00:00.000Z');
    setUserPlan(user.id, 'PRO');
    const created = installStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/', now });
    const card = created.drop.items[0];
    recordDiscoveryTrainingExamples([{
      userId: user.id,
      surface: 'WEEKLY_DISCOVERY_SHELF',
      periodKey: '2026-W42',
      suggestionName: card.suggestion.name,
      lane: card.suggestion.lane,
      position: 1,
      rankerVersion: 'collector-v1',
      features: { japaneseSignal: true, collectorTerms: ['japanese', 'promo'] },
      scores: {}
    }]);
    const existing = recordDiscoveryFeedback({
      userId: user.id,
      cardName: card.suggestion.name,
      lane: card.suggestion.lane,
      feedback: 'MORE_LIKE_THIS'
    });
    const tasteBefore = db.prepare('SELECT weight, interaction_count FROM user_taste_memory WHERE user_id = ? AND source = ?').get(user.id, 'DISCOVERY_LIKE');

    const result = applyPreparedDiscoveryFeedback({ userId: user.id, periodKey: created.drop.periodKey, position: 1, action: 'MORE_LIKE_THIS' });
    const current = getUserDiscoveryFeedback(user.id, card.suggestion.name)!;
    const tasteAfter = db.prepare('SELECT weight, interaction_count FROM user_taste_memory WHERE user_id = ? AND source = ?').get(user.id, 'DISCOVERY_LIKE');

    expect(result).toEqual({ ok: true, feedback: existing });
    expect(current).toMatchObject({ version: existing.version, interactionCount: existing.interactionCount });
    expect(tasteAfter).toEqual(tasteBefore);
    expect(db.prepare('SELECT outcome FROM discovery_training_examples WHERE user_id = ? AND surface = ?').get(user.id, 'WEB_DISPLAY_CASE')).toEqual({ outcome: 'MORE_LIKE_THIS' });
    expect(getDiscoveryLearnedSignalSummary(user.id)).toMatchObject({ exampleCount: 1, likedCount: 1 });
  });

  it('learns from distinct web contexts built from trusted recommendation metadata', () => {
    const user = createUser({ displayName: 'Web Learning Owner' });
    for (const [index, name] of ['Mew CoroCoro Promo 151', 'Pikachu PCG-P Promo 108/PCG-P'].entries()) {
      const suggestion = {
        name,
        why: 'Trusted recommendation context',
        lane: 'Japanese Collector Trail',
        laneWhy: 'Trusted recommendation context',
        nearby: [],
        canonicalReference: {
          provider: 'CURATED',
          sourceCardId: `promo-${index}`,
          canonicalCardId: `promo-${index}`,
          canonicalName: name.split(' Promo')[0],
          setName: index === 0 ? 'CoroCoro Comic Promo' : 'PCG-P Promotional Cards',
          cardNumber: index === 0 ? '151' : '108/PCG-P',
          language: 'JAPANESE' as const,
          imageUrl: `https://example.test/${index}.png`,
          imageSourceKind: 'CARD_REFERENCE' as const
        }
      };
      recordDiscoveryFeedbackWithTrainingExample({
        userId: user.id,
        cardName: name,
        lane: suggestion.lane,
        feedback: 'MORE_LIKE_THIS',
        example: {
          userId: user.id,
          surface: 'WEB_DISPLAY_CASE',
          periodKey: '2026-W43',
          suggestionName: name,
          lane: suggestion.lane,
          position: index + 1,
          rankerVersion: 'prepared-display-case-v1',
          features: discoveryLearningFeatures(suggestion),
          scores: {}
        }
      });
    }

    const summary = getDiscoveryLearnedSignalSummary(user.id);
    expect(summary).toMatchObject({ exampleCount: 2, likedCount: 2, rejectedCount: 0 });
    expect(summary.featureWeights.japaneseSignal).toBeGreaterThan(0);
    expect(summary.featureWeights.promoSignal).toBeGreaterThan(0);
    expect(summary.termWeights.japanese).toBeGreaterThan(0);
    expect(summary.typedTraitEdgeWeights['region:japanese|releaseShape:promo']).toBeGreaterThan(0);
  });

  it('fails closed outside isolated staging and refuses a genuine shelf', () => {
    const user = createUser({ displayName: 'Guarded Fixture Owner' });
    const now = new Date('2026-10-21T18:00:00.000Z');
    expect(() => installStagingDiscoveryFixture({
      userId: user.id,
      env: stagingEnv({ VAULTR_ENVIRONMENT: 'production' }),
      cwd: '/',
      now
    })).toThrow('VAULTR_ENVIRONMENT must be staging');

    upsertScheduledDiscoveryDrop({
      userId: user.id,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey: scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', now),
      status: 'PARTIAL',
      title: 'Genuine Display Case',
      summary: 'real preparation',
      currency: 'CAD',
      availableAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      items: [{
        position: 1,
        suggestion: { name: 'Mew ex 232', why: 'Collector reason', lane: 'Collector Match', laneWhy: 'Collector reason', nearby: [] },
        market: { status: 'MISSING', currency: 'CAD' }
      }]
    }, now.toISOString());
    expect(() => installStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/', now })).toThrow('Refusing to shadow existing Display Case');
  });
});
