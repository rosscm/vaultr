import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { refreshScheduledWeeklyDropMetadata } from './commands/discover.js';
import { validateSqliteBackup } from './services/backup-retention.js';

type Options = {
  userId: string;
  periodKey: string;
  apply: boolean;
};

function usage(): string {
  return [
    'Usage: npm run discovery:refresh-metadata -- --user USER_ID --period YYYY-Www [--apply]',
    '',
    'Preview is read-only. --apply requires a verified SQLite backup created within the last 24 hours.'
  ].join('\n');
}

export function parseDiscoveryMetadataRefreshArgs(argv: string[]): Options {
  let userId = '';
  let periodKey = '';
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--user' || arg === '--period') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value after ${arg}`);
      if (arg === '--user') userId = value.trim();
      else periodKey = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--user=')) userId = arg.slice('--user='.length).trim();
    else if (arg.startsWith('--period=')) periodKey = arg.slice('--period='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!userId) throw new Error('--user is required');
  if (!/^\d{4}-W\d{2}$/.test(periodKey)) throw new Error('--period must use YYYY-Www');
  return { userId, periodKey, apply };
}

export function assertRecentVerifiedBackup(
  backupDir = path.resolve(process.env.VAULTR_BACKUP_DIR ?? './data/backups'),
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000
): string {
  if (!fs.existsSync(backupDir)) throw new Error(`Backup directory does not exist: ${backupDir}`);
  const candidates = fs.readdirSync(backupDir)
    .filter((entry) => entry.endsWith('.db'))
    .map((entry) => path.join(backupDir, entry))
    .filter((entry) => now - fs.statSync(entry).mtimeMs <= maxAgeMs)
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  for (const candidate of candidates) {
    try {
      validateSqliteBackup(candidate);
      return candidate;
    } catch {
      // Try the next recent backup; apply remains blocked unless one validates.
    }
  }
  throw new Error('No verified SQLite backup from the last 24 hours is available');
}

async function main(): Promise<void> {
  const options = parseDiscoveryMetadataRefreshArgs(process.argv.slice(2));
  if (options.apply) assertRecentVerifiedBackup();
  const result = await refreshScheduledWeeklyDropMetadata(options);
  console.log(JSON.stringify({
    userId: result.userId,
    periodKey: result.periodKey,
    mode: result.applied ? 'APPLIED' : 'PREVIEW',
    resolved: result.resolved,
    unchanged: result.unchanged,
    unresolved: result.unresolved,
    items: result.items
  }, null, 2));
}

if (process.argv[1]?.endsWith('discovery-shelf-refresh-metadata.ts') || process.argv[1]?.endsWith('discovery-shelf-refresh-metadata.js')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
