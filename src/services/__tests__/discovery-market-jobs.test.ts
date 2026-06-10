import { afterEach, describe, expect, it } from 'vitest';
import {
  claimDiscoveryMarketRefreshJobs,
  completeDiscoveryMarketRefreshJob,
  deleteDiscoveryMarketRefreshJob,
  enqueueDiscoveryMarketRefreshJob,
  getDiscoveryMarketRefreshJob,
  requeueStaleDiscoveryMarketRefreshJobs,
  retryDiscoveryMarketRefreshJob
} from '../discovery-market-jobs.js';

const cacheKeys: string[] = [];

function track(cacheKey: string): string {
  cacheKeys.push(cacheKey);
  return cacheKey;
}

afterEach(() => {
  for (const cacheKey of cacheKeys.splice(0)) deleteDiscoveryMarketRefreshJob(cacheKey);
});

function enqueueJob(cacheKey: string, priority = 0): void {
  enqueueDiscoveryMarketRefreshJob({
    cacheKey: track(cacheKey),
    suggestion: {
      name: `Mew Japanese S12a 052 ${cacheKey}`,
      lane: 'Japanese Collector Trail',
      laneWhy: 'profile match',
      why: 'profile match',
      nearby: [],
      evidenceSearchTerm: 'Mew Japanese S12a 052 Pokemon card'
    },
    userId: 'user-1',
    activeChases: [
      {
        id: 'chase-1',
        userId: 'user-1',
        cardName: 'Mew ex Paldean Fates 232',
        createdAt: '2026-06-10T00:00:00.000Z'
      }
    ],
    destination: { country: 'CA' },
    range: { min: 0, max: 1200 },
    targetCurrency: 'CAD',
    priority,
    runAfter: '2026-06-10T00:00:00.000Z'
  });
}

describe('discovery market refresh jobs', () => {
  it('upserts a queued job by cache key without duplicating work', () => {
    const cacheKey = `job-upsert-${Date.now()}`;
    enqueueJob(cacheKey, 1);
    enqueueJob(cacheKey, 3);

    const job = getDiscoveryMarketRefreshJob(cacheKey);

    expect(job?.status).toBe('QUEUED');
    expect(job?.priority).toBe(3);
    expect(job?.suggestion.name).toContain(cacheKey);
    expect(job?.destination).toEqual({ country: 'CA' });
    expect(job?.range).toEqual({ min: 0, max: 1200 });
  });

  it('claims ready jobs in priority order for a worker', () => {
    const slowKey = `job-slow-${Date.now()}`;
    const urgentKey = `job-urgent-${Date.now()}`;
    enqueueJob(slowKey, 1);
    enqueueJob(urgentKey, 5);

    const [claimed] = claimDiscoveryMarketRefreshJobs('worker-1', 1, '2026-06-10T00:01:00.000Z');

    expect(claimed?.cacheKey).toBe(urgentKey);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedBy).toBe('worker-1');
    expect(getDiscoveryMarketRefreshJob(slowKey)?.status).toBe('QUEUED');
  });

  it('records completion and retry state for worker processing', () => {
    const cacheKey = `job-retry-${Date.now()}`;
    enqueueJob(cacheKey, 1);
    claimDiscoveryMarketRefreshJobs('worker-1', 1, '2026-06-10T00:01:00.000Z');

    retryDiscoveryMarketRefreshJob(cacheKey, 'eBay timeout', '2026-06-10T00:16:00.000Z', 5, '2026-06-10T00:02:00.000Z');
    expect(getDiscoveryMarketRefreshJob(cacheKey)?.status).toBe('RETRY');
    expect(getDiscoveryMarketRefreshJob(cacheKey)?.lastError).toBe('eBay timeout');

    claimDiscoveryMarketRefreshJobs('worker-2', 1, '2026-06-10T00:17:00.000Z');
    completeDiscoveryMarketRefreshJob(cacheKey, '2026-06-10T00:18:00.000Z');

    const completed = getDiscoveryMarketRefreshJob(cacheKey);
    expect(completed?.status).toBe('DONE');
    expect(completed?.lastError).toBeUndefined();
    expect(completed?.lockedBy).toBeUndefined();
  });

  it('requeues stale running locks for worker crash recovery', () => {
    const cacheKey = `job-stale-${Date.now()}`;
    enqueueJob(cacheKey, 1);
    claimDiscoveryMarketRefreshJobs('worker-1', 1, '2026-06-10T00:01:00.000Z');

    const requeued = requeueStaleDiscoveryMarketRefreshJobs(10 * 60 * 1000, new Date('2026-06-10T00:12:00.000Z').getTime());
    const job = getDiscoveryMarketRefreshJob(cacheKey);

    expect(requeued).toBe(1);
    expect(job?.status).toBe('RETRY');
    expect(job?.lastError).toBe('stale worker lock');
    expect(job?.lockedBy).toBeUndefined();
  });
});