import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { processDiscoveryMarketRefreshWork } from './commands/discover.js';
import { claimDiscoveryMarketRefreshJobs, completeDiscoveryMarketRefreshJob, requeueStaleDiscoveryMarketRefreshJobs, retryDiscoveryMarketRefreshJob } from './services/discovery-market-jobs.js';

const workerId = process.env.DISCOVERY_MARKET_WORKER_ID ?? `discovery-market-worker:${process.pid}:${randomUUID()}`;
const batchSize = Math.max(1, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_BATCH_SIZE ?? '1')));
const pollMs = Math.max(1000, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_POLL_MS ?? '5000')));
const retryBaseMs = Math.max(60_000, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_RETRY_BASE_MS ?? `${15 * 60 * 1000}`)));
const retryMaxMs = Math.max(retryBaseMs, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_RETRY_MAX_MS ?? `${60 * 60 * 1000}`)));
const maxAttempts = Math.max(1, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_MAX_ATTEMPTS ?? '5')));
const lockTimeoutMs = Math.max(60_000, Math.floor(Number(process.env.DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS ?? `${10 * 60 * 1000}`)));

let stopping = false;

function retryAfterIso(attempts: number): string {
  const delayMs = Math.min(retryMaxMs, retryBaseMs * Math.max(1, attempts));
  return new Date(Date.now() + delayMs).toISOString();
}

async function runBatch(): Promise<number> {
  const requeued = requeueStaleDiscoveryMarketRefreshJobs(lockTimeoutMs);
  if (requeued > 0) console.warn(`[Discovery market worker] requeued ${requeued} stale job lock(s)`);
  const jobs = claimDiscoveryMarketRefreshJobs(workerId, batchSize);
  for (const job of jobs) {
    try {
      await processDiscoveryMarketRefreshWork(job);
      completeDiscoveryMarketRefreshJob(job.cacheKey);
      console.log(`[Discovery market worker] refreshed ${job.suggestion.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retryDiscoveryMarketRefreshJob(job.cacheKey, message, retryAfterIso(job.attempts), maxAttempts);
      console.warn(`[Discovery market worker] refresh failed for ${job.suggestion.name}: ${message}`);
    }
  }
  return jobs.length;
}

async function runWorker(): Promise<void> {
  console.log(`[Discovery market worker] started as ${workerId}`);
  while (!stopping) {
    const processed = await runBatch();
    if (processed === 0) await delay(pollMs);
  }
  console.log('[Discovery market worker] stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

await runWorker();