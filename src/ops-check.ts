import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client, GatewayIntentBits } from 'discord.js';
import { getChaseLastPollAttemptAt, getUserPlan, listAllChases } from './services/chase-store.js';
import { getDiscoveryMarketRefreshQueueStats } from './services/discovery-market-jobs.js';
import { getWeeklyDiscoveryPreparationHealth } from './services/discovery-drop-scheduler.js';
import { failureFingerprint, shouldSuppressDuplicateAlert } from './services/ops-alerts.js';
import { activePlanChases, activePlanTier, PLAN_LIMITS } from './services/plans.js';

const execFileAsync = promisify(execFile);

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

type AlertState = {
  lastFailureFingerprint?: string;
  lastAlertedAt?: string;
  lastRecoveryFingerprint?: string;
};

function envValue(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function positiveNumberEnv(key: string, fallback: number): number {
  const value = Number(envValue(key) ?? String(fallback));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function discoveryWorkerLockTimeoutMs(): number {
  return Math.max(60_000, Math.floor(Number(envValue('DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS') ?? `${10 * 60 * 1000}`)));
}

function discoveryHealthRecentProgressGraceMs(): number {
  return Math.max(60_000, Math.floor(Number(envValue('DISCOVERY_HEALTH_RECENT_PROGRESS_GRACE_MS') ?? `${30 * 60 * 1000}`)));
}

function hasRecentDiscoveryQueueProgress(lastCompletedAt: string | undefined, nowMs: number): boolean {
  if (!lastCompletedAt) return false;
  const completedAtMs = Date.parse(lastCompletedAt);
  if (!Number.isFinite(completedAtMs)) return false;
  return nowMs - completedAtMs <= discoveryHealthRecentProgressGraceMs();
}

function alertStatePath(): string {
  return path.resolve(envValue('VAULTR_OPS_ALERT_STATE_PATH') ?? './data/ops-check-state.json');
}

function readAlertState(): AlertState {
  const statePath = alertStatePath();
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as AlertState;
  } catch {
    return {};
  }
}

function writeAlertState(state: AlertState): void {
  const statePath = alertStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function alertBody(failures: CheckResult[], fingerprint: string): string {
  const lines = [
    '**Vaultr ops check failed**',
    `Failure fingerprint: \`${fingerprint.slice(0, 12)}\``,
    ...failures.map((failure) => `- ${failure.name}: ${failure.details}`)
  ];
  return lines.join('\n').slice(0, 1900);
}

async function sendDiscordAlert(message: string): Promise<boolean> {
  const dryRun = (envValue('VAULTR_OPS_ALERT_DRY_RUN') ?? 'false').toLowerCase() === 'true';
  const alertUserId = envValue('VAULTR_OPS_ALERT_USER_ID') ?? envValue('OWNER_USER_ID');
  if (dryRun) {
    console.log(`[DRY RUN] Would send ops alert to ${alertUserId ?? 'no configured user'}:\n${message}`);
    return true;
  }
  if (!alertUserId) {
    console.warn('[ops-alert] Skipping Discord alert: VAULTR_OPS_ALERT_USER_ID or OWNER_USER_ID is not configured');
    return false;
  }
  const token = envValue('DISCORD_TOKEN');
  if (!token) {
    console.warn('[ops-alert] Skipping Discord alert: DISCORD_TOKEN is not configured');
    return false;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(token);
    const user = await client.users.fetch(alertUserId);
    await user.send(message);
    return true;
  } finally {
    client.destroy();
  }
}

async function alertOnFailures(failures: CheckResult[]): Promise<void> {
  if (failures.length === 0) {
    const state = readAlertState();
    if (state.lastFailureFingerprint) {
      writeAlertState({ ...state, lastFailureFingerprint: undefined, lastRecoveryFingerprint: state.lastFailureFingerprint });
    }
    return;
  }

  const fingerprint = failureFingerprint(failures);
  const state = readAlertState();
  const repeatCooldownMinutes = positiveNumberEnv('VAULTR_OPS_ALERT_REPEAT_MINUTES', 0);
  if (shouldSuppressDuplicateAlert(state, fingerprint, Date.now(), repeatCooldownMinutes)) {
    console.log(`[ops-alert] Suppressed duplicate alert for ${fingerprint.slice(0, 12)}`);
    return;
  }

  try {
    const delivered = await sendDiscordAlert(alertBody(failures, fingerprint));
    if (delivered) writeAlertState({ lastFailureFingerprint: fingerprint, lastAlertedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ops-alert] Failed to send Discord alert: ${message}`);
  }
}

async function checkSystemdService(serviceName: string): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', serviceName], { timeout: 5000 });
    const state = stdout.trim();
    return { name: `service:${serviceName}`, ok: state === 'active', details: state };
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    const details = candidate.stdout?.trim() || candidate.stderr?.trim() || candidate.message || String(error);
    return { name: `service:${serviceName}`, ok: false, details };
  }
}

function checkDatabaseFile(): CheckResult {
  const databasePath = path.resolve(envValue('DATABASE_PATH') ?? './data/vaultr.db');
  if (!fs.existsSync(databasePath)) {
    return { name: 'database-file', ok: false, details: `Missing ${databasePath}` };
  }
  const sizeBytes = fs.statSync(databasePath).size;
  return { name: 'database-file', ok: sizeBytes > 0, details: `${databasePath} (${sizeBytes} bytes)` };
}

function checkRecentBackup(): CheckResult {
  const backupDir = path.resolve(envValue('VAULTR_BACKUP_DIR') ?? './data/backups');
  const maxAgeHours = Number(envValue('VAULTR_BACKUP_MAX_AGE_HOURS') ?? '24');
  const maxAgeMs = Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  if (!fs.existsSync(backupDir)) {
    return { name: 'backup-age', ok: false, details: `Missing backup directory ${backupDir}` };
  }

  const backupFiles = fs.readdirSync(backupDir)
    .filter((fileName) => fileName.endsWith('.db'))
    .map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latest = backupFiles[0];
  if (!latest) {
    return { name: 'backup-age', ok: false, details: `No .db backups in ${backupDir}` };
  }

  const ageHours = (Date.now() - latest.mtimeMs) / (60 * 60 * 1000);
  return {
    name: 'backup-age',
    ok: ageHours <= maxAgeMs / (60 * 60 * 1000),
    details: `${latest.filePath} (${ageHours.toFixed(1)}h old; limit ${Math.round(maxAgeMs / (60 * 60 * 1000))}h)`
  };
}

function checkChaseFreshness(): CheckResult {
  const maxOverdueMultiple = positiveNumberEnv('VAULTR_OPS_MAX_OVERDUE_INTERVAL_MULTIPLE', 4);
  const nowMs = Date.now();
  const chasesByUser = new Map<string, ReturnType<typeof listAllChases>>();

  for (const chase of listAllChases()) {
    const userChases = chasesByUser.get(chase.userId) ?? [];
    userChases.push(chase);
    chasesByUser.set(chase.userId, userChases);
  }

  let activeChaseCount = 0;
  let staleChaseCount = 0;
  let worst: { cardName: string; overdueMinutes: number; intervalMinutes: number } | undefined;

  for (const [userId, userChases] of chasesByUser.entries()) {
    const plan = getUserPlan(userId);
    const tier = activePlanTier(plan);
    const intervalSeconds = PLAN_LIMITS[tier].pollIntervalSeconds;
    const maxOverdueMs = intervalSeconds * 1000 * maxOverdueMultiple;

    for (const chase of activePlanChases(userChases, plan)) {
      activeChaseCount += 1;
      const lastAttemptedAt = getChaseLastPollAttemptAt(chase.id);
      if (!lastAttemptedAt) continue;
      const lastAttemptedAtMs = new Date(lastAttemptedAt).getTime();
      if (!Number.isFinite(lastAttemptedAtMs)) continue;
      const overdueMs = nowMs - (lastAttemptedAtMs + intervalSeconds * 1000);
      if (overdueMs <= maxOverdueMs) continue;

      staleChaseCount += 1;
      const overdueMinutes = Math.floor(overdueMs / 60_000);
      if (!worst || overdueMinutes > worst.overdueMinutes) {
        worst = { cardName: chase.cardName, overdueMinutes, intervalMinutes: Math.floor(intervalSeconds / 60) };
      }
    }
  }

  if (!worst) {
    return { name: 'chase-freshness', ok: true, details: `${activeChaseCount} active chases; none over ${maxOverdueMultiple}x interval` };
  }

  return {
    name: 'chase-freshness',
    ok: false,
    details: `${staleChaseCount}/${activeChaseCount} active chases over ${maxOverdueMultiple}x interval without poll attempt; worst ${worst.cardName} (${worst.overdueMinutes}m overdue, ${worst.intervalMinutes}m interval)`
  };
}

function checkDiscoveryHealth(): CheckResult {
  const nowMs = Date.now();
  const queue = getDiscoveryMarketRefreshQueueStats(discoveryWorkerLockTimeoutMs(), nowMs);
  const weekly = getWeeklyDiscoveryPreparationHealth(new Date(nowMs));
  const readyBacklog = queue.queuedReady + queue.retryReady;
  const recentQueueProgress = hasRecentDiscoveryQueueProgress(queue.lastCompletedAt, nowMs);
  const queueActivelyWorking = queue.activeWorkers > 0 || queue.running > 0 || recentQueueProgress;

  if (queue.staleRunning > 0) {
    return {
      name: 'discovery-health',
      ok: false,
      details: `${queue.staleRunning} stale worker lock(s); ready backlog ${readyBacklog}, active workers ${queue.activeWorkers}`
    };
  }

  if (readyBacklog >= 10 && !queueActivelyWorking) {
    return {
      name: 'discovery-health',
      ok: false,
      details: `ready backlog ${readyBacklog} with no active discovery worker; last done ${queue.lastCompletedAt ?? 'never'}`
    };
  }

  if (weekly.proUsers > 0 && weekly.overdueUnprepared === weekly.proUsers && weekly.prepared === 0 && !queueActivelyWorking) {
    return {
      name: 'discovery-health',
      ok: false,
      details: `weekly ${weekly.periodKey} has 0/${weekly.proUsers} prepared Pro shelves after release; queue ready ${readyBacklog}, running ${queue.running}`
    };
  }

  return {
    name: 'discovery-health',
    ok: true,
    details: `weekly ${weekly.periodKey}: ${weekly.prepared}/${weekly.proUsers} prepared, ${weekly.ineligible} thin excluded, ${weekly.refreshDue} refresh due, queue ready ${readyBacklog}, running ${queue.running}`
  };
}

const services = (envValue('VAULTR_OPS_SERVICES') ?? 'vaultr.service,vaultr-discovery-market-worker.service,vaultr-ebay-webhook.service')
  .split(',')
  .map((serviceName) => serviceName.trim())
  .filter(Boolean);

const checks = [
  ...(await Promise.all(services.map((serviceName) => checkSystemdService(serviceName)))),
  checkDatabaseFile(),
  checkRecentBackup(),
  checkChaseFreshness(),
  checkDiscoveryHealth()
];

for (const check of checks) {
  const label = check.ok ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${check.name}: ${check.details}`);
}

const failures = checks.filter((check) => !check.ok);
await alertOnFailures(failures);

if (failures.length > 0) {
  process.exit(1);
}
