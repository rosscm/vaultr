import { db } from './db.js';

export type WeeklyDiscoveryPreparedReserveRecord<TCandidate = unknown, TEvidence = unknown> = {
  userId: string;
  periodKey: string;
  preparationGeneration: number;
  reserveCandidates: TCandidate[];
  canonicalLookupEvidence: TEvidence;
  reserveCount: number;
  canonicalReadyCount: number;
  imageReadyCount: number;
  marketReadyCount: number;
  personallyDefensibleCount: number;
  projectedSelectableCount: number;
  projectedMarketResolvedCount: number;
  viableAlternativeCount: number;
  pendingMarketJobCount: number;
  failedMarketJobCount: number;
  blockingShortages: string[];
  lastCompletedStage: string;
  sourceFingerprint?: string;
  sourceStateUpdatedAt?: string;
  lastMeaningfulProgressAt: string;
  updatedAt: string;
};

type WeeklyDiscoveryPreparedReserveRow = {
  user_id: string;
  period_key: string;
  preparation_generation: number;
  reserve_json: string;
  canonical_lookup_evidence_json: string;
  reserve_count: number;
  canonical_ready_count: number;
  image_ready_count: number;
  market_ready_count: number;
  personally_defensible_count: number;
  projected_selectable_count: number;
  projected_market_resolved_count: number;
  viable_alternative_count: number;
  pending_market_job_count: number;
  failed_market_job_count: number;
  blocking_shortages_json: string;
  last_completed_stage: string;
  source_fingerprint: string | null;
  source_state_updated_at: string | null;
  last_meaningful_progress_at: string;
  updated_at: string;
};

const getPreparedReserveStmt = db.prepare(`
  SELECT user_id, period_key, preparation_generation, reserve_json, canonical_lookup_evidence_json,
         reserve_count, canonical_ready_count, image_ready_count, market_ready_count,
         personally_defensible_count, projected_selectable_count, projected_market_resolved_count,
         viable_alternative_count, pending_market_job_count, failed_market_job_count,
         blocking_shortages_json, last_completed_stage, source_fingerprint, source_state_updated_at,
         last_meaningful_progress_at, updated_at
  FROM weekly_discovery_prepared_reserve
  WHERE user_id = ? AND period_key = ?
`);

const upsertPreparedReserveStmt = db.prepare(`
  INSERT INTO weekly_discovery_prepared_reserve (
    user_id, period_key, preparation_generation, reserve_json, canonical_lookup_evidence_json,
    reserve_count, canonical_ready_count, image_ready_count, market_ready_count,
    personally_defensible_count, projected_selectable_count, projected_market_resolved_count,
    viable_alternative_count, pending_market_job_count, failed_market_job_count,
    blocking_shortages_json, last_completed_stage, source_fingerprint, source_state_updated_at,
    last_meaningful_progress_at, updated_at
  )
  VALUES (
    @user_id, @period_key, @preparation_generation, @reserve_json, @canonical_lookup_evidence_json,
    @reserve_count, @canonical_ready_count, @image_ready_count, @market_ready_count,
    @personally_defensible_count, @projected_selectable_count, @projected_market_resolved_count,
    @viable_alternative_count, @pending_market_job_count, @failed_market_job_count,
    @blocking_shortages_json, @last_completed_stage, @source_fingerprint, @source_state_updated_at,
    @last_meaningful_progress_at, @updated_at
  )
  ON CONFLICT(user_id, period_key) DO UPDATE SET
    preparation_generation = excluded.preparation_generation,
    reserve_json = excluded.reserve_json,
    canonical_lookup_evidence_json = excluded.canonical_lookup_evidence_json,
    reserve_count = excluded.reserve_count,
    canonical_ready_count = excluded.canonical_ready_count,
    image_ready_count = excluded.image_ready_count,
    market_ready_count = excluded.market_ready_count,
    personally_defensible_count = excluded.personally_defensible_count,
    projected_selectable_count = excluded.projected_selectable_count,
    projected_market_resolved_count = excluded.projected_market_resolved_count,
    viable_alternative_count = excluded.viable_alternative_count,
    pending_market_job_count = excluded.pending_market_job_count,
    failed_market_job_count = excluded.failed_market_job_count,
    blocking_shortages_json = excluded.blocking_shortages_json,
    last_completed_stage = excluded.last_completed_stage,
    source_fingerprint = excluded.source_fingerprint,
    source_state_updated_at = excluded.source_state_updated_at,
    last_meaningful_progress_at = excluded.last_meaningful_progress_at,
    updated_at = excluded.updated_at
`);

const deletePreparedReserveStmt = db.prepare(`
  DELETE FROM weekly_discovery_prepared_reserve
  WHERE user_id = ? AND period_key = ?
`);

const listPreparedReservesForUserStmt = db.prepare(`
  SELECT user_id, period_key, preparation_generation, reserve_json, canonical_lookup_evidence_json,
         reserve_count, canonical_ready_count, image_ready_count, market_ready_count,
         personally_defensible_count, projected_selectable_count, projected_market_resolved_count,
         viable_alternative_count, pending_market_job_count, failed_market_job_count,
         blocking_shortages_json, last_completed_stage, source_fingerprint, source_state_updated_at,
         last_meaningful_progress_at, updated_at
  FROM weekly_discovery_prepared_reserve
  WHERE user_id = ?
  ORDER BY period_key ASC
`);

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapPreparedReserveRow<TCandidate, TEvidence>(
  row: WeeklyDiscoveryPreparedReserveRow
): WeeklyDiscoveryPreparedReserveRecord<TCandidate, TEvidence> {
  return {
    userId: row.user_id,
    periodKey: row.period_key,
    preparationGeneration: row.preparation_generation,
    reserveCandidates: parseJson<TCandidate[]>(row.reserve_json),
    canonicalLookupEvidence: parseJson<TEvidence>(row.canonical_lookup_evidence_json),
    reserveCount: row.reserve_count,
    canonicalReadyCount: row.canonical_ready_count,
    imageReadyCount: row.image_ready_count,
    marketReadyCount: row.market_ready_count,
    personallyDefensibleCount: row.personally_defensible_count,
    projectedSelectableCount: row.projected_selectable_count,
    projectedMarketResolvedCount: row.projected_market_resolved_count,
    viableAlternativeCount: row.viable_alternative_count,
    pendingMarketJobCount: row.pending_market_job_count,
    failedMarketJobCount: row.failed_market_job_count,
    blockingShortages: parseJson<string[]>(row.blocking_shortages_json),
    lastCompletedStage: row.last_completed_stage,
    sourceFingerprint: row.source_fingerprint ?? undefined,
    sourceStateUpdatedAt: row.source_state_updated_at ?? undefined,
    lastMeaningfulProgressAt: row.last_meaningful_progress_at,
    updatedAt: row.updated_at
  };
}

export function getWeeklyDiscoveryPreparedReserve<TCandidate = unknown, TEvidence = unknown>(
  userId: string,
  periodKey: string
): WeeklyDiscoveryPreparedReserveRecord<TCandidate, TEvidence> | null {
  const row = getPreparedReserveStmt.get(userId, periodKey) as WeeklyDiscoveryPreparedReserveRow | undefined;
  return row ? mapPreparedReserveRow<TCandidate, TEvidence>(row) : null;
}

export function deleteWeeklyDiscoveryPreparedReserve(userId: string, periodKey: string): void {
  deletePreparedReserveStmt.run(userId, periodKey);
}

export function listWeeklyDiscoveryPreparedReservesForUser<TCandidate = unknown, TEvidence = unknown>(
  userId: string
): WeeklyDiscoveryPreparedReserveRecord<TCandidate, TEvidence>[] {
  const rows = listPreparedReservesForUserStmt.all(userId) as WeeklyDiscoveryPreparedReserveRow[];
  return rows.map((row) => mapPreparedReserveRow<TCandidate, TEvidence>(row));
}

export function upsertWeeklyDiscoveryPreparedReserve<TCandidate = unknown, TEvidence = unknown>(
  input: Omit<WeeklyDiscoveryPreparedReserveRecord<TCandidate, TEvidence>, 'updatedAt'> & { updatedAt?: string }
): { saved: boolean; record: WeeklyDiscoveryPreparedReserveRecord<TCandidate, TEvidence> | null } {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const save = db.transaction(() => {
    const current = getWeeklyDiscoveryPreparedReserve<TCandidate, TEvidence>(input.userId, input.periodKey);
    if (current && current.preparationGeneration > input.preparationGeneration) {
      return { saved: false, record: current };
    }
    upsertPreparedReserveStmt.run({
      user_id: input.userId,
      period_key: input.periodKey,
      preparation_generation: input.preparationGeneration,
      reserve_json: JSON.stringify(input.reserveCandidates),
      canonical_lookup_evidence_json: JSON.stringify(input.canonicalLookupEvidence),
      reserve_count: input.reserveCount,
      canonical_ready_count: input.canonicalReadyCount,
      image_ready_count: input.imageReadyCount,
      market_ready_count: input.marketReadyCount,
      personally_defensible_count: input.personallyDefensibleCount,
      projected_selectable_count: input.projectedSelectableCount,
      projected_market_resolved_count: input.projectedMarketResolvedCount,
      viable_alternative_count: input.viableAlternativeCount,
      pending_market_job_count: input.pendingMarketJobCount,
      failed_market_job_count: input.failedMarketJobCount,
      blocking_shortages_json: JSON.stringify(input.blockingShortages),
      last_completed_stage: input.lastCompletedStage,
      source_fingerprint: input.sourceFingerprint ?? null,
      source_state_updated_at: input.sourceStateUpdatedAt ?? null,
      last_meaningful_progress_at: input.lastMeaningfulProgressAt,
      updated_at: updatedAt
    });
    return {
      saved: true,
      record: getWeeklyDiscoveryPreparedReserve<TCandidate, TEvidence>(input.userId, input.periodKey)
    };
  });
  return save();
}
