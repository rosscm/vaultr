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
): { state: EbayListingAvailabilityState; fresh: boolean; verifiedAt?: string } {
  const record = getEbayListingVerificationState(listingId);
  if (!record) return { state: 'UNVERIFIED', fresh: false };
  const verifiedMs = Date.parse(record.lastSuccessfulVerificationAt ?? '');
  return {
    state: record.availabilityState,
    fresh: (record.availabilityState === 'AVAILABLE' || record.availabilityState === 'ENDED_PUBLIC')
      && Number.isFinite(verifiedMs)
      && now.getTime() - verifiedMs <= maxAgeMs,
    verifiedAt: record.lastSuccessfulVerificationAt
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

function saveResult(record: EbayListingVerificationState, owner: string, result: EbayListingVerificationResult, now: Date): void {
  const successful = result.kind === 'AVAILABLE' || result.kind === 'ENDED_PUBLIC' || result.kind === 'UNAVAILABLE';
  const errorClass = successful ? null : result.kind;
  const attemptCount = successful ? 0 : record.attemptCount + (result.kind === 'RATE_LIMITED' ? 0 : 1);
  const nextVerificationAt = result.kind === 'AVAILABLE'
    ? new Date(now.getTime() + 6 * 60 * 60_000).toISOString()
    : result.kind === 'ENDED_PUBLIC'
      ? new Date(now.getTime() + 24 * 60 * 60_000).toISOString()
      : result.kind === 'UNAVAILABLE'
        ? null
        : new Date(now.getTime() + retryDelayMs(result, attemptCount)).toISOString();
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
    last_successful_verification_at: successful ? now.toISOString() : record.lastSuccessfulVerificationAt ?? null,
    next_verification_at: nextVerificationAt,
    last_attempted_at: now.toISOString(),
    attempt_count: attemptCount,
    last_error_class: errorClass,
    last_http_status: result.httpStatus ?? null,
    item_end_at: result.itemEndAt ?? record.itemEndAt ?? null,
    availability_status: result.availabilityStatus ?? record.availabilityStatus ?? null,
    updated_at: now.toISOString()
  });
}

export async function processEbayListingVerificationQueue(input: {
  now?: Date;
  workerId?: string;
  verify?: typeof verifyEbayListingAvailability;
} = {}): Promise<{ disabled: boolean; attempted: number; succeeded: number; failed: number; deferred: number }> {
  if (!ebayHistoricalVerificationEnabled()) return { disabled: true, attempted: 0, succeeded: 0, failed: 0, deferred: 0 };

  const now = input.now ?? new Date();
  const batchLimit = boundedEnv('EBAY_HISTORICAL_VERIFICATION_BATCH_SIZE', 10, 25);
  const hourlyLimit = boundedEnv('EBAY_HISTORICAL_VERIFICATION_HOURLY_LIMIT', 100, 500);
  const maxAttempts = boundedEnv('EBAY_HISTORICAL_VERIFICATION_MAX_ATTEMPTS', 8, 20);
  const leaseMs = boundedEnv('EBAY_HISTORICAL_VERIFICATION_LEASE_SECONDS', 120, 900) * 1000;
  const hourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  const recent = Number((attemptsSinceStmt.get(hourAgo) as { count: number }).count);
  const allowance = Math.max(0, Math.min(batchLimit, hourlyLimit - recent));
  if (allowance === 0) return { disabled: false, attempted: 0, succeeded: 0, failed: 0, deferred: batchLimit };

  scheduleUnverifiedEbayListings(now, allowance);
  const workerId = input.workerId ?? randomUUID();
  const claimed = claimDue(workerId, now, allowance, maxAttempts, leaseMs);
  let succeeded = 0;
  let failed = 0;
  const verify = input.verify ?? verifyEbayListingAvailability;
  for (const record of claimed) {
    recordAttemptStmt.run(record.listingId, now.toISOString());
    const result = await verify(record.listingId, { now });
    saveResult(record, workerId, result, now);
    if (result.kind === 'AVAILABLE' || result.kind === 'ENDED_PUBLIC' || result.kind === 'UNAVAILABLE') succeeded += 1;
    else failed += 1;
  }
  pruneAttemptsStmt.run(new Date(now.getTime() - 24 * 60 * 60_000).toISOString());
  return { disabled: false, attempted: claimed.length, succeeded, failed, deferred: Math.max(0, allowance - claimed.length) };
}
