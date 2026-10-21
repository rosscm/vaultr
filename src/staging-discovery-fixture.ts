import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

export type StagingDiscoveryFixtureArgs = { userId: string; cleanup: boolean };

export function parseStagingDiscoveryFixtureArgs(argv: string[]): StagingDiscoveryFixtureArgs {
  let userId = '';
  let cleanup = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--user') {
      userId = argv[index + 1]?.trim() ?? '';
      index += 1;
    } else if (token.startsWith('--user=')) {
      userId = token.slice('--user='.length).trim();
    } else if (token === '--cleanup') {
      cleanup = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!userId) throw new Error('An explicit --user account ID is required');
  return { userId, cleanup };
}

export async function runStagingDiscoveryFixtureCli(argv: string[]): Promise<void> {
  const args = parseStagingDiscoveryFixtureArgs(argv);
  const envFile = path.resolve(process.env.VAULTR_STAGING_ENV_FILE ?? '/home/pi/.config/vaultr/staging.env');
  const productionEnvFile = path.resolve('/home/pi/Documents/GitHub/vaultr/.env');
  if (envFile === productionEnvFile) throw new Error('Staging fixture must not load the production .env file');
  const loaded = loadEnv({ path: envFile });
  if (loaded.error) throw new Error(`Unable to load staging environment: ${envFile}`);
  const fixture = await import('./services/staging-discovery-fixture.js');
  const result = args.cleanup
    ? fixture.removeStagingDiscoveryFixture({ userId: args.userId })
    : fixture.installStagingDiscoveryFixture({ userId: args.userId });
  console.log(JSON.stringify({ fixture: fixture.STAGING_DISCOVERY_FIXTURE_MARKER, userId: args.userId, ...result }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStagingDiscoveryFixtureCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
