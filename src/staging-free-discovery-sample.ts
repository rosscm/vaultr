import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

export async function runStagingFreeDiscoverySampleCli(argv: string[]): Promise<void> {
  const userArg = argv.find((value) => value.startsWith('--user='));
  const userId = userArg?.slice('--user='.length).trim();
  if (!userId || argv.some((value) => !value.startsWith('--user='))) throw new Error('An explicit --user=ACCOUNT_ID is required');
  const envFile = path.resolve(process.env.VAULTR_STAGING_ENV_FILE ?? '/home/pi/.config/vaultr/staging.env');
  const productionEnvFile = path.resolve('/home/pi/Documents/GitHub/vaultr/.env');
  if (envFile === productionEnvFile) throw new Error('Staging sample worker must not load the production .env file');
  const loaded = loadEnv({ path: envFile });
  if (loaded.error) throw new Error(`Unable to load staging environment: ${envFile}`);
  const { assertStagingEnvironment } = await import('./services/staging-config.js');
  assertStagingEnvironment();
  const { processFreeDiscoverySampleJobForUser } = await import('./services/free-discovery-sample.js');
  const processed = processFreeDiscoverySampleJobForUser(userId);
  console.log(`Staging Free Display Case sample processed: ${processed ? 1 : 0}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStagingFreeDiscoverySampleCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
