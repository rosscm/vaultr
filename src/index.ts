import 'dotenv/config';
import { initializeCurrencyRates } from './services/currency.js';
import { backfillChaseQueryNames } from './services/chase-store.js';
import { startPoller } from './services/poller.js';
import { logBuildInfo } from './services/build-info.js';

logBuildInfo('monitoring-worker');

await initializeCurrencyRates();
backfillChaseQueryNames();
startPoller();
