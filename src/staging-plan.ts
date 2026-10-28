import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { StagingPlanTier } from './services/staging-plan.js';

export type StagingPlanArgs = { userId: string; tier: StagingPlanTier };

export function parseStagingPlanArgs(argv: string[]): StagingPlanArgs {
  let userId = '';
  let tier = '';
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--user') {
      userId = argv[index + 1]?.trim() ?? '';
      index += 1;
    } else if (token.startsWith('--user=')) {
      userId = token.slice('--user='.length).trim();
    } else if (token === '--plan') {
      tier = argv[index + 1]?.trim().toUpperCase() ?? '';
      index += 1;
    } else if (token.startsWith('--plan=')) {
      tier = token.slice('--plan='.length).trim().toUpperCase();
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!userId) throw new Error('An explicit --user account ID is required');
  if (tier !== 'FREE' && tier !== 'PRO') throw new Error('Plan must be FREE or PRO');
  return { userId, tier };
}

export async function runStagingPlanCli(argv: string[]): Promise<void> {
  const args = parseStagingPlanArgs(argv);
  const envFile = path.resolve(process.env.VAULTR_STAGING_ENV_FILE ?? '/home/pi/.config/vaultr/staging.env');
  const productionEnvFile = path.resolve('/home/pi/Documents/GitHub/vaultr/.env');
  if (envFile === productionEnvFile) throw new Error('Staging plan command must not load the production .env file');
  const loaded = loadEnv({ path: envFile, override: true });
  if (loaded.error) throw new Error(`Unable to load staging environment: ${envFile}`);

  const { assertStagingEnvironment } = await import('./services/staging-config.js');
  assertStagingEnvironment(process.env, process.cwd());
  const { setStagingAccountPlan } = await import('./services/staging-plan.js');
  const result = setStagingAccountPlan({ userId: args.userId, tier: args.tier });
  console.log(JSON.stringify({ userId: result.userId, tier: result.tier, status: result.status }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStagingPlanCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
