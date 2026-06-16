import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client, GatewayIntentBits } from 'discord.js';

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

function failureFingerprint(failures: CheckResult[]): string {
  const payload = failures.map((failure) => ({ name: failure.name, details: failure.details }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
  const cooldownMs = positiveNumberEnv('VAULTR_OPS_ALERT_COOLDOWN_MINUTES', 60) * 60 * 1000;
  const lastAlertedAtMs = state.lastAlertedAt ? new Date(state.lastAlertedAt).getTime() : 0;
  const stillCoolingDown = state.lastFailureFingerprint === fingerprint && Number.isFinite(lastAlertedAtMs) && Date.now() - lastAlertedAtMs < cooldownMs;
  if (stillCoolingDown) {
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

const services = (envValue('VAULTR_OPS_SERVICES') ?? 'vaultr.service,vaultr-discovery-market-worker.service,vaultr-ebay-webhook.service')
  .split(',')
  .map((serviceName) => serviceName.trim())
  .filter(Boolean);

const checks = [
  ...(await Promise.all(services.map((serviceName) => checkSystemdService(serviceName)))),
  checkDatabaseFile(),
  checkRecentBackup()
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
