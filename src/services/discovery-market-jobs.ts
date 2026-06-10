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