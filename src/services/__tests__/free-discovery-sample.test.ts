import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import { db } from '../db.js';
import { collectorPreferenceReadiness, saveCollectorPreferences } from '../collector-preferences.js';
import { claimFreeDiscoverySampleJob, completeFreeDiscoverySampleJob, getFreeDiscoverySample, processFreeDiscoverySampleJobForUser, rankFreeDiscoverySampleRecords, requestFreeDiscoverySample } from '../free-discovery-sample.js';
import { replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import type { CollectorInterestProfile } from '../collector-profile.js';
import type { StoredCardCatalogRecord } from '../card-catalog/types.js';

const users = new Set<string>();
const originalCatalogPath = process.env.CARD_CATALOG_PATH;
const tempDirs = new Set<string>();

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
  if (originalCatalogPath === undefined) delete process.env.CARD_CATALOG_PATH;
  else process.env.CARD_CATALOG_PATH = originalCatalogPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

function missingCatalogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultr-free-sample-'));
  tempDirs.add(dir);
  return path.join(dir, 'missing.db');
}

function tempCatalogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultr-free-sample-catalog-'));
  tempDirs.add(dir);
  return path.join(dir, 'catalog.db');
}

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

  it('keeps account-specific expired-lease cleanup scoped to that account', () => {
    const chosen = userId();
    const other = userId();
    const created = '2026-10-27T10:00:00.000Z';
    const expired = '2026-10-27T10:01:00.000Z';
    const insert = db.prepare(`INSERT INTO free_discovery_samples (user_id, status, attempt_count, lease_expires_at, created_at, updated_at) VALUES (?, 'PREPARING', 3, ?, ?, ?)`);
    insert.run(chosen, expired, created, created);
    insert.run(other, expired, created, created);

    expect(claimFreeDiscoverySampleJob(new Date('2026-10-27T10:02:00.000Z'), chosen)).toBeNull();
    expect(getFreeDiscoverySample(chosen)).toMatchObject({ status: 'FAILED', failureCode: 'RETRY_LIMIT' });
    expect(getFreeDiscoverySample(other)).toMatchObject({ status: 'PREPARING', attemptCount: 3 });
  });

  it('retries missing catalog infrastructure instead of consuming the sample as empty', () => {
    const id = userId();
    const created = '2026-10-27T10:00:00.000Z';
    process.env.CARD_CATALOG_PATH = missingCatalogPath();
    db.prepare(`INSERT INTO user_collector_subject_preferences (user_id, subject_key, subject_label, created_at, updated_at) VALUES (?, 'mew', 'Mew', ?, ?)`).run(id, created, created);
    db.prepare(`INSERT INTO user_collector_artwork_preferences (user_id, source, source_card_id, created_at, updated_at) VALUES (?, 'CURATED', ?, ?, ?), (?, 'CURATED', ?, ?, ?)`).run(id, 'missing-1', created, created, id, 'missing-2', created, created);
    db.prepare(`INSERT INTO free_discovery_samples (user_id, status, attempt_count, created_at, updated_at) VALUES (?, 'QUEUED', 0, ?, ?)`).run(id, created, created);

    expect(processFreeDiscoverySampleJobForUser(id, new Date(created))).toBe(true);
    expect(getFreeDiscoverySample(id)).toMatchObject({ status: 'RETRYABLE_FAILURE', attemptCount: 1, failureCode: 'CATALOG_UNAVAILABLE', items: [] });
  });

  it('persists valid zero, one, and two-card results as terminal undersupply', () => {
    for (const count of [0, 1, 2]) {
      const id = userId();
      const created = `2026-10-27T10:0${count}:00.000Z`;
      db.prepare(`INSERT INTO free_discovery_samples (user_id, status, attempt_count, created_at, updated_at) VALUES (?, 'PREPARING', 1, ?, ?)`).run(id, created, created);
      const items = Array.from({ length: count }, (_, index) => ({
        name: `Mew Test Set ${index + 1}`,
        imageUrl: `https://example.com/${index + 1}.png`,
        language: 'English' as const,
        reason: 'Qualified match.',
        roleLabel: 'Core match',
        cardIdentity: { value: `Mew Test Set ${index + 1}`, matchKey: `mew test set ${index + 1}`, sourceName: 'CURATED', sourceCardId: `${index + 1}` }
      }));
      completeFreeDiscoverySampleJob(id, 1, items, new Date(created));
      expect(getFreeDiscoverySample(id)).toMatchObject({ status: 'UNDERSUPPLIED', items });
    }
  });

  it('completes a readable catalog with no remaining qualified supply as zero-result undersupply', () => {
    const id = userId();
    const dbPath = tempCatalogPath();
    process.env.CARD_CATALOG_PATH = dbPath;
    const records = [1, 2, 3].map((index) => ({
      source: 'CURATED' as const,
      sourceCardId: `selected-${index}`,
      language: 'en' as const,
      name: `Pikachu ${index}`,
      normalizedName: `pikachu ${index}`,
      setName: 'Selected Art',
      normalizedSetName: 'selected art',
      cardNumber: `${index}`,
      normalizedCardNumber: `${index}`,
      imageUrl: `https://example.com/selected-${index}.png`,
      isPromo: false,
      verificationStatus: 'VERIFIED' as const,
      importedAt: '2026-10-27T00:00:00.000Z'
    }));
    replaceCardCatalogSourceRecords('CURATED', records, dbPath);
    saveCollectorPreferences(id, {
      subjects: [],
      artwork: records.map((record) => ({ source: record.source, sourceCardId: record.sourceCardId }))
    });
    requestFreeDiscoverySample(id, new Date('2026-10-27T10:00:00.000Z'));

    expect(processFreeDiscoverySampleJobForUser(id, new Date('2026-10-27T10:01:00.000Z'))).toBe(true);
    expect(getFreeDiscoverySample(id)).toMatchObject({ status: 'UNDERSUPPLIED', items: [] });
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
    expect(rankFreeDiscoverySampleRecords(profile('Mew'), new Set(), records, 'mew')[0]?.name).toBe('Mew Japanese Promo 1');
    expect(rankFreeDiscoverySampleRecords(profile('Pikachu'), new Set(), records, 'pikachu')[0]?.name).toBe('Pikachu Japanese Promo 2');
  });
});
