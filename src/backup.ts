import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function backupTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

const sourcePath = path.resolve(process.env.DATABASE_PATH ?? './data/vaultr.db');
const backupDir = path.resolve(process.env.VAULTR_BACKUP_DIR ?? './data/backups');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Database does not exist: ${sourcePath}`);
}

fs.mkdirSync(backupDir, { recursive: true });

const backupPath = path.join(backupDir, `vaultr-${backupTimestamp()}.db`);
const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });

try {
  await sourceDb.backup(backupPath);
} finally {
  sourceDb.close();
}

const sizeBytes = fs.statSync(backupPath).size;
console.log(`Backed up ${sourcePath} to ${backupPath} (${sizeBytes} bytes)`);
