import 'dotenv/config';
import { commands } from './commands/index.js';
import { getPollerState, initializePollerState } from './services/poller-state.js';
import { listAllChases } from './services/chase-store.js';
import { getRuntimePollIntervalSeconds } from './services/plans.js';

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

const LISTING_SOURCE_MODES = new Set(['EBAY', 'EBAY_SHOPIFY', 'SHOPIFY', 'MOCK']);

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function checkEnv(): CheckResult {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];
  const missing = required.filter((key) => !envValue(key));
  if (missing.length > 0) {
    return { name: 'env', ok: false, details: `Missing required vars: ${missing.join(', ')}` };
  }
  return { name: 'env', ok: true, details: 'Core Discord env vars are present' };
}

function checkListingSourceEnv(): CheckResult {
  const sourceMode = (envValue('LISTING_SOURCE') ?? 'EBAY').toUpperCase();
  if (!LISTING_SOURCE_MODES.has(sourceMode)) {
    return {
      name: 'listing-source',
      ok: false,
      details: `LISTING_SOURCE must be one of ${Array.from(LISTING_SOURCE_MODES).join(', ')}`
    };
  }

  if (sourceMode.includes('EBAY') && (!(envValue('EBAY_CLIENT_ID') ?? envValue('EBAY_APP_ID')) || !envValue('EBAY_CLIENT_SECRET'))) {
    return {
      name: 'listing-source',
      ok: false,
      details: 'eBay listing sources require EBAY_CLIENT_ID or EBAY_APP_ID, plus EBAY_CLIENT_SECRET'
    };
  }

  const ebayEnv = (envValue('EBAY_ENV') ?? 'PRODUCTION').toUpperCase();
  if (ebayEnv !== 'PRODUCTION' && ebayEnv !== 'SANDBOX') {
    return { name: 'listing-source', ok: false, details: 'EBAY_ENV must be PRODUCTION or SANDBOX' };
  }

  return { name: 'listing-source', ok: true, details: `LISTING_SOURCE=${sourceMode} EBAY_ENV=${ebayEnv}` };
}

function checkNumericEnv(): CheckResult {
  const integerVars: Array<{ key: string; min: number }> = [
    { key: 'POLL_INTERVAL_SECONDS', min: 30 },
    { key: 'MAX_ALERTS_PER_CHASE_PER_POLL', min: 1 },
    { key: 'ALERT_LISTING_ENRICHMENT_TIMEOUT_MS', min: 1000 },
    { key: 'SOURCE_OBSERVATION_RETENTION_DAYS', min: 1 },
    { key: 'DISCOVERY_WEEKLY_DROP_SIZE', min: 1 },
    { key: 'DISCOVERY_DROP_PREPARE_BATCH_SIZE', min: 1 },
    { key: 'DISCOVERY_DROP_SCHEDULER_INTERVAL_SECONDS', min: 60 },
    { key: 'DISCOVERY_SOURCE_TIMEOUT_MS', min: 1000 },
    { key: 'DISCOVERY_MARKET_FIRST_RESPONSE_WAIT_MS', min: 0 },
    { key: 'DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_SECONDS', min: 0 },
    { key: 'DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS', min: 1 },
    { key: 'DISCOVERY_MARKET_WORKER_BATCH_SIZE', min: 1 },
    { key: 'DISCOVERY_MARKET_WORKER_POLL_MS', min: 1000 },
    { key: 'DISCOVERY_MARKET_WORKER_RETRY_BASE_MS', min: 60000 },
    { key: 'DISCOVERY_MARKET_WORKER_RETRY_MAX_MS', min: 60000 },
    { key: 'DISCOVERY_MARKET_WORKER_MAX_ATTEMPTS', min: 1 },
    { key: 'DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS', min: 60000 },
    { key: 'EBAY_SEARCH_LIMIT', min: 1 },
    { key: 'EBAY_SOLD_SEARCH_LIMIT', min: 1 },
    { key: 'EBAY_SOLD_SEARCH_PAGES', min: 1 },
    { key: 'EBAY_MAX_REQUESTS_PER_MINUTE', min: 1 },
    { key: 'EBAY_MIN_REQUEST_GAP_MS', min: 0 },
    { key: 'EBAY_SEARCH_CACHE_TTL_SECONDS', min: 0 },
    { key: 'EBAY_BACKOFF_BASE_SECONDS', min: 1 },
    { key: 'FX_REFRESH_MINUTES', min: 1 },
    { key: 'EBAY_WEBHOOK_PORT', min: 1 },
    { key: 'EBAY_WEBHOOK_MAX_BODY_BYTES', min: 1024 }
  ];
  const invalid = integerVars.flatMap(({ key, min }) => {
    const raw = envValue(key);
    if (!raw) return [];
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= min ? [] : [`${key}>=${min}`];
  });

  if (invalid.length > 0) {
    return { name: 'numeric-env', ok: false, details: `Invalid integer env vars: ${invalid.join(', ')}` };
  }
  return { name: 'numeric-env', ok: true, details: `${integerVars.length} numeric env defaults are valid when set` };
}

function checkCommands(): CheckResult {
  const names = commands.map((c) => c.data.name);
  const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
  if (duplicates.length > 0) {
    return { name: 'commands', ok: false, details: `Duplicate commands: ${Array.from(new Set(duplicates)).join(', ')}` };
  }
  return { name: 'commands', ok: true, details: `${names.length} unique slash commands loaded` };
}

function checkDb(): CheckResult {
  try {
    const count = listAllChases().length;
    return { name: 'db', ok: true, details: `SQLite reachable (loaded ${count} chase rows)` };
  } catch (error) {
    return { name: 'db', ok: false, details: error instanceof Error ? error.message : String(error) };
  }
}

function checkPollerDefaults(): CheckResult {
  initializePollerState((process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase(), getRuntimePollIntervalSeconds());
  const state = getPollerState();
  return {
    name: 'poller',
    ok: true,
    details: `Source=${state.sourceMode} interval=${state.pollIntervalSeconds}s`
  };
}

const checks = [
  checkEnv(),
  checkListingSourceEnv(),
  checkNumericEnv(),
  checkCommands(),
  checkDb(),
  checkPollerDefaults()
];
for (const check of checks) {
  const label = check.ok ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${check.name}: ${check.details}`);
}

if (checks.some((c) => !c.ok)) {
  process.exit(1);
}
