import path from 'node:path';

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key} in production web environment`);
  return value;
}

export function assertProductionWebEnvironment(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): void {
  if (env.VAULTR_ENVIRONMENT !== 'production') throw new Error('VAULTR_ENVIRONMENT must be production');
  if (env.VAULTR_WEB_PREVIEW === 'true') throw new Error('Production web must not use preview mode');

  const host = required(env, 'VAULTR_WEB_HOST');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Production web must bind to localhost');
  if (required(env, 'VAULTR_WEB_PORT') !== '8790') throw new Error('Production web must use port 8790');

  const baseUrl = new URL(required(env, 'VAULTR_WEB_BASE_URL'));
  if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('Production web base URL must be a bare HTTPS origin');
  }
  if (baseUrl.hostname.endsWith('.trycloudflare.com')) {
    throw new Error('Production web requires a stable hostname, not a quick tunnel');
  }

  const expectedDatabase = path.resolve(cwd, 'data/vaultr.db');
  const database = path.resolve(cwd, required(env, 'DATABASE_PATH'));
  if (database !== expectedDatabase) throw new Error(`Production web must use ${expectedDatabase}`);
  if (env.VAULTR_WEB_POST_LOGIN_REDIRECT_PATH !== '/app') {
    throw new Error('Production post-login redirect must be /app');
  }
}
