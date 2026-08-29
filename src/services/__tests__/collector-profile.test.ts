import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryCandidate } from '../../commands/discover.js';
import type { CompletedChase } from '../../types.js';
import { getCardCatalogRecordBySourceCardId, replaceCardCatalogSourceRecords } from '../card-catalog-db.js';
import type { CardCatalogRecord } from '../card-catalog/types.js';
import { addChase, listChases, listCompletedChases, listUserTasteMemoryChases, removeAllChases, resolveChaseRemoval } from '../chase-store.js';
import { buildCollectorInterestProfile, type CollectorInterestProfile } from '../collector-profile.js';
import { analyzeCollectorProfileShadowReserve, collectorInterestProfileToTasteProfile, extractCollectorProfileDiscoveryFeatures, weeklyDiscoveryRankingModeForCollectorProfile } from '../collector-profile-ranking-adapter.js';
import { db } from '../db.js';
import { parseCollectorProfileInspectArgs, runCollectorProfileInspectCli } from '../../collector-profile-inspect.js';
import { createUser, linkIdentity } from '../accounts.js';
import { deleteWeeklyDiscoveryPreparedReserve, getWeeklyDiscoveryPreparedReserve, upsertWeeklyDiscoveryPreparedReserve } from '../weekly-discovery-prepared-reserve.js';
import { analyzeWeeklyDiscoveryCandidateReserve, rerankWeeklyDiscoveryReserve, type CollectorTasteProfile } from '../weekly-discovery-ranking.js';

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
  db.prepare('DELETE FROM weekly_discovery_prepared_reserve WHERE user_id = ?').run(userId);
}

function candidate(
  name: string,
  overrides: Partial<Omit<DiscoveryCandidate, 'suggestion'>> & { suggestion?: Partial<DiscoveryCandidate['suggestion']> } = {}
): DiscoveryCandidate {
  return {
    ...overrides,
    suggestion: {
      name,
      lane: 'Test',
      laneWhy: 'Test lane',
      why: 'Test rationale',
      nearby: [],
      ...overrides.suggestion
    },
    marketSampleSize: 3,
    typicalRawAskingTotal: 50
  } as DiscoveryCandidate;
}

function tasteProfile(overrides: Partial<CollectorTasteProfile> = {}): CollectorTasteProfile {
  return {
    subjects: {},
    evolutionFamilies: {},
    artists: {},
    eras: {},
    sets: {},
    setFamilies: {},
    languages: {},
    formats: {},
    rarityTiers: {},
    artTiers: {},
    promoTypes: {},
    releaseTypes: {},
    aestheticTags: {},
    sceneTags: {},
    themeTags: {},
    ...overrides
  };
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

  it('does not infer Pokemon 151 set from CoroCoro Mew identifier text', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Mew CoroCoro Promo 151', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    });

    expect(traitLabels(profile, 'subjects')).toContain('Mew');
    expect(traitLabels(profile, 'promoTypes')).toContain('PROMO');
    expect(traitLabels(profile, 'releaseEvents')).toContain('COROCORO');
    expect(traitLabels(profile, 'sets')).not.toContain('151');
    expect(traitLabels(profile, 'eras')).not.toContain('SV');
  });

  it('keeps structured catalog set 151 authoritative for exact trusted records', () => {
    const dbPath = tempCatalogPath('structured-151');
    process.env.CARD_CATALOG_PATH = dbPath;
    replaceCardCatalogSourceRecords('POKEMONTCG', [record({
      sourceCardId: 'sv3pt5-205',
      name: 'Mew ex',
      normalizedName: 'mew ex',
      setName: '151',
      normalizedSetName: '151',
      series: 'Scarlet & Violet',
      cardNumber: '205',
      normalizedCardNumber: '205',
      printedTotal: '165'
    })], dbPath);

    const profile = buildCollectorInterestProfile({
      activeChases: [{
        id: 'a1',
        userId: 'u1',
        cardName: 'Pokemon 151 Mew ex 205/165',
        cardImageSourceKind: 'CARD_REFERENCE',
        cardImageSourceName: 'POKEMONTCG',
        cardImageSourceCardId: 'sv3pt5-205',
        createdAt: '2026-01-01T00:00:00.000Z'
      }],
      completedChases: []
    });

    expect(traitLabels(profile, 'sets')).toContain('151');
    expect(traitLabels(profile, 'eras')).toContain('SV');
  });

  it('does not infer set 151 from unrelated bare numeric context', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Mew Japanese 151', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    });

    expect(traitLabels(profile, 'subjects')).toContain('Mew');
    expect(traitLabels(profile, 'sets')).not.toContain('151');
  });

  it('preserves existing safe textual set fallbacks', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew-EX Legendary Treasures RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Mew XY Black Star Promos XY192', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      completedChases: []
    });

    expect(traitLabels(profile, 'sets')).toEqual(expect.arrayContaining(['Legendary Treasures', 'XY Black Star Promos']));
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

    expect(parseCollectorProfileInspectArgs(['--user', userId, '--json'])).toEqual({ userId, discordUserId: undefined, json: true, evidence: false, ranker: false, rankerReserve: false });
    expect(() => parseCollectorProfileInspectArgs([])).toThrow('Usage: npm run profile:inspect');
    expect(() => parseCollectorProfileInspectArgs(['--user', '875643283995500625'])).toThrow('--discord-user');
    expect(() => parseCollectorProfileInspectArgs(['--user', userId, '--discord-user', '875643283995500625'])).toThrow('either --user or --discord-user');
    expect(() => parseCollectorProfileInspectArgs(['--user', userId, '--json', '--ranker'])).toThrow('--ranker');
    expect(() => parseCollectorProfileInspectArgs(['--user', userId, '--json', '--ranker-reserve'])).toThrow('--ranker');
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

  it('adapts collector profile subjects into bounded order-independent ranker weights', () => {
    const first = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Mew XY192', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'a3', userId: 'u1', cardName: 'Gardevoir ex Scarlet ex 101/78', createdAt: '2026-01-03T00:00:00.000Z' }
      ],
      completedChases: []
    });
    const second = { ...first, traits: { ...first.traits, subjects: [...first.traits.subjects].reverse() } };

    const adapted = collectorInterestProfileToTasteProfile(first);
    expect(adapted.subjects.Mew).toBeGreaterThan(adapted.subjects.Gardevoir ?? 0);
    expect(adapted.subjects.Mew).toBeLessThanOrEqual(8);
    expect(collectorInterestProfileToTasteProfile(second)).toEqual(adapted);
  });

  it('selects live weekly ranking mode from collector profile confidence tier', () => {
    const base = buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    });

    expect(weeklyDiscoveryRankingModeForCollectorProfile({ ...base, confidence: { tier: 'SEED', score: 0.1 } })).toBe('LEGACY');
    expect(weeklyDiscoveryRankingModeForCollectorProfile({ ...base, confidence: { tier: 'EMERGING', score: 0.4 } })).toBe('LEGACY');
    expect(weeklyDiscoveryRankingModeForCollectorProfile({ ...base, confidence: { tier: 'USABLE', score: 0.6 } })).toBe('COLLECTOR_PROFILE_V1');
    expect(weeklyDiscoveryRankingModeForCollectorProfile({ ...base, confidence: { tier: 'STRONG', score: 0.8 } })).toBe('COLLECTOR_PROFILE_V1');
  });

  it('maps compatible languages, sets, eras, rarities, promos, and explicit feedback preferences', () => {
    const profile = buildCollectorInterestProfile({
      activeChases: [
        { id: 'a1', userId: 'u1', cardName: 'Umbreon ex SAR Terastal Festival ex Japanese 217/187', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', userId: 'u1', cardName: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'a3', userId: 'u1', cardName: "Squirtle Japanese McDonald's Promo 007/018", createdAt: '2026-01-03T00:00:00.000Z' },
        { id: 'a4', userId: 'u1', cardName: 'Mew-EX Legendary Treasures RC24 English', createdAt: '2026-01-04T00:00:00.000Z' }
      ],
      completedChases: []
    });
    const adapted = collectorInterestProfileToTasteProfile(profile, {
      preferredLanguages: ['JAPANESE'],
      preferredEras: ['XY'],
      preferredSets: ['XY Black Star Promos'],
      budgetPreferenceCad: 45
    });

    expect(adapted.languages).toMatchObject({ ENGLISH: expect.any(Number), JAPANESE: expect.any(Number) });
    expect(adapted.sets).toHaveProperty('Terastal Festival ex');
    expect(adapted.sets).toHaveProperty('SM Black Star Promos');
    expect(adapted.sets).toHaveProperty('XY Black Star Promos');
    expect(adapted.setFamilies).toHaveProperty('terastal festival');
    expect(adapted.eras).toMatchObject({ SV: expect.any(Number), SM: expect.any(Number), XY: expect.any(Number) });
    expect(adapted.formats).toMatchObject({ ex: expect.any(Number), EX: expect.any(Number), GX: expect.any(Number), TAG_TEAM: expect.any(Number) });
    expect(adapted.rarityTiers).toHaveProperty('premium');
    expect(adapted.artTiers).toHaveProperty('premium');
    expect(adapted.promoTypes).toMatchObject({ 'black-star': expect.any(Number), mcdonalds: expect.any(Number) });
    expect(adapted.releaseTypes).toMatchObject({ 'promo-release': expect.any(Number), 'japanese-release': expect.any(Number) });
    expect(adapted.budgetPreferenceCad).toBe(45);
  });

  it('leaves unsupported ranker dimensions empty in the shadow adapter', () => {
    const adapted = collectorInterestProfileToTasteProfile(buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Mew RC24', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    }));

    expect(adapted.evolutionFamilies).toEqual({});
    expect(adapted.artists).toEqual({});
    expect(adapted.aestheticTags).toEqual({});
    expect(adapted.sceneTags).toEqual({});
    expect(adapted.themeTags).toEqual({});
  });

  it('extracts shadow-compatible candidate subjects without first-token false positives', () => {
    expect(extractCollectorProfileDiscoveryFeatures(candidate('Mew-EX Legendary Treasures RC24')).subjects).toEqual(['Mew']);
    expect(extractCollectorProfileDiscoveryFeatures(candidate('Mega Gardevoir ex SAR Japanese 087/063')).subjects).toEqual(['Gardevoir']);
    expect(extractCollectorProfileDiscoveryFeatures(candidate('サーナイトex SAR 087/063')).subjects).toEqual(['Gardevoir']);
    expect(extractCollectorProfileDiscoveryFeatures(candidate('ミュウex Japanese Promo')).subjects).toEqual(['Mew']);
    expect(extractCollectorProfileDiscoveryFeatures(candidate('Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210')).subjects).toEqual(['Moltres', 'Zapdos', 'Articuno']);
    expect(extractCollectorProfileDiscoveryFeatures(candidate('Mega Dark Shining Card'))).toMatchObject({ subjects: [], evolutionFamilies: [] });
  });

  it('extracts shadow-compatible formats, promos, sets, and safe 151 eras', () => {
    const exFeatures = extractCollectorProfileDiscoveryFeatures(candidate('Mew-EX Legendary Treasures RC24'));
    const modernExFeatures = extractCollectorProfileDiscoveryFeatures(candidate('Gardevoir ex Scarlet ex SAR Japanese'));
    const tagTeamFeatures = extractCollectorProfileDiscoveryFeatures(candidate('Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210'));
    const corocoroFeatures = extractCollectorProfileDiscoveryFeatures(candidate('Mew CoroCoro Promo 151'));
    const pokemon151Features = extractCollectorProfileDiscoveryFeatures(candidate('Mew Pokemon 151 151/165'));

    expect(exFeatures.formats).toEqual(expect.arrayContaining(['special-art', 'EX']));
    expect(exFeatures.formats).not.toContain('ex');
    expect(modernExFeatures.formats).toEqual(expect.arrayContaining(['special-art', 'ex']));
    expect(tagTeamFeatures.formats).toEqual(expect.arrayContaining(['special-art', 'GX', 'TAG_TEAM', 'promo']));
    expect(corocoroFeatures.formats).toContain('promo');
    expect(corocoroFeatures.promoTypes).toContain('corocoro');
    expect(corocoroFeatures.eras).not.toContain('SV');
    expect(pokemon151Features.eras).toContain('SV');
    expect(tagTeamFeatures.promoTypes).toContain('black-star');
    expect(exFeatures.sets).toContain('Legendary Treasures');
    expect(exFeatures.setFamilies).toContain('legendary treasures');
  });

  it('keeps generation rationale and taste tokens out of shadow intrinsic features', () => {
    const features = extractCollectorProfileDiscoveryFeatures(candidate('Pikachu-EX XY Black Star Promos XY174', {
      suggestion: {
        lane: 'Japanese CoroCoro Mew',
        laneWhy: 'Because you collect Japanese Mew and Gardevoir promos',
        why: 'Similar to your CoroCoro Mew and Umbreon tastes',
        sourceTasteTokens: ['Japanese', 'CoroCoro', 'Mew', 'Gardevoir', 'Umbreon', 'VMAX', 'SAR', 'Mega Symphonia'],
        referenceSourceName: 'Pokemon TCG XY Black Star Promos',
        referenceSourceCardId: 'xyp-XY174'
      }
    }));

    expect(features.subjects).toEqual(['Pikachu']);
    expect(features.subjects).not.toEqual(expect.arrayContaining(['Mew', 'Gardevoir', 'Umbreon']));
    expect(features.languages).toEqual(['ENGLISH']);
    expect(features.sets).toContain('XY Black Star Promos');
    expect(features.sets).not.toContain('Mega Symphonia');
    expect(features.formats).toContain('EX');
    expect(features.formats).not.toContain('VMAX');
    expect(features.rarityTiers).not.toContain('premium');
    expect(features.promoTypes).toContain('black-star');
    expect(features.promoTypes).not.toContain('corocoro');
  });

  it('does not derive Japanese promo traits or subjects from poisoned shadow context', () => {
    const articuno = extractCollectorProfileDiscoveryFeatures(candidate('Articuno Japanese S12a 049/172', {
      suggestion: {
        lane: 'CoroCoro Mew Black Star',
        why: 'Matches your Mew and Pikachu taste',
        sourceTasteTokens: ['CoroCoro', 'Mew', 'Black Star'],
        referenceSourceName: 'TCGdex Japanese VSTAR Universe',
        referenceSourceCardId: 'S12a-049'
      }
    }));
    const moltres = extractCollectorProfileDiscoveryFeatures(candidate('Galarian Moltres V Brilliant Stars 183', {
      suggestion: {
        sourceTasteTokens: ['Mew', 'Pikachu', 'Gardevoir'],
        why: 'For Mew, Pikachu, and Gardevoir collectors'
      }
    }));

    expect(articuno.subjects).toEqual(['Articuno']);
    expect(articuno.languages).toEqual(['JAPANESE']);
    expect(articuno.promoTypes).not.toEqual(expect.arrayContaining(['corocoro', 'black-star']));
    expect(moltres.subjects).toEqual(['Moltres']);
    expect(moltres.subjects).not.toEqual(expect.arrayContaining(['Mew', 'Pikachu', 'Gardevoir']));
  });

  it('uses compatible shadow feature keys for adapter profile scoring without changing the default extractor', () => {
    const profile = collectorInterestProfileToTasteProfile(buildCollectorInterestProfile({
      activeChases: [{ id: 'a1', userId: 'u1', cardName: 'Mew-EX Legendary Treasures RC24 English', createdAt: '2026-01-01T00:00:00.000Z' }],
      completedChases: []
    }));
    const reserve = [candidate('Mew-EX Legendary Treasures RC24 English')];

    const live = analyzeWeeklyDiscoveryCandidateReserve(reserve, profile, {}, 'same-seed')[0];
    const shadow = analyzeCollectorProfileShadowReserve(reserve, profile, {}, 'same-seed')[0];

    expect(live.weeklyDiscovery?.features.subjects).toContain('mew');
    expect(shadow.weeklyDiscovery?.features.subjects).toContain('Mew');
    expect(shadow.weeklyDiscovery?.rankExplanation.scoreComponents.personalRelevance.subjectAffinity).toBeGreaterThan(0);
    expect(shadow.weeklyDiscovery?.features.evolutionFamilies).toEqual([]);
    expect(shadow.weeklyDiscovery?.features.formats).toEqual(expect.arrayContaining(['EX']));
  });

  it('keeps zero-affinity unseen traits as controlled exploration in shadow scoring', () => {
    const profile = tasteProfile({ subjects: { Mew: 8 }, languages: { ENGLISH: 4 } });
    const reserve = [candidate('Pichu Expedition Base Set 22')];

    const live = analyzeWeeklyDiscoveryCandidateReserve(reserve, profile, {}, 'seed')[0];
    const shadow = analyzeCollectorProfileShadowReserve(reserve, profile, {}, 'seed')[0];

    expect(live.weeklyDiscovery?.discoveryRole).toBe('ADJACENT_DISCOVERY');
    expect(shadow.weeklyDiscovery?.discoveryRole).toBe('CONTROLLED_EXPLORATION');
    expect(shadow.weeklyDiscovery?.rankExplanation.shadowDiagnostics?.collectorAnchorStrength).toBe(0);
    expect(shadow.weeklyDiscovery?.rankExplanation.strongestSignals).not.toContain('adjacent trait');
    expect(shadow.weeklyDiscovery?.rankExplanation.strongestSignals).toContain('novelty');
  });

  it('treats language-only affinity as support rather than adjacency', () => {
    const profile = tasteProfile({ languages: { ENGLISH: 4 } });
    const [shadow] = analyzeCollectorProfileShadowReserve([candidate('Unlistedmon English Promo 1')], profile, {}, 'seed');

    const personal = shadow.weeklyDiscovery?.rankExplanation.scoreComponents.personalRelevance;
    expect(personal?.languageAffinity).toBeGreaterThan(0);
    expect(shadow.weeklyDiscovery?.rankExplanation.shadowDiagnostics?.personalAggregate).toBeLessThan(0.1);
    expect(shadow.weeklyDiscovery?.discoveryRole).toBe('CONTROLLED_EXPLORATION');
  });

  it('classifies strong subject and multi-trait profile matches as shadow core', () => {
    const profile = tasteProfile({
      subjects: { Mew: 8, Pikachu: 3.34 },
      sets: { 'XY Black Star Promos': 5 },
      setFamilies: { 'xy black': 5 },
      promoTypes: { 'black-star': 5.13 },
      formats: { EX: 1.92 },
      languages: { ENGLISH: 4 }
    });
    const [mew, pikachu] = analyzeCollectorProfileShadowReserve([
      candidate('Mew HS Triumphant 97 English'),
      candidate('Pikachu-EX XY Black Star Promos XY174', {
        suggestion: { referenceSourceName: 'Pokemon TCG XY Black Star Promos', referenceSourceCardId: 'xyp-XY174' }
      })
    ], profile, {}, 'seed');

    expect(mew.weeklyDiscovery?.discoveryRole).toBe('CORE_MATCH');
    expect(pikachu.weeklyDiscovery?.discoveryRole).toBe('CORE_MATCH');
    expect(pikachu.weeklyDiscovery?.rankExplanation.shadowDiagnostics?.collectorAnchorStrength).toBeGreaterThan(0.4);
  });

  it('allows secondary subject plus format to become adjacent below core strength', () => {
    const profile = tasteProfile({
      subjects: { Umbreon: 2.5 },
      formats: { GX: 5 },
      languages: { ENGLISH: 4 }
    });
    const [shadow] = analyzeCollectorProfileShadowReserve([candidate('Umbreon-GX SM Black Star Promos SM36')], profile, {}, 'seed');

    expect(shadow.weeklyDiscovery?.discoveryRole).toBe('ADJACENT_DISCOVERY');
    expect(shadow.weeklyDiscovery?.rankExplanation.shadowDiagnostics?.collectorAnchorStrength).toBeGreaterThanOrEqual(0.16);
  });

  it('uses subject affinity strength for shadow novelty instead of binary known-subject presence', () => {
    const strong = analyzeCollectorProfileShadowReserve([candidate('Mew HS Triumphant 97')], tasteProfile({ subjects: { Mew: 8 } }), {}, 'seed')[0];
    const weak = analyzeCollectorProfileShadowReserve([candidate('Meowth Promo 10')], tasteProfile({ subjects: { Meowth: 0.97 } }), {}, 'seed')[0];

    expect(weak.weeklyDiscovery?.rankExplanation.scoreComponents.discoveryValue.novelty)
      .toBeGreaterThan(strong.weeklyDiscovery?.rankExplanation.scoreComponents.discoveryValue.novelty ?? 0);
    expect(weak.weeklyDiscovery?.discoveryRole).toBe('CONTROLLED_EXPLORATION');
  });

  it('does not dilute shadow personal relevance for unsupported profile dimensions', () => {
    const profile = tasteProfile({ subjects: { Mew: 8 } });
    const [shadow] = analyzeCollectorProfileShadowReserve([candidate('Mew HS Triumphant 97')], profile, {}, 'seed');

    expect(shadow.weeklyDiscovery?.rankExplanation.scoreComponents.personalRelevance.subjectAffinity).toBe(0.8);
    expect(shadow.weeklyDiscovery?.rankExplanation.shadowDiagnostics?.personalAggregate).toBeCloseTo(0.288, 3);
  });

  it('keeps shadow scoring deterministic for the same seed', () => {
    const profile = tasteProfile({ subjects: { Mew: 8, Pikachu: 3 }, formats: { EX: 2 }, languages: { ENGLISH: 4 } });
    const reserve = [
      candidate('Pikachu-EX XY Black Star Promos XY174'),
      candidate('Mew HS Triumphant 97 English'),
      candidate('Pichu Expedition Base Set 22')
    ];

    const first = rerankWeeklyDiscoveryReserve(analyzeCollectorProfileShadowReserve(reserve, profile, {}, 'stable'));
    const second = rerankWeeklyDiscoveryReserve(analyzeCollectorProfileShadowReserve(reserve, profile, {}, 'stable'));

    expect(first.map((entry) => [entry.suggestion.name, entry.weeklyDiscovery?.discoveryRole, entry.weeklyDiscovery?.rankExplanation.scoreComponents.baseScore]))
      .toEqual(second.map((entry) => [entry.suggestion.name, entry.weeklyDiscovery?.discoveryRole, entry.weeklyDiscovery?.rankExplanation.scoreComponents.baseScore]));
  });

  it('prints a read-only shadow comparison for the latest prepared reserve', () => {
    const userId = 'usr_collector_profile_ranker_reserve_cli';
    clearUser(userId);
    addChase({ userId, cardName: 'Mew-EX Legendary Treasures RC24 English' });
    const reserve = [
      analyzeWeeklyDiscoveryCandidateReserve([candidate('Mew-EX Legendary Treasures RC24 English', {
        suggestion: { referenceSourceCardId: 'bw11-RC24', referenceSourceName: 'Pokemon TCG Legendary Treasures' }
      })], collectorInterestProfileToTasteProfile(buildCollectorInterestProfile({ activeChases: [], completedChases: [] })), {}, 'old')[0]
    ];
    upsertWeeklyDiscoveryPreparedReserve<DiscoveryCandidate, Record<string, never>>({
      userId,
      periodKey: '2026-W32',
      preparationGeneration: 1,
      reserveCandidates: reserve,
      canonicalLookupEvidence: {},
      reserveCount: reserve.length,
      canonicalReadyCount: 1,
      imageReadyCount: 0,
      marketReadyCount: 1,
      personallyDefensibleCount: 1,
      projectedSelectableCount: 1,
      projectedMarketResolvedCount: 1,
      viableAlternativeCount: 0,
      pendingMarketJobCount: 0,
      failedMarketJobCount: 0,
      blockingShortages: [],
      lastCompletedStage: 'test',
      lastMeaningfulProgressAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z'
    });
    const before = getWeeklyDiscoveryPreparedReserve<DiscoveryCandidate>(userId, '2026-W32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    runCollectorProfileInspectCli(['--user', userId, '--ranker-reserve']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Prepared reserve shadow comparison');
    expect(output).toContain('Period: 2026-W32');
    expect(output).toContain('shadow  base=');
    expect(output).toContain('personal=');
    expect(output).toContain('features subjects=');
    expect(output).toContain('old     base=');
    expect(getWeeklyDiscoveryPreparedReserve<DiscoveryCandidate>(userId, '2026-W32')).toEqual(before);
    logSpy.mockRestore();
    deleteWeeklyDiscoveryPreparedReserve(userId, '2026-W32');
  });

  it('reports when ranker reserve inspection has no prepared reserve', () => {
    const userId = 'usr_collector_profile_ranker_reserve_empty';
    clearUser(userId);
    addChase({ userId, cardName: 'Mew RC24' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => runCollectorProfileInspectCli(['--user', userId, '--ranker-reserve'])).toThrow('No prepared Weekly Discovery reserve found');
    logSpy.mockRestore();
  });

  it('shows the adapted ranker profile in human CLI output only', () => {
    const userId = 'usr_collector_profile_ranker_cli';
    clearUser(userId);
    addChase({ userId, cardName: 'Mew-EX Legendary Treasures RC24' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    runCollectorProfileInspectCli(['--user', userId, '--ranker']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Ranker adapter');
    expect(output).toContain('Subjects');
    expect(output).toContain('Formats');
    logSpy.mockRestore();
  });
});
