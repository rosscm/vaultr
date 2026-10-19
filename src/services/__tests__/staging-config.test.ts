import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertStagingEnvironment } from '../staging-config.js';

function stagingEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    VAULTR_ENVIRONMENT: 'staging',
    VAULTR_STAGING_ROOT: '/srv/vaultr-staging',
    DATABASE_PATH: '/srv/vaultr-staging/data/vaultr.db',
    CARD_CATALOG_PATH: '/srv/vaultr-staging/catalog/card-catalog.db',
    VAULTR_STAGING_LOG_PATH: '/srv/vaultr-staging/logs/web.log',
    VAULTR_PRODUCTION_DATA_DIR: '/srv/vaultr-production',
    VAULTR_PRODUCTION_DATABASE_PATH: '/srv/vaultr-production/vaultr.db',
    VAULTR_PRODUCTION_CARD_CATALOG_PATH: '/srv/vaultr-production/card-catalog.db',
    VAULTR_PRODUCTION_WEB_PORT: '8790',
    VAULTR_PRODUCTION_WEB_BASE_URL: 'https://app.vaultr.example',
    VAULTR_WEB_HOST: '127.0.0.1',
    VAULTR_WEB_PORT: '8791',
    VAULTR_WEB_BASE_URL: 'https://staging.vaultr.example',
    VAULTR_WEB_PREVIEW: 'false',
    VAULTR_WEB_ENVIRONMENT_LABEL: 'Staging',
    VAULTR_WEB_COOKIE_NAMESPACE: 'staging',
    DISCORD_CLIENT_ID: 'staging-client',
    DISCORD_CLIENT_SECRET: 'staging-secret',
    ...overrides
  };
}

describe('staging configuration isolation', () => {
  it('accepts distinct staging persistence, origin, port, and cookie paths', () => {
    expect(assertStagingEnvironment(stagingEnv(), '/workspace')).toEqual({
      root: path.resolve('/srv/vaultr-staging'),
      database: path.resolve('/srv/vaultr-staging/data/vaultr.db'),
      cardCatalog: path.resolve('/srv/vaultr-staging/catalog/card-catalog.db'),
      log: path.resolve('/srv/vaultr-staging/logs/web.log')
    });
  });

  it.each([
    ['production database', { DATABASE_PATH: '/srv/vaultr-production/vaultr.db' }],
    ['production data root', { VAULTR_STAGING_ROOT: '/srv/vaultr-production' }],
    ['production hostname', { VAULTR_WEB_BASE_URL: 'https://app.vaultr.example/staging' }],
    ['production port', { VAULTR_WEB_PORT: '8790' }],
    ['missing cookie namespace', { VAULTR_WEB_COOKIE_NAMESPACE: '' }],
    ['email delivery', { POSTMARK_SERVER_TOKEN: 'must-not-load' }]
  ])('rejects %s overlap or unsafe activation', (_name, override) => {
    expect(() => assertStagingEnvironment(stagingEnv(override), '/workspace')).toThrow();
  });
});
