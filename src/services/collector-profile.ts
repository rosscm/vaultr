import type { Chase, CompletedChase } from '../types.js';
import { getCardCatalogRecordBySourceCardId } from './card-catalog-db.js';
import { normalizeCatalogText } from './card-catalog/normalize.js';
import type { StoredCardCatalogRecord } from './card-catalog/types.js';
import { listChases, listCompletedChases, listUserTasteMemoryChases } from './chase-store.js';

export type CollectorProfileEvidenceSource = 'ACTIVE_CHASE' | 'COMPLETED_CHASE' | 'LEGACY_BOUGHT_OR_SEEN';
export type CollectorProfileConfidenceTier = 'SEED' | 'EMERGING' | 'USABLE' | 'STRONG';
export type CollectorProfileTraitConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type CollectorProfileTraitGroup =
  | 'subjects'
  | 'languages'
  | 'sets'
  | 'eras'
  | 'formats'
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

const KNOWN_SUBJECTS = [
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
  [/\bxy\s+black\s+star\s+promos\b/i, 'XY Black Star Promos'],
  [/\b151\b/i, '151']
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
  if (!values.some((existing) => normalizeKey(existing) === normalizeKey(cleaned))) values.push(cleaned);
  traits[group] = values;
}

function subjectsFromName(name: string): string[] {
  const normalizedName = normalizeKey(name);
  const subjects = KNOWN_SUBJECTS.filter((subject) => new RegExp(`\\b${normalizeKey(subject)}\\b`, 'i').test(normalizedName));
  if (subjects.length > 0) return subjects;
  const beforeContext = name.split(/\s+(?:ex|gx|vmax|vstar|v|lv\.?x|sar|sir|ir|ar|promo|japanese|english|\d)/i)[0]?.trim();
  if (!beforeContext) return [];
  const cleaned = beforeContext.replace(/^mega\s+/i, '').trim();
  return cleaned && cleaned.split(/\s+/).length <= 2 ? [cleaned] : [];
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
  if (/\bpaldean fates|terastal festival|mega symphonia|151\b/.test(normalized)) return 'SV';
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
  for (const [pattern, label] of [
    [/\blv\.?\s*x\b/i, 'LV.X'],
    [/\bvmax\b/i, 'VMAX'],
    [/\bvstar\b/i, 'VSTAR'],
    [/\btag\s*team\b|&.*&.*-gx\b/i, 'TAG_TEAM'],
    [/\bgx\b/i, 'GX'],
    [/\bex\b/i, 'ex'],
    [/\bv\b/i, 'V'],
    [/\bsar\b/i, 'SAR'],
    [/\bsir\b/i, 'SIR'],
    [/\bir\b/i, 'IR'],
    [/\bar\b/i, 'AR']
  ] as Array<[RegExp, string]>) {
    if (pattern.test(name)) addTrait(traits, pattern.source.includes('sar') || pattern.source.includes('sir') || pattern.source === '\\bir\\b' || pattern.source === '\\bar\\b' ? 'rarities' : 'formats', label);
  }
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
    'subjects', 'languages', 'sets', 'eras', 'formats', 'rarities', 'promoTypes', 'releaseTypes', 'releaseEvents', 'gradingPreferences', 'conditionPreferences'
  ] as CollectorProfileTraitGroup[]).map((group) => [group, new Map<string, CollectorInterestTrait>()])) as Record<CollectorProfileTraitGroup, Map<string, CollectorInterestTrait>>;

  for (const item of evidence) {
    for (const [group, values] of Object.entries(item.extractedTraits) as Array<[CollectorProfileTraitGroup, string[] | undefined]>) {
      for (const value of values ?? []) {
        const key = normalizeKey(value);
        const existing = groups[group].get(key) ?? {
          key,
          label: value,
          score: 0,
          evidenceCount: 0,
          activeEvidenceCount: 0,
          completedEvidenceCount: 0,
          confidence: 'LOW' as const,
          evidenceIds: []
        };
        existing.score = Number((existing.score + item.weight).toFixed(3));
        existing.evidenceCount += 1;
        if (item.source === 'ACTIVE_CHASE') existing.activeEvidenceCount += 1;
        if (item.source === 'COMPLETED_CHASE') existing.completedEvidenceCount += 1;
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
  const score = Math.min(1, Number(((distinctCards * 0.14) + (Math.min(evidenceCount, 12) * 0.025)).toFixed(2)));
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

export function buildCollectorInterestProfile(input: BuildCollectorInterestProfileInput): CollectorInterestProfile {
  const completedIdentityKeys = new Set(input.completedChases.map(identityKeyFor));
  const legacy = input.includeLegacyBoughtOrSeen
    ? (input.legacyTasteMemoryChases ?? [])
        .filter((chase) => chase.tasteSource === 'BOUGHT_OR_SEEN')
        .filter((chase) => !completedIdentityKeys.has(identityKeyFor(chase)))
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
      activeChases: input.activeChases.length,
      completedChases: input.completedChases.length,
      legacyBoughtOrSeen: legacy.length,
      distinctCards
    },
    confidence: profileConfidence(distinctCards, evidence.length),
    traits: aggregateTraits(evidence),
    budget: budgetFrom([...input.activeChases, ...input.completedChases, ...legacy]),
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
