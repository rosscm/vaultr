import 'dotenv/config';
import { processOneFreeDiscoverySampleJob } from './services/free-discovery-sample.js';

const once = process.argv.includes('--once');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = Math.max(1, Math.min(Number(limitArg?.split('=')[1] ?? (once ? 1 : 10)), 25));

let processed = 0;
while (processed < limit && processOneFreeDiscoverySampleJob()) processed += 1;
console.log(`Free Display Case sample jobs processed: ${processed}`);
