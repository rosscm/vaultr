import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { validateSqliteBackup } from './services/backup-retention.js';
import { runPhase3cEbayCleanup } from './services/phase3c-ebay-cleanup.js';

type Options = {
  apply: boolean;
  databasePath: string;
  databaseExplicit: boolean;
  backupPath?: string;
  maintenanceConfirmed: boolean;
};

function parseOptions(argv: string[]): Options {
  let apply = false;
  let databasePath = path.resolve(process.env.DATABASE_PATH ?? './data/vaultr.db');
  let databaseExplicit = false;
  let backupPath: string | undefined;
  let maintenanceConfirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') apply = true;
    else if (argument === '--maintenance-confirmed') maintenanceConfirmed = true;
    else if (argument === '--database' && argv[index + 1]) {
      databasePath = path.resolve(argv[index += 1]!);
      databaseExplicit = true;
    } else if (argument === '--verified-backup' && argv[index + 1]) {
      backupPath = path.resolve(argv[index += 1]!);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return { apply, databasePath, databaseExplicit, backupPath, maintenanceConfirmed };
}

export function validateApplyOptions(options: Options): void {
  if (!options.apply) return;
  if (!options.databaseExplicit) throw new Error('Apply mode requires an explicit --database path');
  if (!options.backupPath) throw new Error('Apply mode requires --verified-backup');
  if (!options.maintenanceConfirmed) throw new Error('Apply mode requires --maintenance-confirmed after all database writers are stopped');
  if (options.backupPath === options.databasePath) throw new Error('The verified backup must be separate from the live database');
  validateSqliteBackup(options.backupPath);
  const databaseStat = fs.statSync(options.databasePath);
  const backupStat = fs.statSync(options.backupPath);
  if (backupStat.mtimeMs < databaseStat.mtimeMs) {
    throw new Error('The database changed after the verified backup was created; create a new checkpoint in the maintenance window');
  }
}

export function main(argv = process.argv.slice(2)): void {
  const options = parseOptions(argv);
  validateApplyOptions(options);
  const database = new Database(options.databasePath, {
    readonly: !options.apply,
    fileMustExist: true
  });
  try {
    database.pragma('foreign_keys = ON');
    const report = runPhase3cEbayCleanup(database, options.apply);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Phase 3C cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
