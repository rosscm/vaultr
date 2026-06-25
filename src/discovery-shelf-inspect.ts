import 'dotenv/config';
import { prepareWeeklyDiscoveryDropForUser } from './commands/discover.js';
import { getScheduledDiscoveryDrop, scheduledDiscoveryPeriodKey } from './services/scheduled-discovery-drops.js';

type Options = {
  blockedNames: string[];
  date: Date;
  hydrateMarketInline: boolean;
  refresh: boolean;
  userId: string;
};

function usage(): string {
  return [
    'Usage: npm run discovery:inspect -- --user USER_ID [options]',
    '',
    'Options:',
    '  --date YYYY-MM-DD         Date inside the weekly period to inspect',
    '  --refresh                 Force-refresh the scheduled weekly shelf first',
    '  --hydrate-market          Hydrate market data inline during refresh',
    '  --blocked NAME            Name that must not appear; can be repeated',
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
  const blockedNames: string[] = [];
  let dateValue: string | undefined;
  let hydrateMarketInline = false;
  let refresh = false;
  let userId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--refresh') {
      refresh = true;
      continue;
    }
    if (arg === '--hydrate-market') {
      hydrateMarketInline = true;
      continue;
    }
    if (arg === '--user') {
      userId = argv[index + 1];
      if (!userId) throw new Error('Missing value after --user');
      index += 1;
      continue;
    }
    if (arg.startsWith('--user=')) {
      userId = arg.slice('--user='.length);
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
    if (arg === '--blocked') {
      const name = argv[index + 1];
      if (!name) throw new Error('Missing value after --blocked');
      blockedNames.push(name);
      index += 1;
      continue;
    }
    if (arg.startsWith('--blocked=')) {
      blockedNames.push(arg.slice('--blocked='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!userId) throw new Error('Provide --user USER_ID');
  return { blockedNames, date: parseDate(dateValue), hydrateMarketInline, refresh, userId };
}

const options = parseArgs(process.argv.slice(2));
const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', options.date);

if (options.refresh) {
  const result = await prepareWeeklyDiscoveryDropForUser(options.userId, options.date, {
    force: true,
    hydrateMarketInline: options.hydrateMarketInline
  });
  console.log(`Refresh | prepared=${result.prepared} itemCount=${result.itemCount} fullDiscovery=${result.hasFullDiscovery}`);
}

const drop = getScheduledDiscoveryDrop(options.userId, 'WEEKLY_DISCOVERY', periodKey);
if (!drop) {
  console.log(`${options.userId}: no scheduled weekly discovery drop for ${periodKey}`);
  process.exit(1);
}

const names = drop.items.map((item) => item.suggestion.name);
const blockedPresent = options.blockedNames.filter((name) => names.includes(name));
console.log(JSON.stringify({
  userId: options.userId,
  periodKey,
  status: drop.status,
  itemCount: drop.itemCount,
  marketReadyCount: drop.marketReadyCount,
  imageReadyCount: drop.imageReadyCount,
  page0: names.slice(0, 10),
  page1: names.slice(10, 20),
  blockedPresent
}, null, 2));

if (blockedPresent.length > 0) process.exit(1);