import type { Chase, CompletedChase } from '../types.js';
import { getCardCatalogRecordBySourceCardId } from './card-catalog-db.js';
import { normalizeCatalogText } from './card-catalog/normalize.js';
import type { StoredCardCatalogRecord } from './card-catalog/types.js';
import { listChases, listCompletedChases, listUserTasteMemoryChases } from './chase-store.js';
import { JAPANESE_SUBJECT_ALIASES } from './collector-card-aliases.js';

export type CollectorProfileEvidenceSource = 'ACTIVE_CHASE' | 'COMPLETED_CHASE' | 'LEGACY_BOUGHT_OR_SEEN';
export type CollectorProfileConfidenceTier = 'SEED' | 'EMERGING' | 'USABLE' | 'STRONG';
export type CollectorProfileTraitConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type CollectorProfileTraitGroup =
  | 'subjects'
  | 'languages'
  | 'sets'
  | 'eras'
  | 'formats'
  | 'artists'
  | 'rarities'
  | 'promoTypes'
  | 'releaseTypes'
  | 'releaseEvents'
  | 'gradingPreferences'
  | 'conditionPreferences';

export type CollectorProfileTraitExtraction = Partial<Record<CollectorProfileTraitGroup, string[]>>;

export type CollectorProfileEvidence = {
  id: string;
  source: CollectorProfileEvidenceSource;
  sourceId: string;
  cardName: string;
  timestamp: string;
  weight: number;
  identityKey: string;
  canonicalIdentity?: {
    source?: string;
    sourceCardId?: string;
    setName?: string;
    cardNumber?: string;
    language?: string;
  };
  extractedTraits: CollectorProfileTraitExtraction;
  extractionConfidence: CollectorProfileTraitConfidence;
};

export type CollectorInterestTrait = {
  key: string;
  label: string;
  score: number;
  evidenceCount: number;
  activeEvidenceCount: number;
  completedEvidenceCount: number;
  legacyEvidenceCount: number;
  confidence: CollectorProfileTraitConfidence;
  evidenceIds: string[];
};

export type CollectorInterestProfile = {
  version: 1;
  sourceSummary: {
    activeChases: number;
    completedChases: number;
    legacyBoughtOrSeen: number;
    distinctCards: number;
  };
  confidence: {
    tier: CollectorProfileConfidenceTier;
    score: number;
    reasons: string[];
  };
  traits: Record<CollectorProfileTraitGroup, CollectorInterestTrait[]>;
  budget?: {
    observedTargetCount: number;
    minTarget: number;
    medianTarget: number;
    maxTarget: number;
  };
  evidence: CollectorProfileEvidence[];
};

export type BuildCollectorInterestProfileInput = {
  activeChases: Chase[];
  completedChases: CompletedChase[];
  legacyTasteMemoryChases?: Chase[];
  includeLegacyBoughtOrSeen?: boolean;
};

const SOURCE_WEIGHTS: Record<CollectorProfileEvidenceSource, number> = {
  ACTIVE_CHASE: 1,
  COMPLETED_CHASE: 1.15,
  LEGACY_BOUGHT_OR_SEEN: 0.65
};

const PRIORITY_MULTIPLIERS: Record<NonNullable<Chase['priority']>, number> = {
  NORMAL: 1,
  HIGH: 1.12,
  GRAIL: 1.25
};

const MAX_EXACT_IDENTITY_CONTRIBUTION = 2.6;

export const KNOWN_COLLECTOR_SUBJECTS = [
  'Moltres', 'Zapdos', 'Articuno', 'Gardevoir', 'Umbreon', 'Sylveon', 'Espeon', 'Vaporeon',
  'Jolteon', 'Flareon', 'Leafeon', 'Glaceon', 'Pikachu', 'Raichu', 'Pichu', 'Mewtwo', 'Mew',
  'Squirtle', 'Wartortle', 'Blastoise', 'Charizard', 'Dragonite', 'Celebi', 'Lapras'
];

const SET_PATTERNS: Array<[RegExp, string]> = [
  [/\bexpedition(?:\s+base\s+set)?\b/i, 'Expedition Base Set'],
  [/\baquapolis\b/i, 'Aquapolis'],
  [/\bskyridge\b/i, 'Skyridge'],
  [/\bpaldean\s+fates\b/i, 'Paldean Fates'],
  [/\blegendary\s+treasures\b/i, 'Legendary Treasures'],
  [/\bterastal\s+festival\b/i, 'Terastal Festival ex'],
  [/\bmega\s+symphonia\b/i, 'Mega Symphonia'],
  [/\bsm\s+black\s+star\s+promos\b|\bblack\s+star\s+promos\b/i, 'SM Black Star Promos'],
  [/\bxy\s+black\s+star\s+promos\b/i, 'XY Black Star Promos']
];

function normalizeKey(value: string | undefined): string {
  return normalizeCatalogText(value);
}

function labelLanguage(language: string | undefined): string | undefined {
  if (language === 'ja') return 'JAPANESE';
  if (language === 'en') return 'ENGLISH';
  return undefined;
}

function weightFor(source: CollectorProfileEvidenceSource, priority?: Chase['priority']): number {
  const base = SOURCE_WEIGHTS[source];
  const multiplier = priority ? PRIORITY_MULTIPLIERS[priority] ?? 1 : 1;
  return Number((base * multiplier).toFixed(3));
}

function identityKeyFor(chase: Chase | CompletedChase): string {
  if (chase.cardImageSourceKind === 'CARD_REFERENCE' && chase.cardImageSourceName && chase.cardImageSourceCardId) {
    return `${chase.cardImageSourceName}:${chase.cardImageSourceCardId}`.toLowerCase();
  }
  if (chase.cardImageIdentity) return `image:${normalizeKey(chase.cardImageIdentity)}`;
  return `name:${normalizeKey(chase.cardName)}`;
}

function catalogRecordFor(chase: Chase | CompletedChase): StoredCardCatalogRecord | null {
  if (chase.cardImageSourceKind !== 'CARD_REFERENCE') return null;
  if (!chase.cardImageSourceName || !chase.cardImageSourceCardId) return null;
  const source = chase.cardImageSourceName === 'DEXTCG' ? 'VAULTR_PROMO' : chase.cardImageSourceName;
  return getCardCatalogRecordBySourceCardId(source, chase.cardImageSourceCardId);
}

function addTrait(traits: CollectorProfileTraitExtraction, group: CollectorProfileTraitGroup, value: string | undefined): void {
  const cleaned = value?.trim();
  if (!cleaned) return;
  const values = traits[group] ?? [];
  if (!values.some((existing) => traitKey(group, existing) === traitKey(group, cleaned))) values.push(cleaned);
  traits[group] = values;
}

function traitKey(group: CollectorProfileTraitGroup, value: string): string {
  if (group === 'formats' && value === 'EX') return 'pokemon-ex';
  if (group === 'formats' && value === 'ex') return 'pokemon-ex-lowercase';
  return normalizeKey(value);
}

function subjectsFromName(name: string): string[] {
  const normalizedName = normalizeKey(name);
  const japaneseSubjects = Object.entries(JAPANESE_SUBJECT_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => normalizedName.includes(normalizeKey(alias))))
    .map(([subject]) => canonicalSubjectLabel(subject));
  if (japaneseSubjects.length > 0) return [...new Set(japaneseSubjects)];
  const subjects = KNOWN_COLLECTOR_SUBJECTS.filter((subject) => new RegExp(`\\b${normalizeKey(subject)}\\b`, 'i').test(normalizedName));
  if (subjects.length > 0) return subjects;
  const beforeContext = name.split(/\s+(?:ex|gx|vmax|vstar|v|lv\.?x|sar|sir|ir|ar|promo|japanese|english|\d)/i)[0]?.trim();
  if (!beforeContext) return [];
  const cleaned = beforeContext.replace(/^mega\s+/i, '').trim();
  return cleaned && cleaned.split(/\s+/).length <= 2 ? [cleaned] : [];
}

function canonicalSubjectLabel(subject: string): string {
  if (subject.toLowerCase() === 'mew') return 'Mew';
  return subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
}

function eraFromRecord(record: StoredCardCatalogRecord): string | undefined {
  const series = normalizeKey(record.series);
  const set = normalizeKey([record.setName, record.translatedSetName].filter(Boolean).join(' '));
  if (['expedition base set', 'aquapolis', 'skyridge'].some((term) => set.includes(term))) return 'WOTC e-Reader';
  if (series.includes('scarlet') || set.includes('paldean fates') || set.includes('terastal') || set.includes('mega symphonia')) return 'SV';
  if (series.includes('sun') || /\bsm\b/.test(set)) return 'SM';
  if (series.includes('xy') || /\bxy\b/.test(set)) return 'XY';
  if (series.includes('black') || set.includes('legendary treasures')) return 'BW';
  return undefined;
}

function eraFromName(name: string): string | undefined {
  const normalized = normalizeKey(name);
  if (/\bexpedition|aquapolis|skyridge\b/.test(normalized)) return 'WOTC e-Reader';
  if (/\bpaldean fates|terastal festival|mega symphonia\b/.test(normalized)) return 'SV';
  if (/\bsm\b|sun and moon/.test(normalized)) return 'SM';
  if (/\bxy\b/.test(normalized)) return 'XY';
  if (/\blegendary treasures\b/.test(normalized)) return 'BW';
  return undefined;
}

function extractTraits(chase: Chase | CompletedChase, record: StoredCardCatalogRecord | null): { traits: CollectorProfileTraitExtraction; confidence: CollectorProfileTraitConfidence } {
  const traits: CollectorProfileTraitExtraction = {};
  const sourceName = record?.name ?? chase.cardImageIdentity ?? chase.cardName;
  for (const subject of subjectsFromName(sourceName)) addTrait(traits, 'subjects', subject);
  if (record) {
    addTrait(traits, 'languages', labelLanguage(record.language));
    addTrait(traits, 'sets', record.translatedSetName ?? record.setName);
    addTrait(traits, 'eras', eraFromRecord(record));
    addTrait(traits, 'artists', record.illustrator);
    addTrait(traits, 'rarities', record.rarity);
    if (record.isPromo) addTrait(traits, 'promoTypes', 'PROMO');
    addTrait(traits, 'promoTypes', record.promoContext);
    addTrait(traits, 'releaseTypes', record.releaseType);
    addTrait(traits, 'releaseEvents', record.releaseEvent);
  } else {
    if (/\bjapanese\b/i.test(chase.cardName)) addTrait(traits, 'languages', 'JAPANESE');
    if (/\benglish\b/i.test(chase.cardName)) addTrait(traits, 'languages', 'ENGLISH');
    for (const [, label] of SET_PATTERNS) if (new RegExp(`\\b${normalizeKey(label).replace(/\s+/g, '\\s+')}\\b`, 'i').test(normalizeKey(chase.cardName))) addTrait(traits, 'sets', label);
    addTrait(traits, 'eras', eraFromName(chase.cardName));
    if (/\bpromo|promos|promotional\b/i.test(chase.cardName)) addTrait(traits, 'promoTypes', 'PROMO');
    if (/\bcorocoro|coro\s*coro\b/i.test(chase.cardName)) addTrait(traits, 'releaseEvents', 'COROCORO');
    if (/\bmcdonald'?s\b/i.test(chase.cardName)) addTrait(traits, 'releaseEvents', 'MCDONALDS');
  }
  const name = chase.cardName;
  for (const [pattern, label, group] of [
    [/\blv\.?\s*x\b/i, 'LV.X', 'formats'],
    [/\bvmax\b/i, 'VMAX', 'formats'],
    [/\bvstar\b/i, 'VSTAR', 'formats'],
    [/\btag\s*team\b|&.*&.*-gx\b/i, 'TAG_TEAM', 'formats'],
    [/\bgx\b/i, 'GX', 'formats'],
    [/\b(?:[A-Za-z]+-EX|EX)\b/, 'EX', 'formats'],
    [/\bex\b/, 'ex', 'formats'],
    [/\bv\b/i, 'V', 'formats'],
    [/\bsar\b/i, 'SAR', 'rarities'],
    [/\bsir\b/i, 'SIR', 'rarities'],
    [/\bir\b/i, 'IR', 'rarities'],
    [/\bar\b/i, 'AR', 'rarities']
  ] as Array<[RegExp, string, CollectorProfileTraitGroup]>) {
    if (pattern.test(name)) addTrait(traits, group, label);
  }
  if (!traits.formats?.includes('EX') && /\b(?:Black\s*&\s*White|BW|XY)\b/i.test([record?.series, record?.setName, name].filter(Boolean).join(' ')) && /\bex\b/i.test(name)) addTrait(traits, 'formats', 'EX');
  if (!traits.formats?.includes('ex') && /\b(?:Scarlet\s*&\s*Violet|SV)\b/i.test([record?.series, record?.setName, name].filter(Boolean).join(' ')) && /\bex\b/i.test(name)) addTrait(traits, 'formats', 'ex');
  if (record?.setName && /\bexpedition|aquapolis|skyridge\b/i.test(record.setName)) addTrait(traits, 'formats', 'e-Reader');
  if (chase.grade) addTrait(traits, 'gradingPreferences', normalizeGrade(chase.grade));
  if (chase.condition) addTrait(traits, 'conditionPreferences', chase.condition.toUpperCase());
  return { traits, confidence: record ? 'HIGH' : 'MEDIUM' };
}

function normalizeGrade(grade: string): string {
  if (/\braw|ungraded\b/i.test(grade)) return 'RAW';
  const company = /\b(PSA|BGS|CGC|TAG)\b/i.exec(grade)?.[1];
  return company ? company.toUpperCase() : grade.toUpperCase();
}

function evidenceFromChase(chase: Chase | CompletedChase, source: CollectorProfileEvidenceSource): CollectorProfileEvidence {
  const record = catalogRecordFor(chase);
  const { traits, confidence } = extractTraits(chase, record);
  return {
    id: `${source.toLowerCase()}:${chase.id}`,
    source,
    sourceId: chase.id,
    cardName: chase.cardName,
    timestamp: 'completedAt' in chase ? chase.completedAt : chase.createdAt,
    weight: weightFor(source, chase.priority),
    identityKey: identityKeyFor(chase),
    canonicalIdentity: record
      ? {
          source: record.source,
          sourceCardId: record.sourceCardId,
          setName: record.translatedSetName ?? record.setName,
          cardNumber: record.cardNumber,
          language: labelLanguage(record.language)
        }
      : chase.cardImageSourceKind === 'CARD_REFERENCE'
        ? {
            source: chase.cardImageSourceName,
            sourceCardId: chase.cardImageSourceCardId,
            language: traits.languages?.[0]
          }
        : undefined,
    extractedTraits: traits,
    extractionConfidence: confidence
  };
}

function capExactIdentityContribution(evidence: CollectorProfileEvidence[]): CollectorProfileEvidence[] {
  const totals = new Map<string, number>();
  return evidence.map((item) => {
    const current = totals.get(item.identityKey) ?? 0;
    const allowed = Math.max(0, MAX_EXACT_IDENTITY_CONTRIBUTION - current);
    const weight = Math.min(item.weight, allowed);
    totals.set(item.identityKey, current + weight);
    return { ...item, weight: Number(weight.toFixed(3)) };
  }).filter((item) => item.weight > 0);
}

function aggregateTraits(evidence: CollectorProfileEvidence[]): CollectorInterestProfile['traits'] {
  const groups = Object.fromEntries(([
    'subjects', 'languages', 'sets', 'eras', 'formats', 'artists', 'rarities', 'promoTypes', 'releaseTypes', 'releaseEvents', 'gradingPreferences', 'conditionPreferences'
  ] as CollectorProfileTraitGroup[]).map((group) => [group, new Map<string, CollectorInterestTrait>()])) as Record<CollectorProfileTraitGroup, Map<string, CollectorInterestTrait>>;

  for (const item of evidence) {
    for (const [group, values] of Object.entries(item.extractedTraits) as Array<[CollectorProfileTraitGroup, string[] | undefined]>) {
      const groupWeight = group === 'subjects' && (values?.length ?? 0) > 1
        ? Number((item.weight / (values?.length ?? 1)).toFixed(3))
        : item.weight;
      for (const value of values ?? []) {
        const key = traitKey(group, value);
        const existing = groups[group].get(key) ?? {
          key,
          label: value,
          score: 0,
          evidenceCount: 0,
          activeEvidenceCount: 0,
          completedEvidenceCount: 0,
          legacyEvidenceCount: 0,
          confidence: 'LOW' as const,
          evidenceIds: []
        };
        existing.score = Number((existing.score + groupWeight).toFixed(3));
        existing.evidenceCount += 1;
        if (item.source === 'ACTIVE_CHASE') existing.activeEvidenceCount += 1;
        if (item.source === 'COMPLETED_CHASE') existing.completedEvidenceCount += 1;
        if (item.source === 'LEGACY_BOUGHT_OR_SEEN') existing.legacyEvidenceCount += 1;
        existing.evidenceIds.push(item.id);
        existing.confidence = existing.evidenceCount >= 3 || existing.completedEvidenceCount >= 2 ? 'HIGH' : existing.evidenceCount >= 2 || existing.completedEvidenceCount >= 1 ? 'MEDIUM' : 'LOW';
        groups[group].set(key, existing);
      }
    }
  }

  return Object.fromEntries(Object.entries(groups).map(([group, values]) => [
    group,
    [...values.values()].sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.key.localeCompare(b.key))
  ])) as CollectorInterestProfile['traits'];
}

function profileConfidence(distinctCards: number, evidenceCount: number): CollectorInterestProfile['confidence'] {
  const score = Number((0.95 * (1 - Math.exp(-distinctCards / 7))).toFixed(2));
  const tier: CollectorProfileConfidenceTier = distinctCards >= 8 ? 'STRONG' : distinctCards >= 4 ? 'USABLE' : distinctCards >= 2 ? 'EMERGING' : 'SEED';
  return {
    tier,
    score,
    reasons: [
      `${distinctCards} distinct card${distinctCards === 1 ? '' : 's'}`,
      `${evidenceCount} positive evidence event${evidenceCount === 1 ? '' : 's'}`
    ]
  };
}

function budgetFrom(chases: Array<Chase | CompletedChase>): CollectorInterestProfile['budget'] | undefined {
  const values = chases.map((chase) => chase.maxPrice).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
  return { observedTargetCount: values.length, minTarget: values[0]!, medianTarget: Number(median.toFixed(2)), maxTarget: values[values.length - 1]! };
}

function legacyOriginChaseId(chase: Chase): string | undefined {
  const match = /^taste:BOUGHT_OR_SEEN:(.+)$/.exec(chase.id);
  return match?.[1];
}

function retainedLegacyBoughtOrSeen(legacyTasteMemoryChases: Chase[], completedChases: CompletedChase[]): Chase[] {
  const completedIds = new Set(completedChases.map((chase) => chase.id));
  const completedIdentities = new Set(completedChases.map(identityKeyFor));
  const completedNames = new Set(completedChases.map((chase) => normalizeKey(chase.cardName)));
  const byIdentity = new Map<string, Chase>();
  for (const chase of legacyTasteMemoryChases) {
    if (chase.tasteSource !== 'BOUGHT_OR_SEEN') continue;
    const originId = legacyOriginChaseId(chase);
    if (originId && completedIds.has(originId)) continue;
    const identity = identityKeyFor(chase);
    if (completedIdentities.has(identity)) continue;
    if (completedNames.has(normalizeKey(chase.cardName))) continue;
    const existing = byIdentity.get(identity);
    if (!existing || chase.createdAt.localeCompare(existing.createdAt) < 0 || (chase.createdAt === existing.createdAt && chase.id.localeCompare(existing.id) < 0)) {
      byIdentity.set(identity, chase);
    }
  }
  return [...byIdentity.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function buildCollectorInterestProfile(input: BuildCollectorInterestProfileInput): CollectorInterestProfile {
  const legacy = input.includeLegacyBoughtOrSeen
    ? retainedLegacyBoughtOrSeen(input.legacyTasteMemoryChases ?? [], input.completedChases)
    : [];
  const rawEvidence = [
    ...input.activeChases.map((chase) => evidenceFromChase(chase, 'ACTIVE_CHASE')),
    ...input.completedChases.map((chase) => evidenceFromChase(chase, 'COMPLETED_CHASE')),
    ...legacy.map((chase) => evidenceFromChase(chase, 'LEGACY_BOUGHT_OR_SEEN'))
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const evidence = capExactIdentityContribution(rawEvidence);
  const distinctCards = new Set(evidence.map((item) => item.identityKey)).size;
  return {
    version: 1,
    sourceSummary: {
      activeChases: evidence.filter((item) => item.source === 'ACTIVE_CHASE').length,
      completedChases: evidence.filter((item) => item.source === 'COMPLETED_CHASE').length,
      legacyBoughtOrSeen: legacy.length,
      distinctCards
    },
    confidence: profileConfidence(distinctCards, evidence.length),
    traits: aggregateTraits(evidence),
    budget: budgetFrom([...input.activeChases, ...input.completedChases]),
    evidence
  };
}

export function getCollectorInterestProfile(userId: string): CollectorInterestProfile {
  return buildCollectorInterestProfile({
    activeChases: listChases(userId),
    completedChases: listCompletedChases(userId),
    legacyTasteMemoryChases: listUserTasteMemoryChases(userId),
    includeLegacyBoughtOrSeen: true
  });
}
