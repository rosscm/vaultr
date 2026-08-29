import type { DiscoveryCandidate } from '../commands/discover.js';
import { JAPANESE_SUBJECT_ALIASES } from './collector-card-aliases.js';
import { KNOWN_COLLECTOR_SUBJECTS, type CollectorInterestProfile, type CollectorInterestTrait, type CollectorProfileTraitGroup } from './collector-profile.js';
import {
  analyzeWeeklyDiscoveryCandidateReserveWithFeatures,
  type CollectorTasteProfile,
  type DiscoveryCardFeatures,
  type PersonalRelevanceComponents,
  type WeeklyDiscoveryFinalizationInput,
  type WeeklyDiscoveryPolicies,
  type WeeklyDiscoveryScoringStrategy
} from './weekly-discovery-ranking.js';

const EMPTY_PROFILE_GROUPS = {
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
  themeTags: {}
} satisfies Omit<CollectorTasteProfile, 'budgetPreferenceCad'>;

const RANKER_MAX_WEIGHTS: Partial<Record<CollectorProfileTraitGroup, number>> = {
  subjects: 8,
  languages: 4,
  sets: 5,
  eras: 4,
  formats: 5,
  rarities: 4,
  promoTypes: 4,
  releaseTypes: 4,
  releaseEvents: 4
};

const ERA_TRANSLATIONS: Record<string, string | undefined> = {
  SV: 'SV',
  SM: 'SM',
  XY: 'XY',
  BW: undefined,
  'WOTC e-Reader': 'WOTC'
};

const RARITY_TIER_TRANSLATIONS: Record<string, string | undefined> = {
  SAR: 'premium',
  SIR: 'premium',
  HR: 'premium',
  'Secret Rare': 'premium',
  IR: 'illustration',
  AR: 'illustration',
  'Illustration Rare': 'illustration',
  'Art Rare': 'illustration'
};

const PROMO_TRANSLATIONS: Record<string, string | undefined> = {
  PROMO: undefined,
  'XY Black Star Promos': 'black-star',
  'SM Black Star Promos': 'black-star',
  'Black Star Promos': 'black-star',
  MCDONALDS: 'mcdonalds',
  "McDonald's": 'mcdonalds',
  COROCORO: 'corocoro'
};

const RELEASE_TRANSLATIONS: Record<string, string | undefined> = {
  PROMO: 'promo-release',
  JAPANESE: 'japanese-release',
  MCDONALDS: 'special-release',
  COROCORO: 'special-release'
};

function emptyCollectorTasteProfile(feedbackPreferences: WeeklyDiscoveryFinalizationInput['feedbackPreferences'] = {}): CollectorTasteProfile {
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
    budgetPreferenceCad: feedbackPreferences.budgetPreferenceCad
  };
}

export function rankerSetFamily(setName: string): string {
  return setName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
}

function addWeighted(target: Record<string, number>, key: string | undefined, weight: number): void {
  if (!key) return;
  target[key] = Number(((target[key] ?? 0) + weight).toFixed(3));
}

function scaleTraitsForRanker(
  traits: CollectorInterestTrait[],
  maxWeight: number,
  translate: (trait: CollectorInterestTrait) => string | undefined = (trait) => trait.label
): Record<string, number> {
  const strongest = Math.max(...traits.map((trait) => trait.score), 0);
  if (strongest <= 0) return {};
  const scaled: Record<string, number> = {};
  for (const trait of [...traits].sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.key.localeCompare(b.key))) {
    addWeighted(scaled, translate(trait), Math.max(0.5, (trait.score / strongest) * maxWeight));
  }
  return scaled;
}

function mergeScaled(target: Record<string, number>, values: Record<string, number>): void {
  for (const [key, weight] of Object.entries(values)) addWeighted(target, key, weight);
}

export function collectorInterestProfileToTasteProfile(
  profile: CollectorInterestProfile,
  feedbackPreferences: WeeklyDiscoveryFinalizationInput['feedbackPreferences'] = {}
): CollectorTasteProfile {
  const rankerProfile = emptyCollectorTasteProfile(feedbackPreferences);
  mergeScaled(rankerProfile.subjects, scaleTraitsForRanker(profile.traits.subjects, RANKER_MAX_WEIGHTS.subjects!));
  mergeScaled(rankerProfile.languages, scaleTraitsForRanker(profile.traits.languages, RANKER_MAX_WEIGHTS.languages!));
  mergeScaled(rankerProfile.sets, scaleTraitsForRanker(profile.traits.sets, RANKER_MAX_WEIGHTS.sets!));
  mergeScaled(rankerProfile.eras, scaleTraitsForRanker(profile.traits.eras, RANKER_MAX_WEIGHTS.eras!, (trait) => ERA_TRANSLATIONS[trait.label]));
  mergeScaled(rankerProfile.formats, scaleTraitsForRanker(profile.traits.formats, RANKER_MAX_WEIGHTS.formats!));
  mergeScaled(rankerProfile.rarityTiers, scaleTraitsForRanker(profile.traits.rarities, RANKER_MAX_WEIGHTS.rarities!, (trait) => RARITY_TIER_TRANSLATIONS[trait.label]));
  mergeScaled(rankerProfile.artTiers, scaleTraitsForRanker(profile.traits.rarities, RANKER_MAX_WEIGHTS.rarities!, (trait) => RARITY_TIER_TRANSLATIONS[trait.label]));
  mergeScaled(rankerProfile.promoTypes, scaleTraitsForRanker([...profile.traits.promoTypes, ...profile.traits.releaseEvents, ...profile.traits.sets], RANKER_MAX_WEIGHTS.promoTypes!, (trait) => PROMO_TRANSLATIONS[trait.label]));
  mergeScaled(rankerProfile.releaseTypes, scaleTraitsForRanker([...profile.traits.promoTypes, ...profile.traits.releaseTypes, ...profile.traits.releaseEvents, ...profile.traits.languages], RANKER_MAX_WEIGHTS.releaseTypes!, (trait) => RELEASE_TRANSLATIONS[trait.label]));
  for (const setName of Object.keys(rankerProfile.sets)) addWeighted(rankerProfile.setFamilies, rankerSetFamily(setName), Math.min(rankerProfile.sets[setName] ?? 0, RANKER_MAX_WEIGHTS.sets!));
  for (const language of feedbackPreferences.preferredLanguages ?? []) addWeighted(rankerProfile.languages, language, 3);
  for (const era of feedbackPreferences.preferredEras ?? []) addWeighted(rankerProfile.eras, era, 3);
  for (const setName of feedbackPreferences.preferredSets ?? []) {
    addWeighted(rankerProfile.sets, setName, 2);
    addWeighted(rankerProfile.setFamilies, rankerSetFamily(setName), 2);
  }
  return rankerProfile;
}

function addUnique(target: string[], ...values: Array<string | undefined>): void {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !target.includes(trimmed)) target.push(trimmed);
  }
}

function normalizedAscii(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function shadowCardNameText(candidate: DiscoveryCandidate): string {
  return [
    candidate.weeklyDiscovery?.canonicalReference?.canonicalName,
    candidate.suggestion.canonicalReference?.canonicalName,
    candidate.suggestion.name
  ].filter(Boolean).join(' ');
}

function trustedSourceName(candidate: DiscoveryCandidate): string | undefined {
  return candidate.weeklyDiscovery?.canonicalReference?.provider
    ?? candidate.suggestion.canonicalReference?.provider
    ?? candidate.suggestion.referenceSourceName
    ?? candidate.image?.sourceName;
}

function setNameFromSourceName(sourceName: string | undefined): string | undefined {
  const cleaned = sourceName
    ?.replace(/^Pokemon TCG\s*/i, '')
    .replace(/^TCGdex Japanese\s*/i, '')
    .replace(/[()]/g, ' ')
    .trim();
  return cleaned || undefined;
}

function shadowSetNameFromCandidate(candidate: DiscoveryCandidate, cardName: string): string | undefined {
  const sourceSetName = setNameFromSourceName(candidate.suggestion.referenceSourceName);
  return candidate.weeklyDiscovery?.canonicalReference?.setName
    ?? candidate.suggestion.canonicalReference?.setName
    ?? sourceSetName
    ?? (/\bxy\s+black\s+star\s+promos?\b/i.test(cardName) ? 'XY Black Star Promos' : undefined)
    ?? (/\bsm\s+black\s+star\s+promos?\b/i.test(cardName) ? 'SM Black Star Promos' : undefined)
    ?? (/\blegendary\s+treasures\b/i.test(cardName) ? 'Legendary Treasures' : undefined)
    ?? (/\bmega\s+symphonia\b/i.test(cardName) ? 'Mega Symphonia' : undefined)
    ?? (/\bscarlet\s+ex\b/i.test(cardName) ? 'Scarlet ex' : undefined)
    ?? (/\bterastal\s+festival(?:\s+ex)?\b/i.test(cardName) ? 'Terastal Festival ex' : undefined)
    ?? (/\bexpedition(?:\s+base\s+set)?\b/i.test(cardName) ? 'Expedition Base Set' : undefined);
}

function shadowLanguage(candidate: DiscoveryCandidate, cardName: string, sourceName: string | undefined): 'ENGLISH' | 'JAPANESE' | undefined {
  const canonicalLanguage = candidate.weeklyDiscovery?.canonicalReference?.language ?? candidate.suggestion.canonicalReference?.language;
  if (canonicalLanguage) return canonicalLanguage;
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(cardName) || /\bjapanese\b/i.test(cardName)) return 'JAPANESE';
  if (/\benglish\b/i.test(cardName)) return 'ENGLISH';
  if (/^TCGdex Japanese/i.test(sourceName ?? '')) return 'JAPANESE';
  if (/^Pokemon TCG/i.test(sourceName ?? '')) return 'ENGLISH';
  return undefined;
}

function shadowSubjectsFromText(text: string): string[] {
  const subjects: string[] = [];
  const ascii = normalizedAscii(text);
  for (const subject of KNOWN_COLLECTOR_SUBJECTS) {
    if (new RegExp(`\\b${normalizedAscii(subject)}\\b`, 'i').test(ascii)) addUnique(subjects, subject);
  }
  for (const [canonicalKey, aliases] of Object.entries(JAPANESE_SUBJECT_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias))) {
      const canonical = KNOWN_COLLECTOR_SUBJECTS.find((subject) => normalizedAscii(subject) === canonicalKey) ?? canonicalKey;
      addUnique(subjects, canonical);
    }
  }
  return subjects;
}

function shadowFormatTokens(text: string): string[] {
  const formats: string[] = [];
  if (/\b(vmax|gx|ex|vstar|sar|sir|ir|ar|alt art|full art)\b/i.test(text)) addUnique(formats, 'special-art');
  if (/\b(?:[A-Za-z]+-EX|EX)\b/.test(text)) addUnique(formats, 'EX');
  if (/(?<!-)\bex\b/.test(text)) addUnique(formats, 'ex');
  if (/\bgx\b/i.test(text)) addUnique(formats, 'GX');
  if (/\btag\s*team\b|&.*&.*-gx\b/i.test(text)) addUnique(formats, 'TAG_TEAM');
  if (/\bv\b/i.test(text)) addUnique(formats, 'V');
  if (/\bvmax\b/i.test(text)) addUnique(formats, 'VMAX');
  if (/\bvstar\b/i.test(text)) addUnique(formats, 'VSTAR');
  if (/\bpromo|black star|mcdonald'?s|league promo|nintendo promo|corocoro|coro\s*coro\b/i.test(text)) addUnique(formats, 'promo');
  if (/\be-reader|skyridge|aquapolis|expedition\b/i.test(text)) addUnique(formats, 'e-reader');
  if (/\btrainer gallery|galarian gallery|radiant collection|classic collection\b/i.test(text)) addUnique(formats, 'gallery');
  return formats;
}

function shadowRarityTokens(text: string): string[] {
  const tiers: string[] = [];
  if (/\b(sar|sir|hr|secret rare)\b/i.test(text)) addUnique(tiers, 'premium');
  if (/\b(ir|ar|illustration rare|art rare)\b/i.test(text)) addUnique(tiers, 'illustration');
  if (/\bpromo\b/i.test(text)) addUnique(tiers, 'promo');
  return tiers;
}

function shadowPromoTypes(text: string): string[] {
  const promoTypes: string[] = [];
  if (/\b(?:xy|sm)?\s*black\s+star\s+promos?\b|\bblack\s+star\b/i.test(text)) addUnique(promoTypes, 'black-star');
  if (/\bcorocoro|coro\s*coro\b/i.test(text)) addUnique(promoTypes, 'corocoro');
  if (/\bmcdonald'?s\b/i.test(text)) addUnique(promoTypes, 'mcdonalds');
  if (/\bleague promo|staff promo|prerelease\b/i.test(text)) addUnique(promoTypes, 'event');
  return promoTypes;
}

function shadowReleaseTypes(text: string): string[] {
  const releaseTypes: string[] = [];
  if (/\bjapanese\b|tcgdex japanese|[\u3040-\u30ff\u3400-\u9fff]/i.test(text)) addUnique(releaseTypes, 'japanese-release');
  if (/\bpromo|black star|corocoro|coro\s*coro|mcdonald'?s\b/i.test(text)) addUnique(releaseTypes, 'promo-release');
  if (/\blimited|exclusive|anniversary|collection|corocoro|coro\s*coro|mcdonald'?s\b/i.test(text)) addUnique(releaseTypes, 'special-release');
  return releaseTypes;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shadowPersonalAggregate(components: PersonalRelevanceComponents): number {
  return Number(clamp01(
    components.subjectAffinity * 0.36
    + components.setAffinity * 0.18
    + components.promoAffinity * 0.13
    + components.formatAffinity * 0.12
    + components.eraAffinity * 0.10
    + components.languageAffinity * 0.06
    + components.artTierAffinity * 0.03
    + components.patternAffinity * 0.02
  ).toFixed(6));
}

function shadowCollectorAnchorStrength(components: PersonalRelevanceComponents): number {
  return Number(clamp01(
    components.subjectAffinity * 0.40
    + components.setAffinity * 0.24
    + components.promoAffinity * 0.16
    + components.formatAffinity * 0.12
    + components.eraAffinity * 0.06
    + components.artTierAffinity * 0.02
  ).toFixed(6));
}

function shadowMeaningfulAffinityCount(components: PersonalRelevanceComponents): number {
  return [
    components.subjectAffinity,
    components.setAffinity,
    components.promoAffinity,
    components.formatAffinity,
    components.eraAffinity,
    components.artTierAffinity
  ].filter((value) => value >= 0.18).length;
}

const COLLECTOR_PROFILE_SHADOW_SCORING_STRATEGY: WeeklyDiscoveryScoringStrategy = {
  personalRelevanceAggregate: shadowPersonalAggregate,
  computeDiscoveryValue: (features, profile, personal) => {
    const anchor = shadowCollectorAnchorStrength(personal);
    const subjectStrength = personal.subjectAffinity;
    const hasKnownEra = features.eras.some((era) => era in profile.eras);
    const hasKnownFormat = features.formats.some((format) => format in profile.formats);
    const hasUnseenTrait = features.eras.some((era) => !(era in profile.eras)) || features.formats.some((format) => !(format in profile.formats));
    return {
      novelty: Number(clamp01(subjectStrength >= 0.45 ? 0.25 : anchor >= 0.25 ? 0.45 : anchor > 0 ? 0.62 : 0.82).toFixed(6)),
      adjacency: Number(clamp01(anchor >= 0.42 ? 0.72 : anchor >= 0.16 ? 0.56 : (hasKnownEra || hasKnownFormat) && anchor > 0 ? 0.42 : 0.24).toFixed(6)),
      serendipity: Number(clamp01(anchor >= 0.42 ? 0.25 : anchor >= 0.16 ? 0.45 : 0.72).toFixed(6)),
      underrepresentedTraitCoverage: hasUnseenTrait ? 1 : 0.2
    };
  },
  determineRole: (components, value) => {
    const anchor = shadowCollectorAnchorStrength(components);
    const meaningfulCount = shadowMeaningfulAffinityCount(components);
    if (components.subjectAffinity >= 0.65 || components.setAffinity >= 0.55 || (anchor >= 0.40 && meaningfulCount >= 2)) return 'CORE_MATCH';
    if (anchor >= 0.16 && value.adjacency >= 0.5) return 'ADJACENT_DISCOVERY';
    return 'CONTROLLED_EXPLORATION';
  },
  shadowDiagnostics: (components) => ({
    personalAggregate: shadowPersonalAggregate(components),
    collectorAnchorStrength: shadowCollectorAnchorStrength(components)
  })
};

function shadowEras(text: string, setName: string | undefined): string[] {
  const source = `${text} ${setName ?? ''}`;
  const eras: string[] = [];
  if (/\b(base set|jungle|fossil|neo|gym heroes|gym challenge|skyridge|aquapolis|expedition)\b/i.test(source)) addUnique(eras, 'WOTC');
  if (/\b(ex deoxys|ex team magma|hidden legends)\b/i.test(source)) addUnique(eras, 'EX');
  if (/\b(sun\s*&\s*moon|sm black star|tag team)\b/i.test(source)) addUnique(eras, 'SM');
  if (/\b(sword\s*&\s*shield|swsh|evolving skies|vstar universe)\b/i.test(source)) addUnique(eras, 'SWSH');
  if (/\b(scarlet\s*&\s*violet|pokemon\s+151|pok[eé]mon\s+151|paldean fates|stellar crown|terastal festival|scarlet ex|mega symphonia)\b/i.test(source)) addUnique(eras, 'SV');
  if (/\bxy black star|legendary treasures\b/i.test(source)) addUnique(eras, 'XY');
  return eras;
}

export function extractCollectorProfileDiscoveryFeatures(candidate: DiscoveryCandidate): DiscoveryCardFeatures {
  const cardName = shadowCardNameText(candidate);
  const setName = shadowSetNameFromCandidate(candidate, cardName);
  const sourceName = trustedSourceName(candidate);
  const identityText = [cardName, setName, sourceName].filter(Boolean).join(' ');
  const sets: string[] = [];
  addUnique(sets, setName);
  const rarityTiers = shadowRarityTokens(cardName);
  return {
    subjects: shadowSubjectsFromText(cardName),
    evolutionFamilies: [],
    artists: [],
    eras: shadowEras(cardName, setName),
    sets,
    setFamilies: sets.map(rankerSetFamily).filter(Boolean),
    languages: [shadowLanguage(candidate, cardName, sourceName)].filter((value): value is 'ENGLISH' | 'JAPANESE' => !!value),
    formats: shadowFormatTokens(identityText),
    rarityTiers,
    artTiers: rarityTiers.includes('illustration') ? ['illustration'] : rarityTiers.includes('premium') ? ['premium'] : [],
    promoTypes: shadowPromoTypes(identityText),
    releaseTypes: shadowReleaseTypes(identityText),
    aestheticTags: [],
    sceneTags: [],
    themeTags: []
  };
}

export function analyzeCollectorProfileShadowReserve(
  reserve: DiscoveryCandidate[],
  profile: CollectorTasteProfile,
  policies: Partial<WeeklyDiscoveryPolicies> = {},
  stableTieBreakerSeed = ''
): DiscoveryCandidate[] {
  return analyzeWeeklyDiscoveryCandidateReserveWithFeatures(
    reserve.map((candidate) => ({
      ...candidate,
      suggestion: { ...candidate.suggestion },
      image: candidate.image ? { ...candidate.image } : undefined,
      listing: candidate.listing ? { ...candidate.listing } : undefined,
      weeklyDiscovery: candidate.weeklyDiscovery ? { ...candidate.weeklyDiscovery } : undefined
    })),
    profile,
    extractCollectorProfileDiscoveryFeatures,
    policies,
    stableTieBreakerSeed,
    COLLECTOR_PROFILE_SHADOW_SCORING_STRATEGY
  );
}

export const __collectorProfileRankingAdapterTestHooks = {
  EMPTY_PROFILE_GROUPS,
  scaleTraitsForRanker
};
