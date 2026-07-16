import { createHash } from 'node:crypto';
import type { DiscoveryCandidate } from '../commands/discover.js';
import type { Chase } from '../types.js';
import type { SupportedCurrency } from './currency.js';
import type { ScheduledDiscoveryDrop, ScheduledDiscoveryDropItem } from './scheduled-discovery-drops.js';

export type WeeklyDiscoveryRole =
  | 'CORE_MATCH'
  | 'ADJACENT_DISCOVERY'
  | 'CONTROLLED_EXPLORATION';

export type WeeklyDiscoveryGenerationStrategy =
  | 'CORE_AFFINITY'
  | 'ADJACENT_DISCOVERY'
  | 'CONTROLLED_EXPLORATION';

export type WeeklyDiscoveryGenerationReason = {
  code:
    | 'DIRECT_SUBJECT_MATCH'
    | 'EVOLUTION_FAMILY_MATCH'
    | 'ERA_MATCH'
    | 'SET_MATCH'
    | 'LANGUAGE_MATCH'
    | 'PROMO_MATCH'
    | 'FORMAT_MATCH'
    | 'THEME_MATCH'
    | 'NOVELTY_COVERAGE'
    | 'UNDERREPRESENTED_TRAIT'
    | 'MARKET_CONFIDENCE'
    | 'EXPLORATION_EDGE';
  weight: number;
  detail: string;
};

export type CanonicalCardReference = {
  provider: string;
  sourceCardId: string;
  canonicalCardId: string;
  canonicalName: string;
  setId?: string;
  setName: string;
  cardNumber: string;
  language?: 'ENGLISH' | 'JAPANESE';
  imageUrl: string;
  imageSourceKind: 'CARD_REFERENCE';
};

export type DiscoveryCardFeatures = {
  subjects: string[];
  evolutionFamilies: string[];
  artists: string[];
  eras: string[];
  sets: string[];
  setFamilies: string[];
  languages: string[];
  formats: string[];
  rarityTiers: string[];
  artTiers: string[];
  promoTypes: string[];
  releaseTypes: string[];
  aestheticTags: string[];
  sceneTags: string[];
  themeTags: string[];
};

export type CollectorTasteProfile = {
  subjects: Record<string, number>;
  evolutionFamilies: Record<string, number>;
  artists: Record<string, number>;
  eras: Record<string, number>;
  sets: Record<string, number>;
  setFamilies: Record<string, number>;
  languages: Record<string, number>;
  formats: Record<string, number>;
  rarityTiers: Record<string, number>;
  artTiers: Record<string, number>;
  promoTypes: Record<string, number>;
  releaseTypes: Record<string, number>;
  aestheticTags: Record<string, number>;
  sceneTags: Record<string, number>;
  themeTags: Record<string, number>;
  budgetPreferenceCad?: number;
};

export type PersonalRelevanceComponents = {
  subjectAffinity: number;
  familyAffinity: number;
  artistAffinity: number;
  eraAffinity: number;
  setAffinity: number;
  promoAffinity: number;
  languageAffinity: number;
  formatAffinity: number;
  artTierAffinity: number;
  aestheticAffinity: number;
  patternAffinity: number;
  feedbackAffinity: number;
};

export type DiscoveryValueComponents = {
  novelty: number;
  adjacency: number;
  serendipity: number;
  underrepresentedTraitCoverage: number;
};

export type MarketSuitabilityComponents = {
  estimateConfidence: number;
  availabilityConfidence: number;
  valueFloorPass: boolean;
  marketResolved: boolean;
  shoppable: boolean;
};

export type WeeklyDiscoveryScoreComponents = {
  personalRelevance: PersonalRelevanceComponents;
  discoveryValue: DiscoveryValueComponents;
  marketSuitability: MarketSuitabilityComponents;
  baseScore: number;
  slateScore: number;
};

export type WeeklyDiscoveryRankExplanation = {
  strongestSignals: string[];
  noveltyReason: string;
  discoveryRole: WeeklyDiscoveryRole;
  scoreComponents: WeeklyDiscoveryScoreComponents;
};

export type WeeklyDiscoveryCandidateOutcome =
  | 'SELECTED'
  | 'REJECTED_IDENTITY'
  | 'REJECTED_PROVENANCE'
  | 'REJECTED_HISTORY'
  | 'REJECTED_VAULT_PARALLEL'
  | 'REJECTED_VALUE'
  | 'REJECTED_DIVERSITY'
  | 'MARKET_PENDING'
  | 'MARKET_INCOMPLETE_LIMIT'
  | 'LOWER_RANKED'
  | 'ROLE_QUOTA_BACKFILL'
  | 'OTHER_EXPLICIT_REASON';

export type WeeklyDiscoveryPolicies = {
  personalRelevanceWeight: number;
  adjacencyWeight: number;
  noveltyWeight: number;
  confidenceWeight: number;
  sameSubjectPenalty: number;
  sameFamilyPenalty: number;
  sameEraPenalty: number;
  sameFormatPenalty: number;
  sameLanguagePenalty: number;
  sameStrategyPenalty: number;
  underrepresentedTraitBonus: number;
  roleCoverageBonus: number;
  valueFloorCad: number;
  targetRoleCounts: Record<WeeklyDiscoveryRole, number>;
};

export type WeeklyDiscoveryCandidateAnalysis = {
  canonicalReference?: CanonicalCardReference;
  features: DiscoveryCardFeatures;
  generationStrategies: WeeklyDiscoveryGenerationStrategy[];
  generationReasons: WeeklyDiscoveryGenerationReason[];
  discoveryRole: WeeklyDiscoveryRole;
  rankExplanation: WeeklyDiscoveryRankExplanation;
  outcome?: WeeklyDiscoveryCandidateOutcome;
  outcomeReason?: string;
  stableTieBreaker: string;
};

export type WeeklyDiscoveryFinalizationInput = {
  targetPeriod: string;
  frozenTime: string;
  userCurrency: SupportedCurrency;
  exchangeRates: Record<string, number>;
  activeVault: Chase[];
  collectorProfile: CollectorTasteProfile;
  priorShelfHistory: ScheduledDiscoveryDrop[];
  orderedCandidateReserve: DiscoveryCandidate[];
  feedbackPreferences: {
    preferredLanguages?: string[];
    preferredEras?: string[];
    preferredSets?: string[];
    budgetPreferenceCad?: number;
  };
  policies?: Partial<WeeklyDiscoveryPolicies>;
  stableTieBreakerSeed?: string;
};

export type WeeklyDiscoveryStructuralGate = {
  status: 'PASS' | 'FAIL';
  failures: string[];
};

export type WeeklyDiscoveryQualityGate = {
  status: 'PASS' | 'FAIL' | 'UNLABELED';
  notes: string[];
};

export type WeeklyDiscoveryFinalizationResult = {
  rerankedReserve: DiscoveryCandidate[];
  analyzedReserve: DiscoveryCandidate[];
  fingerprint: string;
  roleDistribution: Record<WeeklyDiscoveryRole, number>;
  averagePersonalRelevance: number;
  averageNovelty: number;
  subjectConcentration: number;
  familyConcentration: number;
  structuralGate: WeeklyDiscoveryStructuralGate;
  qualityGate: WeeklyDiscoveryQualityGate;
};

const STOP_WORDS = new Set([
  'and',
  'art',
  'card',
  'cards',
  'collection',
  'edition',
  'english',
  'holo',
  'japanese',
  'pokemon',
  'promo',
  'rare',
  'special',
  'star',
  'the'
]);

const KNOWN_ERA_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'WOTC', pattern: /\b(base set|jungle|fossil|neo|gym heroes|gym challenge|skyridge|aquapolis|expedition)\b/i },
  { label: 'EX', pattern: /\b(ex|deoxys|team magma|hidden legends)\b/i },
  { label: 'SM', pattern: /\b(sun\s*&\s*moon|sm black star|tag team)\b/i },
  { label: 'SWSH', pattern: /\b(sword\s*&\s*shield|swsh|evolving skies|vstar universe)\b/i },
  { label: 'SV', pattern: /\b(scarlet\s*&\s*violet|sv|paldean fates|stellar crown|terastal festival|151)\b/i }
];

const DEFAULT_POLICIES: WeeklyDiscoveryPolicies = {
  personalRelevanceWeight: 0.52,
  adjacencyWeight: 0.18,
  noveltyWeight: 0.16,
  confidenceWeight: 0.14,
  sameSubjectPenalty: 0.34,
  sameFamilyPenalty: 0.18,
  sameEraPenalty: 0.08,
  sameFormatPenalty: 0.08,
  sameLanguagePenalty: 0.05,
  sameStrategyPenalty: 0.06,
  underrepresentedTraitBonus: 0.07,
  roleCoverageBonus: 0.09,
  valueFloorCad: 30,
  targetRoleCounts: {
    CORE_MATCH: 12,
    ADJACENT_DISCOVERY: 5,
    CONTROLLED_EXPLORATION: 3
  }
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleTokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 8);
}

function pushUnique(target: string[], ...values: Array<string | undefined>): void {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || target.includes(trimmed)) continue;
    target.push(trimmed);
  }
}

function requestedLanguage(text: string): 'ENGLISH' | 'JAPANESE' | undefined {
  if (/\bjapanese\b|tcgdex japanese|sv\d+\s+\d+\/\d+|s\d+[ap]?\b/i.test(text)) return 'JAPANESE';
  if (/\benglish\b/.test(text)) return 'ENGLISH';
  return undefined;
}

function detectFormatTokens(text: string): string[] {
  const formats: string[] = [];
  if (/\b(vmax|gx|ex|vstar|sar|sir|ir|ar|alt art|full art)\b/i.test(text)) pushUnique(formats, 'special-art');
  if (/\bpromo|black star|mcdonald'?s|league promo|nintendo promo\b/i.test(text)) pushUnique(formats, 'promo');
  if (/\be-reader|skyridge|aquapolis|expedition\b/i.test(text)) pushUnique(formats, 'e-reader');
  if (/\btrainer gallery|galarian gallery|radiant collection|classic collection\b/i.test(text)) pushUnique(formats, 'gallery');
  return formats;
}

function detectRarityTokens(text: string): string[] {
  const tiers: string[] = [];
  if (/\b(sar|sir|hr|secret rare)\b/i.test(text)) pushUnique(tiers, 'premium');
  if (/\b(ir|ar|illustration rare|art rare)\b/i.test(text)) pushUnique(tiers, 'illustration');
  if (/\bpromo\b/i.test(text)) pushUnique(tiers, 'promo');
  return tiers;
}

function detectPromoTypes(text: string): string[] {
  const promoTypes: string[] = [];
  if (/\bnintendo promo|black star\b/i.test(text)) pushUnique(promoTypes, 'black-star');
  if (/\bmcdonald'?s\b/i.test(text)) pushUnique(promoTypes, 'mcdonalds');
  if (/\bleague promo|staff promo|prerelease\b/i.test(text)) pushUnique(promoTypes, 'event');
  return promoTypes;
}

function detectReleaseTypes(text: string): string[] {
  const releaseTypes: string[] = [];
  if (/\bjapanese\b/i.test(text)) pushUnique(releaseTypes, 'japanese-release');
  if (/\bpromo\b/i.test(text)) pushUnique(releaseTypes, 'promo-release');
  if (/\blimited|exclusive|anniversary|collection\b/i.test(text)) pushUnique(releaseTypes, 'special-release');
  return releaseTypes;
}

function detectThemeTags(text: string): string[] {
  const tags: string[] = [];
  if (/\bdarkrai|umbreon|mewtwo|mew|gardevoir|pikachu|squirtle|blastoise|eevee\b/i.test(text)) {
    pushUnique(tags, 'character-driven');
  }
  if (/\bpromo|exclusive|festival|universe|collection\b/i.test(text)) pushUnique(tags, 'collector-release');
  if (/\bskyridge|aquapolis|expedition|gym|neo\b/i.test(text)) pushUnique(tags, 'vintage');
  if (/\bpaldean fates|terastal festival|stellar crown|destined rivals\b/i.test(text)) pushUnique(tags, 'modern');
  return tags;
}

function setNameFromCandidate(candidate: DiscoveryCandidate): string | undefined {
  return candidate.suggestion.referenceSourceName
    ?.replace(/^Pokemon TCG\s*/i, '')
    .replace(/^TCGdex Japanese\s*/i, '')
    .replace(/[()]/g, ' ')
    .trim() || undefined;
}

function numberFromCandidate(candidate: DiscoveryCandidate): string | undefined {
  const sourceCardId = candidate.suggestion.referenceSourceCardId?.trim() ?? candidate.image?.sourceCardId?.trim();
  if (!sourceCardId || !sourceCardId.includes('-')) return undefined;
  return sourceCardId.slice(sourceCardId.indexOf('-') + 1);
}

function providerFromCandidate(candidate: DiscoveryCandidate): string | undefined {
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName ?? '';
  if (/^Pokemon TCG/i.test(sourceName)) return 'PokemonTCG';
  if (/^TCGdex Japanese/i.test(sourceName)) return 'TCGdex';
  return undefined;
}

function buildCanonicalReference(candidate: DiscoveryCandidate): CanonicalCardReference | undefined {
  const image = candidate.image;
  const sourceCardId = candidate.suggestion.referenceSourceCardId?.trim() ?? image?.sourceCardId?.trim();
  const imageUrl = image?.sourceKind === 'CARD_REFERENCE' ? image.url : undefined;
  const provider = providerFromCandidate(candidate);
  const setName = setNameFromCandidate(candidate);
  const cardNumber = numberFromCandidate(candidate);
  if (!provider || !sourceCardId || !imageUrl || !setName || !cardNumber) return undefined;
  return {
    provider,
    sourceCardId,
    canonicalCardId: sourceCardId,
    canonicalName: candidate.suggestion.name,
    setId: sourceCardId.split('-')[0],
    setName,
    cardNumber,
    language: requestedLanguage(candidate.suggestion.name),
    imageUrl,
    imageSourceKind: 'CARD_REFERENCE'
  };
}

export function extractDiscoveryCardFeatures(candidate: DiscoveryCandidate): DiscoveryCardFeatures {
  const text = [
    candidate.suggestion.name,
    candidate.suggestion.lane,
    candidate.suggestion.laneWhy,
    candidate.suggestion.why,
    candidate.suggestion.referenceSourceName,
    ...(candidate.suggestion.sourceTasteTokens ?? [])
  ].filter(Boolean).join(' ');
  const tokens = titleTokens(candidate.suggestion.name);
  const subjects: string[] = [];
  pushUnique(subjects, tokens[0], tokens[1] && /^[A-Z]/.test(tokens[1]) ? tokens[1] : undefined);
  const sets: string[] = [];
  pushUnique(sets, setNameFromCandidate(candidate));
  const eras: string[] = [];
  for (const rule of KNOWN_ERA_RULES) {
    if (rule.pattern.test(text)) pushUnique(eras, rule.label);
  }
  const languages: string[] = [];
  pushUnique(languages, requestedLanguage(text));
  const formats = detectFormatTokens(text);
  const rarityTiers = detectRarityTokens(text);
  const promoTypes = detectPromoTypes(text);
  const releaseTypes = detectReleaseTypes(text);
  const themeTags = detectThemeTags(text);
  const setFamilies = sets.map((setName) => normalize(setName).split(' ').slice(0, 2).join(' ')).filter(Boolean);
  return {
    subjects,
    evolutionFamilies: [...subjects],
    artists: [],
    eras,
    sets,
    setFamilies,
    languages,
    formats,
    rarityTiers,
    artTiers: rarityTiers.includes('illustration') ? ['illustration'] : rarityTiers.includes('premium') ? ['premium'] : [],
    promoTypes,
    releaseTypes,
    aestheticTags: [],
    sceneTags: [],
    themeTags
  };
}

function addWeightedTokens(target: Record<string, number>, values: string[], weight: number): void {
  for (const value of values) {
    if (!value) continue;
    target[value] = (target[value] ?? 0) + weight;
  }
}

export function buildCollectorTasteProfile(
  chases: Chase[],
  feedbackPreferences: WeeklyDiscoveryFinalizationInput['feedbackPreferences'] = {}
): CollectorTasteProfile {
  const profile: CollectorTasteProfile = {
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
    budgetPreferenceCad: feedbackPreferences.budgetPreferenceCad
  };

  for (const [index, chase] of chases.entries()) {
    const freshnessWeight = Math.max(1, chases.length - index);
    const text = [chase.cardName, chase.targetNote ?? ''].join(' ');
    const candidateLike = {
      suggestion: {
        name: chase.cardName,
        lane: 'vault',
        laneWhy: 'vault',
        why: 'vault',
        nearby: [],
        referenceSourceName: chase.targetNote ?? undefined
      }
    } as DiscoveryCandidate;
    const features = extractDiscoveryCardFeatures(candidateLike);
    addWeightedTokens(profile.subjects, features.subjects, freshnessWeight * 2);
    addWeightedTokens(profile.evolutionFamilies, features.evolutionFamilies, freshnessWeight * 1.5);
    addWeightedTokens(profile.eras, features.eras, freshnessWeight * 1.2);
    addWeightedTokens(profile.sets, features.sets, freshnessWeight);
    addWeightedTokens(profile.setFamilies, features.setFamilies, freshnessWeight);
    addWeightedTokens(profile.languages, features.languages, freshnessWeight);
    addWeightedTokens(profile.formats, features.formats, freshnessWeight);
    addWeightedTokens(profile.rarityTiers, features.rarityTiers, freshnessWeight);
    addWeightedTokens(profile.artTiers, features.artTiers, freshnessWeight);
    addWeightedTokens(profile.promoTypes, features.promoTypes, freshnessWeight);
    addWeightedTokens(profile.releaseTypes, features.releaseTypes, freshnessWeight);
    addWeightedTokens(profile.themeTags, features.themeTags, freshnessWeight * 0.8);
    const explicitLanguage = requestedLanguage(text);
    if (explicitLanguage) profile.languages[explicitLanguage] = (profile.languages[explicitLanguage] ?? 0) + freshnessWeight * 1.5;
  }

  addWeightedTokens(profile.languages, feedbackPreferences.preferredLanguages ?? [], 3);
  addWeightedTokens(profile.eras, feedbackPreferences.preferredEras ?? [], 3);
  addWeightedTokens(profile.sets, feedbackPreferences.preferredSets ?? [], 2);
  return profile;
}

function overlapScore(values: string[], weights: Record<string, number>, divisor = 12): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + (weights[value] ?? 0), 0);
  return Math.max(0, Math.min(1, total / divisor));
}

function computePersonalRelevance(features: DiscoveryCardFeatures, profile: CollectorTasteProfile): PersonalRelevanceComponents {
  return {
    subjectAffinity: overlapScore(features.subjects, profile.subjects, 10),
    familyAffinity: overlapScore(features.evolutionFamilies, profile.evolutionFamilies, 10),
    artistAffinity: overlapScore(features.artists, profile.artists, 10),
    eraAffinity: overlapScore(features.eras, profile.eras, 8),
    setAffinity: overlapScore(features.sets, profile.sets, 8),
    promoAffinity: overlapScore(features.promoTypes, profile.promoTypes, 8),
    languageAffinity: overlapScore(features.languages, profile.languages, 5),
    formatAffinity: overlapScore(features.formats, profile.formats, 8),
    artTierAffinity: overlapScore(features.artTiers, profile.artTiers, 8),
    aestheticAffinity: overlapScore(features.themeTags, profile.themeTags, 8),
    patternAffinity: overlapScore(features.releaseTypes, profile.releaseTypes, 8),
    feedbackAffinity: 0
  };
}

function computeDiscoveryValue(features: DiscoveryCardFeatures, profile: CollectorTasteProfile): DiscoveryValueComponents {
  const knownSubjects = Object.keys(profile.subjects);
  const directSubjectMatch = features.subjects.some((subject) => knownSubjects.includes(subject));
  const underrepresentedTraitCoverage = features.eras.some((era) => !(era in profile.eras)) || features.formats.some((format) => !(format in profile.formats)) ? 1 : 0.2;
  return {
    novelty: directSubjectMatch ? 0.25 : 0.8,
    adjacency: directSubjectMatch ? 0.35 : (features.eras.some((era) => era in profile.eras) || features.formats.some((format) => format in profile.formats) ? 0.75 : 0.45),
    serendipity: directSubjectMatch ? 0.2 : 0.7,
    underrepresentedTraitCoverage
  };
}

function computeMarketSuitability(candidate: DiscoveryCandidate, policies: WeeklyDiscoveryPolicies): MarketSuitabilityComponents {
  const value = candidate.typicalRawSoldTotal ?? candidate.typicalRawAskingTotal;
  const sampleSize = candidate.soldSampleSize ?? candidate.marketSampleSize ?? 0;
  const marketResolved = sampleSize >= 3;
  const valueFloorPass = value === undefined ? true : value >= policies.valueFloorCad;
  return {
    estimateConfidence: marketResolved ? 1 : sampleSize > 0 ? 0.5 : 0.2,
    availabilityConfidence: candidate.listing?.url ? 1 : marketResolved ? 0.75 : 0.4,
    valueFloorPass,
    marketResolved,
    shoppable: !['ERROR', 'TIMEOUT', 'RATE_LIMITED'].includes(candidate.sourceStatus ?? '') && !!candidate.listing?.url
  };
}

function strongestSignals(components: PersonalRelevanceComponents, value: DiscoveryValueComponents): string[] {
  const signals: Array<{ label: string; value: number }> = [
    { label: 'subject match', value: components.subjectAffinity },
    { label: 'family match', value: components.familyAffinity },
    { label: 'era match', value: components.eraAffinity },
    { label: 'set match', value: components.setAffinity },
    { label: 'language match', value: components.languageAffinity },
    { label: 'format match', value: components.formatAffinity },
    { label: 'adjacent trait', value: value.adjacency },
    { label: 'novelty', value: value.novelty }
  ];
  return signals
    .sort((left, right) => right.value - left.value)
    .filter((entry) => entry.value > 0.2)
    .slice(0, 3)
    .map((entry) => entry.label);
}

function determineRole(components: PersonalRelevanceComponents, value: DiscoveryValueComponents): WeeklyDiscoveryRole {
  if (components.subjectAffinity >= 0.45 || components.familyAffinity >= 0.45 || components.setAffinity >= 0.45) return 'CORE_MATCH';
  if (value.adjacency >= 0.6 || value.underrepresentedTraitCoverage >= 0.7) return 'ADJACENT_DISCOVERY';
  return 'CONTROLLED_EXPLORATION';
}

function determineGenerationStrategies(
  role: WeeklyDiscoveryRole,
  components: PersonalRelevanceComponents,
  value: DiscoveryValueComponents,
  features: DiscoveryCardFeatures
): { strategies: WeeklyDiscoveryGenerationStrategy[]; reasons: WeeklyDiscoveryGenerationReason[] } {
  const strategies: WeeklyDiscoveryGenerationStrategy[] = [];
  const reasons: WeeklyDiscoveryGenerationReason[] = [];
  if (role === 'CORE_MATCH') {
    strategies.push('CORE_AFFINITY');
    if (components.subjectAffinity > 0.35) reasons.push({ code: 'DIRECT_SUBJECT_MATCH', weight: components.subjectAffinity, detail: 'Matches recurring Vault subject signals' });
    if (components.familyAffinity > 0.3) reasons.push({ code: 'EVOLUTION_FAMILY_MATCH', weight: components.familyAffinity, detail: 'Connects to a favored evolution family' });
  }
  if (role === 'ADJACENT_DISCOVERY') {
    strategies.push('ADJACENT_DISCOVERY');
    reasons.push({ code: 'THEME_MATCH', weight: value.adjacency, detail: 'Connected through adjacent set, era, or format traits' });
    if (features.eras.length > 0) reasons.push({ code: 'ERA_MATCH', weight: components.eraAffinity, detail: `Touches preferred era traits: ${features.eras.join(', ')}` });
  }
  if (role === 'CONTROLLED_EXPLORATION') {
    strategies.push('CONTROLLED_EXPLORATION');
    reasons.push({ code: 'EXPLORATION_EDGE', weight: value.serendipity, detail: 'Extends the profile just beyond the strongest known tastes' });
  }
  if (components.languageAffinity > 0.2) reasons.push({ code: 'LANGUAGE_MATCH', weight: components.languageAffinity, detail: 'Aligns with preferred card language' });
  if (components.promoAffinity > 0.2) reasons.push({ code: 'PROMO_MATCH', weight: components.promoAffinity, detail: 'Matches promo/release preferences' });
  if (components.formatAffinity > 0.2) reasons.push({ code: 'FORMAT_MATCH', weight: components.formatAffinity, detail: 'Matches preferred card formats' });
  return { strategies: strategies.length > 0 ? strategies : ['CONTROLLED_EXPLORATION'], reasons };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function baseScore(components: PersonalRelevanceComponents, value: DiscoveryValueComponents, market: MarketSuitabilityComponents, policies: WeeklyDiscoveryPolicies): number {
  const personal = average(Object.values(components));
  const novelty = average(Object.values(value));
  const confidence = average([market.estimateConfidence, market.availabilityConfidence, market.marketResolved ? 1 : 0.35]);
  return Number((
    policies.personalRelevanceWeight * personal
    + policies.adjacencyWeight * value.adjacency
    + policies.noveltyWeight * novelty
    + policies.confidenceWeight * confidence
  ).toFixed(6));
}

function candidateAnalysis(
  candidate: DiscoveryCandidate,
  profile: CollectorTasteProfile,
  policies: WeeklyDiscoveryPolicies,
  stableSeed = ''
): WeeklyDiscoveryCandidateAnalysis {
  const features = extractDiscoveryCardFeatures(candidate);
  const personal = computePersonalRelevance(features, profile);
  const discoveryValue = computeDiscoveryValue(features, profile);
  const market = computeMarketSuitability(candidate, policies);
  const role = determineRole(personal, discoveryValue);
  const strategy = determineGenerationStrategies(role, personal, discoveryValue, features);
  const base = baseScore(personal, discoveryValue, market, policies);
  const strongest = strongestSignals(personal, discoveryValue);
  const stableTieBreaker = createHash('sha256')
    .update(JSON.stringify([stableSeed, candidate.suggestion.referenceSourceCardId ?? '', candidate.suggestion.name, candidate.selectionIndex ?? -1]))
    .digest('hex');
  return {
    canonicalReference: buildCanonicalReference(candidate),
    features,
    generationStrategies: strategy.strategies,
    generationReasons: strategy.reasons,
    discoveryRole: role,
    rankExplanation: {
      strongestSignals: strongest,
      noveltyReason: role === 'CORE_MATCH' ? 'High-confidence fit with controlled freshness' : role === 'ADJACENT_DISCOVERY' ? 'Trait-adjacent discovery beyond the obvious subject match' : 'Defensible exploration outside the strongest known lane',
      discoveryRole: role,
      scoreComponents: {
        personalRelevance: personal,
        discoveryValue,
        marketSuitability: market,
        baseScore: base,
        slateScore: base
      }
    },
    stableTieBreaker
  };
}

function overlapCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function similarityPenalty(
  candidate: WeeklyDiscoveryCandidateAnalysis,
  selected: WeeklyDiscoveryCandidateAnalysis[],
  policies: WeeklyDiscoveryPolicies
): number {
  let penalty = 0;
  for (const prior of selected) {
    penalty += overlapCount(candidate.features.subjects, prior.features.subjects) * policies.sameSubjectPenalty;
    penalty += overlapCount(candidate.features.evolutionFamilies, prior.features.evolutionFamilies) * policies.sameFamilyPenalty;
    penalty += overlapCount(candidate.features.eras, prior.features.eras) * policies.sameEraPenalty;
    penalty += overlapCount(candidate.features.formats, prior.features.formats) * policies.sameFormatPenalty;
    penalty += overlapCount(candidate.features.languages, prior.features.languages) * policies.sameLanguagePenalty;
    penalty += overlapCount(candidate.generationStrategies, prior.generationStrategies) * policies.sameStrategyPenalty;
  }
  return penalty;
}

function roleCoverageBonus(
  role: WeeklyDiscoveryRole,
  selected: WeeklyDiscoveryCandidateAnalysis[],
  policies: WeeklyDiscoveryPolicies
): number {
  const count = selected.filter((entry) => entry.discoveryRole === role).length;
  return count < policies.targetRoleCounts[role] ? policies.roleCoverageBonus : 0;
}

function underrepresentedTraitBonus(candidate: WeeklyDiscoveryCandidateAnalysis, selected: WeeklyDiscoveryCandidateAnalysis[], policies: WeeklyDiscoveryPolicies): number {
  const seenEras = new Set(selected.flatMap((entry) => entry.features.eras));
  const seenFormats = new Set(selected.flatMap((entry) => entry.features.formats));
  const introducesFreshEra = candidate.features.eras.some((era) => !seenEras.has(era));
  const introducesFreshFormat = candidate.features.formats.some((format) => !seenFormats.has(format));
  return introducesFreshEra || introducesFreshFormat ? policies.underrepresentedTraitBonus : 0;
}

export function analyzeWeeklyDiscoveryCandidateReserve(
  reserve: DiscoveryCandidate[],
  profile: CollectorTasteProfile,
  policies: Partial<WeeklyDiscoveryPolicies> = {},
  stableTieBreakerSeed = ''
): DiscoveryCandidate[] {
  const mergedPolicies = { ...DEFAULT_POLICIES, ...policies };
  return reserve.map((candidate) => {
    const analysis = candidateAnalysis(candidate, profile, mergedPolicies, stableTieBreakerSeed);
    return {
      ...candidate,
      suggestion: {
        ...candidate.suggestion,
        generationStrategies: analysis.generationStrategies,
        generationReasons: analysis.generationReasons,
        discoveryRole: analysis.discoveryRole,
        canonicalReference: analysis.canonicalReference,
        rankExplanation: analysis.rankExplanation
      },
      weeklyDiscovery: analysis
    };
  });
}

export function rerankWeeklyDiscoveryReserve(
  reserve: DiscoveryCandidate[],
  policies: Partial<WeeklyDiscoveryPolicies> = {}
): DiscoveryCandidate[] {
  const mergedPolicies = { ...DEFAULT_POLICIES, ...policies };
  const remaining = reserve.map((candidate) => candidate);
  const selected: DiscoveryCandidate[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [index, candidate] of remaining.entries()) {
      const analysis = candidate.weeklyDiscovery;
      if (!analysis) continue;
      const selectedAnalyses = selected.map((item) => item.weeklyDiscovery!).filter(Boolean);
      const base = analysis.rankExplanation.scoreComponents.baseScore;
      const slate = base
        - similarityPenalty(analysis, selectedAnalyses, mergedPolicies)
        + roleCoverageBonus(analysis.discoveryRole, selectedAnalyses, mergedPolicies)
        + underrepresentedTraitBonus(analysis, selectedAnalyses, mergedPolicies);
      if (slate > bestScore || (slate === bestScore && analysis.stableTieBreaker < (remaining[bestIndex]?.weeklyDiscovery?.stableTieBreaker ?? 'zzz'))) {
        bestIndex = index;
        bestScore = slate;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (!next?.weeklyDiscovery) continue;
    next.weeklyDiscovery.rankExplanation.scoreComponents.slateScore = Number(bestScore.toFixed(6));
    selected.push(next);
  }
  return selected;
}

function hhi(groups: string[]): number {
  if (groups.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
  const total = groups.length;
  return Number([...counts.values()].reduce((sum, value) => sum + (value / total) ** 2, 0).toFixed(4));
}

function marketplaceUrlLabelledAsReference(items: ScheduledDiscoveryDropItem[]): boolean {
  return items.some((item) => item.imageSourceKind === 'CARD_REFERENCE' && /ebay|marketplace|auction|listing|seller/i.test(item.imageUrl ?? ''));
}

export function weeklyDiscoveryStructuralGate(
  items: ScheduledDiscoveryDropItem[],
  expectedSize: number,
  marketResolvedMinimum: number
): WeeklyDiscoveryStructuralGate {
  const failures: string[] = [];
  if (items.length !== expectedSize) failures.push(`expected ${expectedSize} items, found ${items.length}`);
  if (items.filter((item) => item.market.status === 'READY').length < marketResolvedMinimum) failures.push(`market resolved below ${marketResolvedMinimum}`);
  if (items.filter((item) => item.market.status !== 'READY').length > 2) failures.push('more than 2 market-incomplete items');
  if (items.some((item) => !item.suggestion.referenceSourceCardId?.trim())) failures.push('selected card missing canonical id');
  if (new Set(items.map((item) => item.suggestion.referenceSourceCardId)).size !== items.length) failures.push('duplicate canonical ids');
  if (items.some((item) => item.imageSourceKind !== 'CARD_REFERENCE')) failures.push('non-reference image in selected shelf');
  if (marketplaceUrlLabelledAsReference(items)) failures.push('marketplace url labelled as CARD_REFERENCE');
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

export function finalizeWeeklyDiscoveryAnalytics(
  input: WeeklyDiscoveryFinalizationInput,
  rerankedReserve: DiscoveryCandidate[],
  selectedItems: ScheduledDiscoveryDropItem[]
): WeeklyDiscoveryFinalizationResult {
  const mergedPolicies = { ...DEFAULT_POLICIES, ...input.policies };
  const selectedAnalyses = rerankedReserve
    .filter((candidate) => selectedItems.some((item) => item.suggestion.referenceSourceCardId === candidate.suggestion.referenceSourceCardId))
    .map((candidate) => candidate.weeklyDiscovery)
    .filter((value): value is WeeklyDiscoveryCandidateAnalysis => !!value);
  const roleDistribution: Record<WeeklyDiscoveryRole, number> = {
    CORE_MATCH: 0,
    ADJACENT_DISCOVERY: 0,
    CONTROLLED_EXPLORATION: 0
  };
  for (const analysis of selectedAnalyses) roleDistribution[analysis.discoveryRole] += 1;
  const averagePersonalRelevance = Number(average(selectedAnalyses.map((analysis) => average(Object.values(analysis.rankExplanation.scoreComponents.personalRelevance)))).toFixed(4));
  const averageNovelty = Number(average(selectedAnalyses.map((analysis) => average(Object.values(analysis.rankExplanation.scoreComponents.discoveryValue)))).toFixed(4));
  const subjectConcentration = hhi(selectedAnalyses.flatMap((analysis) => analysis.features.subjects));
  const familyConcentration = hhi(selectedAnalyses.flatMap((analysis) => analysis.features.evolutionFamilies));
  const structuralGate = weeklyDiscoveryStructuralGate(selectedItems, mergedPolicies.targetRoleCounts.CORE_MATCH + mergedPolicies.targetRoleCounts.ADJACENT_DISCOVERY + mergedPolicies.targetRoleCounts.CONTROLLED_EXPLORATION, 18);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      targetPeriod: input.targetPeriod,
      orderedIds: selectedItems.map((item) => item.suggestion.referenceSourceCardId),
      reserveOrder: rerankedReserve.map((candidate) => candidate.suggestion.referenceSourceCardId ?? candidate.suggestion.name),
      roleDistribution,
      averagePersonalRelevance,
      averageNovelty
    }))
    .digest('hex');
  return {
    rerankedReserve,
    analyzedReserve: rerankedReserve,
    fingerprint,
    roleDistribution,
    averagePersonalRelevance,
    averageNovelty,
    subjectConcentration,
    familyConcentration,
    structuralGate,
    qualityGate: {
      status: 'UNLABELED',
      notes: ['No human judgments attached']
    }
  };
}

