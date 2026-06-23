import type { Chase } from '../types.js';

export type DiscoverySuggestion = {
  name: string;
  why: string;
  lane: string;
  laneWhy: string;
  nearby: string[];
  referenceImageUrl?: string;
  referenceSourceName?: string;
  referenceSourceCardId?: string;
  evidenceSearchTerm?: string;
  evidenceAliases?: string[];
  requiredEvidenceTokens?: string[];
  sourceTasteTokens?: string[];
  minimumExampleTotalCad?: number;
  curiosityScore?: number;
};

export type DiscoverySelection = {
  lane: string;
  suggestions: DiscoverySuggestion[];
};

type DiscoverySelectionOptions = {
  excludedNames?: Iterable<string>;
  excludeLanesForExcludedNames?: boolean;
};

type ChaseSignalProfile = {
  sourceText: string;
  anchor: string;
  displayAnchor: string;
  cardNumber?: string;
  cardCodePrefix?: string;
  tokens: string[];
  weight: number;
  isActiveChase: boolean;
  promoLike: boolean;
  specialReleaseLike: boolean;
  languageHints: string[];
  traitHints: string[];
};

type ThreadTemplate = {
  lane: string;
  suffix: string;
  scope: 'subject' | 'trait';
  anchor?: (profile: ChaseSignalProfile) => string;
  requiredTerms?: (profile: ChaseSignalProfile) => string[];
  laneWhy: (anchor: string) => string;
  why: (anchor: string) => string;
  applies: (profile: ChaseSignalProfile) => boolean;
  score: (profile: ChaseSignalProfile) => number;
  curiosityScore?: number;
};

type TasteFeatureSuggestion = {
  suggestion: DiscoverySuggestion;
  score: number;
};

type TasteFeature = {
  key: string;
  name: string;
  lane: string;
  requiredTerms: string[];
  laneWhy: string;
  why: string;
  support: number;
  activeSupport: number;
  score: number;
  tasteTokens: string[];
  curiosityScore: number;
};

const STOP_WORDS = new Set([
  'and',
  'any',
  'buy',
  'card',
  'cards',
  'chase',
  'condition',
  'for',
  'from',
  'grade',
  'graded',
  'holo',
  'mint',
  'near',
  'nm',
  'lp',
  'mp',
  'hp',
  'dm',
  'it',
  'now',
  'pokemon',
  'raw',
  'the',
  'tcg',
  'ungraded',
  'with'
]);

const RELEASE_WORDS = new Set([
  'anniversary',
  'black',
  'collection',
  'exclusive',
  'jp',
  'japanese',
  'limited',
  'mcdonalds',
  'movie',
  'promo',
  'promotional',
  'release',
  'special',
  'star',
  'staff'
]);

const PROMO_RELEASE_PATTERNS = [
  /\b(promo|promotional|black star|mcdonald'?s|toys\s*r\s*us|movie promo|league promo|staff promo|prerelease)\b/i,
  /\b(sm|swsh|svp|xy|bw|dp|hgss)\s?-?\d{2,4}\b/i,
  /\b(?:sm|swsh|svp|xy|bw|dp|hgss)\d{2,4}\b/i
];

const SPECIAL_RELEASE_PATTERNS = [
  /\b(?:gg|tg|rc)\s?-?\d{1,3}\b/i,
  /\b(radiant collection|southern islands?|classic collection|celebrations|pop series|trainer kit|battle academy|vending|e-reader|corocoro|coro coro)\b/i
];

const JAPANESE_PROMO_CODE_PATTERN = /\b(?:\d{1,3}\s*\/\s*(?:XY|SM|S|SV)-P|(?:XY|SM|S|SV)-P\s*-?\s*\d{1,3})\b/i;
const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const JAPANESE_RELEASE_MARKER_PATTERN = /\b(?:coro\s?coro|masaki|munch|poncho|battle\s*festa|players?\s+club|fan\s+club|trainers?\s+magazine|yu\s?nagaba|precious\s+collector|kanazawa|yokohama|sapporo|pokemon\s+center)\b/i;
const NUMBER_PATTERN = /\b(?:[A-Z]{0,4}\d{1,3}\s*\/\s*\d{1,3}|\d{1,3}\s*\/\s*(?:XY|SM|S|SV)-P|(?:XY|SM|S|SV)-P\s*-?\s*\d{1,3}|(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}|H\d{1,2}|\d{1,3})\b/i;

const RETAIL_RELEASE_PATTERN = /\b(mcdonald'?s|toys\s*r\s*us|pokemon center|game\s?stop|best buy|target|walmart)\b/i;
const MULTI_SUBJECT_PATTERN = /\b\w+\s+\w+\s+\w+\b/;
const SOURCE_FEATURE_TOKENS = new Set([
  'collector',
  'deck',
  'delta',
  'e-reader',
  'ex',
  'exclusive',
  'art',
  'full',
  'full art',
  'gallery',
  'gx',
  'illustration',
  'intro',
  'japanese',
  'promo',
  'rare',
  'retail',
  'set',
  'small',
  'small set',
  'special',
  'tag',
  'tag team',
  'team',
  'vhs',
  'vintage'
]);

const THREAD_TEMPLATES: ThreadTemplate[] = [
  {
    lane: 'source-backed matches',
    suffix: 'trading card',
    scope: 'subject',
    laneWhy: (anchor) => `starts with source and market matches around ${anchor}`,
    why: () => 'keeps Discovery anchored to the exact card language already in your Vault',
    applies: () => true,
    score: (profile) => 100 * profile.weight,
    curiosityScore: 3
  },
  {
    lane: 'release-history thread',
    suffix: 'special release cards',
    scope: 'subject',
    laneWhy: (anchor) => `looks for release-path relatives around ${anchor} without naming the answer in code`,
    why: () => 'uses promo, small-set, or release wording from your chase as a source-backed search direction',
    applies: (profile) => profile.promoLike || profile.specialReleaseLike,
    score: (profile) => 72 * profile.weight,
    curiosityScore: 7
  },
  {
    lane: 'release-family discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: (profile) => (profile.languageHints.includes('japanese') ? 'Japanese promo' : 'promo and special release'),
    requiredTerms: (profile) => (profile.languageHints.includes('japanese') ? ['japanese', 'promo'] : ['promo']),
    laneWhy: () => 'widens from active chases into release traits that sources and listings can verify',
    why: () => 'uses release metadata from your profile without choosing a specific follow-up card in code',
    applies: (profile) => profile.promoLike || profile.specialReleaseLike,
    score: (profile) => 90 * profile.weight,
    curiosityScore: 8
  },
  {
    lane: 'retail-promo discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'retail promo',
    requiredTerms: () => ['promo'],
    laneWhy: () => 'uses retail or event-distribution signals without repeating the chase card',
    why: () => 'opens the hunt to source-backed retail promos rather than the card already in your Vault',
    applies: (profile) => RETAIL_RELEASE_PATTERN.test(profile.sourceText),
    score: (profile) => 86 * profile.weight,
    curiosityScore: 8
  },
  {
    lane: 'set-code discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: (profile) => `${(profile.cardCodePrefix ?? 'set-code').toUpperCase()} era`,
    requiredTerms: (profile) => (profile.cardCodePrefix ? [profile.cardCodePrefix] : ['pokemon']),
    laneWhy: () => 'uses card-number prefixes as a broad release signal instead of a specific card match',
    why: () => 'lets source and market evidence find other cards from the same code family',
    applies: (profile) => !!profile.cardCodePrefix,
    score: (profile) => 82 * profile.weight,
    curiosityScore: 7
  },
  {
    lane: 'language and region thread',
    suffix: 'Japanese cards',
    scope: 'subject',
    laneWhy: (anchor) => `checks whether ${anchor} has language or region-specific collector paths`,
    why: () => 'follows the language signal already present in your chase text rather than assuming a prewritten branch',
    applies: (profile) => profile.languageHints.includes('japanese'),
    score: (profile) => 64 * profile.weight,
    curiosityScore: 8
  },
  {
    lane: 'language-wide discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'Japanese collector',
    requiredTerms: () => ['japanese'],
    laneWhy: () => 'keeps the language signal while removing the current chase card from the search',
    why: () => 'lets external evidence surface what else exists in the same language or region space',
    applies: (profile) => profile.languageHints.includes('japanese'),
    score: (profile) => 80 * profile.weight,
    curiosityScore: 7
  },
  {
    lane: 'visual variant thread',
    suffix: 'illustration rare cards',
    scope: 'subject',
    laneWhy: (anchor) => `tests modern visual variants around ${anchor} with source and market evidence`,
    why: () => 'widens from the named chase into visual versions only when listings or references can support it',
    applies: () => true,
    score: (profile) => 42 * profile.weight,
    curiosityScore: 5
  },
  {
    lane: 'visual-format discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'illustration rare',
    requiredTerms: () => ['illustration', 'rare'],
    laneWhy: () => 'tests visual collecting formats without repeating the current chase card',
    why: () => 'uses the chase as a signal for display-oriented cards while evidence decides the actual results',
    applies: (profile) => /\b(illustration|art rare|alt art|alternate art|full art|gallery|sar|ar)\b/i.test(profile.sourceText),
    score: (profile) => 68 * profile.weight,
    curiosityScore: 6
  },
  {
    lane: 'era thread',
    suffix: 'vintage cards',
    scope: 'subject',
    laneWhy: (anchor) => `looks for older-era examples around ${anchor} using live evidence instead of a static card list`,
    why: () => 'lets era language emerge from available catalog and marketplace data',
    applies: (profile) => /\b(vintage|wotc|old|classic|e-reader|expedition|neo|base)\b/i.test(profile.sourceText) || profile.specialReleaseLike,
    score: (profile) => 38 * profile.weight,
    curiosityScore: 6
  },
  {
    lane: 'small-set discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'small set promo',
    requiredTerms: () => ['promo'],
    laneWhy: () => 'uses compact set-number structure as a broad collector signal instead of the current card',
    why: () => 'searches for small-release examples and lets market evidence decide what is real enough to show',
    applies: (profile) => profile.traitHints.includes('small set'),
    score: (profile) => 74 * profile.weight,
    curiosityScore: 8
  },
  {
    lane: 'multi-card discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'multi Pokemon promo',
    requiredTerms: () => ['promo'],
    laneWhy: () => 'uses multi-character chase structure without recommending the same group card back',
    why: () => 'searches for broader multi-Pokemon release patterns and lets evidence pick the actual cards',
    applies: (profile) => profile.promoLike && profile.tokens.length >= 3 && MULTI_SUBJECT_PATTERN.test(profile.anchor),
    score: (profile) => 70 * profile.weight,
    curiosityScore: 7
  },
  {
    lane: 'era-wide discovery',
    suffix: 'Pokemon cards',
    scope: 'trait',
    anchor: () => 'vintage era',
    requiredTerms: () => ['vintage'],
    laneWhy: () => 'keeps the era signal while avoiding the card already in your Vault',
    why: () => 'opens the time-period thread and lets source-backed results define what belongs',
    applies: (profile) => /\b(vintage|wotc|old|classic|e-reader|expedition|neo|base)\b/i.test(profile.sourceText),
    score: (profile) => 62 * profile.weight,
    curiosityScore: 6
  },
  {
    lane: 'value watch thread',
    suffix: 'raw card',
    scope: 'subject',
    laneWhy: (anchor) => `keeps an approachable raw-market watch around ${anchor}`,
    why: () => 'uses your chase as the anchor while market cache decides whether the thread is worth showing',
    applies: () => true,
    score: (profile) => 34 * profile.weight,
    curiosityScore: 2
  },
  {
    lane: 'adjacent collector thread',
    suffix: 'collector cards',
    scope: 'subject',
    laneWhy: (anchor) => `opens a broader collector search around ${anchor}`,
    why: () => 'gives Discovery room to learn from what you add, like, or reject next',
    applies: () => true,
    score: (profile) => 24 * profile.weight,
    curiosityScore: 4
  },
  {
    lane: 'open discovery thread',
    suffix: 'cards',
    scope: 'trait',
    anchor: () => 'Pokemon collector',
    requiredTerms: () => ['pokemon'],
    laneWhy: () => 'uses the active chase only as permission to explore, without repeating the chase card',
    why: () => 'keeps Discovery moving when a chase has not exposed stronger release, language, era, or art signals yet',
    applies: () => true,
    score: (profile) => 18 * profile.weight,
    curiosityScore: 1
  }
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function normalizeSearchText(value: string): string {
  return normalize(value).replace(/[^a-z0-9/ -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[-/]+|[-/]+$/g, ''))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.includes('/') ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');
}

function chaseRawSignalText(chase: Chase): string {
  return [chase.cardName, chase.targetNote, chase.grade, chase.condition, chase.listingType].filter(Boolean).join(' ');
}

function chaseSignalWeight(chase: Chase): number {
  if (chase.tasteWeight !== undefined) return chase.tasteWeight;
  if (chase.priority === 'GRAIL') return 2.4;
  if (chase.priority === 'HIGH') return 1.6;
  return 1;
}

function extractCardNumber(value: string): string | undefined {
  return NUMBER_PATTERN.exec(value)?.[0].replace(/\s+/g, '').toUpperCase();
}

function extractCardCodePrefix(cardNumber: string | undefined): string | undefined {
  if (!cardNumber) return undefined;
  const prefix = /^([A-Z]{1,5})\d/i.exec(cardNumber)?.[1];
  return prefix?.toLowerCase();
}

function stripCardNumber(value: string): string {
  return value.replace(NUMBER_PATTERN, ' ');
}

function languageHints(value: string): string[] {
  if (/\b(japanese|japan|jp|jpn)\b/i.test(value) || JAPANESE_PROMO_CODE_PATTERN.test(value) || JAPANESE_SCRIPT_PATTERN.test(value) || JAPANESE_RELEASE_MARKER_PATTERN.test(value)) {
    return ['japanese'];
  }
  return [];
}

function traitHints(value: string): string[] {
  const hints = new Set<string>();
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/i.test(value)) hints.add('e-reader');
  if (/\bfull art\b|\bfa\b/i.test(value)) hints.add('full art');
  if (/\billustration rare\b|\bart rare\b|\balt art\b|\balternate art\b|\bsar\b|\bar\b/i.test(value)) hints.add('illustration');
  if (/\btrainer gallery\b|\bgalarian gallery\b|\bgallery\b|\bgg\s?-?\d{1,3}\b|\btg\s?-?\d{1,3}\b/i.test(value)) hints.add('gallery');
  if (/\btag team\b|&/i.test(value)) hints.add('tag team');
  if (/\bex\b/i.test(value)) hints.add('ex');
  if (/\bgx\b/i.test(value)) hints.add('gx');
  if (/\b(?:v|vmax|vstar)\b/i.test(value)) hints.add('v');
  if (/\bdelta species\b|\bdelta\b/i.test(value)) hints.add('delta');
  if (/\b(vintage|wotc|old|classic|neo|base)\b/i.test(value) || JAPANESE_RELEASE_MARKER_PATTERN.test(value)) hints.add('vintage');
  if (/\bsmall set\b/i.test(value)) hints.add('small set');
  if (RETAIL_RELEASE_PATTERN.test(value)) hints.add('retail');
  return [...hints];
}

function buildAnchorText(value: string): string {
  const cleaned = stripCardNumber(value)
    .replace(/\b(?:psa|bgs|cgc|sgc)\s?\d{1,2}\b/gi, ' ')
    .replace(/\b(?:gem mint|near mint|light played|moderately played|heavily played|damaged|first edition|1st edition)\b/gi, ' ');
  const anchorTokens = tokens(cleaned).filter((token) => !RELEASE_WORDS.has(token));
  return anchorTokens.slice(0, 4).join(' ') || tokens(value).slice(0, 4).join(' ') || 'pokemon';
}

function profileFromText(sourceText: string, weight = 1, isActiveChase = false): ChaseSignalProfile | null {
  const normalizedSource = normalizeSearchText(sourceText);
  if (!normalizedSource) return null;
  const anchor = buildAnchorText(normalizedSource);
  const cardNumber = extractCardNumber(sourceText);
  const cardCodePrefix = extractCardCodePrefix(cardNumber);
  const promoLike = PROMO_RELEASE_PATTERNS.some((pattern) => pattern.test(sourceText));
  const japanesePromoLike = JAPANESE_PROMO_CODE_PATTERN.test(sourceText);
  const japaneseReleaseMarkerLike = JAPANESE_RELEASE_MARKER_PATTERN.test(sourceText);
  const specialReleaseLike = promoLike || japanesePromoLike || japaneseReleaseMarkerLike || SPECIAL_RELEASE_PATTERNS.some((pattern) => pattern.test(sourceText));
  const traits = traitHints(sourceText);
  return {
    sourceText,
    anchor,
    displayAnchor: titleCase(anchor),
    cardNumber,
    cardCodePrefix,
    tokens: tokens(anchor),
    weight,
    isActiveChase,
    promoLike: promoLike || japanesePromoLike || japaneseReleaseMarkerLike,
    specialReleaseLike,
    languageHints: languageHints(sourceText),
    traitHints: traits
  };
}

function buildChaseSignalProfile(chase: Chase): ChaseSignalProfile | null {
  return profileFromText(chaseRawSignalText(chase), chaseSignalWeight(chase), chase.tasteSource === undefined || chase.tasteSource === 'ACTIVE_CHASE');
}

export function hasPromoLeaningDiscoveryProfile(chases: Chase[]): boolean {
  const profiles = chases.map(buildChaseSignalProfile).filter((profile): profile is ChaseSignalProfile => !!profile);
  if (profiles.length === 0) return false;
  const releaseSignals = profiles.filter((profile) => profile.promoLike || profile.specialReleaseLike);
  return releaseSignals.length >= 2 || releaseSignals.length / profiles.length >= 0.5;
}

function suggestionName(profile: ChaseSignalProfile, template: ThreadTemplate): string {
  const exactName = [profile.displayAnchor, profile.cardNumber].filter(Boolean).join(' ');
  const templateAnchor = template.anchor?.(profile);
  const anchor = templateAnchor ?? (template.lane === 'source-backed matches' ? exactName || profile.displayAnchor : profile.displayAnchor);
  return `${anchor} ${template.suffix}`.replace(/\s+/g, ' ').trim();
}

function requiredTokens(profile: ChaseSignalProfile, template: ThreadTemplate): string[] {
  const templateTerms = template.requiredTerms?.(profile);
  if (templateTerms) {
    return templateTerms
      .flatMap((term) => normalizeSearchText(term).split(/\s+/))
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 6);
  }
  const baseTokens = profile.tokens.slice(0, 3);
  if (template.lane !== 'source-backed matches' || !profile.cardNumber) return baseTokens;
  return [...baseTokens, ...tokens(profile.cardNumber.replace('/', ' '))].slice(0, 6);
}

function nearbyThreads(profile: ChaseSignalProfile, template: ThreadTemplate): string[] {
  return THREAD_TEMPLATES.filter((candidate) => candidate !== template && candidate.applies(profile))
    .slice(0, 3)
    .map((candidate) => suggestionName(profile, candidate));
}

function evidenceAliases(profile: ChaseSignalProfile, template: ThreadTemplate, name: string): string[] {
  const aliases = profile.isActiveChase && template.scope === 'trait' ? [name] : [profile.sourceText, name];
  if (!(profile.isActiveChase && template.scope === 'trait') && profile.cardNumber) aliases.push(`${profile.displayAnchor} ${profile.cardNumber}`);
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

function suggestionFromTemplate(profile: ChaseSignalProfile, template: ThreadTemplate): DiscoverySuggestion {
  const name = suggestionName(profile, template);
  const anchor = template.anchor?.(profile) ?? profile.displayAnchor;
  return {
    name,
    lane: template.lane,
    laneWhy: template.laneWhy(anchor),
    why: template.why(anchor),
    nearby: nearbyThreads(profile, template),
    evidenceSearchTerm: name,
    evidenceAliases: evidenceAliases(profile, template, name),
    requiredEvidenceTokens: requiredTokens(profile, template),
    curiosityScore: template.curiosityScore
  };
}

function ambientThreadMultiplier(template: ThreadTemplate): number {
  if (template.lane === 'source-backed matches') return 1.25;
  if (template.lane === 'value watch thread') return 1.1;
  if (/release|language|visual|era|adjacent/.test(template.lane)) return 1.15;
  return 1;
}

function scoreSuggestion(profile: ChaseSignalProfile, template: ThreadTemplate, profileIndex: number): number {
  return template.score(profile) * ambientThreadMultiplier(template) - profileIndex * 4;
}

function generateProfileSuggestions(profile: ChaseSignalProfile, profileIndex: number): Array<{ suggestion: DiscoverySuggestion; score: number }> {
  const templates = THREAD_TEMPLATES.filter((template) => template.applies(profile));
  const selectedTemplates = profile.isActiveChase ? [] : templates;
  return selectedTemplates.map((template) => ({
    suggestion: suggestionFromTemplate(profile, template),
    score: scoreSuggestion(profile, template, profileIndex)
  }));
}

function featureTasteTokens(profile: ChaseSignalProfile, extraTokens: string[] = []): string[] {
  return [...new Set([...profile.tokens, ...profile.languageHints, ...profile.traitHints, profile.cardCodePrefix, profile.promoLike ? 'promo' : undefined, profile.specialReleaseLike ? 'special' : undefined, ...extraTokens]
    .filter((token): token is string => !!token)
    .flatMap((token) => normalizeSearchText(token).split(/\s+/))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))]
    .slice(0, 10);
}

function addTasteFeature(features: Map<string, TasteFeature>, profile: ChaseSignalProfile, input: Omit<TasteFeature, 'support' | 'activeSupport' | 'score' | 'tasteTokens'> & { tasteTokens?: string[] }): void {
  const existing = features.get(input.key);
  const support = existing ? existing.support + 1 : 1;
  const activeSupport = existing ? existing.activeSupport + (profile.isActiveChase ? 1 : 0) : profile.isActiveChase ? 1 : 0;
  const score = (existing?.score ?? 0) + profile.weight;
  const tasteTokens = [...new Set([...(existing?.tasteTokens ?? []), ...featureTasteTokens(profile, input.tasteTokens)])].slice(0, 24);
  features.set(input.key, {
    ...input,
    support,
    activeSupport,
    score: score + support * 0.25,
    tasteTokens
  });
}

function collectTasteFeatures(profiles: ChaseSignalProfile[]): TasteFeature[] {
  const features = new Map<string, TasteFeature>();
  for (const profile of profiles) {
    if (profile.promoLike || profile.specialReleaseLike) {
      addTasteFeature(features, profile, {
        key: profile.languageHints.includes('japanese') ? 'release:japanese-promo' : 'release:promo',
        name: profile.languageHints.includes('japanese') ? 'Japanese promo Pokemon cards' : 'Pokemon promo cards',
        lane: 'Promo Trail',
        requiredTerms: profile.languageHints.includes('japanese') ? ['japanese', 'promo'] : ['promo'],
        laneWhy: 'matches repeated release and promo signals across your chase profile',
        why: 'uses active and remembered chases as taste cues, then asks the market for other cards from the same collector lane',
        tasteTokens: profile.languageHints.includes('japanese') ? ['japanese', 'promo'] : ['promo'],
        curiosityScore: 8
      });
      addTasteFeature(features, profile, {
        key: 'release:special',
        name: 'Pokemon special release cards',
        lane: 'Special Release Trail',
        requiredTerms: ['pokemon'],
        laneWhy: 'follows shared promo and limited-release signals without naming any active chase card',
        why: 'looks for cards from similar promo, small-set, or limited-release paths while active chase cards are excluded from market evidence',
        tasteTokens: ['promo', 'special'],
        curiosityScore: 7
      });
    }
    if (profile.languageHints.includes('japanese')) {
      addTasteFeature(features, profile, {
        key: 'language:japanese',
        name: 'Japanese Pokemon cards',
        lane: 'Japanese Collector Trail',
        requiredTerms: ['japanese'],
        laneWhy: 'keeps the language signal from your profile while leaving the current card behind',
        why: 'uses region and language as a broad taste marker rather than a prewritten card branch',
        tasteTokens: ['japanese'],
        curiosityScore: 7
      });
    }
    if (profile.languageHints.includes('japanese') && (profile.promoLike || profile.specialReleaseLike || profile.traitHints.includes('vintage') || profile.traitHints.includes('e-reader'))) {
      addTasteFeature(features, profile, {
        key: 'release:japanese-niche-exclusive',
        name: 'Japanese niche exclusive Pokemon cards',
        lane: 'Japanese Collector Trail',
        requiredTerms: ['japanese', 'exclusive', 'intro', 'deck'],
        laneWhy: 'matches repeated Japanese promo, deck, and odd-release signals across your chase profile',
        why: 'looks for scarce marketplace-native Japanese release identities that official card sources often miss',
        tasteTokens: ['japanese', 'exclusive', 'intro', 'deck', 'vhs', 'vintage'],
        curiosityScore: 9
      });
    }
    if (/\b(illustration|art rare|alt art|alternate art|full art|gallery|sar|ar)\b/i.test(profile.sourceText)) {
      addTasteFeature(features, profile, {
        key: profile.traitHints.includes('full art') ? 'visual:full-art' : 'visual:illustration',
        name: profile.traitHints.includes('full art') ? 'Pokemon full art cards' : 'Pokemon illustration rare cards',
        lane: profile.traitHints.includes('full art') ? 'Full Art Trail' : 'Illustration Rarity Trail',
        requiredTerms: profile.traitHints.includes('full art') ? ['full', 'art'] : ['illustration', 'rare'],
        laneWhy: 'matches display-oriented visual signals from your chase profile',
        why: 'lets visual-format taste steer the search while evidence decides which card is viable',
        tasteTokens: profile.traitHints.includes('full art') ? ['full art', 'illustration', 'rare'] : ['illustration', 'rare', 'gallery'],
        curiosityScore: 6
      });
    }
    if (profile.traitHints.includes('e-reader')) {
      addTasteFeature(features, profile, {
        key: 'era:e-reader',
        name: 'e-reader Pokemon cards',
        lane: 'E-Reader Era Trail',
        requiredTerms: ['e-reader'],
        laneWhy: 'matches e-reader and early-2000s release signals from your chase profile',
        why: 'opens a source-backed e-reader path without repeating the current chase card',
        tasteTokens: ['e-reader', 'vintage'],
        curiosityScore: 7
      });
    }
    if (profile.traitHints.includes('tag team')) {
      addTasteFeature(features, profile, {
        key: 'format:tag-team',
        name: 'Tag Team Pokemon cards',
        lane: 'Tag Team Trail',
        requiredTerms: ['tag', 'team'],
        laneWhy: 'matches multi-Pokemon card structure from your chase profile',
        why: 'uses card format as a taste cue while source evidence chooses the actual recommendations',
        tasteTokens: ['tag team', 'gx', 'promo'],
        curiosityScore: 7
      });
    }
    for (const powerTrait of ['ex', 'gx', 'v', 'delta']) {
      if (!profile.traitHints.includes(powerTrait)) continue;
      addTasteFeature(features, profile, {
        key: `format:${powerTrait}`,
        name: `${powerTrait.toUpperCase()} Pokemon cards`,
        lane: `${powerTrait.toUpperCase()} Format Trail`,
        requiredTerms: [powerTrait],
        laneWhy: `matches ${powerTrait.toUpperCase()} card-format signals from your chase profile`,
        why: 'uses card format as a taste marker instead of a hard-coded card branch',
        tasteTokens: [powerTrait, 'special'],
        curiosityScore: 6
      });
    }
    if (profile.traitHints.includes('vintage') || /\b(vintage|wotc|old|classic|e-reader|expedition|neo|base)\b/i.test(profile.sourceText)) {
      addTasteFeature(features, profile, {
        key: 'era:vintage',
        name: 'vintage Pokemon cards',
        lane: 'Vintage Era Trail',
        requiredTerms: ['vintage'],
        laneWhy: 'uses older-era language as the taste cue instead of a named card branch',
        why: 'opens a related era path and relies on source-backed listings for viable examples',
        tasteTokens: ['vintage'],
        curiosityScore: 6
      });
    }
  }

  addTasteFeature(features, { sourceText: 'Pokemon collector cards', anchor: 'pokemon', displayAnchor: 'Pokemon', tokens: ['pokemon'], weight: 0.65, isActiveChase: false, promoLike: false, specialReleaseLike: false, languageHints: [], traitHints: [] }, {
    key: 'open:collector',
    name: 'Pokemon collector cards',
    lane: 'Collector Compass',
    requiredTerms: ['pokemon'],
    laneWhy: 'keeps Discovery moving from the overall profile when no narrower shared trait is ready',
    why: 'uses the chase profile as taste context while market evidence supplies the actual card examples',
    tasteTokens: ['collector'],
    curiosityScore: 2
  });

  const tokenSupport = new Map<string, { total: number; remembered: number }>();
  for (const profile of profiles) {
    for (const token of featureTasteTokens(profile)) {
      const support = tokenSupport.get(token) ?? { total: 0, remembered: 0 };
      support.total += 1;
      if (!profile.isActiveChase) support.remembered += 1;
      tokenSupport.set(token, support);
    }
  }

  const isConcreteTraitFeature = (feature: TasteFeature): boolean => /^(era:e-reader|era:vintage|visual:|format:)/.test(feature.key);

  return [...features.values()]
    .filter(
      (feature) =>
        profiles.length <= 1 || feature.support >= 2 || feature.support > feature.activeSupport || feature.key === 'open:collector' || isConcreteTraitFeature(feature)
    )
    .map((feature) => ({
      ...feature,
      tasteTokens: feature.tasteTokens.filter((token) => {
        const support = tokenSupport.get(token);
        return SOURCE_FEATURE_TOKENS.has(token) || (support?.total ?? 0) >= 2 || (support?.remembered ?? 0) > 0;
      })
    }));
}

function tasteFeatureSuggestions(profiles: ChaseSignalProfile[]): TasteFeatureSuggestion[] {
  return collectTasteFeatures(profiles).map((feature) => ({
    suggestion: {
      name: feature.name,
      lane: feature.lane,
      laneWhy: feature.laneWhy,
      why: feature.why,
      nearby: [],
      evidenceSearchTerm: feature.name,
      evidenceAliases: [feature.name],
      requiredEvidenceTokens: feature.requiredTerms,
      sourceTasteTokens: feature.tasteTokens,
      curiosityScore: feature.curiosityScore
    },
    score: feature.score * 100
  }));
}

function starterProfiles(): ChaseSignalProfile[] {
  return ['Pokemon TCG collector cards', 'Pokemon promo cards', 'Pokemon illustration rare cards']
    .map((text) => profileFromText(text, 1))
    .filter((profile): profile is ChaseSignalProfile => !!profile);
}

function profilesFromInputs(focuses: string[], chases: Chase[]): ChaseSignalProfile[] {
  const chaseProfiles = chases.map(buildChaseSignalProfile).filter((profile): profile is ChaseSignalProfile => !!profile);
  const focusProfiles = focuses.map((focus) => profileFromText(focus, 0.45, false)).filter((profile): profile is ChaseSignalProfile => !!profile);
  return [...chaseProfiles, ...focusProfiles];
}

function normalizeKey(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, ' ');
}

function excludedLaneKeys(excludedNames: Set<string>, suggestions: DiscoverySuggestion[]): Set<string> {
  return new Set(suggestions.filter((suggestion) => excludedNames.has(suggestion.name)).map((suggestion) => suggestion.lane));
}

function pickLane(suggestions: DiscoverySuggestion[]): string {
  const counts = new Map<string, number>();
  for (const suggestion of suggestions) counts.set(suggestion.lane, (counts.get(suggestion.lane) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'source-backed matches';
}

export function selectDiscoverySuggestionsForFocuses(focuses: string[], chases: Chase[], count = 3, options: DiscoverySelectionOptions = {}): DiscoverySelection {
  const normalizedFocuses = [...new Set(focuses.map((focus) => focus.trim()).filter(Boolean))];
  const profiles = profilesFromInputs(normalizedFocuses, chases);
  const activeProfiles = profiles.length > 0 ? profiles : starterProfiles();
  const hasActiveChaseSignals = chases.some((chase) => chase.tasteSource === undefined || chase.tasteSource === 'ACTIVE_CHASE');
  const generated = [
    ...(hasActiveChaseSignals ? tasteFeatureSuggestions(activeProfiles) : []),
    ...activeProfiles.flatMap((profile, profileIndex) => generateProfileSuggestions(profile, profileIndex))
  ];
  const ranked = generated.sort((left, right) => right.score - left.score || left.suggestion.name.localeCompare(right.suggestion.name));
  const excludedNames = new Set([...(options.excludedNames ?? [])]);
  const excludedNameKeys = new Set([...excludedNames].map(normalizeKey));
  const allSuggestions = ranked.map((entry) => entry.suggestion);
  const excludedLanes = options.excludeLanesForExcludedNames ? excludedLaneKeys(excludedNames, allSuggestions) : new Set<string>();
  const selected: DiscoverySuggestion[] = [];
  const selectedNames = new Set<string>();
  const selectedLanes = new Set<string>();

  const tryAdd = (suggestion: DiscoverySuggestion, allowExcludedLane = false): void => {
    const nameKey = normalizeKey(suggestion.name);
    if (selected.length >= count || selectedNames.has(nameKey) || selectedLanes.has(suggestion.lane)) return;
    if (excludedNameKeys.has(nameKey)) return;
    if (!allowExcludedLane && excludedLanes.has(suggestion.lane)) return;
    selected.push(suggestion);
    selectedNames.add(nameKey);
    selectedLanes.add(suggestion.lane);
  };

  for (const { suggestion } of ranked) tryAdd(suggestion);
  if (selected.length < count) {
    for (const { suggestion } of ranked) {
      const nameKey = normalizeKey(suggestion.name);
      if (selected.length >= count || selectedNames.has(nameKey) || excludedNameKeys.has(nameKey)) continue;
      selected.push(suggestion);
      selectedNames.add(nameKey);
    }
  }
  if (selected.length < count && excludedNameKeys.size > 0) {
    for (const { suggestion } of ranked) {
      if (selected.length >= count) break;
      const nameKey = normalizeKey(suggestion.name);
      if (selectedNames.has(nameKey) || selectedLanes.has(suggestion.lane) || excludedLanes.has(suggestion.lane)) continue;
      selected.push(suggestion);
      selectedNames.add(nameKey);
      selectedLanes.add(suggestion.lane);
    }
  }

  return {
    lane: pickLane(selected),
    suggestions: selected
  };
}

export function selectDiscoverySuggestions(focus: string | null, chases: Chase[], count = 3, options: DiscoverySelectionOptions = {}): DiscoverySelection {
  return selectDiscoverySuggestionsForFocuses(focus ? [focus] : [], chases, count, options);
}
