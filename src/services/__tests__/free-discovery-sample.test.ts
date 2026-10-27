import { afterEach, describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import { db } from '../db.js';
import { collectorPreferenceReadiness } from '../collector-preferences.js';
import { claimFreeDiscoverySampleJob, getFreeDiscoverySample, rankFreeDiscoverySampleRecords } from '../free-discovery-sample.js';
import type { CollectorInterestProfile } from '../collector-profile.js';
import type { StoredCardCatalogRecord } from '../card-catalog/types.js';

const users = new Set<string>();

function userId(): string {
  const user = createUser({ displayName: 'Sample collector' });
  users.add(user.id);
  return user.id;
}

afterEach(() => {
  for (const id of users) {
    db.prepare('DELETE FROM free_discovery_samples WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_collector_artwork_preferences WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_collector_subject_preferences WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  users.clear();
});

describe('Free Display Case sample', () => {
  it('supports both readiness paths without counting duplicate selections', () => {
    expect(collectorPreferenceReadiness(0, new Set(['a', 'b', 'c']).size)).toMatchObject({ ready: true, artworkCount: 3 });
    expect(collectorPreferenceReadiness(1, new Set(['a', 'b']).size)).toMatchObject({ ready: true, artworkCount: 2 });
    expect(collectorPreferenceReadiness(1, new Set(['a', 'a']).size)).toMatchObject({ ready: false, artworkCount: 1 });
  });

  it('claims one account job once and recovers an expired lease', () => {
    const id = userId();
    const created = '2026-10-27T10:00:00.000Z';
    db.prepare(`INSERT INTO free_discovery_samples (user_id, status, attempt_count, created_at, updated_at) VALUES (?, 'QUEUED', 0, ?, ?)`).run(id, created, created);
    expect(claimFreeDiscoverySampleJob(new Date(created))).toEqual({ userId: id, attemptCount: 1 });
    expect(claimFreeDiscoverySampleJob(new Date(created))).toBeNull();
    expect(getFreeDiscoverySample(id)).toMatchObject({ status: 'PREPARING', attemptCount: 1 });
    expect(claimFreeDiscoverySampleJob(new Date('2026-10-27T10:06:00.000Z'))).toEqual({ userId: id, attemptCount: 2 });
  });

  it('turns different explicit subjects into different qualified first picks', () => {
    const profile = (subject: string): CollectorInterestProfile => ({
      version: 1,
      sourceSummary: { activeChases: 0, completedChases: 0, legacyBoughtOrSeen: 0, explicitPreferences: 2, distinctCards: 2 },
      confidence: { tier: 'EMERGING', score: 0.35, reasons: ['explicit preferences'] },
      traits: {
        subjects: [{ key: subject.toLowerCase(), label: subject, score: 1.8, evidenceCount: 1, activeEvidenceCount: 0, completedEvidenceCount: 0, legacyEvidenceCount: 0, confidence: 'HIGH', evidenceIds: [`subject:${subject}`] }],
        languages: [{ key: 'japanese', label: 'JAPANESE', score: 1.8, evidenceCount: 1, activeEvidenceCount: 0, completedEvidenceCount: 0, legacyEvidenceCount: 0, confidence: 'HIGH', evidenceIds: ['language:japanese'] }],
        sets: [], eras: [], formats: [], artists: [], rarities: [], promoTypes: [], releaseTypes: [], releaseEvents: [], gradingPreferences: [], conditionPreferences: []
      },
      evidence: []
    });
    const record = (name: string, id: string): StoredCardCatalogRecord => ({
      id: Number(id), source: 'CURATED', sourceCardId: id, language: 'ja', name, normalizedName: name.toLowerCase(),
      setName: 'Japanese Promo', normalizedSetName: 'japanese promo', cardNumber: id, normalizedCardNumber: id,
      imageUrl: `https://example.com/${id}.png`, isPromo: true, verificationStatus: 'VERIFIED', importedAt: '2026-10-27T00:00:00.000Z'
    });
    const records = [record('Mew', '1'), record('Pikachu', '2')];
    expect(rankFreeDiscoverySampleRecords(profile('Mew'), new Set(), records, 'mew')[0]?.name).toBe('Mew');
    expect(rankFreeDiscoverySampleRecords(profile('Pikachu'), new Set(), records, 'pikachu')[0]?.name).toBe('Pikachu');
  });
});
