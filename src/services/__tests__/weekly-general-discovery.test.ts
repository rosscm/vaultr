import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import { replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import { addChase, removeAllChases, resolveChaseRemoval } from '../chase-store.js';
import { db } from '../db.js';
import { getOrCreateWeeklyGeneralDiscoverySnapshot, weeklyGeneralDiscoveryForUser, weeklyGeneralDiscoveryPeriodKey } from '../weekly-general-discovery.js';

const originalCatalogPath = process.env.CARD_CATALOG_PATH;
const tempDirs = new Set<string>();
const users = new Set<string>();

function catalogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultr-weekly-general-'));
  tempDirs.add(dir);
  return path.join(dir, 'catalog.db');
}

function records(count = 12) {
  const subjects = ['Mew', 'Pikachu', 'Gardevoir', 'Umbreon', 'Squirtle', 'Dragonite', 'Gengar', 'Eevee', 'Raichu', 'Lapras', 'Celebi', 'Jirachi'];
  return subjects.slice(0, count).map((name, index) => ({
    source: 'CURATED' as const,
    sourceCardId: `weekly-${index + 1}`,
    language: index % 2 ? 'ja' as const : 'en' as const,
    name,
    normalizedName: name.toLowerCase(),
    setName: `Weekly Set ${index + 1}`,
    normalizedSetName: `weekly set ${index + 1}`,
    cardNumber: `${index + 1}`,
    normalizedCardNumber: `${index + 1}`,
    imageUrl: `https://cards.example/weekly-${index + 1}.png`,
    isPromo: false,
    verificationStatus: 'VERIFIED' as const,
    importedAt: '2026-10-27T00:00:00.000Z'
  }));
}

function user(label: string): string {
  const id = createUser({ displayName: label }).id;
  users.add(id);
  return id;
}

afterEach(() => {
  db.prepare('DELETE FROM weekly_general_discovery_snapshots').run();
  for (const id of users) {
    removeAllChases(id);
    db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_collector_subject_preferences WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  users.clear();
  if (originalCatalogPath === undefined) delete process.env.CARD_CATALOG_PATH;
  else process.env.CARD_CATALOG_PATH = originalCatalogPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe('weekly general discovery', () => {
  it('uses UTC ISO weeks across year boundaries', () => {
    expect(weeklyGeneralDiscoveryPeriodKey(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-W53');
    expect(weeklyGeneralDiscoveryPeriodKey(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-W53');
    expect(weeklyGeneralDiscoveryPeriodKey(new Date('2027-01-04T00:00:00.000Z'))).toBe('2027-W01');
  });

  it('persists one shared reserve for the week despite catalog changes and rotates next week', () => {
    const dbPath = catalogPath();
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('CURATED', records(), dbPath);
    const first = getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-10-27T12:00:00.000Z'));
    db.prepare('DELETE FROM weekly_general_discovery_snapshots').run();
    const regenerated = getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-10-27T12:00:00.000Z'));
    replaceCardCatalogSourceRecords('CURATED', [...records(), ...records(1).map((record) => ({ ...record, sourceCardId: 'new-midweek', name: 'Mewtwo', normalizedName: 'mewtwo' }))], dbPath);
    const repeated = getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-10-29T12:00:00.000Z'));
    const next = getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-11-03T12:00:00.000Z'));

    expect(regenerated.items).toEqual(first.items);
    expect(first.items).toEqual(repeated.items);
    expect(first.items.slice(0, 3).map((item) => item.identityKey)).not.toEqual(next.items.slice(0, 3).map((item) => item.identityKey));
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_general_discovery_snapshots').get()).toEqual({ count: 2 });
  });

  it('shares ordering, ignores favourites, deduplicates printings, and advances past owned cards', () => {
    const dbPath = catalogPath();
    process.env.CARD_CATALOG_PATH = dbPath;
    const sourceRecords = records();
    replaceCardCatalogSourceRecords('CURATED', sourceRecords, dbPath);
    replaceCardCatalogSourceRecords('POKEMONTCG', [{ ...sourceRecords[0]!, source: 'POKEMONTCG', sourceCardId: 'duplicate-printing' }], dbPath);
    const firstUser = user('First weekly collector');
    const secondUser = user('Second weekly collector');
    db.prepare(`INSERT INTO user_collector_subject_preferences (user_id, subject_key, subject_label, created_at, updated_at) VALUES (?, 'mew', 'Mew', ?, ?)`).run(firstUser, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
    const date = new Date('2026-10-27T12:00:00.000Z');
    const first = weeklyGeneralDiscoveryForUser(firstUser, date);
    const second = weeklyGeneralDiscoveryForUser(secondUser, date);
    expect(first.items).toEqual(second.items);
    expect(new Set(getOrCreateWeeklyGeneralDiscoverySnapshot(date).items.map((item) => item.identityKey)).size).toBe(getOrCreateWeeklyGeneralDiscoverySnapshot(date).items.length);
    expect(new Set(first.items.map((item) => item.subjectKey)).size).toBe(first.items.length);

    const owned = first.items[0]!;
    const chase = addChase({
      userId: secondUser,
      cardName: owned.name,
      cardImageUrl: owned.imageUrl,
      cardImageIdentity: owned.name,
      cardImageSourceName: owned.sourceName,
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: owned.sourceCardId,
      priority: 'NORMAL'
    });
    const advanced = weeklyGeneralDiscoveryForUser(secondUser, date);
    expect(advanced.items).toHaveLength(3);
    expect(advanced.items.map((item) => item.sourceCardId)).not.toContain(owned.sourceCardId);
    resolveChaseRemoval(secondUser, chase.id, 'COMPLETED');
    const afterPickup = weeklyGeneralDiscoveryForUser(secondUser, date);
    expect(afterPickup.items).toHaveLength(3);
    expect(afterPickup.items.map((item) => item.sourceCardId)).not.toContain(owned.sourceCardId);
  });

  it('reports missing and insufficient catalog states without inventing cards', () => {
    const missing = catalogPath();
    process.env.CARD_CATALOG_PATH = missing;
    expect(getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-10-27T12:00:00.000Z'))).toMatchObject({ status: 'CATALOG_UNAVAILABLE', items: [] });
    db.prepare('DELETE FROM weekly_general_discovery_snapshots').run();
    replaceCardCatalogSourceRecords('CURATED', records(2), missing);
    expect(getOrCreateWeeklyGeneralDiscoverySnapshot(new Date('2026-10-27T12:00:00.000Z'))).toMatchObject({ status: 'INSUFFICIENT' });
  });
});
