import 'dotenv/config';
import { commands } from './commands/index.js';
import { getPollerState, initializePollerState } from './services/poller-state.js';
import { listAllChases } from './services/chase-store.js';

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

function checkEnv(): CheckResult {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];
  const missing = required.filter((key) => !process.env[key] || process.env[key]?.trim() === '');
  if (missing.length > 0) {
    return { name: 'env', ok: false, details: `Missing required vars: ${missing.join(', ')}` };
  }
  return { name: 'env', ok: true, details: 'Core Discord env vars are present' };
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
  initializePollerState((process.env.LISTING_SOURCE ?? 'EBAY').toUpperCase(), Number(process.env.POLL_INTERVAL_SECONDS ?? '180'));
  const state = getPollerState();
  return {
    name: 'poller',
    ok: true,
    details: `Source=${state.sourceMode} interval=${state.pollIntervalSeconds}s`
  };
}

const checks = [checkEnv(), checkCommands(), checkDb(), checkPollerDefaults()];
for (const check of checks) {
  const label = check.ok ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${check.name}: ${check.details}`);
}

if (checks.some((c) => !c.ok)) {
  process.exit(1);
}
