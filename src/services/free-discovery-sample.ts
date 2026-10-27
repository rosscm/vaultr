import { db } from './db.js';
import { requireVerifiedCardCatalogRecordsWithImages } from './card-catalog-db.js';
import { catalogDisplayValue } from './card-catalog/normalize.js';
import type { StoredCardCatalogRecord } from './card-catalog/types.js';
import { getCollectorInterestProfile, type CollectorInterestProfile } from './collector-profile.js';
import { analyzeCollectorProfileReserve, collectorInterestProfileToTasteProfile } from './collector-profile-ranking-adapter.js';
import { getCollectorPreferences } from './collector-preferences.js';
import type { DiscoveryCandidate } from '../commands/discover.js';
import { tasteOnboardingEnabled } from './features.js';

export type FreeDiscoverySampleStatus = 'NOT_REQUESTED' | 'QUEUED' | 'PREPARING' | 'RETRYABLE_FAILURE' | 'COMPLETE' | 'UNDERSUPPLIED' | 'FAILED';
export type FreeDiscoverySampleItem = {
  name: string;
  imageUrl: string;
  setName?: string;
  cardNumber?: string;
  language: 'English' | 'Japanese';
  reason: string;
  roleLabel: string;
  cardIdentity: { value: string; matchKey: string; sourceName: string; sourceCardId: string };
};
export type FreeDiscoverySample = {
  status: FreeDiscoverySampleStatus;
  attemptCount: number;
  nextRetryAt?: string;
  failureCode?: string;
  items: FreeDiscoverySampleItem[];
  updatedAt?: string;
};

type SampleRow = {
  status: Exclude<FreeDiscoverySampleStatus, 'NOT_REQUESTED'>;
  attempt_count: number;
  lease_expires_at: string | null;
  next_retry_at: string | null;
  result_json: string | null;
  failure_code: string | null;
  failure_summary: string | null;
  updated_at: string;
};

const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;

function mapRow(row?: SampleRow): FreeDiscoverySample {
  if (!row) return { status: 'NOT_REQUESTED', attemptCount: 0, items: [] };
  let items: FreeDiscoverySampleItem[] = [];
  try { items = row.result_json ? JSON.parse(row.result_json) : []; } catch { items = []; }
  return {
    status: row.status,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at ?? undefined,
    failureCode: row.failure_code ?? undefined,
    items,
    updatedAt: row.updated_at
  };
}

export function getFreeDiscoverySample(userId: string): FreeDiscoverySample {
  return mapRow(db.prepare('SELECT * FROM free_discovery_samples WHERE user_id = ?').get(userId) as SampleRow | undefined);
}

export function requestFreeDiscoverySample(userId: string, now = new Date()): FreeDiscoverySample {
  if (!tasteOnboardingEnabled()) throw new Error('feature_disabled');
  if (!getCollectorPreferences(userId).readiness.ready) throw new Error('preferences_not_ready');
  const iso = now.toISOString();
  db.prepare(`
    INSERT INTO free_discovery_samples (user_id, status, attempt_count, created_at, updated_at)
    VALUES (?, 'QUEUED', 0, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, iso, iso);
  return getFreeDiscoverySample(userId);
}

export function claimFreeDiscoverySampleJob(now = new Date(), onlyUserId?: string): { userId: string; attemptCount: number } | null {
  if (!tasteOnboardingEnabled()) return null;
  return db.transaction(() => {
    const iso = now.toISOString();
    db.prepare(`UPDATE free_discovery_samples SET status = 'FAILED', lease_expires_at = NULL, next_retry_at = NULL, failure_code = 'RETRY_LIMIT', failure_summary = 'Preparation did not complete within the bounded retry limit', updated_at = @now WHERE (@userId IS NULL OR user_id = @userId) AND attempt_count >= @maxAttempts AND ((status = 'PREPARING' AND lease_expires_at <= @now) OR (status = 'RETRYABLE_FAILURE' AND next_retry_at <= @now))`).run({ now: iso, userId: onlyUserId ?? null, maxAttempts: MAX_ATTEMPTS });
    const row = db.prepare(`
      SELECT user_id, attempt_count FROM free_discovery_samples
      WHERE (@userId IS NULL OR user_id = @userId) AND (
        status = 'QUEUED'
        OR (status = 'RETRYABLE_FAILURE' AND next_retry_at <= @now)
        OR (status = 'PREPARING' AND lease_expires_at <= @now)
      ) AND attempt_count < @maxAttempts
      ORDER BY created_at, user_id LIMIT 1
    `).get({ userId: onlyUserId ?? null, maxAttempts: MAX_ATTEMPTS, now: iso }) as { user_id: string; attempt_count: number } | undefined;
    if (!row) return null;
    const attemptCount = row.attempt_count + 1;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
    const claimed = db.prepare(`UPDATE free_discovery_samples SET status = 'PREPARING', attempt_count = ?, lease_expires_at = ?, next_retry_at = NULL, updated_at = ? WHERE user_id = ? AND attempt_count = ?`).run(attemptCount, leaseExpiresAt, iso, row.user_id, row.attempt_count);
    return claimed.changes === 1 ? { userId: row.user_id, attemptCount } : null;
  })();
}

function candidateFromRecord(record: StoredCardCatalogRecord): DiscoveryCandidate {
  const setName = record.translatedSetName ?? record.setName ?? 'Unknown set';
  const cardNumber = record.cardNumber ?? (record.isUnnumbered ? 'Unnumbered' : 'Unknown');
  const language = record.language === 'ja' ? 'JAPANESE' : 'ENGLISH';
  return {
    suggestion: {
      name: [record.name, setName, record.cardNumber].filter(Boolean).join(' '),
      why: 'Selected from verified catalog traits that match your collecting profile.',
      lane: 'Collector profile',
      laneWhy: 'Matches explicit collecting preferences.',
      nearby: [],
      referenceImageUrl: record.imageUrl,
      referenceSourceName: record.source,
      referenceSourceCardId: record.sourceCardId,
      canonicalReference: {
        provider: record.source,
        sourceCardId: record.sourceCardId,
        canonicalCardId: `${record.source}:${record.sourceCardId}`,
        canonicalName: record.name,
        setId: record.setId,
        setName,
        cardNumber,
        language,
        imageUrl: record.imageUrl!,
        imageSourceKind: 'CARD_REFERENCE'
      }
    },
    image: { name: record.name, url: record.imageUrl!, sourceName: record.source, sourceCardId: record.sourceCardId, sourceKind: 'CARD_REFERENCE' },
    catalogFacts: {
      source: record.source,
      sourceCardId: record.sourceCardId,
      canonicalName: record.name,
      setId: record.setId,
      setName: record.setName,
      translatedSetName: record.translatedSetName,
      series: record.series,
      cardNumber: record.cardNumber,
      printedTotal: record.printedTotal,
      language: record.language,
      verificationStatus: record.verificationStatus,
      rarity: record.rarity,
      illustrator: record.illustrator,
      isPromo: record.isPromo,
      promoContext: record.promoContext,
      releaseType: record.releaseType,
      releaseEvent: record.releaseEvent,
      releaseYear: record.releaseYear,
      imageUrl: record.imageUrl,
      imageSourceKind: 'CARD_REFERENCE'
    }
  };
}

export function rankFreeDiscoverySampleRecords(
  interestProfile: CollectorInterestProfile,
  selected: Set<string>,
  records: StoredCardCatalogRecord[],
  stableSeed: string
): FreeDiscoverySampleItem[] {
  const profile = collectorInterestProfileToTasteProfile(interestProfile);
  const reserve = records
    .filter((record) => !selected.has(`${record.source}:${record.sourceCardId}`))
    .map(candidateFromRecord);
  const ranked = analyzeCollectorProfileReserve(reserve, profile, {}, stableSeed)
    .filter((candidate) => candidate.weeklyDiscovery?.discoveryRole !== 'CONTROLLED_EXPLORATION')
    .filter((candidate) => (candidate.weeklyDiscovery?.rankExplanation.scoreComponents.personalRelevance.subjectAffinity ?? 0) > 0 || (candidate.weeklyDiscovery?.rankExplanation.strongestSignals.length ?? 0) >= 2)
    .slice(0, 3);
  return ranked.map((candidate) => {
    const reference = candidate.suggestion.canonicalReference!;
    const record = records.find((item) => item.source === reference.provider && item.sourceCardId === reference.sourceCardId)!;
    const exactPrintingName = catalogDisplayValue(record);
    const strongest = candidate.weeklyDiscovery?.rankExplanation.strongestSignals ?? [];
    return {
      name: exactPrintingName,
      imageUrl: reference.imageUrl,
      setName: reference.setName,
      cardNumber: reference.cardNumber,
      language: reference.language === 'JAPANESE' ? 'Japanese' : 'English',
      reason: strongest.length ? `A profile match through ${strongest.slice(0, 2).join(' and ')}.` : 'A verified card aligned with your collecting profile.',
      roleLabel: candidate.weeklyDiscovery?.discoveryRole === 'CORE_MATCH' ? 'Core match' : 'Adjacent discovery',
      cardIdentity: {
        value: exactPrintingName,
        matchKey: exactPrintingName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        sourceName: reference.provider,
        sourceCardId: reference.sourceCardId
      }
    };
  });
}

export function generateFreeDiscoverySample(userId: string): FreeDiscoverySampleItem[] {
  const records = requireVerifiedCardCatalogRecordsWithImages(500);
  const preferences = getCollectorPreferences(userId);
  if (!preferences.readiness.ready) throw new Error('preferences_not_ready');
  const selected = new Set(preferences.artwork.map((item) => `${item.source}:${item.sourceCardId}`));
  return rankFreeDiscoverySampleRecords(
    getCollectorInterestProfile(userId),
    selected,
    records,
    `free-sample:${userId}`
  );
}

export function completeFreeDiscoverySampleJob(userId: string, attemptCount: number, items: FreeDiscoverySampleItem[], now = new Date()): void {
  const iso = now.toISOString();
  db.prepare(`UPDATE free_discovery_samples SET status = ?, result_json = ?, lease_expires_at = NULL, next_retry_at = NULL, failure_code = NULL, failure_summary = NULL, completed_at = ?, updated_at = ? WHERE user_id = ? AND status = 'PREPARING' AND attempt_count = ?`)
    .run(items.length < 3 ? 'UNDERSUPPLIED' : 'COMPLETE', JSON.stringify(items), iso, iso, userId, attemptCount);
}

export function failFreeDiscoverySampleJob(userId: string, attemptCount: number, error: unknown, now = new Date()): void {
  const current = getFreeDiscoverySample(userId);
  const terminal = current.attemptCount >= MAX_ATTEMPTS;
  const iso = now.toISOString();
  const nextRetryAt = terminal ? null : new Date(now.getTime() + Math.min(60_000 * 2 ** current.attemptCount, 15 * 60_000)).toISOString();
  const summary = error instanceof Error ? error.message.slice(0, 300) : 'Unknown generation failure';
  const code = summary.startsWith('card_catalog_unavailable:') ? 'CATALOG_UNAVAILABLE' : 'GENERATION_FAILED';
  db.prepare(`UPDATE free_discovery_samples SET status = ?, lease_expires_at = NULL, next_retry_at = ?, failure_code = ?, failure_summary = ?, updated_at = ? WHERE user_id = ? AND status = 'PREPARING' AND attempt_count = ?`)
    .run(terminal ? 'FAILED' : 'RETRYABLE_FAILURE', nextRetryAt, code, summary, iso, userId, attemptCount);
}

export function processOneFreeDiscoverySampleJob(now = new Date()): boolean {
  const job = claimFreeDiscoverySampleJob(now);
  if (!job) return false;
  try {
    completeFreeDiscoverySampleJob(job.userId, job.attemptCount, generateFreeDiscoverySample(job.userId), now);
  } catch (error) {
    failFreeDiscoverySampleJob(job.userId, job.attemptCount, error, now);
  }
  return true;
}

export function processFreeDiscoverySampleJobForUser(userId: string, now = new Date()): boolean {
  const job = claimFreeDiscoverySampleJob(now, userId);
  if (!job) return false;
  try {
    completeFreeDiscoverySampleJob(job.userId, job.attemptCount, generateFreeDiscoverySample(job.userId), now);
  } catch (error) {
    failFreeDiscoverySampleJob(job.userId, job.attemptCount, error, now);
  }
  return true;
}
