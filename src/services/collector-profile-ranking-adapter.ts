import type { CollectorInterestProfile, CollectorInterestTrait, CollectorProfileTraitGroup } from './collector-profile.js';
import type { CollectorTasteProfile, WeeklyDiscoveryFinalizationInput } from './weekly-discovery-ranking.js';

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

function rankerSetFamily(setName: string): string {
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

export const __collectorProfileRankingAdapterTestHooks = {
  EMPTY_PROFILE_GROUPS,
  scaleTraitsForRanker
};
