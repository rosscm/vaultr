import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWeeklyDiscoveryReset, isWeeklyDiscoveryPeriodKey, type WeeklyDiscoveryResetScope } from './services/weekly-discovery-reset.js';

export type WeeklyDiscoveryResetCliArgs = {
  userIds: string[];
  scope: WeeklyDiscoveryResetScope;
  confirm: boolean;
};

function normalizePlaceholderCandidate(value: string): string {
  return value.trim().replace(/[<>]/g, '').toUpperCase();
}

function isPlaceholderUserId(value: string): boolean {
  const normalized = normalizePlaceholderCandidate(value);
  return normalized === 'USER_ID' || normalized === 'YOUR_USER_ID';
}

export function parseWeeklyDiscoveryResetArgs(argv: string[]): WeeklyDiscoveryResetCliArgs {
  const userIds: string[] = [];
  let periodKey: string | undefined;
  let allPeriods = false;
  let confirm = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--user') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --user');
      userIds.push(value.trim());
      index += 1;
      continue;
    }
    if (token.startsWith('--user=')) {
      userIds.push(token.slice('--user='.length).trim());
      continue;
    }
    if (token === '--period') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --period');
      periodKey = value.trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--period=')) {
      periodKey = token.slice('--period='.length).trim();
      continue;
    }
    if (token === '--all-periods') {
      allPeriods = true;
      continue;
    }
    if (token === '--confirm') {
      confirm = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  const normalizedUsers = Array.from(new Set(userIds.map((value) => value.trim()).filter(Boolean)));
  if (normalizedUsers.length === 0) throw new Error('At least one explicit --user is required');
  if (normalizedUsers.some(isPlaceholderUserId)) throw new Error('Replace placeholder user IDs before running this command');
  if (normalizedUsers.some((value) => value === '--all' || value.toLowerCase() === 'all')) {
    throw new Error('Resetting all users is not supported');
  }
  if ((periodKey ? 1 : 0) + (allPeriods ? 1 : 0) !== 1) {
    throw new Error('Specify exactly one of --period YYYY-WNN or --all-periods');
  }
  if (periodKey && !isWeeklyDiscoveryPeriodKey(periodKey)) {
    throw new Error(`Invalid weekly period key: ${periodKey}`);
  }

  return {
    userIds: normalizedUsers,
    scope: periodKey ? { kind: 'PERIOD', periodKey } : { kind: 'ALL_PERIODS' },
    confirm
  };
}

export function runWeeklyDiscoveryResetCli(argv: string[]): Record<string, unknown> {
  const parsed = parseWeeklyDiscoveryResetArgs(argv);
  const result = applyWeeklyDiscoveryReset({
    userIds: parsed.userIds,
    scope: parsed.scope,
    confirm: parsed.confirm
  });
  return {
    confirmed: result.confirmed,
    userIds: result.userIds,
    scope: result.scope.kind === 'PERIOD' ? result.scope.periodKey : 'ALL_PERIODS',
    matchingPeriodKeys: result.matchingPeriodKeys,
    scheduledDropCount: result.scheduledDropCount,
    preparationStateCount: result.preparationStateCount,
    preparedReserveCount: result.preparedReserveCount,
    deliveryPublicationMarkerCount: result.deliveryPublicationMarkerCount,
    announcementCount: result.announcementCount,
    wouldChange: result.wouldChange,
    deleted: result.deleted,
    users: result.users,
    periodAnnouncements: result.periodAnnouncements,
    preserved: result.preserved,
    suggestedInspectionCommand: result.userIds.map((userId) => `npm run discovery:inspect -- --user ${userId}`).join(' && ')
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = runWeeklyDiscoveryResetCli(process.argv.slice(2));
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
