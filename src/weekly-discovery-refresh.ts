import 'dotenv/config';
import { prepareWeeklyDiscoveryDropForUser } from './commands/discover.js';
import { getUserPlan, listUsersWithChases } from './services/chase-store.js';
import { activePlanTier } from './services/plans.js';
import { getScheduledDiscoveryDrop, scheduledDiscoveryPeriodKey } from './services/scheduled-discovery-drops.js';

type Options = {
  all: boolean;
  allowRepeatFiller: boolean;
  date: Date;
  dryRun: boolean;
  hydrateMarketInline: boolean;
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
    '  --help                    Show this help'
  ].join('\n');
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --date value: ${value}`);
  return date;
}

function parseArgs(argv: string[]): Options {
  let all = false;
  let allowRepeatFiller = false;
  let dateValue: string | undefined;
  let dryRun = false;
  let hydrateMarketInline = true;
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
    if (arg === '--user') {
      const userId = argv[index + 1];
      if (!userId) throw new Error('Missing value after --user');
      users.push(userId);
      index += 1;
      continue;
    }
    if (arg.startsWith('--user=')) {
      users.push(arg.slice('--user='.length));
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

  return { all, allowRepeatFiller, date: parseDate(dateValue), dryRun, hydrateMarketInline, users };
}

function proUsersWithChases(): string[] {
  return listUsersWithChases().filter((userId) => activePlanTier(getUserPlan(userId)) === 'PRO');
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

const options = parseArgs(process.argv.slice(2));
const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', options.date);
const users = options.all ? proUsersWithChases() : Array.from(new Set(options.users));

if (users.length === 0) {
  console.log(`No users to refresh for ${periodKey}`);
  process.exit(0);
}

console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Weekly Shelf refresh target: ${periodKey}`);
console.log(`Users: ${users.join(', ')}`);

for (const userId of users) {
  console.log(`Before | ${describeDrop(userId, periodKey)}`);
  if (options.dryRun) continue;

  const result = await prepareWeeklyDiscoveryDropForUser(userId, options.date, {
    force: true,
    hydrateMarketInline: options.hydrateMarketInline,
    allowRecentRepeatFiller: options.allowRepeatFiller
  });
  console.log(`Refresh | ${userId}: prepared=${result.prepared} itemCount=${result.itemCount} fullDiscovery=${result.hasFullDiscovery}`);
  console.log(`After  | ${describeDrop(userId, periodKey)}`);
}