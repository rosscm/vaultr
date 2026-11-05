import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBackupRetention,
  planBackupRetention,
  protectedMarkerPath,
  runAutomaticBackup,
  validateSqliteBackup,
  withBackupLock
} from '../backup-retention.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keepseek-backup-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createDatabase(databasePath: string, invalidForeignKey = false): void {
  const database = new Database(databasePath);
  database.pragma('foreign_keys = OFF');
  database.exec(`
    CREATE TABLE parent (id INTEGER PRIMARY KEY);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    INSERT INTO parent (id) VALUES (1);
    INSERT INTO child (id, parent_id) VALUES (1, ${invalidForeignKey ? 2 : 1});
  `);
  database.close();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('automatic SQLite backup retention', () => {
  it('creates and validates managed backups while retaining only the latest configured count', async () => {
    const root = temporaryDirectory();
    const sourcePath = path.join(root, 'source.db');
    const backupDir = path.join(root, 'backups');
    createDatabase(sourcePath);

    for (let index = 0; index < 9; index += 1) {
      await runAutomaticBackup({
        sourcePath,
        backupDir,
        retentionCount: 7,
        now: new Date(Date.UTC(2026, 10, 1, index)),
        log: () => undefined
      });
    }

    const databases = fs.readdirSync(backupDir).filter((entry) => entry.endsWith('.db'));
    expect(databases).toHaveLength(7);
    expect(fs.readdirSync(backupDir).filter((entry) => entry.endsWith('.automatic.json'))).toHaveLength(7);
    for (const database of databases) validateSqliteBackup(path.join(backupDir, database));
  });

  it('preserves protected checkpoints, manual exports, catalog backups, and unknown historical files', async () => {
    const root = temporaryDirectory();
    const sourcePath = path.join(root, 'source.db');
    const backupDir = path.join(root, 'backups');
    createDatabase(sourcePath);
    fs.mkdirSync(backupDir);
    for (const name of ['manual-export.db', 'card-catalog-backup.db', 'vaultr-historical.db']) {
      fs.copyFileSync(sourcePath, path.join(backupDir, name));
    }
    const first = await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-01T00:00:00Z'), log: () => undefined });
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-02T00:00:00Z'), log: () => undefined });
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-03T00:00:00Z'), log: () => undefined });
    fs.writeFileSync(protectedMarkerPath(first.backupPath), 'pre-web-migration recovery checkpoint\n');

    const plan = planBackupRetention(backupDir, 1);
    applyBackupRetention(plan, false, () => undefined);

    expect(fs.existsSync(first.backupPath)).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'manual-export.db'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'card-catalog-backup.db'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'vaultr-historical.db'))).toBe(true);
  });

  it('reports dry-run candidates and recoverable bytes without deleting files', async () => {
    const root = temporaryDirectory();
    const sourcePath = path.join(root, 'source.db');
    const backupDir = path.join(root, 'backups');
    createDatabase(sourcePath);
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-01T00:00:00Z'), log: () => undefined });
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-02T00:00:00Z'), log: () => undefined });
    const plan = planBackupRetention(backupDir, 1);
    const messages: string[] = [];

    applyBackupRetention(plan, true, (message) => messages.push(message));

    expect(plan.candidates).toHaveLength(1);
    expect(plan.recoverableBytes).toBeGreaterThan(0);
    expect(fs.existsSync(plan.candidates[0]!.backupPath)).toBe(true);
    expect(messages.join(' ')).toContain('Would delete');
  });

  it('does not prune known-good backups when a new backup fails validation', async () => {
    const root = temporaryDirectory();
    const sourcePath = path.join(root, 'source.db');
    const invalidSourcePath = path.join(root, 'invalid.db');
    const backupDir = path.join(root, 'backups');
    createDatabase(sourcePath);
    createDatabase(invalidSourcePath, true);
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-01T00:00:00Z'), log: () => undefined });
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-02T00:00:00Z'), log: () => undefined });

    await expect(runAutomaticBackup({
      sourcePath: invalidSourcePath,
      backupDir,
      retentionCount: 1,
      now: new Date('2026-11-03T00:00:00Z'),
      log: () => undefined
    })).rejects.toThrow(/foreign-key check failed/);

    expect(fs.readdirSync(backupDir).filter((entry) => entry.endsWith('.automatic.json'))).toHaveLength(2);
    expect(fs.readdirSync(backupDir).filter((entry) => entry.endsWith('.db'))).toHaveLength(3);
  });

  it('does not prune when backup creation cannot start', async () => {
    const root = temporaryDirectory();
    const sourcePath = path.join(root, 'source.db');
    const backupDir = path.join(root, 'backups');
    createDatabase(sourcePath);
    await runAutomaticBackup({ sourcePath, backupDir, retentionCount: 10, now: new Date('2026-11-01T00:00:00Z'), log: () => undefined });
    const before = fs.readdirSync(backupDir).sort();

    await expect(runAutomaticBackup({
      sourcePath: path.join(root, 'missing.db'),
      backupDir,
      retentionCount: 1,
      log: () => undefined
    })).rejects.toThrow(/Database does not exist/);

    expect(fs.readdirSync(backupDir).sort()).toEqual(before);
  });

  it('prevents concurrent backup processes from entering the protected section', async () => {
    const backupDir = temporaryDirectory();
    let release!: () => void;
    const held = withBackupLock(backupDir, async () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(withBackupLock(backupDir, async () => undefined)).rejects.toThrow(/already running/);
    release();
    await held;
  });
});
