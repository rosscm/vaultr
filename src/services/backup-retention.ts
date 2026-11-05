import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const METADATA_SUFFIX = '.automatic.json';
const PROTECTED_SUFFIX = '.protected';
const LOCK_FILE = '.automatic-backup.lock';

export interface AutomaticBackupMetadata {
  schemaVersion: 1;
  kind: 'AUTOMATIC_APPLICATION_BACKUP';
  backupFile: string;
  createdAt: string;
  verifiedAt: string;
  sizeBytes: number;
}

export interface BackupRetentionCandidate {
  backupPath: string;
  metadataPath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupRetentionPlan {
  managedCount: number;
  retainedCount: number;
  candidates: BackupRetentionCandidate[];
  recoverableBytes: number;
}

export interface RunAutomaticBackupOptions {
  sourcePath: string;
  backupDir: string;
  retentionCount?: number;
  now?: Date;
  log?: (message: string) => void;
}

function metadataPathFor(backupPath: string): string {
  return `${backupPath}${METADATA_SUFFIX}`;
}

function backupTimestamp(now: Date): string {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function positiveRetentionCount(value: number | undefined): number {
  const count = value ?? 7;
  if (!Number.isInteger(count) || count < 1) throw new Error('Backup retention count must be a positive integer');
  return count;
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function withBackupLock<T>(backupDir: string, work: () => Promise<T>): Promise<T> {
  fs.mkdirSync(backupDir, { recursive: true });
  const lockPath = path.join(backupDir, LOCK_FILE);
  const acquire = (): void => {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid);
      } catch {
        throw new Error('Automatic backup lock exists but its owner cannot be verified');
      }
      if (ownerPid > 0 && processIsRunning(ownerPid)) throw new Error(`Automatic backup is already running (pid ${ownerPid})`);
      fs.unlinkSync(lockPath);
      acquire();
    }
  };
  acquire();
  try {
    return await work();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

export function validateSqliteBackup(backupPath: string): void {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = backup.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${String(integrity)}`);
    const foreignKeyViolations = backup.pragma('foreign_key_check') as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error(`SQLite foreign-key check failed with ${foreignKeyViolations.length} violation(s)`);
    }
  } finally {
    backup.close();
  }
}

function readManagedBackups(backupDir: string): Array<AutomaticBackupMetadata & { backupPath: string; metadataPath: string }> {
  if (!fs.existsSync(backupDir)) return [];
  const managed: Array<AutomaticBackupMetadata & { backupPath: string; metadataPath: string }> = [];
  for (const entry of fs.readdirSync(backupDir)) {
    if (!entry.endsWith(METADATA_SUFFIX)) continue;
    const metadataPath = path.join(backupDir, entry);
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as AutomaticBackupMetadata;
      const expectedMetadataName = `${metadata.backupFile}${METADATA_SUFFIX}`;
      const backupPath = path.join(backupDir, metadata.backupFile);
      if (
        metadata.schemaVersion !== 1 ||
        metadata.kind !== 'AUTOMATIC_APPLICATION_BACKUP' ||
        path.basename(metadata.backupFile) !== metadata.backupFile ||
        entry !== expectedMetadataName ||
        !fs.existsSync(backupPath)
      ) continue;
      managed.push({ ...metadata, backupPath, metadataPath });
    } catch {
      // Malformed or unknown metadata never makes a backup eligible for deletion.
    }
  }
  return managed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function planBackupRetention(backupDir: string, retentionCount = 7, currentBackupPath?: string): BackupRetentionPlan {
  const count = positiveRetentionCount(retentionCount);
  const managed = readManagedBackups(backupDir);
  const retained = new Set(managed.slice(0, count).map((entry) => entry.backupPath));
  if (currentBackupPath) retained.add(path.resolve(currentBackupPath));
  const candidates = managed
    .filter((entry) => !retained.has(path.resolve(entry.backupPath)))
    .filter((entry) => !fs.existsSync(`${entry.backupPath}${PROTECTED_SUFFIX}`))
    .map((entry) => ({
      backupPath: entry.backupPath,
      metadataPath: entry.metadataPath,
      sizeBytes: fs.statSync(entry.backupPath).size,
      createdAt: entry.createdAt
    }));
  return {
    managedCount: managed.length,
    retainedCount: managed.length - candidates.length,
    candidates,
    recoverableBytes: candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0)
  };
}

export function applyBackupRetention(plan: BackupRetentionPlan, dryRun: boolean, log: (message: string) => void = console.log): number {
  for (const candidate of plan.candidates) {
    log(`${dryRun ? 'Would delete' : 'Deleting'} automatic backup ${path.basename(candidate.backupPath)} (${candidate.sizeBytes} bytes)`);
    if (!dryRun) {
      fs.unlinkSync(candidate.backupPath);
      fs.unlinkSync(candidate.metadataPath);
    }
  }
  log(`${dryRun ? 'Recoverable' : 'Recovered'} backup space: ${plan.recoverableBytes} bytes`);
  return plan.recoverableBytes;
}

export async function runAutomaticBackup(options: RunAutomaticBackupOptions): Promise<{ backupPath: string; plan: BackupRetentionPlan }> {
  const sourcePath = path.resolve(options.sourcePath);
  const backupDir = path.resolve(options.backupDir);
  const retentionCount = positiveRetentionCount(options.retentionCount);
  const log = options.log ?? console.log;
  if (!fs.existsSync(sourcePath)) throw new Error(`Database does not exist: ${sourcePath}`);

  return withBackupLock(backupDir, async () => {
    const now = options.now ?? new Date();
    const backupPath = path.join(backupDir, `vaultr-${backupTimestamp(now)}.db`);
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(backupPath);
    } finally {
      source.close();
    }

    validateSqliteBackup(backupPath);
    const verifiedAt = new Date().toISOString();
    const metadata: AutomaticBackupMetadata = {
      schemaVersion: 1,
      kind: 'AUTOMATIC_APPLICATION_BACKUP',
      backupFile: path.basename(backupPath),
      createdAt: now.toISOString(),
      verifiedAt,
      sizeBytes: fs.statSync(backupPath).size
    };
    const metadataPath = metadataPathFor(backupPath);
    const temporaryMetadataPath = `${metadataPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporaryMetadataPath, metadataPath);
    log(`Created and verified automatic backup ${backupPath} (${metadata.sizeBytes} bytes)`);

    const plan = planBackupRetention(backupDir, retentionCount, backupPath);
    applyBackupRetention(plan, false, log);
    return { backupPath, plan };
  });
}

export function protectedMarkerPath(backupPath: string): string {
  return `${backupPath}${PROTECTED_SUFFIX}`;
}
