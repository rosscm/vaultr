import { db } from './db.js';

export type WeeklyDiscoveryPreparationStateStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'RETRY_SCHEDULED'
  | 'READY'
  | 'FAILED_FINAL';

export type WeeklyDiscoveryDeliveryState = 'NONE' | 'PENDING' | 'DELIVERED';

export type WeeklyPreparationFailureCode =
  | 'PREPARATION_TIMEOUT'
  | 'RESERVE_ASSEMBLY_TIMEOUT'
  | 'INSUFFICIENT_FINAL_CANDIDATES'
  | 'INSUFFICIENT_MARKET_READY'
  | 'INSUFFICIENT_TRUSTED_IMAGES'
  | 'INVALID_FINAL_SHELF'
  | 'WORKER_RESULTS_PENDING'
  | 'PROVIDER_TIMEOUT'
  | 'STALE_PREPARATION_LEASE'
  | 'USER_INELIGIBLE'
  | 'EXISTING_VALID_SHELF_RETAINED'
  | 'UNEXPECTED_EXCEPTION'
  | 'ANNOUNCEMENT_SEND_FAILED';

export type WeeklyPreparationLastOutcome =
  | 'PREPARED'
  | 'RETRYABLE_FAILURE'
  | 'TERMINAL_FAILURE'
  | 'NOT_REQUIRED'
  | 'DELIVERED';

export type WeeklyDiscoveryPreparationState = {
  userId: string;
  periodKey: string;
  state: WeeklyDiscoveryPreparationStateStatus;
  attemptCount: number;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastOutcome?: WeeklyPreparationLastOutcome;
  failureCode?: WeeklyPreparationFailureCode;
  failureSummary?: string;
  preparationGeneration: number;
  leaseExpiresAt?: string;
  releasePassed: boolean;
  ownerAlertSent: boolean;
  recoveredAfterRelease: boolean;
  deliveryState: WeeklyDiscoveryDeliveryState;
  deliveryAttemptCount: number;
  lastDeliveryAttemptAt?: string;
  deliveryError?: string;
  deliveredAt?: string;
  announcementGuildId?: string;
  announcementMessageId?: string;
  updatedAt: string;
};

type WeeklyDiscoveryPreparationStateRow = {
  user_id: string;
  period_key: string;
  state: WeeklyDiscoveryPreparationStateStatus;
  attempt_count: number;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  last_outcome: WeeklyPreparationLastOutcome | null;
  failure_code: WeeklyPreparationFailureCode | null;
  failure_summary: string | null;
  preparation_generation: number;
  lease_expires_at: string | null;
  release_passed: number;
  owner_alert_sent: number;
  recovered_after_release: number;
  delivery_state: WeeklyDiscoveryDeliveryState;
  delivery_attempt_count: number;
  last_delivery_attempt_at: string | null;
  delivery_error: string | null;
  delivered_at: string | null;
  announcement_guild_id: string | null;
  announcement_message_id: string | null;
  updated_at: string;
};

const getWeeklyPreparationStateStmt = db.prepare(`
  SELECT user_id, period_key, state, attempt_count, first_attempt_at, last_attempt_at, next_retry_at,
         last_outcome, failure_code, failure_summary, preparation_generation, lease_expires_at,
         release_passed, owner_alert_sent, recovered_after_release, delivery_state, delivery_attempt_count,
         last_delivery_attempt_at, delivery_error, delivered_at, announcement_guild_id, announcement_message_id,
         updated_at
  FROM weekly_discovery_preparation_state
  WHERE user_id = ? AND period_key = ?
`);

const listWeeklyPreparationStatesStmt = db.prepare(`
  SELECT user_id, period_key, state, attempt_count, first_attempt_at, last_attempt_at, next_retry_at,
         last_outcome, failure_code, failure_summary, preparation_generation, lease_expires_at,
         release_passed, owner_alert_sent, recovered_after_release, delivery_state, delivery_attempt_count,
         last_delivery_attempt_at, delivery_error, delivered_at, announcement_guild_id, announcement_message_id,
         updated_at
  FROM weekly_discovery_preparation_state
  WHERE period_key = ?
  ORDER BY user_id ASC
`);

const upsertWeeklyPreparationStateStmt = db.prepare(`
  INSERT INTO weekly_discovery_preparation_state (
    user_id, period_key, state, attempt_count, first_attempt_at, last_attempt_at, next_retry_at,
    last_outcome, failure_code, failure_summary, preparation_generation, lease_expires_at,
    release_passed, owner_alert_sent, recovered_after_release, delivery_state, delivery_attempt_count,
    last_delivery_attempt_at, delivery_error, delivered_at, announcement_guild_id, announcement_message_id, updated_at
  )
  VALUES (
    @user_id, @period_key, @state, @attempt_count, @first_attempt_at, @last_attempt_at, @next_retry_at,
    @last_outcome, @failure_code, @failure_summary, @preparation_generation, @lease_expires_at,
    @release_passed, @owner_alert_sent, @recovered_after_release, @delivery_state, @delivery_attempt_count,
    @last_delivery_attempt_at, @delivery_error, @delivered_at, @announcement_guild_id, @announcement_message_id, @updated_at
  )
  ON CONFLICT(user_id, period_key) DO UPDATE SET
    state = excluded.state,
    attempt_count = excluded.attempt_count,
    first_attempt_at = excluded.first_attempt_at,
    last_attempt_at = excluded.last_attempt_at,
    next_retry_at = excluded.next_retry_at,
    last_outcome = excluded.last_outcome,
    failure_code = excluded.failure_code,
    failure_summary = excluded.failure_summary,
    preparation_generation = excluded.preparation_generation,
    lease_expires_at = excluded.lease_expires_at,
    release_passed = excluded.release_passed,
    owner_alert_sent = excluded.owner_alert_sent,
    recovered_after_release = excluded.recovered_after_release,
    delivery_state = excluded.delivery_state,
    delivery_attempt_count = excluded.delivery_attempt_count,
    last_delivery_attempt_at = excluded.last_delivery_attempt_at,
    delivery_error = excluded.delivery_error,
    delivered_at = excluded.delivered_at,
    announcement_guild_id = excluded.announcement_guild_id,
    announcement_message_id = excluded.announcement_message_id,
    updated_at = excluded.updated_at
`);

const deleteWeeklyPreparationStateStmt = db.prepare(`
  DELETE FROM weekly_discovery_preparation_state
  WHERE user_id = ? AND period_key = ?
`);

const deleteWeeklyPreparationStatesForPeriodStmt = db.prepare(`
  DELETE FROM weekly_discovery_preparation_state
  WHERE period_key = ?
`);

function mapWeeklyPreparationStateRow(row: WeeklyDiscoveryPreparationStateRow): WeeklyDiscoveryPreparationState {
  return {
    userId: row.user_id,
    periodKey: row.period_key,
    state: row.state,
    attemptCount: row.attempt_count,
    firstAttemptAt: row.first_attempt_at ?? undefined,
    lastAttemptAt: row.last_attempt_at ?? undefined,
    nextRetryAt: row.next_retry_at ?? undefined,
    lastOutcome: row.last_outcome ?? undefined,
    failureCode: row.failure_code ?? undefined,
    failureSummary: row.failure_summary ?? undefined,
    preparationGeneration: row.preparation_generation,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    releasePassed: row.release_passed === 1,
    ownerAlertSent: row.owner_alert_sent === 1,
    recoveredAfterRelease: row.recovered_after_release === 1,
    deliveryState: row.delivery_state,
    deliveryAttemptCount: row.delivery_attempt_count,
    lastDeliveryAttemptAt: row.last_delivery_attempt_at ?? undefined,
    deliveryError: row.delivery_error ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    announcementGuildId: row.announcement_guild_id ?? undefined,
    announcementMessageId: row.announcement_message_id ?? undefined,
    updatedAt: row.updated_at
  };
}

function isoOrUndefined(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

export function getWeeklyDiscoveryPreparationState(userId: string, periodKey: string): WeeklyDiscoveryPreparationState | null {
  const row = getWeeklyPreparationStateStmt.get(userId, periodKey) as WeeklyDiscoveryPreparationStateRow | undefined;
  return row ? mapWeeklyPreparationStateRow(row) : null;
}

export function listWeeklyDiscoveryPreparationStates(periodKey: string): WeeklyDiscoveryPreparationState[] {
  const rows = listWeeklyPreparationStatesStmt.all(periodKey) as WeeklyDiscoveryPreparationStateRow[];
  return rows.map(mapWeeklyPreparationStateRow);
}

export function deleteWeeklyDiscoveryPreparationState(userId: string, periodKey: string): void {
  deleteWeeklyPreparationStateStmt.run(userId, periodKey);
}

export function deleteWeeklyDiscoveryPreparationStatesForPeriod(periodKey: string): void {
  deleteWeeklyPreparationStatesForPeriodStmt.run(periodKey);
}

export function upsertWeeklyDiscoveryPreparationState(
  input: Omit<WeeklyDiscoveryPreparationState, 'updatedAt'> & { updatedAt?: string }
): WeeklyDiscoveryPreparationState {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  upsertWeeklyPreparationStateStmt.run({
    user_id: input.userId,
    period_key: input.periodKey,
    state: input.state,
    attempt_count: input.attemptCount,
    first_attempt_at: isoOrUndefined(input.firstAttemptAt) ?? null,
    last_attempt_at: isoOrUndefined(input.lastAttemptAt) ?? null,
    next_retry_at: isoOrUndefined(input.nextRetryAt) ?? null,
    last_outcome: input.lastOutcome ?? null,
    failure_code: input.failureCode ?? null,
    failure_summary: input.failureSummary ?? null,
    preparation_generation: input.preparationGeneration,
    lease_expires_at: isoOrUndefined(input.leaseExpiresAt) ?? null,
    release_passed: input.releasePassed ? 1 : 0,
    owner_alert_sent: input.ownerAlertSent ? 1 : 0,
    recovered_after_release: input.recoveredAfterRelease ? 1 : 0,
    delivery_state: input.deliveryState,
    delivery_attempt_count: input.deliveryAttemptCount,
    last_delivery_attempt_at: isoOrUndefined(input.lastDeliveryAttemptAt) ?? null,
    delivery_error: input.deliveryError ?? null,
    delivered_at: isoOrUndefined(input.deliveredAt) ?? null,
    announcement_guild_id: input.announcementGuildId ?? null,
    announcement_message_id: input.announcementMessageId ?? null,
    updated_at: updatedAt
  });
  const saved = getWeeklyDiscoveryPreparationState(input.userId, input.periodKey);
  if (!saved) throw new Error('Weekly discovery preparation state was not saved');
  return saved;
}

export function claimWeeklyDiscoveryPreparationLease(input: {
  userId: string;
  periodKey: string;
  now?: string;
  leaseExpiresAt: string;
  releasePassed: boolean;
}): WeeklyDiscoveryPreparationState | null {
  const now = input.now ?? new Date().toISOString();
  const claim = db.transaction(() => {
    const current = getWeeklyDiscoveryPreparationState(input.userId, input.periodKey);
    if (current?.state === 'PREPARING' && current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.parse(now)) {
      return null;
    }

    return upsertWeeklyDiscoveryPreparationState({
      userId: input.userId,
      periodKey: input.periodKey,
      state: 'PREPARING',
      attemptCount: (current?.attemptCount ?? 0) + 1,
      firstAttemptAt: current?.firstAttemptAt ?? now,
      lastAttemptAt: now,
      nextRetryAt: undefined,
      lastOutcome: current?.lastOutcome,
      failureCode: current?.failureCode,
      failureSummary: current?.failureSummary,
      preparationGeneration: (current?.preparationGeneration ?? 0) + 1,
      leaseExpiresAt: input.leaseExpiresAt,
      releasePassed: input.releasePassed,
      ownerAlertSent: current?.ownerAlertSent ?? false,
      recoveredAfterRelease: current?.recoveredAfterRelease ?? false,
      deliveryState: current?.deliveryState ?? 'NONE',
      deliveryAttemptCount: current?.deliveryAttemptCount ?? 0,
      lastDeliveryAttemptAt: current?.lastDeliveryAttemptAt,
      deliveryError: current?.deliveryError,
      deliveredAt: current?.deliveredAt,
      announcementGuildId: current?.announcementGuildId,
      announcementMessageId: current?.announcementMessageId,
      updatedAt: now
    });
  });
  return claim();
}

export function completeWeeklyDiscoveryPreparationState(input: {
  userId: string;
  periodKey: string;
  generation: number;
  state: WeeklyDiscoveryPreparationStateStatus;
  lastOutcome: WeeklyPreparationLastOutcome;
  failureCode?: WeeklyPreparationFailureCode;
  failureSummary?: string;
  nextRetryAt?: string;
  releasePassed: boolean;
  deliveryState: WeeklyDiscoveryDeliveryState;
  now?: string;
}): WeeklyDiscoveryPreparationState | null {
  const now = input.now ?? new Date().toISOString();
  const complete = db.transaction(() => {
    const current = getWeeklyDiscoveryPreparationState(input.userId, input.periodKey);
    if (!current || current.preparationGeneration !== input.generation) return null;
    return upsertWeeklyDiscoveryPreparationState({
      ...current,
      state: input.state,
      lastOutcome: input.lastOutcome,
      failureCode: input.failureCode,
      failureSummary: input.failureSummary,
      nextRetryAt: input.nextRetryAt,
      releasePassed: input.releasePassed,
      deliveryState: input.deliveryState,
      leaseExpiresAt: undefined,
      updatedAt: now
    });
  });
  return complete();
}

export function markWeeklyDiscoveryDeliveryAttempt(input: {
  userId: string;
  periodKey: string;
  now?: string;
  error?: string;
  state?: WeeklyDiscoveryDeliveryState;
}): WeeklyDiscoveryPreparationState | null {
  const now = input.now ?? new Date().toISOString();
  const current = getWeeklyDiscoveryPreparationState(input.userId, input.periodKey);
  if (!current) return null;
  return upsertWeeklyDiscoveryPreparationState({
    ...current,
    deliveryState: input.state ?? current.deliveryState,
    deliveryAttemptCount: current.deliveryAttemptCount + 1,
    lastDeliveryAttemptAt: now,
    deliveryError: input.error,
    updatedAt: now
  });
}

export function markWeeklyDiscoveryDeliveredForPeriod(input: {
  periodKey: string;
  userIds: string[];
  guildId?: string;
  messageId?: string;
  now?: string;
}): void {
  const now = input.now ?? new Date().toISOString();
  const write = db.transaction(() => {
    for (const userId of input.userIds) {
      const current = getWeeklyDiscoveryPreparationState(userId, input.periodKey);
      if (!current) continue;
      upsertWeeklyDiscoveryPreparationState({
        ...current,
        state: current.state === 'READY' ? 'READY' : current.state,
        lastOutcome: 'DELIVERED',
        deliveryState: 'DELIVERED',
        deliveryError: undefined,
        deliveredAt: now,
        announcementGuildId: input.guildId ?? current.announcementGuildId,
        announcementMessageId: input.messageId ?? current.announcementMessageId,
        recoveredAfterRelease: current.recoveredAfterRelease,
        updatedAt: now
      });
    }
  });
  write();
}

export function markWeeklyDiscoveryOwnerAlertState(input: {
  periodKey: string;
  userIds: string[];
  ownerAlertSent?: boolean;
  recoveredAfterRelease?: boolean;
  now?: string;
}): void {
  const now = input.now ?? new Date().toISOString();
  const write = db.transaction(() => {
    for (const userId of input.userIds) {
      const current = getWeeklyDiscoveryPreparationState(userId, input.periodKey);
      if (!current) continue;
      upsertWeeklyDiscoveryPreparationState({
        ...current,
        ownerAlertSent: input.ownerAlertSent ?? current.ownerAlertSent,
        recoveredAfterRelease: input.recoveredAfterRelease ?? current.recoveredAfterRelease,
        updatedAt: now
      });
    }
  });
  write();
}
