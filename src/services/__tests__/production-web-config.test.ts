import { describe, expect, it } from 'vitest';
import { assertProductionWebEnvironment } from '../production-web-config.js';

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    VAULTR_ENVIRONMENT: 'production',
    DATABASE_PATH: './data/vaultr.db',
    VAULTR_WEB_HOST: '127.0.0.1',
    VAULTR_WEB_PORT: '8790',
    VAULTR_WEB_BASE_URL: 'https://app.keepseek.example',
    VAULTR_WEB_POST_LOGIN_REDIRECT_PATH: '/app',
    VAULTR_WEB_PREVIEW: 'false',
    ...overrides
  };
}

describe('production web configuration', () => {
  it('accepts the production database, loopback listener, and stable HTTPS origin', () => {
    expect(() => assertProductionWebEnvironment(productionEnv(), '/srv/keepseek')).not.toThrow();
  });

  it.each([
    ['preview mode', { VAULTR_WEB_PREVIEW: 'true' }],
    ['quick tunnel', { VAULTR_WEB_BASE_URL: 'https://random.trycloudflare.com' }],
    ['public listener', { VAULTR_WEB_HOST: '0.0.0.0' }],
    ['wrong port', { VAULTR_WEB_PORT: '8791' }],
    ['wrong database', { DATABASE_PATH: './data/staging.db' }],
    ['URL path', { VAULTR_WEB_BASE_URL: 'https://app.keepseek.example/app' }]
  ])('rejects %s', (_name, override) => {
    expect(() => assertProductionWebEnvironment(productionEnv(override), '/srv/keepseek')).toThrow();
  });
});
