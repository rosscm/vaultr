import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompletedChase } from '../../types.js';
import { getCardCatalogRecordBySourceCardId, replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import type { CardCatalogRecord } from '../card-catalog/types.js';
import { addChase, listChases, listCompletedChases, listUserTasteMemoryChases, removeAllChases, resolveChaseRemoval } from '../chase-store.js';
import { buildCollectorInterestProfile, type CollectorInterestProfile } from '../collector-profile.js';
import { db } from '../db.js';
import { parseCollectorProfileInspectArgs, runCollectorProfileInspectCli } from '../../collector-profile-inspect.js';
import { createUser, linkIdentity } from '../accounts.js';

const originalCatalogPath = process.env.CARD_CATALOG_PATH;
const tempDirs = new Set<string>();

function tempCatalogPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vaultr-profile-${label}-`));
  tempDirs.add(dir);
  return path.join(dir, 'card-catalog.db');
}

function clearUser(userId: string): void {
  removeAllChases(userId);
  db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
}

function record(overrides: Partial<CardCatalogRecord> & { sourceCardId: string; name: string }): CardCatalogRecord {
  return {
    ...overrides,
    source: overrides.source ?? 'POKEMONTCG',
    sourceCardId: overrides.sourceCardId,
    language: overrides.language ?? 'en',
    name: overrides.name,
    normalizedName: overrides.normalizedName ?? overrides.name.toLowerCase(),
    setName: overrides.setName ?? 'Test Set',
    normalizedSetName: overrides.normalizedSetName ?? 'test set',
    series: overrides.series ?? 'Test',
    cardNumber: overrides.cardNumber ?? '1',
    normalizedCardNumber: overrides.normalizedCardNumber ?? '1',
    rarity: overrides.rarity ?? 'Rare Holo',
    imageUrl: overrides.imageUrl ?? `https://images.pokemontcg.io/test/${overrides.sourceCardId}.png`,
    isPromo: overrides.isPromo ?? false,
    importedAt: overrides.importedAt ?? '2026-08-01T00:00:00.000Z'
  };
}

function traitLabels(profile: CollectorInterestProfile, group: keyof CollectorInterestProfile['traits']): string[] {
  return profile.traits[group].map((trait) => trait.label);
}

afterEach(() => {
  if (originalCatalogPath === undefined) delete process.env.CARD_CATALOG_PATH;
  else process.env.CARD_CATALOG_PATH = originalCatalogPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe('collector interest profile', () => {
  it('builds a deterministic active-only profile from conservative traits', () => {
    const activeChases = [
      { id: 'a1', userId: 'u1', cardName: 'Mew-EX Legendary Treasures RC24', priority: 'GRAIL' as const, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', userId: 'u1', cardName: 'Umbreon ex Terastal Festival ex 217/187 Japanese', priority: 'HIGH' as const, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'a3', userId: 'u1', cardName: 'Pichu Expedition Base Set 22/165', condition: 'NM', createdAt: '2026-01-03T00:00:00.000Z' }
    ];

    const first = buildCollectorInterestProfile({ activeChases, completedChases: [] });
    const second = buildCollectorInterestProfile({ activeChases, completedChases: [] });

    expect(first).toEqual(second);
    expect(first.sourceSummary).toMatchObject({ activeChases: 3, completedChases: 0, distinctCards: 3 });
    expect(traitLabels(first, 'subjects')).toEqual(['Mew', 'Umbreon', 'Pichu']);
    expect(traitLabels(first, 'languages')).toContain('JAPANESE');
    expect(traitLabels(first, 'sets')).toEqual(expect.arrayContaining(['Legendary Treasures', 'Terastal Festival ex', 'Expedition Base Set']));
    expect(first.traits.subjects[0]).toMatchObject({ label: 'Mew', activeEvidenceCount: 1, completedEvidenceCount: 0 });
  });

  it('includes completed history without treating it as active monitoring', () => {
    const userId = 'collector-profile-completed';
    clearUser(userId);
    const chase = addChase({ userId, cardName: 'Mew RC24', priority: 'NORMAL' });

    resolveChaseRemoval(userId, chase.id, 'COMPLETED');
    const profile = buildCollectorInterestProfile({ activeChases: [], completedChases: listCompletedChases(userId) });

    expect(listChases(userId)).toEqual([]);
    expect(profile.sourceSummary).toMatchObject({ activeChases: 0, completedChases: 1, distinctCards: 1 });
    expect(profile.traits.subjects[0]).toMatchObject({ label: 'Mew', score: 1.15, activeEvidenceCount: 0, completedEvidenceCount: 1 });
  });

  it('reinforces mixed active and completed traits while preserving distinct card identities', () => {
    const completed: CompletedChase[] = [{
      id: 'c1',
      userId: 'u1',
      cardName: 'Mew XY Black Star Promos XY110',
      priority: 'NORMAL',
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-03T00:00:00.000Z'
    }];
    const activeChases = [
      { id: 'a1', userId: 'u1', cardName: 'Mew XY Black Star Promos XY192', createdAt: '2026-01-04T00:00:00.000Z' },
      { id: 'a2', userId: 'u1', cardName: 'Gardevoir ex Paldean Fates 233', createdAt: '2026-01-05T00:00:00.000Z' }
    ];

    const profile = buildCollectorInterestProfile({ activeChases, completedChases: completed });

    expect(profile.sourceSummary.distinctCards).toBe(3);
    expect(profile.traits.subjects.find((trait) => trait.label === 'Mew')).toMatchObject({ evidenceCount: 2 });
    expect(profile.evidence.map((item) => item.identityKey)).toEqual(expect.arrayContaining([
      'name:mew xy black star promos xy110',
      'name:mew xy black star promos xy192'
    ]));
  });

  it('canonicalizes Japanese catalog subjects through existing subject aliases', () => {
    const dbPath = tempCatalogPath('jp-subjects');
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('TCGDEX', [
      record({ source: 'TCGDEX', sourceCardId: 'SV1S-101', language: 'ja', name: 'サーナイトex', normalizedName: 'サーナイトex', setName: 'Scarlet ex', normalizedSetName: 'scarlet ex', cardNumber: '101', normalizedCardNumber: '101', printedTotal: '078' }),
      record({ source: 'TCGDEX', sourceCardId: 'SV-P-mew', language: 'ja', name: 'ミュウex', normalizedName: 'ミュウex', setName: 'Japanese Promo', normalizedSetName: 'japanese promo', cardNumber: '1', normalizedCardNumber: '1' }),
      record({ source: 'TCGDEX', sourceCardId: 'SV8a-217', language: 'ja', name: 'ブラッキーex', normalizedName: 'ブラッキーex', setName: 'Terastal Festival ex', normalizedSetName: 'terastal festival ex', cardNumber: '217', normalizedCardNumber: '217' })
    ], dbPath);

    const profile = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'サーナイトex Scarlet ex 101/78 Japanese', cardImageSourceKind: 'CARD_REFERENCE', cardImageSourceName: 'TCGDEX', cardImageSourceCardId: 'SV1S-101', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'ミュウex Japanese Promo', cardImageSourceKind: 'CARD_REFERENCE', cardImageSourceName: 'TCGDEX', cardImageSourceCardId: 'SV-P-mew', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'a3', userId: 'u1', cardName: 'ブラッキーex Terastal Festival Japanese 217', cardImageSourceKind: 'CARD_REFERENCE', cardImageSourceName: 'TCGDEX', cardImageSourceCardId: 'SV8a-217', createdAt: '2026-01-03T00:00:00.000Z' }
      ],
      completedChases: []
    });

    expect(traitLabels(profile, 'subjects')).toEqual(['Gardevoir', 'Mew', 'Umbreon']);
    expect(traitLabels(profile, 'subjects')).not.toContain('サーナイトex');
  });

  it('caps repeated exact-card reinforcement without discarding lifecycle evidence', () => {
    const repeated = Array.from({ length: 4 }, (_, index) => ({
      id: `a${index}`,
      userId: 'u1',
      cardName: 'Mew-EX Legendary Treasures RC24',
      cardImageSourceKind: 'CARD_REFERENCE' as const,
      cardImageSourceName: 'POKEMONTCG',
      cardImageSourceCardId: 'bw11-RC24',
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`
    }));

    const profile = buildCollectorInterestProfile({ activeChases: repeated, completedChases: [] });

    expect(profile.evidence).toHaveLength(3);
    expect(profile.traits.subjects[0]).toMatchObject({ label: 'Mew', score: 2.6 });
    expect(profile.confidence.tier).toBe('SEED');
  });

  it('uses structured catalog metadata when an exact trusted reference is available', () => {
    const dbPath = tempCatalogPath('catalog');
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('TCGDEX', [record({
      source: 'TCGDEX',
      sourceCardId: 'SV8a-217',
      language: 'ja',
      name: 'Umbreon ex',
      normalizedName: 'umbreon ex',
      setId: 'SV8a',
      setName: 'テラスタルフェスex',
      translatedSetName: 'Terastal Festival ex',
      normalizedSetName: 'terastal festival ex',
      series: 'Scarlet & Violet',
      cardNumber: '217',
      normalizedCardNumber: '217',
      printedTotal: '187',
      rarity: 'SAR',
      isPromo: false,
      releaseYear: 2024,
      verificationStatus: 'VERIFIED'
    })], dbPath);

    const profile = buildCollectorInterestProfile({
      activeChases: [{
        id: 'a1',
        userId: 'u1',
        cardName: 'Umbreon Japanese 217/187',
        cardImageSourceKind: 'CARD_REFERENCE',
        cardImageSourceName: 'TCGDEX',
        cardImageSourceCardId: 'SV8a-217',
        createdAt: '2026-01-01T00:00:00.000Z'
      }],
      completedChases: []
    });

    expect(getCardCatalogRecordBySourceCardId('TCGDEX', 'SV8a-217', dbPath)?.translatedSetName).toBe('Terastal Festival ex');
    expect(profile.evidence[0]?.extractionConfidence).toBe('HIGH');
    expect(traitLabels(profile, 'languages')).toEqual(['JAPANESE']);
    expect(traitLabels(profile, 'sets')).toEqual(['Terastal Festival ex']);
    expect(traitLabels(profile, 'rarities')).toContain('SAR');
  });

  it('continues with conservative fallback when the catalog is unavailable or a chase is freeform', () => {
    process.env.CARD_CATALOG_PATH = path.join(os.tmpdir(), `missing-profile-catalog-${Date.now()}.db`);

    const profile = buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210', grade: 'RAW', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    });

    expect(traitLabels(profile, 'subjects')).toEqual(expect.arrayContaining(['Moltres', 'Zapdos', 'Articuno']));
    expect(traitLabels(profile, 'formats')).toContain('GX');
    expect(traitLabels(profile, 'gradingPreferences')).toEqual(['RAW']);
    expect(profile.traits.rarities).toEqual([]);
  });

  it('suppresses completed legacy mirrors by origin ID and safe exact identity fallback', () => {
    const userId = 'collector-profile-legacy';
    clearUser(userId);
    const completed = addChase({ userId, cardName: 'Mew RC24' });
    const mistake = addChase({ userId, cardName: 'Zapdos Expedition 48' });

    resolveChaseRemoval(userId, completed.id, 'COMPLETED');
    resolveChaseRemoval(userId, mistake.id, 'ADDED_BY_MISTAKE');
    const profile = buildCollectorInterestProfile({
      activeChases: listChases(userId),
      completedChases: listCompletedChases(userId),
      legacyTasteMemoryChases: [
        ...listUserTasteMemoryChases(userId),
        { id: 'taste:removed', userId, cardName: 'Pichu Expedition 22/165', createdAt: '2026-01-01T00:00:00.000Z', tasteSource: 'REMOVED_CHASE' },
        { id: 'taste:BOUGHT_OR_SEEN:legacy-name', userId, cardName: 'Mew RC24', createdAt: '2026-01-02T00:00:00.000Z', tasteSource: 'BOUGHT_OR_SEEN' },
        { id: 'taste:BOUGHT_OR_SEEN:xy192', userId, cardName: 'Mew XY Black Star Promos XY192', createdAt: '2026-01-03T00:00:00.000Z', tasteSource: 'BOUGHT_OR_SEEN' }
      ],
      includeLegacyBoughtOrSeen: true
    });

    expect(profile.sourceSummary.completedChases).toBe(1);
    expect(profile.sourceSummary.legacyBoughtOrSeen).toBe(1);
    expect(profile.evidence.map((item) => item.cardName)).toEqual(expect.arrayContaining(['Mew RC24', 'Mew XY Black Star Promos XY192']));
  });

  it('dedupes legacy bought evidence per exact identity and reports legacy trait counts', () => {
    const legacy = Array.from({ length: 4 }, (_, index) => ({
      id: `taste:BOUGHT_OR_SEEN:umbreon-${index}`,
      userId: 'u1',
      cardName: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      tasteSource: 'BOUGHT_OR_SEEN' as const,
      maxPrice: 100 + index
    }));

    const profile = buildCollectorInterestProfile({ activeChases: [], completedChases: [], legacyTasteMemoryChases: legacy, includeLegacyBoughtOrSeen: true });

    expect(profile.sourceSummary).toMatchObject({ activeChases: 0, completedChases: 0, legacyBoughtOrSeen: 1, distinctCards: 1 });
    expect(profile.evidence).toHaveLength(1);
    expect(profile.evidence[0]).toMatchObject({ source: 'LEGACY_BOUGHT_OR_SEEN', weight: 0.65 });
    expect(profile.traits.subjects[0]).toMatchObject({ label: 'Umbreon', activeEvidenceCount: 0, completedEvidenceCount: 0, legacyEvidenceCount: 1 });
    expect(profile.budget).toBeUndefined();
  });

  it('reports mixed source counts on reinforced traits', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Mew XY192', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      completedChases: [{ id: 'c1', userId: 'u1', cardName: 'Mew XY110', createdAt: '2026-01-03T00:00:00.000Z', completedAt: '2026-01-04T00:00:00.000Z' }],
      legacyTasteMemoryChases: [{ id: 'taste:BOUGHT_OR_SEEN:mew-old', userId: 'u1', cardName: 'Mew Expedition Base Set 19', createdAt: '2026-01-05T00:00:00.000Z', tasteSource: 'BOUGHT_OR_SEEN' }],
      includeLegacyBoughtOrSeen: true
    });

    expect(profile.traits.subjects[0]).toMatchObject({ label: 'Mew', activeEvidenceCount: 2, completedEvidenceCount: 1, legacyEvidenceCount: 1 });
    expect(profile.sourceSummary).toMatchObject({ activeChases: 2, completedChases: 1, legacyBoughtOrSeen: 1, distinctCards: 4 });
  });

  it('keeps Pokemon-EX and modern Pokemon ex as separate format traits', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew-EX Legendary Treasures RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      completedChases: []
    });

    expect(traitLabels(profile, 'formats')).toEqual(expect.arrayContaining(['EX', 'ex']));
  });

  it('reports confidence from independent evidence breadth', () => {
    expect(buildCollectorInterestProfile({ activeChases: [], completedChases: [] }).confidence.tier).toBe('SEED');
    expect(buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Pichu Expedition 22/165', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      completedChases: []
    }).confidence.tier).toBe('EMERGING');
    expect(buildCollectorInterestProfile({
      activeChases: ['Mew RC24', 'Pichu Expedition 22/165', 'Gardevoir ex 233', 'Umbreon 217/187'].map((cardName, index) => ({
        id: `a${index}`,
        userId: 'u1',
        cardName,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`
      })),
      completedChases: []
    }).confidence.tier).toBe('USABLE');
    expect(buildCollectorInterestProfile({
      activeChases: Array.from({ length: 8 }, (_, index) => ({
        id: `a${index}`,
        userId: 'u1',
        cardName: `Testmon ${index} Promo ${index}`,
        createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      })),
      completedChases: []
    }).confidence.tier).toBe('STRONG');
    expect(buildCollectorInterestProfile({
      activeChases: Array.from({ length: 12 }, (_, index) => ({
        id: `b${index}`,
        userId: 'u1',
        cardName: `Testmon ${index} Promo ${index}`,
        createdAt: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      })),
      completedChases: []
    }).confidence.score).toBeLessThan(1);
    expect(buildCollectorInterestProfile({
      activeChases: [{ id: 'same-1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    }).confidence.score).toBeLessThan(buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Pichu Expedition 22/165', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      completedChases: []
    }).confidence.score);
  });

  it('parses inspector CLI args and prints concise JSON output without mutation', () => {
    const userId = 'usr_collector_profile_cli';
    clearUser(userId);
    addChase({ userId, cardName: 'Mew RC24' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(parseCollectorProfileInspectArgs(['--user', userId, '--json'])).toEqual({ userId, discordUserId: undefined, json: true, evidence: false });
    expect(() => parseCollectorProfileInspectArgs([])).toThrow('Usage: npm run profile:inspect');
    expect(() => parseCollectorProfileInspectArgs(['--user', '875643283995500625'])).toThrow('--discord-user');
    expect(() => parseCollectorProfileInspectArgs(['--user', userId, '--discord-user', '875643283995500625'])).toThrow('either --user or --discord-user');
    runCollectorProfileInspectCli(['--user', userId, '--json']);

    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(printed.version).toBe(1);
    expect(printed.sourceSummary.activeChases).toBe(1);
    expect(listChases(userId)).toHaveLength(1);
    logSpy.mockRestore();
  });

  it('resolves linked Discord IDs in the inspector without creating accounts', () => {
    const user = createUser({ displayName: 'Profile CLI' });
    clearUser(user.id);
    const discordUserId = '875643283995500625';
    db.prepare('DELETE FROM user_identities WHERE provider = ? AND provider_user_id = ?').run('DISCORD', discordUserId);
    linkIdentity({ userId: user.id, provider: 'DISCORD', providerUserId: discordUserId });
    addChase({ userId: user.id, cardName: 'Mew RC24' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    runCollectorProfileInspectCli(['--discord-user', discordUserId]);

    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain(`User: ${user.id}`);
    expect(() => runCollectorProfileInspectCli(['--discord-user', '000000000000000000'])).toThrow('No Vaultr account is linked');
    logSpy.mockRestore();
  });
});
