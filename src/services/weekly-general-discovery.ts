import { createHash } from 'node:crypto';
import { db } from './db.js';
import { requireVerifiedCardCatalogRecordsWithImages } from './card-catalog-db.js';
import { catalogDisplayValue, normalizeCatalogText } from './card-catalog/normalize.js';
import type { StoredCardCatalogRecord } from './card-catalog/types.js';
import { listChases, listCompletedChases } from './chase-store.js';
import { isKnownNonFrontCardImageUrl, isMarketplaceLikeImageUrl } from './discovery-canonical-resolution.js';

export type WeeklyGeneralDiscoveryItem = {
  name: string;
  canonicalName: string;
  imageUrl: string;
  setName?: string;
  cardNumber?: string;
  language: 'English' | 'Japanese';
  sourceName: string;
  sourceCardId: string;
  identityKey: string;
  subjectKey: string;
};

export type WeeklyGeneralDiscovery = {
  periodKey: string;
  status: 'WEEKLY' | 'INSUFFICIENT' | 'CATALOG_UNAVAILABLE';
  items: WeeklyGeneralDiscoveryItem[];
  catalogRecordCount: number;
};

type SnapshotRow = { period_key: string; status: WeeklyGeneralDiscovery['status']; reserve_json: string; catalog_record_count: number };
const unavailableLogged = new Set<string>();
const RESERVE_LIMIT = 60;
export const WEEKLY_GENERAL_DISCOVERY_RETRY_MS = 5 * 60 * 1000;

type CatalogLoader = () => StoredCardCatalogRecord[];

// UTC is deliberate: every account and process crosses the ISO-week boundary together.
export function weeklyGeneralDiscoveryPeriodKey(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function exactIdentityKey(record: StoredCardCatalogRecord): string {
  return [record.name, record.translatedSetName ?? record.setName, record.cardNumber, record.printedTotal, record.language]
    .map((value) => normalizeCatalogText(value ?? ''))
    .join('|');
}

function usefulRecord(record: StoredCardCatalogRecord): boolean {
  return record.verificationStatus === 'VERIFIED'
    && !!record.imageUrl
    && /^https:\/\//i.test(record.imageUrl)
    && !isMarketplaceLikeImageUrl(record.imageUrl)
    && !isKnownNonFrontCardImageUrl(record.imageUrl)
    && !!(record.translatedSetName ?? record.setName)
    && !!(record.cardNumber || record.isUnnumbered);
}

function itemFromRecord(record: StoredCardCatalogRecord): WeeklyGeneralDiscoveryItem {
  return {
    name: catalogDisplayValue(record),
    canonicalName: record.name,
    imageUrl: record.imageUrl!,
    setName: record.translatedSetName ?? record.setName,
    cardNumber: record.isUnnumbered ? 'Unnumbered' : record.cardNumber,
    language: record.language === 'ja' ? 'Japanese' : 'English',
    sourceName: record.source,
    sourceCardId: record.sourceCardId,
    identityKey: exactIdentityKey(record),
    subjectKey: normalizeCatalogText(record.name)
  };
}

function seededScore(periodKey: string, identityKey: string): string {
  return createHash('sha256').update(`${periodKey}:${identityKey}`).digest('hex');
}

function buildReserve(periodKey: string, records: StoredCardCatalogRecord[], previous: Set<string>): WeeklyGeneralDiscoveryItem[] {
  const unique = new Map<string, StoredCardCatalogRecord>();
  for (const record of records.filter(usefulRecord)) {
    const key = exactIdentityKey(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  const ordered = [...unique.entries()]
    .sort(([leftKey], [rightKey]) => seededScore(periodKey, leftKey).localeCompare(seededScore(periodKey, rightKey)))
    .map(([, record]) => itemFromRecord(record));
  const fresh = ordered.filter((item) => !previous.has(item.identityKey));
  const repeats = ordered.filter((item) => previous.has(item.identityKey));
  return [...fresh, ...repeats].slice(0, RESERVE_LIMIT);
}

function parseSnapshot(row: SnapshotRow): WeeklyGeneralDiscoveryItem[] {
  try { return JSON.parse(row.reserve_json) as WeeklyGeneralDiscoveryItem[]; } catch { return []; }
}

function previousSnapshot(periodKey: string): Set<string> {
  const row = db.prepare('SELECT reserve_json FROM weekly_general_discovery_snapshots WHERE period_key < ? ORDER BY period_key DESC LIMIT 1').get(periodKey) as { reserve_json: string } | undefined;
  if (!row) return new Set();
  try { return new Set((JSON.parse(row.reserve_json) as WeeklyGeneralDiscoveryItem[]).slice(0, 3).map((item) => item.identityKey)); } catch { return new Set(); }
}

function snapshotResult(periodKey: string, row: SnapshotRow): WeeklyGeneralDiscovery {
  return { periodKey, status: row.status, items: parseSnapshot(row), catalogRecordCount: row.catalog_record_count };
}

function loadSnapshotCandidate(periodKey: string, loadCatalog: CatalogLoader): Omit<WeeklyGeneralDiscovery, 'periodKey'> {
  let records: StoredCardCatalogRecord[] = [];
  let status: WeeklyGeneralDiscovery['status'] = 'WEEKLY';
  try {
    records = loadCatalog();
  } catch (error) {
    status = 'CATALOG_UNAVAILABLE';
    if (!unavailableLogged.has(periodKey)) {
      unavailableLogged.add(periodKey);
      console.warn(`[weekly-general-discovery] catalog unavailable period=${periodKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const items = status === 'CATALOG_UNAVAILABLE' ? [] : buildReserve(periodKey, records, previousSnapshot(periodKey));
  if (status === 'WEEKLY' && items.length < 3) status = 'INSUFFICIENT';
  return { status, items, catalogRecordCount: records.length };
}

export function getOrCreateWeeklyGeneralDiscoverySnapshot(
  date = new Date(),
  loadCatalog: CatalogLoader = () => requireVerifiedCardCatalogRecordsWithImages(500)
): WeeklyGeneralDiscovery {
  const periodKey = weeklyGeneralDiscoveryPeriodKey(date);
  const existing = db.prepare('SELECT * FROM weekly_general_discovery_snapshots WHERE period_key = ?').get(periodKey) as (SnapshotRow & { created_at: string }) | undefined;
  if (existing && existing.status !== 'CATALOG_UNAVAILABLE') return snapshotResult(periodKey, existing);

  const attemptAt = date.toISOString();
  if (existing) {
    const lastAttemptAt = Date.parse(existing.created_at);
    if (Number.isFinite(lastAttemptAt) && date.getTime() - lastAttemptAt < WEEKLY_GENERAL_DISCOVERY_RETRY_MS) {
      return snapshotResult(periodKey, existing);
    }
    const claimed = db.prepare(`
      UPDATE weekly_general_discovery_snapshots
      SET created_at = ?
      WHERE period_key = ? AND status = 'CATALOG_UNAVAILABLE' AND created_at = ?
    `).run(attemptAt, periodKey, existing.created_at);
    if (claimed.changes === 0) {
      const current = db.prepare('SELECT * FROM weekly_general_discovery_snapshots WHERE period_key = ?').get(periodKey) as SnapshotRow;
      return snapshotResult(periodKey, current);
    }

    const recovered = loadSnapshotCandidate(periodKey, loadCatalog);
    if (recovered.status !== 'CATALOG_UNAVAILABLE') {
      db.prepare(`
        UPDATE weekly_general_discovery_snapshots
        SET status = ?, reserve_json = ?, catalog_record_count = ?
        WHERE period_key = ? AND status = 'CATALOG_UNAVAILABLE' AND created_at = ?
      `).run(recovered.status, JSON.stringify(recovered.items), recovered.catalogRecordCount, periodKey, attemptAt);
    }
    const saved = db.prepare('SELECT * FROM weekly_general_discovery_snapshots WHERE period_key = ?').get(periodKey) as SnapshotRow;
    return snapshotResult(periodKey, saved);
  }

  const candidate = loadSnapshotCandidate(periodKey, loadCatalog);
  db.prepare('INSERT OR IGNORE INTO weekly_general_discovery_snapshots (period_key, status, reserve_json, catalog_record_count, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(periodKey, candidate.status, JSON.stringify(candidate.items), candidate.catalogRecordCount, attemptAt);
  const saved = db.prepare('SELECT * FROM weekly_general_discovery_snapshots WHERE period_key = ?').get(periodKey) as SnapshotRow;
  return snapshotResult(periodKey, saved);
}

function ownedIdentityKeys(userId: string): Set<string> {
  const keys = new Set<string>();
  for (const chase of [...listChases(userId), ...listCompletedChases(userId)]) {
    if (chase.cardImageSourceKind === 'CARD_REFERENCE' && chase.cardImageSourceName && chase.cardImageSourceCardId) {
      keys.add(`source:${chase.cardImageSourceName}:${chase.cardImageSourceCardId}`);
    }
    if (chase.cardImageIdentity) keys.add(`name:${normalizeCatalogText(chase.cardImageIdentity)}`);
    keys.add(`name:${normalizeCatalogText(chase.cardName)}`);
  }
  return keys;
}

export function weeklyGeneralDiscoveryForUser(userId: string, date = new Date()): WeeklyGeneralDiscovery {
  const snapshot = getOrCreateWeeklyGeneralDiscoverySnapshot(date);
  const excluded = ownedIdentityKeys(userId);
  const eligible = snapshot.items.filter((item) =>
    !excluded.has(`source:${item.sourceName}:${item.sourceCardId}`)
    && !excluded.has(`name:${normalizeCatalogText(item.name)}`)
  );
  const selected: WeeklyGeneralDiscoveryItem[] = [];
  const subjects = new Set<string>();
  for (const item of eligible) {
    if (subjects.has(item.subjectKey)) continue;
    selected.push(item);
    subjects.add(item.subjectKey);
    if (selected.length === 3) break;
  }
  for (const item of eligible) {
    if (selected.length === 3) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return { ...snapshot, items: selected };
}
