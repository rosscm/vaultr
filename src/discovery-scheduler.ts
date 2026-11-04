import 'dotenv/config';
import { logBuildInfo } from './services/build-info.js';
import { startDiscoveryDropScheduler, stopDiscoveryDropScheduler } from './services/discovery-drop-scheduler.js';

logBuildInfo('discovery-scheduler');

if (process.env.VAULTR_ENVIRONMENT !== 'production') {
  throw new Error('Standalone Discovery scheduler requires VAULTR_ENVIRONMENT=production');
}

console.log('[Discovery scheduler] starting');
startDiscoveryDropScheduler();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`[Discovery scheduler] stopping on ${signal}`);
    stopDiscoveryDropScheduler();
  });
}
