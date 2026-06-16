import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';
import type { SupportedCurrency } from './currency.js';
import type { Chase } from '../types.js';

export type DiscoveryMarketRefreshJobStatus = 'QUEUED' | 'RUNNING' | 'RETRY' | 'DONE' | 'FAILED';

export type DiscoveryMarketRefreshJobInput = {
  cacheKey: string;
  suggestion: DiscoverySuggestion;
  userId: string;
  activeChases: Chase[];
  destination?: { country?: string; postalCode?: string };
  range?: { min: number; max: number };
  targetCurrency: SupportedCurrency;
  priority?: number;
  runAfter?: string;
};

export type DiscoveryMarketRefreshJob = DiscoveryMarketRefreshJobInput & {
  suggestionName: string;
  status: DiscoveryMarketRefreshJobStatus;
  attempts: number;
  lastError?: string;
  lockedBy?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DiscoveryMarketRefreshQueueStats = {
  queuedReady: number;
  queuedScheduled: number;
  retryReady: number;
  retryScheduled: number;
  running: number;
  staleRunning: number;
  failed: number;
  done: number;
  activeWorkers: number;
  oldestReadyAt?: string;
  oldestRunningLockedAt?: string;
  nextScheduledRunAt?: string;
  lastCompletedAt?: string;
  lastFailedAt?: string;
  lastError?: string;
};

type DiscoveryMarketRefreshJobRow = {
  cache_key: string;
  suggestion_name: string;
  suggestion_json: string;
  user_id: string;
  active_chases_json: string;
  destination_json: string | null;
  range_json: string | null;
  target_currency: SupportedCurrency;
  priority: number;
  status: DiscoveryMarketRefreshJobStatus;
  attempts: number;
  last_error: string | null;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

const enqueueDiscoveryMarketRefreshJobStmt = db.prepare(`
  INSERT INTO discovery_market_refresh_jobs (
    cache_key, suggestion_name, suggestion_json, user_id, active_chases_json,
    destination_json, range_json, target_currency, priority, status, attempts,
    last_error, run_after, locked_by, locked_at, created_at, updated_at
  )
  VALUES (
    @cache_key, @suggestion_name, @suggestion_json, @user_id, @active_chases_json,
    @destination_json, @range_json, @target_currency, @priority, 'QUEUED', 0,
    NULL, @run_after, NULL, NULL, @created_at, @updated_at
  )
  ON CONFLICT(cache_key) DO UPDATE SET
    suggestion_name = excluded.suggestion_name,
    suggestion_json = excluded.suggestion_json,
    user_id = excluded.user_id,
    active_chases_json = excluded.active_chases_json,
    destination_json = excluded.destination_json,
    range_json = excluded.range_json,
    target_currency = excluded.target_currency,
    priority = max(discovery_market_refresh_jobs.priority, excluded.priority),
    status = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.status
      ELSE 'QUEUED'
    END,
    attempts = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.attempts
      ELSE 0
    END,
    last_error = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.last_error
      ELSE NULL
    END,
    run_after = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.run_after
      ELSE excluded.run_after
    END,
    locked_by = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.locked_by
      ELSE NULL
    END,
    locked_at = CASE
      WHEN discovery_market_refresh_jobs.status = 'RUNNING' THEN discovery_market_refresh_jobs.locked_at
      ELSE NULL
    END,
    updated_at = excluded.updated_at
`);

const claimableDiscoveryMarketRefreshJobsStmt = db.prepare(`
  SELECT cache_key, suggestion_name, suggestion_json, user_id, active_chases_json,
         destination_json, range_json, target_currency, priority, status, attempts,
         last_error, run_after, locked_by, locked_at, created_at, updated_at
  FROM discovery_market_refresh_jobs
  WHERE status IN ('QUEUED', 'RETRY')
    AND run_after <= @now
  ORDER BY priority DESC, created_at ASC
  LIMIT @limit
`);

const claimDiscoveryMarketRefreshJobStmt = db.prepare(`
  UPDATE discovery_market_refresh_jobs
  SET status = 'RUNNING', attempts = attempts + 1, locked_by = @worker_id, locked_at = @now, updated_at = @now
  WHERE cache_key = @cache_key
    AND status IN ('QUEUED', 'RETRY')
    AND run_after <= @now
`);

const completeDiscoveryMarketRefreshJobStmt = db.prepare(`
  UPDATE discovery_market_refresh_jobs
  SET status = 'DONE', last_error = NULL, locked_by = NULL, locked_at = NULL, updated_at = @now
  WHERE cache_key = @cache_key
`);

const retryDiscoveryMarketRefreshJobStmt = db.prepare(`
  UPDATE discovery_market_refresh_jobs
  SET status = @status, last_error = @last_error, run_after = @run_after, locked_by = NULL, locked_at = NULL, updated_at = @now
  WHERE cache_key = @cache_key
`);

const requeueStaleDiscoveryMarketRefreshJobsStmt = db.prepare(`
  UPDATE discovery_market_refresh_jobs
  SET status = 'RETRY', last_error = 'stale worker lock', run_after = @now, locked_by = NULL, locked_at = NULL, updated_at = @now
  WHERE status = 'RUNNING'
    AND locked_at IS NOT NULL
    AND locked_at < @locked_before
`);

const deleteDiscoveryMarketRefreshJobStmt = db.prepare(`
  DELETE FROM discovery_market_refresh_jobs
  WHERE cache_key = ?
`);

const getDiscoveryMarketRefreshJobStmt = db.prepare(`
  SELECT cache_key, suggestion_name, suggestion_json, user_id, active_chases_json,
         destination_json, range_json, target_currency, priority, status, attempts,
         last_error, run_after, locked_by, locked_at, created_at, updated_at
  FROM discovery_market_refresh_jobs
  WHERE cache_key = ?
`);

const getDiscoveryMarketRefreshQueueStatsStmt = db.prepare(`
  SELECT
    SUM(CASE WHEN status = 'QUEUED' AND run_after <= @now THEN 1 ELSE 0 END) AS queued_ready,
    SUM(CASE WHEN status = 'QUEUED' AND run_after > @now THEN 1 ELSE 0 END) AS queued_scheduled,
    SUM(CASE WHEN status = 'RETRY' AND run_after <= @now THEN 1 ELSE 0 END) AS retry_ready,
    SUM(CASE WHEN status = 'RETRY' AND run_after > @now THEN 1 ELSE 0 END) AS retry_scheduled,
    SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) AS running,
    SUM(CASE WHEN status = 'RUNNING' AND locked_at IS NOT NULL AND locked_at < @stale_before THEN 1 ELSE 0 END) AS stale_running,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done,
    COUNT(DISTINCT CASE WHEN status = 'RUNNING' THEN locked_by ELSE NULL END) AS active_workers,
    MIN(CASE WHEN status IN ('QUEUED', 'RETRY') AND run_after <= @now THEN created_at ELSE NULL END) AS oldest_ready_at,
    MIN(CASE WHEN status = 'RUNNING' THEN locked_at ELSE NULL END) AS oldest_running_locked_at,
    MIN(CASE WHEN status IN ('QUEUED', 'RETRY') AND run_after > @now THEN run_after ELSE NULL END) AS next_scheduled_run_at,
    MAX(CASE WHEN status = 'DONE' THEN updated_at ELSE NULL END) AS last_completed_at,
    MAX(CASE WHEN status = 'FAILED' THEN updated_at ELSE NULL END) AS last_failed_at
  FROM discovery_market_refresh_jobs
`);

const getLatestDiscoveryMarketRefreshJobErrorStmt = db.prepare(`
  SELECT last_error
  FROM discovery_market_refresh_jobs
  WHERE last_error IS NOT NULL
    AND status IN ('RETRY', 'FAILED')
  ORDER BY updated_at DESC
  LIMIT 1
`);

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as T;
}

function mapDiscoveryMarketRefreshJob(row: DiscoveryMarketRefreshJobRow): DiscoveryMarketRefreshJob {
  return {
    cacheKey: row.cache_key,
    suggestionName: row.suggestion_name,
    suggestion: parseJson<DiscoverySuggestion>(row.suggestion_json) ?? {
      name: row.suggestion_name,
      lane: 'Collector Compass',
      laneWhy: 'queued market refresh',
      why: 'queued market refresh',
      nearby: []
    },
    userId: row.user_id,
    activeChases: parseJson<Chase[]>(row.active_chases_json) ?? [],
    destination: parseJson<{ country?: string; postalCode?: string }>(row.destination_json),
    range: parseJson<{ min: number; max: number }>(row.range_json),
    targetCurrency: row.target_currency,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    lockedBy: row.locked_by ?? undefined,
    lockedAt: row.locked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function enqueueDiscoveryMarketRefreshJob(input: DiscoveryMarketRefreshJobInput): void {
  const now = new Date().toISOString();
  enqueueDiscoveryMarketRefreshJobStmt.run({
    cache_key: input.cacheKey,
    suggestion_name: input.suggestion.name,
    suggestion_json: JSON.stringify(input.suggestion),
    user_id: input.userId,
    active_chases_json: JSON.stringify(input.activeChases),
    destination_json: input.destination ? JSON.stringify(input.destination) : null,
    range_json: input.range ? JSON.stringify(input.range) : null,
    target_currency: input.targetCurrency,
    priority: input.priority ?? 0,
    run_after: input.runAfter ?? now,
    created_at: now,
    updated_at: now
  });
}

export function enqueueDiscoveryMarketRefreshJobs(inputs: DiscoveryMarketRefreshJobInput[]): void {
  const enqueueMany = db.transaction((jobs: DiscoveryMarketRefreshJobInput[]) => {
    for (const job of jobs) enqueueDiscoveryMarketRefreshJob(job);
  });
  enqueueMany(inputs);
}

export function claimDiscoveryMarketRefreshJobs(workerId: string = randomUUID(), limit = 1, now = new Date().toISOString()): DiscoveryMarketRefreshJob[] {
  const claimMany = db.transaction(() => {
    const rows = claimableDiscoveryMarketRefreshJobsStmt.all({ now, limit }) as DiscoveryMarketRefreshJobRow[];
    const claimed: DiscoveryMarketRefreshJob[] = [];
    for (const row of rows) {
      const result = claimDiscoveryMarketRefreshJobStmt.run({ cache_key: row.cache_key, worker_id: workerId, now });
      if (result.changes > 0) {
        const claimedRow = getDiscoveryMarketRefreshJobStmt.get(row.cache_key) as DiscoveryMarketRefreshJobRow | undefined;
        if (claimedRow) claimed.push(mapDiscoveryMarketRefreshJob(claimedRow));
      }
    }
    return claimed;
  });
  return claimMany();
}

export function completeDiscoveryMarketRefreshJob(cacheKey: string, now = new Date().toISOString()): void {
  completeDiscoveryMarketRefreshJobStmt.run({ cache_key: cacheKey, now });
}

export function retryDiscoveryMarketRefreshJob(cacheKey: string, error: string, runAfter: string, maxAttempts = 5, now = new Date().toISOString()): void {
  const current = getDiscoveryMarketRefreshJob(cacheKey);
  const status: DiscoveryMarketRefreshJobStatus = current && current.attempts >= maxAttempts ? 'FAILED' : 'RETRY';
  retryDiscoveryMarketRefreshJobStmt.run({ cache_key: cacheKey, status, last_error: error, run_after: runAfter, now });
}

export function requeueStaleDiscoveryMarketRefreshJobs(lockTimeoutMs: number, nowMs = Date.now()): number {
  const now = new Date(nowMs).toISOString();
  const lockedBefore = new Date(nowMs - lockTimeoutMs).toISOString();
  const result = requeueStaleDiscoveryMarketRefreshJobsStmt.run({ now, locked_before: lockedBefore });
  return result.changes;
}

export function deleteDiscoveryMarketRefreshJob(cacheKey: string): void {
  deleteDiscoveryMarketRefreshJobStmt.run(cacheKey);
}

export function getDiscoveryMarketRefreshJob(cacheKey: string): DiscoveryMarketRefreshJob | null {
  const row = getDiscoveryMarketRefreshJobStmt.get(cacheKey) as DiscoveryMarketRefreshJobRow | undefined;
  return row ? mapDiscoveryMarketRefreshJob(row) : null;
}

export function getDiscoveryMarketRefreshQueueStats(lockTimeoutMs: number, nowMs = Date.now()): DiscoveryMarketRefreshQueueStats {
  const now = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - lockTimeoutMs).toISOString();
  const row = getDiscoveryMarketRefreshQueueStatsStmt.get({ now, stale_before: staleBefore }) as {
    queued_ready: number | null;
    queued_scheduled: number | null;
    retry_ready: number | null;
    retry_scheduled: number | null;
    running: number | null;
    stale_running: number | null;
    failed: number | null;
    done: number | null;
    active_workers: number | null;
    oldest_ready_at: string | null;
    oldest_running_locked_at: string | null;
    next_scheduled_run_at: string | null;
    last_completed_at: string | null;
    last_failed_at: string | null;
  };
  const latestError = getLatestDiscoveryMarketRefreshJobErrorStmt.get() as { last_error: string | null } | undefined;
  return {
    queuedReady: row.queued_ready ?? 0,
    queuedScheduled: row.queued_scheduled ?? 0,
    retryReady: row.retry_ready ?? 0,
    retryScheduled: row.retry_scheduled ?? 0,
    running: row.running ?? 0,
    staleRunning: row.stale_running ?? 0,
    failed: row.failed ?? 0,
    done: row.done ?? 0,
    activeWorkers: row.active_workers ?? 0,
    oldestReadyAt: row.oldest_ready_at ?? undefined,
    oldestRunningLockedAt: row.oldest_running_locked_at ?? undefined,
    nextScheduledRunAt: row.next_scheduled_run_at ?? undefined,
    lastCompletedAt: row.last_completed_at ?? undefined,
    lastFailedAt: row.last_failed_at ?? undefined,
    lastError: latestError?.last_error ?? undefined
  };
}