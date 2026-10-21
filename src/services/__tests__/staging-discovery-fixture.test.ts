import { describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import { getUserDiscoveryFeedback, getUserPlan } from '../chase-store.js';
import { applyPreparedDiscoveryFeedback } from '../discovery-feedback.js';
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
    expect(installStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/', now }).action).toBe('UNCHANGED');
    expect(getScheduledDiscoveryDrop(other.id, 'WEEKLY_DISCOVERY', periodKey)).toBeNull();
    expect(getUserPlan(user.id)).toEqual(originalPlan);

    expect(applyPreparedDiscoveryFeedback({
      userId: user.id,
      periodKey,
      position: 1,
      action: 'MORE_LIKE_THIS'
    }).ok).toBe(true);
    expect(getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)?.feedback).toBe('MORE_LIKE_THIS');

    expect(removeStagingDiscoveryFixture({ userId: user.id, env: stagingEnv(), cwd: '/' })).toEqual({ action: 'REMOVED', count: 1 });
    expect(getScheduledDiscoveryDrop(user.id, 'WEEKLY_DISCOVERY', periodKey)).toBeNull();
    expect(getUserDiscoveryFeedback(user.id, created.drop.items[0].suggestion.name)).toBeNull();
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
