import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { verifyEbayListingAvailability, type EbayListingVerificationResult } from './ebay.js';

export type EbayListingAvailabilityState = 'UNVERIFIED' | 'AVAILABLE' | 'ENDED_PUBLIC' | 'UNAVAILABLE' | 'VERIFICATION_FAILED';
export type EbayListingVerificationErrorClass = 'AMBIGUOUS_NOT_FOUND' | 'RATE_LIMITED' | 'TEMPORARY_FAILURE' | 'AUTH_FAILURE';

export type EbayListingVerificationState = {
  listingId: string;
  availabilityState: EbayListingAvailabilityState;
  lastSuccessfulVerificationAt?: string;
  nextVerificationAt?: string;
  lastAttemptedAt?: string;
  attemptCount: number;
  lastErrorClass?: EbayListingVerificationErrorClass;
  lastHttpStatus?: number;
  itemEndAt?: string;
  availabilityStatus?: string;
  redactedAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

type VerificationRow = {
  listing_id: string;
  availability_state: EbayListingAvailabilityState;
  last_successful_verification_at: string | null;
  next_verification_at: string | null;
  last_attempted_at: string | null;
  attempt_count: number;
  last_error_class: EbayListingVerificationErrorClass | null;
  last_http_status: number | null;
  item_end_at: string | null;
  availability_status: string | null;
  redacted_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const verificationColumns = `
  listing_id, availability_state, last_successful_verification_at, next_verification_at,
  last_attempted_at, attempt_count, last_error_class, last_http_status, item_end_at,
  availability_status, redacted_at, lease_owner, lease_expires_at, created_at, updated_at
`;

const getStateStmt = db.prepare(`SELECT ${verificationColumns} FROM ebay_listing_verifications WHERE listing_id = ?`);
const scheduleCandidatesStmt = db.prepare(`
  SELECT listing_id FROM ebay_listing_verifications
  WHERE availability_state = 'UNVERIFIED' AND next_verification_at IS NULL AND redacted_at IS NULL
  ORDER BY created_at ASC
  LIMIT ?
`);
const scheduleCandidateStmt = db.prepare(`
  UPDATE ebay_listing_verifications
  SET next_verification_at = @now, updated_at = @now
  WHERE listing_id = @listing_id AND availability_state = 'UNVERIFIED'
    AND next_verification_at IS NULL AND redacted_at IS NULL
`);
const claimableStmt = db.prepare(`
  SELECT ${verificationColumns} FROM ebay_listing_verifications
  WHERE next_verification_at IS NOT NULL AND next_verification_at <= @now
    AND redacted_at IS NULL AND attempt_count < @max_attempts
    AND (lease_expires_at IS NULL OR lease_expires_at <= @now)
  ORDER BY next_verification_at ASC, created_at ASC
  LIMIT @limit
`);
const claimStmt = db.prepare(`
  UPDATE ebay_listing_verifications
  SET lease_owner = @owner, lease_expires_at = @lease_expires_at, updated_at = @now
  WHERE listing_id = @listing_id AND next_verification_at IS NOT NULL AND next_verification_at <= @now
    AND redacted_at IS NULL AND attempt_count < @max_attempts
    AND (lease_expires_at IS NULL OR lease_expires_at <= @now)
`);
const renewLeaseStmt = db.prepare(`
  UPDATE ebay_listing_verifications
  SET lease_expires_at = @lease_expires_at, updated_at = @now
  WHERE listing_id = @listing_id AND lease_owner = @owner
`);
const recordAttemptStmt = db.prepare(`
  INSERT INTO ebay_listing_verification_attempts (listing_id, attempted_at) VALUES (?, ?)
`);
const attemptsSinceStmt = db.prepare(`SELECT COUNT(*) AS count FROM ebay_listing_verification_attempts WHERE attempted_at >= ?`);
const pruneAttemptsStmt = db.prepare(`DELETE FROM ebay_listing_verification_attempts WHERE attempted_at < ?`);
const completeStmt = db.prepare(`
  UPDATE ebay_listing_verifications
  SET availability_state = @availability_state,
      last_successful_verification_at = @last_successful_verification_at,
      next_verification_at = @next_verification_at,
      last_attempted_at = @last_attempted_at,
      attempt_count = @attempt_count,
      last_error_class = @last_error_class,
      last_http_status = @last_http_status,
      item_end_at = @item_end_at,
      availability_status = @availability_status,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = @updated_at
  WHERE listing_id = @listing_id AND lease_owner = @lease_owner
`);

function mapState(row: VerificationRow): EbayListingVerificationState {
  return {
    listingId: row.listing_id,
    availabilityState: row.availability_state,
    lastSuccessfulVerificationAt: row.last_successful_verification_at ?? undefined,
    nextVerificationAt: row.next_verification_at ?? undefined,
    lastAttemptedAt: row.last_attempted_at ?? undefined,
    attemptCount: row.attempt_count,
    lastErrorClass: row.last_error_class ?? undefined,
    lastHttpStatus: row.last_http_status ?? undefined,
    itemEndAt: row.item_end_at ?? undefined,
    availabilityStatus: row.availability_status ?? undefined,
    redactedAt: row.redacted_at ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function boundedEnv(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.floor(parsed)) : fallback;
}

export function ebayHistoricalVerificationEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.EBAY_HISTORICAL_VERIFICATION_ENABLED?.trim() ?? '');
}

export function getEbayListingVerificationState(listingId: string): EbayListingVerificationState | null {
  const row = getStateStmt.get(listingId.trim()) as VerificationRow | undefined;
  return row ? mapState(row) : null;
}

export function ebayListingContentFreshness(
  listingId: string,
  now = new Date(),
  maxAgeMs = 6 * 60 * 60 * 1000
): {
  state: EbayListingAvailabilityState;
  availabilityFresh: boolean;
  contentFresh: false;
  availabilityVerifiedAt?: string;
  contentRefreshedAt?: string;
} {
  const record = getEbayListingVerificationState(listingId);
  if (!record) return { state: 'UNVERIFIED', availabilityFresh: false, contentFresh: false };
  const verifiedMs = Date.parse(record.lastSuccessfulVerificationAt ?? '');
  return {
    state: record.availabilityState,
    availabilityFresh: (record.availabilityState === 'AVAILABLE' || record.availabilityState === 'ENDED_PUBLIC')
      && Number.isFinite(verifiedMs)
      && now.getTime() - verifiedMs <= maxAgeMs,
    contentFresh: false,
    availabilityVerifiedAt: record.lastSuccessfulVerificationAt,
    contentRefreshedAt: undefined
  };
}

export function scheduleUnverifiedEbayListings(now = new Date(), limit = 100): number {
  if (!ebayHistoricalVerificationEnabled()) return 0;
  const rows = scheduleCandidatesStmt.all(Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<{ listing_id: string }>;
  const schedule = db.transaction(() => {
    let changed = 0;
    const nowIso = now.toISOString();
    for (const row of rows) changed += scheduleCandidateStmt.run({ listing_id: row.listing_id, now: nowIso }).changes;
    return changed;
  });
  return schedule();
}

function claimDue(owner: string, now: Date, limit: number, maxAttempts: number, leaseMs: number): EbayListingVerificationState[] {
  const claim = db.transaction(() => {
    const params = { now: now.toISOString(), limit, max_attempts: maxAttempts };
    const rows = claimableStmt.all(params) as VerificationRow[];
    const claimed: EbayListingVerificationState[] = [];
    for (const row of rows) {
      const result = claimStmt.run({
        listing_id: row.listing_id,
        owner,
        now: params.now,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        max_attempts: maxAttempts
      });
      if (result.changes > 0) {
        const current = getStateStmt.get(row.listing_id) as VerificationRow;
        claimed.push(mapState(current));
      }
    }
    return claimed;
  });
  return claim();
}

function retryDelayMs(result: EbayListingVerificationResult, attempts: number): number {
  if (result.kind === 'RATE_LIMITED') return Math.max(60_000, Math.min(24 * 60 * 60_000, result.retryAfterMs ?? 15 * 60_000));
  if (result.kind === 'AUTH_FAILURE') return 60 * 60_000;
  return Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** Math.max(0, attempts));
}

function saveResult(
  record: EbayListingVerificationState,
  owner: string,
  result: EbayListingVerificationResult,
  attemptedAt: Date,
  completedAt: Date
): void {
  const successful = result.kind === 'AVAILABLE' || result.kind === 'ENDED_PUBLIC' || result.kind === 'UNAVAILABLE';
  const errorClass = successful ? null : result.kind;
  const attemptCount = successful ? 0 : record.attemptCount + (result.kind === 'RATE_LIMITED' ? 0 : 1);
  const nextVerificationAt = result.kind === 'AVAILABLE'
    ? new Date(completedAt.getTime() + 6 * 60 * 60_000).toISOString()
    : result.kind === 'ENDED_PUBLIC'
      ? new Date(completedAt.getTime() + 24 * 60 * 60_000).toISOString()
      : result.kind === 'UNAVAILABLE'
        ? null
        : new Date(completedAt.getTime() + retryDelayMs(result, attemptCount)).toISOString();
  const state: EbayListingAvailabilityState = result.kind === 'AVAILABLE'
    ? 'AVAILABLE'
    : result.kind === 'ENDED_PUBLIC'
      ? 'ENDED_PUBLIC'
      : result.kind === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'VERIFICATION_FAILED';

  completeStmt.run({
    listing_id: record.listingId,
    lease_owner: owner,
    availability_state: state,
    last_successful_verification_at: successful ? completedAt.toISOString() : record.lastSuccessfulVerificationAt ?? null,
    next_verification_at: nextVerificationAt,
    last_attempted_at: attemptedAt.toISOString(),
    attempt_count: attemptCount,
    last_error_class: errorClass,
    last_http_status: result.httpStatus ?? null,
    item_end_at: result.itemEndAt ?? record.itemEndAt ?? null,
    availability_status: result.availabilityStatus ?? record.availabilityStatus ?? null,
    updated_at: completedAt.toISOString()
  });
}

export async function processEbayListingVerificationQueue(input: {
  now?: Date;
  clock?: () => Date;
  workerId?: string;
  verify?: typeof verifyEbayListingAvailability;
} = {}): Promise<{ disabled: boolean; attempted: number; succeeded: number; failed: number; deferred: number }> {
  if (!ebayHistoricalVerificationEnabled()) return { disabled: true, attempted: 0, succeeded: 0, failed: 0, deferred: 0 };

  const clock = input.clock ?? (input.now ? () => new Date(input.now!.getTime()) : () => new Date());
  const batchStartedAt = clock();
  const batchLimit = boundedEnv('EBAY_HISTORICAL_VERIFICATION_BATCH_SIZE', 10, 25);
  const hourlyLimit = boundedEnv('EBAY_HISTORICAL_VERIFICATION_HOURLY_LIMIT', 100, 500);
  const maxAttempts = boundedEnv('EBAY_HISTORICAL_VERIFICATION_MAX_ATTEMPTS', 8, 20);
  const leaseMs = boundedEnv('EBAY_HISTORICAL_VERIFICATION_LEASE_SECONDS', 300, 900) * 1000;
  scheduleUnverifiedEbayListings(batchStartedAt, batchLimit);
  const workerId = input.workerId ?? randomUUID();
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;
  const verify = input.verify ?? verifyEbayListingAvailability;
  for (let index = 0; index < batchLimit; index += 1) {
    const claimAt = clock();
    const hourAgo = new Date(claimAt.getTime() - 60 * 60_000).toISOString();
    const recent = Number((attemptsSinceStmt.get(hourAgo) as { count: number }).count);
    if (recent >= hourlyLimit) break;
    const [record] = claimDue(workerId, claimAt, 1, maxAttempts, leaseMs);
    if (!record) break;
    attempted += 1;
    const attemptedAt = clock();
    recordAttemptStmt.run(record.listingId, attemptedAt.toISOString());
    let result: EbayListingVerificationResult;
    try {
      result = await verify(record.listingId, {
        now: attemptedAt,
        onRequestStart: () => {
          const requestStartedAt = clock();
          renewLeaseStmt.run({
            listing_id: record.listingId,
            owner: workerId,
            now: requestStartedAt.toISOString(),
            lease_expires_at: new Date(requestStartedAt.getTime() + leaseMs).toISOString()
          });
        }
      });
    } catch (error) {
      console.error('Historical eBay listing verification failed unexpectedly', {
        listingId: record.listingId,
        error: error instanceof Error ? error.message : String(error)
      });
      result = { kind: 'TEMPORARY_FAILURE', errorCode: 'UNEXPECTED_EXCEPTION' };
    }
    const completedAt = clock();
    saveResult(record, workerId, result, attemptedAt, completedAt);
    if (result.kind === 'AVAILABLE' || result.kind === 'ENDED_PUBLIC' || result.kind === 'UNAVAILABLE') succeeded += 1;
    else failed += 1;
  }
  pruneAttemptsStmt.run(new Date(clock().getTime() - 24 * 60 * 60_000).toISOString());
  return { disabled: false, attempted, succeeded, failed, deferred: Math.max(0, batchLimit - attempted) };
}

type VerificationProcessor = () => Promise<{ attempted: number }>;

let verificationWorkerTimer: ReturnType<typeof setInterval> | undefined;
let verificationWorkerRunning = false;

async function runScheduledVerification(processor: VerificationProcessor): Promise<void> {
  if (verificationWorkerRunning) return;
  verificationWorkerRunning = true;
  try {
    const result = await processor();
    if (result.attempted > 0) console.info(`[eBayVerification] ${JSON.stringify(result)}`);
  } catch (error) {
    console.error('Historical eBay verification batch failed', error);
  } finally {
    verificationWorkerRunning = false;
  }
}

export function startHistoricalEbayVerificationWorker(
  processor: VerificationProcessor = processEbayListingVerificationQueue
): void {
  if (!ebayHistoricalVerificationEnabled() || verificationWorkerTimer) return;
  const intervalMs = boundedEnv('EBAY_HISTORICAL_VERIFICATION_INTERVAL_SECONDS', 900, 3600) * 1000;
  verificationWorkerTimer = setInterval(() => {
    void runScheduledVerification(processor);
  }, intervalMs);
  verificationWorkerTimer.unref?.();
}

export const __ebayListingVerificationTestHooks = {
  stopWorker(): void {
    if (verificationWorkerTimer) clearInterval(verificationWorkerTimer);
    verificationWorkerTimer = undefined;
    verificationWorkerRunning = false;
  },
  runScheduledVerification
};
