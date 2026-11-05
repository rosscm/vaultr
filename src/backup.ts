import 'dotenv/config';
import path from 'node:path';
import { applyBackupRetention, planBackupRetention, runAutomaticBackup, withBackupLock } from './services/backup-retention.js';

const sourcePath = path.resolve(process.env.DATABASE_PATH ?? './data/vaultr.db');
const backupDir = path.resolve(process.env.VAULTR_BACKUP_DIR ?? './data/backups');

const retentionCount = Number(process.env.VAULTR_BACKUP_RETENTION_COUNT ?? '7');
const dryRun = process.argv.includes('--dry-run') || process.env.VAULTR_BACKUP_DRY_RUN === 'true';

if (dryRun) {
  await withBackupLock(backupDir, async () => {
    const plan = planBackupRetention(backupDir, retentionCount);
    console.log(`Managed automatic backups: ${plan.managedCount}; retained: ${plan.retainedCount}`);
    applyBackupRetention(plan, true);
  });
} else {
  await runAutomaticBackup({ sourcePath, backupDir, retentionCount });
}
