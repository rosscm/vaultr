import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const envFile = path.resolve(process.env.VAULTR_STAGING_ENV_FILE ?? '/home/pi/.config/vaultr/staging.env');
const productionEnvFile = path.resolve('/home/pi/Documents/GitHub/vaultr/.env');
if (envFile === productionEnvFile) throw new Error('Staging must not load the production .env file');
process.env.DOTENV_CONFIG_PATH = envFile;
const loaded = loadEnv({ path: envFile });
if (loaded.error) throw new Error(`Unable to load staging environment: ${envFile}`);

const { assertStagingEnvironment } = await import('./services/staging-config.js');
assertStagingEnvironment();

const { createVaultrWebServer, webConfigFromEnv } = await import('./web.js');
const config = webConfigFromEnv();
const port = Number(process.env.VAULTR_WEB_PORT);
const host = process.env.VAULTR_WEB_HOST!;
const server = createVaultrWebServer({ config, logger: console });
server.listen(port, host, () => {
  console.log(`KeepSeek staging web listening on http://${host}:${port}`);
});
