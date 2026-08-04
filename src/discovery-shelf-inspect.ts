import 'dotenv/config';
import { prepareWeeklyDiscoveryDropForUser } from './commands/discover.js';
import { getWeeklyDiscoveryPreparedReserve } from './services/weekly-discovery-prepared-reserve.js';
import { getWeeklyDiscoveryPreparationState } from './services/weekly-discovery-preparation-state.js';
import { getLatestAvailableScheduledDiscoveryDrop, getScheduledDiscoveryDrop, scheduledDiscoveryPeriodKey } from './services/scheduled-discovery-drops.js';

type Options = {
  blockedNames: string[];
  date: Date;
  hydrateMarketInline: boolean;
  regenerateCurrent: boolean;
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
    '  --regenerate-current      Refresh by excluding the current live shelf from replacement candidates',
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

function assertConcreteUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed || /^<?USER_ID>?$/i.test(trimmed)) {
    throw new Error('Replace USER_ID with an actual Discord user ID');
  }
  return trimmed;
}

function parseArgs(argv: string[]): Options {
  const blockedNames: string[] = [];
  let dateValue: string | undefined;
  let hydrateMarketInline = false;
  let regenerateCurrent = false;
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
    if (arg === '--regenerate-current') {
      regenerateCurrent = true;
      continue;
    }
    if (arg === '--user') {
      userId = argv[index + 1];
      if (!userId) throw new Error('Missing value after --user');
      userId = assertConcreteUserId(userId);
      index += 1;
      continue;
    }
    if (arg.startsWith('--user=')) {
      userId = assertConcreteUserId(arg.slice('--user='.length));
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
  return { blockedNames, date: parseDate(dateValue), hydrateMarketInline, regenerateCurrent, refresh, userId };
}

function describeRefreshDiagnostics(result: Awaited<ReturnType<typeof prepareWeeklyDiscoveryDropForUser>>): string | null {
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
const preparationState = getWeeklyDiscoveryPreparationState(options.userId, periodKey);
const preparedReserve = getWeeklyDiscoveryPreparedReserve(options.userId, periodKey);
const retainedDrop = getLatestAvailableScheduledDiscoveryDrop(options.userId, 'WEEKLY_DISCOVERY', options.date.toISOString());

if (options.refresh) {
  const result = await prepareWeeklyDiscoveryDropForUser(options.userId, options.date, {
    force: true,
    hydrateMarketInline: options.hydrateMarketInline,
    regenerateCurrent: options.regenerateCurrent
  });
  console.log(`Refresh | prepared=${result.prepared} itemCount=${result.itemCount} fullDiscovery=${result.hasFullDiscovery}`);
  const diagnostics = describeRefreshDiagnostics(result);
  if (diagnostics) console.log(`Diag    | ${diagnostics}`);
}

const drop = getScheduledDiscoveryDrop(options.userId, 'WEEKLY_DISCOVERY', periodKey);
if (!drop) {
  console.log(JSON.stringify({
    userId: options.userId,
    periodKey,
    preparationState,
    preparedReserve,
    retainedShelfPeriod: retainedDrop?.periodKey,
    message: 'no scheduled weekly discovery drop for this period'
  }, null, 2));
  process.exit(1);
}

const names = drop.items.map((item) => item.suggestion.name);
const blockedPresent = options.blockedNames.filter((name) => names.includes(name));
console.log(JSON.stringify({
  userId: options.userId,
  periodKey,
  preparationState: preparationState
    ? {
        state: preparationState.state,
        attempts: preparationState.attemptCount,
        lastOutcome: preparationState.lastOutcome,
        failureCode: preparationState.failureCode,
        nextRetryAt: preparationState.nextRetryAt,
        updatedAt: preparationState.updatedAt
      }
    : null,
  preparedReserve: preparedReserve
    ? {
        generation: preparedReserve.preparationGeneration,
        lastCompletedStage: preparedReserve.lastCompletedStage,
        reserveCount: preparedReserve.reserveCount,
        canonicalReadyCount: preparedReserve.canonicalReadyCount,
        imageReadyCount: preparedReserve.imageReadyCount,
        marketReadyCount: preparedReserve.marketReadyCount,
        personallyDefensibleCount: preparedReserve.personallyDefensibleCount,
        projectedSelectableCount: preparedReserve.projectedSelectableCount,
        projectedMarketResolvedCount: preparedReserve.projectedMarketResolvedCount,
        viableAlternativeCount: preparedReserve.viableAlternativeCount,
        pendingMarketJobCount: preparedReserve.pendingMarketJobCount,
        failedMarketJobCount: preparedReserve.failedMarketJobCount,
        blockingShortages: preparedReserve.blockingShortages,
        lastMeaningfulProgressAt: preparedReserve.lastMeaningfulProgressAt
      }
    : null,
  refreshMode: options.regenerateCurrent ? 'regenerate-current' : 'normal',
  status: drop.status,
  itemCount: drop.itemCount,
  marketReadyCount: drop.marketReadyCount,
  imageReadyCount: drop.imageReadyCount,
  retainedShelfPeriod: retainedDrop?.periodKey,
  page0: names.slice(0, 10),
  page1: names.slice(10, 20),
  blockedPresent
}, null, 2));

if (blockedPresent.length > 0) process.exit(1);
