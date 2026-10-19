import path from 'node:path';

export type StagingPaths = {
  root: string;
  database: string;
  cardCatalog: string;
  log: string;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key} in staging environment`);
  return value;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSeparate(stagingPath: string, productionPath: string, label: string): void {
  if (stagingPath === productionPath || within(productionPath, stagingPath) || within(stagingPath, productionPath)) {
    throw new Error(`Staging ${label} overlaps production: ${stagingPath}`);
  }
}

export function assertStagingEnvironment(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): StagingPaths {
  if (env.VAULTR_ENVIRONMENT !== 'staging') throw new Error('VAULTR_ENVIRONMENT must be staging');
  if (env.VAULTR_WEB_PREVIEW === 'true') throw new Error('Writable staging must not use preview mode');
  if (env.POSTMARK_SERVER_TOKEN || env.POSTMARK_FROM_EMAIL || env.VAULTR_AUTH_OUTBOX_KEY) {
    throw new Error('Email delivery must remain disabled in staging');
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    throw new Error('Staging requires its own Discord OAuth client credentials');
  }
  if (env.VAULTR_WEB_COOKIE_NAMESPACE !== 'staging') {
    throw new Error('VAULTR_WEB_COOKIE_NAMESPACE must be staging');
  }

  const root = path.resolve(cwd, required(env, 'VAULTR_STAGING_ROOT'));
  const database = path.resolve(cwd, required(env, 'DATABASE_PATH'));
  const cardCatalog = path.resolve(cwd, required(env, 'CARD_CATALOG_PATH'));
  const log = path.resolve(cwd, required(env, 'VAULTR_STAGING_LOG_PATH'));
  for (const [label, candidate] of [['database', database], ['card catalog', cardCatalog], ['log', log]] as const) {
    if (!within(root, candidate) || candidate === root) throw new Error(`Staging ${label} must be inside VAULTR_STAGING_ROOT`);
  }

  const productionRoot = path.resolve(cwd, required(env, 'VAULTR_PRODUCTION_DATA_DIR'));
  const productionDatabase = path.resolve(cwd, required(env, 'VAULTR_PRODUCTION_DATABASE_PATH'));
  const productionCatalog = path.resolve(cwd, required(env, 'VAULTR_PRODUCTION_CARD_CATALOG_PATH'));
  assertSeparate(root, productionRoot, 'root');
  assertSeparate(database, productionDatabase, 'database');
  assertSeparate(cardCatalog, productionCatalog, 'card catalog');

  const host = required(env, 'VAULTR_WEB_HOST');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Staging web must bind to localhost');
  const port = Number(required(env, 'VAULTR_WEB_PORT'));
  const productionPort = Number(required(env, 'VAULTR_PRODUCTION_WEB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === productionPort) {
    throw new Error('Staging web port must be valid and distinct from production');
  }

  const stagingUrl = new URL(required(env, 'VAULTR_WEB_BASE_URL'));
  const productionUrl = new URL(required(env, 'VAULTR_PRODUCTION_WEB_BASE_URL'));
  if (stagingUrl.hostname === productionUrl.hostname) {
    throw new Error('Staging and production must use different public hostnames');
  }
  if (env.VAULTR_WEB_ENVIRONMENT_LABEL !== 'Staging') throw new Error('VAULTR_WEB_ENVIRONMENT_LABEL must be Staging');
  return { root, database, cardCatalog, log };
}
