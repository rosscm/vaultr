import { db } from './db.js';
import { getCardCatalogRecordBySourceCardId, listVerifiedCardCatalogRecordsWithImages } from './card-catalog-db.js';
import { catalogSubjectsEquivalent } from './card-catalog/search.js';
import { KNOWN_COLLECTOR_SUBJECTS } from './collector-profile.js';
import type { CardCatalogSource, StoredCardCatalogRecord } from './card-catalog/types.js';

export type CollectorArtworkPreference = {
  source: CardCatalogSource;
  sourceCardId: string;
  name: string;
  setName?: string;
  cardNumber?: string;
  language: 'ENGLISH' | 'JAPANESE';
  imageUrl: string;
};

export type CollectorPreferences = {
  subjects: string[];
  artwork: CollectorArtworkPreference[];
  readiness: { ready: boolean; artworkCount: number; subjectCount: number; neededArtworkCount: number };
};

const subjectRows = db.prepare('SELECT subject_label FROM user_collector_subject_preferences WHERE user_id = ? ORDER BY subject_label');
const artworkRows = db.prepare('SELECT source, source_card_id FROM user_collector_artwork_preferences WHERE user_id = ? ORDER BY created_at, source, source_card_id');

function supportedSubject(value: string): string | undefined {
  return KNOWN_COLLECTOR_SUBJECTS.find((subject) => catalogSubjectsEquivalent(subject, value));
}

function publicArtwork(record: StoredCardCatalogRecord): CollectorArtworkPreference | null {
  if (record.verificationStatus !== 'VERIFIED' || !record.imageUrl) return null;
  return {
    source: record.source,
    sourceCardId: record.sourceCardId,
    name: record.name,
    setName: record.translatedSetName ?? record.setName,
    cardNumber: record.cardNumber,
    language: record.language === 'ja' ? 'JAPANESE' : 'ENGLISH',
    imageUrl: record.imageUrl
  };
}

export function collectorPreferenceReadiness(subjectCount: number, artworkCount: number): CollectorPreferences['readiness'] {
  const ready = artworkCount >= 3 || (subjectCount >= 1 && artworkCount >= 2);
  return { ready, subjectCount, artworkCount, neededArtworkCount: Math.max(0, (subjectCount > 0 ? 2 : 3) - artworkCount) };
}

export function getCollectorPreferences(userId: string): CollectorPreferences {
  const subjects = (subjectRows.all(userId) as Array<{ subject_label: string }>).map((row) => row.subject_label);
  const artwork = (artworkRows.all(userId) as Array<{ source: CardCatalogSource; source_card_id: string }>)
    .map((row) => getCardCatalogRecordBySourceCardId(row.source, row.source_card_id))
    .map((record) => record ? publicArtwork(record) : null)
    .filter((record): record is CollectorArtworkPreference => !!record);
  return { subjects, artwork, readiness: collectorPreferenceReadiness(subjects.length, artwork.length) };
}

export function collectorPreferenceCatalogRecords(userId: string): StoredCardCatalogRecord[] {
  return (artworkRows.all(userId) as Array<{ source: CardCatalogSource; source_card_id: string }>)
    .map((row) => getCardCatalogRecordBySourceCardId(row.source, row.source_card_id))
    .filter((record): record is StoredCardCatalogRecord => !!record && record.verificationStatus === 'VERIFIED');
}

export function saveCollectorPreferences(userId: string, input: { subjects: unknown; artwork: unknown }): CollectorPreferences {
  if (!Array.isArray(input.subjects) || !Array.isArray(input.artwork)) throw new Error('invalid_preferences');
  const subjects = [...new Set(input.subjects.map((value) => typeof value === 'string' ? supportedSubject(value.trim()) : undefined))];
  if (subjects.some((value) => !value) || subjects.length > 8) throw new Error('unsupported_subject');
  const refs = input.artwork.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('unsupported_artwork');
    const source = (value as any).source;
    const sourceCardId = (value as any).sourceCardId;
    if (!['TCGDEX', 'POKEMONTCG', 'CURATED'].includes(source) || typeof sourceCardId !== 'string') throw new Error('unsupported_artwork');
    const record = getCardCatalogRecordBySourceCardId(source, sourceCardId);
    if (!record || record.verificationStatus !== 'VERIFIED' || !record.imageUrl) throw new Error('unsupported_artwork');
    return { source: source as CardCatalogSource, sourceCardId, record };
  });
  const uniqueRefs = new Map(refs.map((item) => [`${item.source}:${item.sourceCardId}`, item]));
  if (uniqueRefs.size !== refs.length || uniqueRefs.size > 8) throw new Error('duplicate_or_excess_artwork');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM user_collector_subject_preferences WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_collector_artwork_preferences WHERE user_id = ?').run(userId);
    const subjectInsert = db.prepare('INSERT INTO user_collector_subject_preferences (user_id, subject_key, subject_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const subject of subjects as string[]) subjectInsert.run(userId, subject.toLowerCase(), subject, now, now);
    const artworkInsert = db.prepare('INSERT INTO user_collector_artwork_preferences (user_id, source, source_card_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const item of uniqueRefs.values()) artworkInsert.run(userId, item.source, item.sourceCardId, now, now);
  })();
  return getCollectorPreferences(userId);
}

export function collectorPreferenceOptions() {
  const artwork = listVerifiedCardCatalogRecordsWithImages(80)
    .filter((record) => !!record.setName || !!record.releaseEvent)
    .map(publicArtwork)
    .filter((record): record is CollectorArtworkPreference => !!record)
    .filter((record, index, all) => all.findIndex((other) => other.name === record.name && other.setName === record.setName && other.cardNumber === record.cardNumber) === index)
    .slice(0, 18);
  return { subjects: KNOWN_COLLECTOR_SUBJECTS, artwork };
}
