import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  assertRecentVerifiedBackup,
  parseDiscoveryMetadataRefreshArgs
} from '../discovery-shelf-refresh-metadata.js';

describe('Display Case metadata refresh command', () => {
  it('requires one explicit account and weekly period and defaults to preview', () => {
    expect(parseDiscoveryMetadataRefreshArgs(['--user', 'usr_123', '--period', '2026-W45']))
      .toEqual({ userId: 'usr_123', periodKey: '2026-W45', apply: false });
    expect(parseDiscoveryMetadataRefreshArgs(['--user=usr_123', '--period=2026-W45', '--apply']).apply).toBe(true);
    expect(() => parseDiscoveryMetadataRefreshArgs(['--period', '2026-W45'])).toThrow('--user is required');
    expect(() => parseDiscoveryMetadataRefreshArgs(['--user', 'usr_123', '--period', 'W45'])).toThrow('YYYY-Www');
  });

  it('allows apply only when a recent SQLite backup passes integrity checks', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keepseek-shelf-refresh-'));
    const backupPath = path.join(directory, 'keepseek-recent.db');
    const database = new Database(backupPath);
    database.exec('CREATE TABLE example (id INTEGER PRIMARY KEY); INSERT INTO example DEFAULT VALUES;');
    database.close();

    expect(assertRecentVerifiedBackup(directory)).toBe(backupPath);
    fs.utimesSync(backupPath, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    expect(() => assertRecentVerifiedBackup(directory, Date.parse('2026-11-05T00:00:00Z'))).toThrow('No verified SQLite backup');
  });
});
