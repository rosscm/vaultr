import 'dotenv/config';
import type { prepareWeeklyDiscoveryDropForUser } from './commands/discover.js';
import { db } from './services/db.js';
import { runWeeklyDiscoveryPreparationAttempt } from './services/discovery-drop-scheduler.js';
import { getScheduledDiscoveryDrop, scheduledDiscoveryPeriodKey } from './services/scheduled-discovery-drops.js';
import { listProUsersEligibleForWeeklyDiscovery, weeklyDiscoveryEligibilityForUser } from './services/weekly-discovery-eligibility.js';

type Options = {
  all: boolean;
  allowRepeatFiller: boolean;
  date: Date;
  dryRun: boolean;
  hydrateMarketInline: boolean;
  regenerateCurrent: boolean;
  users: string[];
};

function usage(): string {
  return [
    'Usage: npm run weekly:refresh -- --date YYYY-MM-DD (--all | --user USER_ID) [options]',
    '',
    'Options:',
    '  --all                    Refresh all Pro users with chases',
    '  --user USER_ID            Refresh one user; can be repeated',
    '  --date YYYY-MM-DD         Date inside the weekly period to refresh',
    '  --dry-run                 Show target rows without writing',
    '  --allow-repeat-filler     Allow recent weekly cards as filler if needed',
    '  --no-hydrate-market       Queue market work instead of hydrating inline',
    '  --regenerate-current      Rebuild the current period against the live shelf as hard exclusions',
    '  --help                    Show this help'
  ].join('\n');
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --date value: ${value}`);
  return date;
}

function assertConcreteUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed || /^<?USER_ID>?$/i.test(trimmed)) {
    throw new Error('Replace USER_ID with an actual Discord user ID');
  }
  return trimmed;
}

function parseArgs(argv: string[]): Options {
  let all = false;
  let allowRepeatFiller = false;
  let dateValue: string | undefined;
  let dryRun = false;
  let hydrateMarketInline = true;
  let regenerateCurrent = false;
  const users: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--allow-repeat-filler') {
      allowRepeatFiller = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-hydrate-market') {
      hydrateMarketInline = false;
      continue;
    }
    if (arg === '--regenerate-current') {
      regenerateCurrent = true;
      continue;
    }
    if (arg === '--user') {
      const userId = argv[index + 1];
      if (!userId) throw new Error('Missing value after --user');
      users.push(assertConcreteUserId(userId));
      index += 1;
      continue;
    }
    if (arg.startsWith('--user=')) {
      users.push(assertConcreteUserId(arg.slice('--user='.length)));
      continue;
    }
    if (arg === '--date') {
      dateValue = argv[index + 1];
      if (!dateValue) throw new Error('Missing value after --date');
      index += 1;
      continue;
    }
    if (arg.startsWith('--date=')) {
      dateValue = arg.slice('--date='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (all && users.length > 0) throw new Error('Use either --all or --user, not both');
  if (!all && users.length === 0) throw new Error('Provide --all or at least one --user');

  return { all, allowRepeatFiller, date: parseDate(dateValue), dryRun, hydrateMarketInline, regenerateCurrent, users };
}

function describeDrop(userId: string, periodKey: string): string {
  const drop = getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey);
  if (!drop) return `${userId}: no existing drop`;
  return [
    `${userId}: ${drop.status}`,
    `items=${drop.itemCount}`,
    `marketReady=${drop.marketReadyCount}`,
    `imageReady=${drop.imageReadyCount}`,
    `updated=${drop.updatedAt}`
  ].join(' | ');
}

function describeDiagnostics(result: Awaited<ReturnType<typeof prepareWeeklyDiscoveryDropForUser>>): string | null {
  const diagnostics = result.diagnostics;
  if (!diagnostics) return null;
  const parts = [
    `regen=${diagnostics.regenerateCurrent}`,
    `exclusions=${diagnostics.currentShelfExclusions}`,
    `reserve=${diagnostics.reserveCount}`,
    `postCap=${diagnostics.postCapSelectableCount}/20`,
    `postCapMarket=${diagnostics.postCapMarketReadyCount}/18`
  ];
  if (diagnostics.saturatedSubjects.length > 0) parts.push(`subjects=${diagnostics.saturatedSubjects.slice(0, 3).join(',')}`);
  if (diagnostics.saturatedFormats.length > 0) parts.push(`formats=${diagnostics.saturatedFormats.slice(0, 3).join(',')}`);
  if (diagnostics.saturatedLanes.length > 0) parts.push(`lanes=${diagnostics.saturatedLanes.slice(0, 3).join(',')}`);
  if (diagnostics.blockingShortages.length > 0) parts.push(`shortages=${diagnostics.blockingShortages.slice(0, 3).join('; ')}`);
  if (diagnostics.retainedPreviousShelf !== undefined) parts.push(`retained=${diagnostics.retainedPreviousShelf}`);
  if (diagnostics.replacedExistingShelf !== undefined) parts.push(`replaced=${diagnostics.replacedExistingShelf}`);
  return parts.join(' | ');
}

const options = parseArgs(process.argv.slice(2));
const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', options.date);
const users = options.all ? listProUsersEligibleForWeeklyDiscovery() : Array.from(new Set(options.users));

async function closeGlobalFetchDispatcher(): Promise<void> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const undici = require('undici') as {
      getGlobalDispatcher?: () => { close?: () => Promise<void> | void };
    };
    await undici.getGlobalDispatcher?.()?.close?.();
  } catch {
    // Best-effort CLI cleanup only. The refresh has already completed by here.
  }
}

if (users.length === 0) {
  console.log(`No users to refresh for ${periodKey}`);
  process.exit(0);
}

console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Weekly Shelf refresh target: ${periodKey}`);
console.log(`Regeneration mode: ${options.regenerateCurrent ? 'current-shelf replacement' : 'normal refresh'}`);
console.log(`Users: ${users.join(', ')}`);

try {
  for (const userId of users) {
    if (!options.all) {
      const eligibility = weeklyDiscoveryEligibilityForUser(userId);
      if (!eligibility.eligible) {
        console.warn(
          `Eligibility bypass | ${userId}: ${eligibility.uniqueSignalCount}/${eligibility.minimumSignalCount} unique collector signals; explicit --user refresh will still run diagnostics`
        );
      }
    }
    console.log(`Before | ${describeDrop(userId, periodKey)}`);
    if (options.dryRun) continue;

    const { result } = await runWeeklyDiscoveryPreparationAttempt(userId, options.date, {
      force: true,
      hydrateMarketInline: options.hydrateMarketInline,
      allowRecentRepeatFiller: options.allowRepeatFiller,
      regenerateCurrent: options.regenerateCurrent
    });
    console.log(`Refresh | ${userId}: prepared=${result.prepared} itemCount=${result.itemCount} fullDiscovery=${result.hasFullDiscovery}`);
    const diagnostics = describeDiagnostics(result);
    if (diagnostics) console.log(`Diag   | ${userId}: ${diagnostics}`);
    console.log(`After  | ${describeDrop(userId, periodKey)}`);
  }
} finally {
  db.close();
  await closeGlobalFetchDispatcher();
}
