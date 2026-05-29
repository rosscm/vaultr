import type { Chase } from '../types.js';

export type DiscoverySuggestion = {
  name: string;
  why: string;
  lane: string;
  laneWhy: string;
  nearby: string[];
  evidenceSearchTerm?: string;
  evidenceAliases?: string[];
  requiredEvidenceTokens?: string[];
  minimumExampleTotalCad?: number;
  maximumBaselineRawTotalCad?: number;
  curiosityScore?: number;
};

type DiscoveryCatalogCard = DiscoverySuggestion & {
  keywords: string[];
  tags: string[];
  starter?: boolean;
};

type ChaseDiscoverySignals = {
  text: string;
  promoLike: boolean;
  specialReleaseLike: boolean;
};

export type DiscoverySelection = {
  lane: string;
  suggestions: DiscoverySuggestion[];
};

const STOP_WORDS = new Set(['and', 'card', 'cards', 'for', 'from', 'pokemon', 'the', 'with']);

const PROMO_RELEASE_PATTERNS = [
  /\b(promo|promotional|black star|corocoro|coro coro|mcdonald'?s|movie promo|league promo|staff promo|prerelease)\b/i,
  /\b(sm|swsh|svp|xy|bw|dp|hgss)\s?-?\d{2,4}\b/i,
  /\b(?:sm|swsh|svp|xy|bw|dp|hgss)\d{2,4}\b/i
];

const SPECIAL_RELEASE_PATTERNS = [
  /\b(radiant collection|rc\d{1,3}|southern islands?|classic collection|celebrations|pop series|trainer kit|battle academy)\b/i,
  /\b(\d{1,3})\s?\/\s?(?:018|025|030)\b/i
];

const KNOWN_RELEASE_HINTS: Array<{ pattern: RegExp; signals: string; promoLike?: boolean; specialReleaseLike?: boolean }> = [
  { pattern: /\bcorocoro\b|\bshining mew\b/i, signals: 'corocoro promo special release japanese magazine promo', promoLike: true, specialReleaseLike: true },
  { pattern: /\bmoltres\b.*\bzapdos\b.*\barticuno\b.*\bsm\s?-?210\b/i, signals: 'sm210 black star promo legendary birds special release', promoLike: true, specialReleaseLike: true },
  { pattern: /\bmew\s+ex\s+0?53\b/i, signals: 'mew ex svp 053 black star promo scarlet violet promo special release', promoLike: true, specialReleaseLike: true },
  { pattern: /\bsquirtle\s+0?07\s?\/\s?0?18\b/i, signals: 'squirtle 007/018 mcdonalds promo starter pokemon special release', promoLike: true, specialReleaseLike: true },
  { pattern: /\bmew\s+rc\s?24\b/i, signals: 'mew rc24 radiant collection special subset mythical display', specialReleaseLike: true },
  { pattern: /\bmew\s+347\s?\/\s?190\b/i, signals: 'mew shiny treasure shiny special art rare japanese special release', specialReleaseLike: true }
];

const DISCOVERY_CATALOG: DiscoveryCatalogCard[] = [
  {
    name: 'Pikachu 012 Nintendo Black Star Promo',
    lane: 'quiet character promos',
    laneWhy: 'character-led promos with release-story charm and binder-page personality',
    nearby: ['Pikachu XY95 Black Star Promo', 'Pikachu RC29 Generations'],
    keywords: ['pikachu', 'promo', 'black star', 'nintendo', '012'],
    tags: ['character promo', 'nintendo era', 'black star promo', 'pikachu'],
    why: 'follows the Pikachu lane into a quieter Nintendo-era promo with strong binder-page charm',
    evidenceSearchTerm: 'Pikachu 012 Nintendo Black Star Promo',
    evidenceAliases: ['Pikachu 012 Nintendo Black Star Promo', 'Pikachu Black Star Promo 012', 'Pikachu Nintendo Promo 012'],
    requiredEvidenceTokens: ['pikachu', '012'],
    minimumExampleTotalCad: 40,
    maximumBaselineRawTotalCad: 450,
    curiosityScore: 8,
    starter: true
  },
  {
    name: 'Pikachu XY95 Black Star Promo',
    lane: 'quiet character promos',
    laneWhy: 'character-led promos with release-story charm and binder-page personality',
    nearby: ['Pikachu 012 Nintendo Black Star Promo', 'Pikachu RC29 Generations'],
    keywords: ['pikachu', 'promo', 'xy95', 'black star'],
    tags: ['character promo', 'black star promo', 'pikachu', 'illustration-forward'],
    why: 'keeps the promo identity but shifts toward a softer illustration-led pickup'
  },
  {
    name: 'Pikachu RC29 Generations',
    lane: 'playful display cards',
    laneWhy: 'cards with immediate visual charm that still feel collection-first',
    nearby: ['Pikachu 012 Nintendo Black Star Promo', 'Ditto Charmander Delta Species'],
    keywords: ['pikachu', 'generations', 'rc29', 'radiant collection'],
    tags: ['pikachu', 'radiant collection', 'playful art', 'modern nostalgia'],
    why: 'adds a playful collection texture without jumping straight to the obvious trophy promos'
  },
  {
    name: 'Mimikyu 245/236 Cosmic Eclipse',
    lane: 'character cameo art',
    laneWhy: 'Pokemon cards where the character, trainer, and scene all carry the appeal',
    nearby: ['Koffing 243/236 Cosmic Eclipse', 'Piplup 239/236 Cosmic Eclipse'],
    keywords: ['mimikyu', 'cosmic eclipse', 'character rare', 'acerola'],
    tags: ['character cameo', 'modern art rare', 'ghost type', 'trainer cameo'],
    why: 'matches collectors who like character identity, moody art, and display-friendly modern cards',
    starter: true
  },
  {
    name: 'Koffing 243/236 Cosmic Eclipse',
    lane: 'character cameo art',
    laneWhy: 'Pokemon cards where the character, trainer, and scene all carry the appeal',
    nearby: ['Mimikyu 245/236 Cosmic Eclipse', 'Piplup 239/236 Cosmic Eclipse'],
    keywords: ['koffing', 'cosmic eclipse', 'character rare', 'roxie'],
    tags: ['character cameo', 'modern art rare', 'trainer cameo', 'offbeat favorite'],
    why: 'keeps the trainer-cameo thread but points at a less obvious, personality-heavy card'
  },
  {
    name: 'Gengar Web Series',
    lane: 'Japanese-only oddities',
    laneWhy: 'release paths that feel harder to stumble into through normal marketplace browsing',
    nearby: ['Mewtwo Vending Series', 'Masaki Gengar'],
    keywords: ['gengar', 'web', 'japanese', 'jp'],
    tags: ['gengar', 'japanese exclusive', 'web series', 'vintage', 'dark atmospheric'],
    why: 'moves a Gengar chase toward a Japanese-only release with a stranger collector texture',
    starter: true
  },
  {
    name: 'Darkrai & Cresselia LEGEND',
    lane: 'unusual card formats',
    laneWhy: 'cards that stand out because the object itself has a strange format or era feel',
    nearby: ['Ho-Oh LEGEND', 'Lugia LEGEND'],
    keywords: ['darkrai', 'cresselia', 'legend', 'dark', 'night'],
    tags: ['legend', 'dark atmospheric', 'unusual format', 'legendary'],
    why: 'keeps the night-and-shadow mood while adding an unusual two-card era format'
  },
  {
    name: 'Mewtwo Vending Series',
    lane: 'Japanese-only oddities',
    laneWhy: 'release paths that feel harder to stumble into through normal marketplace browsing',
    nearby: ['Gengar Web Series', 'Vending Series Mew'],
    keywords: ['mewtwo', 'vending', 'japanese', 'jp'],
    tags: ['japanese exclusive', 'vending', 'vintage', 'legendary'],
    why: 'adds vending-machine era texture for collectors who like Japanese release stories',
    evidenceSearchTerm: 'Mewtwo Vending Series Pokemon',
    evidenceAliases: ['Mewtwo Vending Series', 'Mewtwo Glossy Vending', 'Mewtwo Japanese Vending'],
    requiredEvidenceTokens: ['mewtwo', 'vending'],
    minimumExampleTotalCad: 35,
    maximumBaselineRawTotalCad: 350,
    curiosityScore: 9
  },
  {
    name: 'Mew Southern Islands Promo',
    lane: 'mythical display cards',
    laneWhy: 'soft mythical cards with strong binder presence and approachable raw examples',
    nearby: ['Ancient Mew Promo', 'Mew Black Star Promo 040'],
    keywords: ['mew', 'shining mew', 'corocoro', 'mythical', 'southern islands'],
    tags: ['mew', 'mythical', 'promo', 'binder card', 'soft artwork'],
    why: 'branches from a Shining Mew chase into a more available raw Mew display card',
    evidenceSearchTerm: 'Mew Southern Islands Pokemon card',
    evidenceAliases: ['Mew Southern Islands', 'Mew Southern Island', 'Mew No.151 Southern Island', 'Mew 46/040 Southern Islands', 'Mew 01/18 Southern Islands'],
    requiredEvidenceTokens: ['mew'],
    curiosityScore: 7
  },
  {
    name: 'Ancient Mew Promo',
    lane: 'mythical movie promos',
    laneWhy: 'mythical promo cards with strong nostalgia and a distinct object-story feel',
    nearby: ['Mew Southern Islands Promo', 'Mew Black Star Promo 040'],
    keywords: ['mew', 'ancient mew', 'movie promo', 'promo', 'mythical'],
    tags: ['mew', 'mythical', 'movie promo', 'nostalgia', 'promo'],
    why: 'keeps the Mew thread but shifts toward a nostalgic promo that many collectors remember as an object',
    evidenceSearchTerm: 'Ancient Mew Pokemon',
    requiredEvidenceTokens: ['mew'],
    maximumBaselineRawTotalCad: 250,
    curiosityScore: 6
  },
  {
    name: 'Mew GG10 Crown Zenith',
    lane: 'soft mythical galleries',
    laneWhy: 'modern gallery cards where mythical Pokemon carry the scene more than rarity alone',
    nearby: ['Mew ex 193/165 Pokemon 151', 'Mewtwo VSTAR GG44 Crown Zenith'],
    keywords: ['mew', 'gallery', 'crown zenith', 'gg10', 'mythical'],
    tags: ['mew', 'mythical', 'gallery', 'modern display', 'soft artwork'],
    why: 'turns a Mew chase toward a softer modern gallery card with approachable raw-market depth',
    evidenceSearchTerm: 'Mew GG10 Crown Zenith',
    evidenceAliases: ['Mew GG10/GG70 Crown Zenith', 'Mew GG10 Crown Zenith', 'Mew Galarian Gallery'],
    requiredEvidenceTokens: ['mew', 'gg10']
  },
  {
    name: 'Totodile 18/25 McDonald\'s 25th Anniversary Promo',
    lane: 'starter promo side paths',
    laneWhy: 'starter Pokemon promos that keep the release-story feel without repeating the exact same grail',
    nearby: ['Pikachu 25/25 McDonald\'s 25th Anniversary Promo', 'Cyndaquil 10/25 McDonald\'s 25th Anniversary Promo'],
    keywords: ['squirtle', '007/018', 'mcdonalds', 'mcdonald\'s', 'starter promo', 'totodile', '18/25'],
    tags: ['starter pokemon', 'promo', 'mcdonalds promo', 'water type', 'special release'],
    why: 'branches from the McDonald\'s Squirtle chase into another starter promo with a lighter, set-building feel',
    evidenceSearchTerm: 'Totodile 18/25 McDonalds Pokemon',
    evidenceAliases: ['Totodile 18/25 McDonald\'s', 'Totodile 18/25 McDonalds', 'Totodile McDonald\'s 25th Anniversary'],
    requiredEvidenceTokens: ['totodile', '18', '25'],
    minimumExampleTotalCad: 20,
    curiosityScore: 3
  },
  {
    name: 'Squirtle 170/165 Pokemon 151 Illustration Rare',
    lane: 'starter illustration rares',
    laneWhy: 'starter Pokemon cards where the appeal comes from scene, nostalgia, and raw display quality',
    nearby: ['Wartortle 171/165 Pokemon 151', 'Bulbasaur 166/165 Pokemon 151'],
    keywords: ['squirtle', 'starter', 'water type', '151'],
    tags: ['squirtle', 'starter pokemon', 'illustration rare', 'water type', 'modern display'],
    why: 'keeps the Squirtle thread but moves it into a liquid modern illustration lane with healthy raw supply',
    evidenceSearchTerm: 'Squirtle 170/165 Pokemon 151',
    evidenceAliases: ['Squirtle 170/165 Pokemon 151', 'Squirtle AR SV2a 170/165', 'Squirtle Illustration Rare 170/165'],
    requiredEvidenceTokens: ['squirtle', '170', '165']
  },
  {
    name: 'Wartortle 171/165 Pokemon 151 Illustration Rare',
    lane: 'evolution-line displays',
    laneWhy: 'cards that help a favorite Pokemon grow into a small visual run instead of a single chase',
    nearby: ['Squirtle 170/165 Pokemon 151 Illustration Rare', 'Blastoise ex 200/165 Pokemon 151'],
    keywords: ['squirtle', 'wartortle', 'blastoise', '007/018', '151', 'water starter'],
    tags: ['squirtle', 'wartortle', 'starter pokemon', 'evolution line', 'illustration rare'],
    why: 'builds from Squirtle into an evolution-line page with a consistent modern illustration language',
    evidenceSearchTerm: 'Wartortle 171/165 Pokemon 151',
    evidenceAliases: ['Wartortle 171/165 Pokemon 151', 'Wartortle AR SV2a 171/165', 'Wartortle Illustration Rare 171/165'],
    requiredEvidenceTokens: ['wartortle', '171', '165']
  },
  {
    name: 'Totodile 073/071 Triplet Beat Art Rare',
    lane: 'water starter side quests',
    laneWhy: 'starter Pokemon cards that keep the playful water-type energy without repeating the exact same target',
    nearby: ['Squirtle 170/165 Pokemon 151 Illustration Rare', 'Piplup 239/236 Cosmic Eclipse'],
    keywords: ['squirtle', 'water starter', 'starter', 'totodile', 'playful art'],
    tags: ['water type', 'starter pokemon', 'art rare', 'playful art'],
    why: 'keeps the water-starter feel while branching into a playful art rare with raw-market visibility'
  },
  {
    name: 'Articuno Fossil Holo',
    lane: 'legendary bird branches',
    laneWhy: 'single-card branches from trio chases that keep the legendary identity but widen the hunt',
    nearby: ['Zapdos Fossil Holo', 'Moltres Fossil Holo'],
    keywords: ['articuno', 'zapdos', 'moltres', 'legendary birds', 'bird trio', 'sm210'],
    tags: ['legendary bird', 'vintage holo', 'wotc', 'articuno', 'trio branch'],
    why: 'turns the bird-trio chase into a cleaner single-bird vintage branch with steady raw examples'
  },
  {
    name: 'Articuno 148/147 Supreme Victors Secret Rare',
    lane: 'secret rare bird detours',
    laneWhy: 'older secret rares that keep the legendary-bird thread but feel more discovered than obvious',
    nearby: ['Zapdos 202/165 Pokemon 151 Illustration Rare', 'Articuno Fossil Holo'],
    keywords: ['articuno', 'zapdos', 'moltres', 'legendary birds', 'bird trio', 'sm210', 'secret rare', 'supreme victors'],
    tags: ['legendary bird', 'secret rare', 'vintage-adjacent', 'articuno', 'hidden gem'],
    why: 'turns the bird-trio thread toward an older secret rare that still sits below true grail territory in raw copies',
    evidenceSearchTerm: 'Articuno Supreme Victors 148/147 Pokemon',
    evidenceAliases: ['Articuno 148/147 Supreme Victors', 'Articuno Supreme Victors Secret Rare', 'Articuno Supreme Victors 148/147'],
    requiredEvidenceTokens: ['articuno', '148', '147'],
    minimumExampleTotalCad: 80,
    maximumBaselineRawTotalCad: 450,
    curiosityScore: 8
  },
  {
    name: 'Zapdos 202/165 Pokemon 151 Illustration Rare',
    lane: 'legendary bird illustration rares',
    laneWhy: 'legendary bird cards that make the chase feel scenic, modern, and display-forward',
    nearby: ['Articuno Fossil Holo', 'Moltres Fossil Holo'],
    keywords: ['zapdos', 'articuno', 'moltres', 'legendary birds', 'sm210', '151'],
    tags: ['legendary bird', 'illustration rare', 'zapdos', 'modern display'],
    why: 'branches from the trio promo into a scenic single-bird card with strong raw-market depth',
    curiosityScore: 4
  },
  {
    name: 'Moltres Zapdos Articuno GX 66/68 Hidden Fates',
    lane: 'trio centerpiece cards',
    laneWhy: 'multi-Pokemon cards that keep the group identity as the main collecting hook',
    nearby: ['Moltres Zapdos Articuno SM210', 'Articuno Fossil Holo'],
    keywords: ['moltres', 'zapdos', 'articuno', 'sm210', 'hidden fates', 'bird trio'],
    tags: ['legendary birds', 'trio card', 'promo-adjacent', 'modern gx'],
    why: 'keeps the legendary-bird trio intact while moving toward a more available raw centerpiece',
    curiosityScore: 5
  },
  {
    name: 'Monkey.D.Luffy ST01-001 Leader',
    lane: 'shonen lead cards',
    laneWhy: 'main-character cards where the appeal is identity, recognizability, and display impact',
    nearby: ['Monkey.D.Luffy OP05-119', 'Monkey.D.Luffy ST21-014'],
    keywords: ['luffy', 'st21', 'st01', 'one piece', 'leader', 'promo'],
    tags: ['one piece', 'luffy', 'leader card', 'main character', 'shonen lead'],
    why: 'branches from a Luffy promo chase into a main-character leader card with clear collection identity',
    evidenceSearchTerm: 'Monkey D Luffy ST01-001 One Piece card',
    requiredEvidenceTokens: ['luffy']
  },
  {
    name: 'Monkey.D.Luffy OP05-119 Secret Rare',
    lane: 'manga-era headline cards',
    laneWhy: 'modern One Piece cards with big character identity and strong collector conversation energy',
    nearby: ['Monkey.D.Luffy ST01-001 Leader', 'Sabo OP04-083 Super Rare'],
    keywords: ['luffy', 'op05', '119', 'secret rare', 'one piece', 'manga'],
    tags: ['one piece', 'luffy', 'secret rare', 'headline card', 'modern chase'],
    why: 'keeps Luffy as the anchor but shifts toward a higher-signal modern One Piece chase lane'
  },
  {
    name: 'Nami OP01-016 Parallel',
    lane: 'crew character parallels',
    laneWhy: 'One Piece character cards that widen a lead-character profile into crew-focused collecting',
    nearby: ['Roronoa Zoro OP01-025 Parallel', 'Monkey.D.Luffy ST01-001 Leader'],
    keywords: ['one piece', 'luffy', 'nami', 'parallel', 'crew', 'op01'],
    tags: ['one piece', 'crew character', 'parallel', 'character card'],
    why: 'widens a Luffy-centered profile into a crew-character lane with recognizable raw-market examples'
  },
  {
    name: 'Smeargle Neo Discovery',
    lane: 'offbeat vintage holos',
    laneWhy: 'older holos with personality that sit outside the obvious grail circuit',
    nearby: ['Light Arcanine Neo Destiny', "Misty's Golduck Gym Challenge"],
    keywords: ['smeargle', 'neo', 'vintage', 'holo'],
    tags: ['vintage holo', 'neo', 'offbeat favorite', 'artist energy'],
    why: 'brings vintage holo energy through a more expressive, less obvious character',
    starter: true
  },
  {
    name: 'Light Arcanine Neo Destiny',
    lane: 'character-driven vintage',
    laneWhy: 'vintage cards where the Pokemon identity matters as much as the era',
    nearby: ['Smeargle Neo Discovery', 'Ninetales Expedition H19/H32'],
    keywords: ['arcanine', 'light arcanine', 'neo destiny', 'vintage'],
    tags: ['vintage holo', 'neo', 'beloved pokemon', 'warm artwork'],
    why: 'fits collectors who like vintage presence with a gentler character-led feel'
  },
  {
    name: "Misty's Golduck Gym Challenge",
    lane: 'trainer-owned vintage',
    laneWhy: 'Gym-era cards where trainer identity adds a second collecting hook',
    nearby: ["Rocket's Scyther Gym Heroes", "Erika's Dragonair Gym Heroes"],
    keywords: ['misty', 'golduck', 'gym challenge', 'vintage'],
    tags: ['trainer owned', 'gym era', 'vintage holo', 'water type'],
    why: 'extends trainer-owned collecting into a card that feels distinctive without being the obvious headline pick'
  },
  {
    name: "Rocket's Scyther Gym Heroes",
    lane: 'trainer-owned vintage',
    laneWhy: 'Gym-era cards where trainer identity adds a second collecting hook',
    nearby: ["Misty's Golduck Gym Challenge", "Giovanni's Gyarados Gym Challenge"],
    keywords: ['rocket', 'scyther', 'gym heroes', 'vintage'],
    tags: ['trainer owned', 'gym era', 'vintage holo', 'team rocket'],
    why: 'keeps the vintage trainer identity with sharper Team Rocket display energy'
  },
  {
    name: 'Houndoom Aquapolis H11/H32',
    lane: 'e-reader atmosphere',
    laneWhy: 'early-2000s cards with sparse layouts, moody art, and quieter scarcity',
    nearby: ['Ninetales Expedition H19/H32', 'Umbreon Aquapolis H29/H32'],
    keywords: ['houndoom', 'aquapolis', 'e-reader', 'dark'],
    tags: ['e-reader', 'vintage holo', 'dark atmospheric', 'houndoom'],
    why: 'pushes a dark-art lane into e-reader texture and quieter vintage scarcity'
  },
  {
    name: 'Ninetales Expedition H19/H32',
    lane: 'e-reader atmosphere',
    laneWhy: 'early-2000s cards with sparse layouts, moody art, and quieter scarcity',
    nearby: ['Houndoom Aquapolis H11/H32', 'Dragonite Expedition H15/H32'],
    keywords: ['ninetales', 'expedition', 'e-reader', 'vintage'],
    tags: ['e-reader', 'vintage holo', 'elegant artwork', 'fire type'],
    why: 'adds e-reader era atmosphere with a graceful display card that many casual collectors miss'
  },
  {
    name: 'Ditto Charmander Delta Species',
    lane: 'playful era oddities',
    laneWhy: 'cards that feel memorable because they are strange, specific, and a little off-center',
    nearby: ['Ditto Pikachu Delta Species', 'Ditto Squirtle Delta Species'],
    keywords: ['ditto', 'charmander', 'delta species', 'ex era'],
    tags: ['delta species', 'ex era', 'playful art', 'oddity'],
    why: 'turns character collecting toward a strange, memorable ex-era oddity'
  },
  {
    name: 'Latias 105/107 Deoxys',
    lane: 'ex-era character cards',
    laneWhy: 'mid-2000s texture for collectors who like older character presence without only chasing WOTC',
    nearby: ['Latios 106/107 Deoxys', 'Jirachi 9/107 Deoxys'],
    keywords: ['latias', 'deoxys', 'ex era', 'holo'],
    tags: ['ex era', 'legendary', 'vintage-adjacent', 'holo'],
    why: 'adds mid-2000s texture for collectors circling older legendary cards'
  },
  {
    name: 'Umbreon EX 112/124 Fates Collide',
    lane: 'Eeveelution side paths',
    laneWhy: 'Eeveelution cards that widen the thread beyond the most repeated modern grails',
    nearby: ['Espeon Prime Undaunted', 'Umbreon Prime Undaunted'],
    keywords: ['umbreon', 'eevee', 'eeveelution', 'fates collide'],
    tags: ['umbreon', 'eeveelution', 'modern-era side path', 'dark type'],
    why: 'keeps the Umbreon identity but moves away from the most repeated modern chase cards'
  },
  {
    name: 'Espeon Prime Undaunted',
    lane: 'Eeveelution side paths',
    laneWhy: 'Eeveelution cards that widen the thread beyond the most repeated modern grails',
    nearby: ['Umbreon EX 112/124 Fates Collide', 'Espeon EX 52/122 BREAKpoint'],
    keywords: ['espeon', 'eevee', 'eeveelution', 'prime', 'undaunted'],
    tags: ['espeon', 'eeveelution', 'prime', 'hgss era'],
    why: 'widens an Eeveelution profile into a less common HGSS-era texture'
  }
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function tokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function chaseRawSignalText(chase: Chase): string {
  return [chase.cardName, chase.targetNote, chase.grade, chase.condition, chase.listingType].filter(Boolean).join(' ');
}

function inferChaseDiscoverySignals(chase: Chase): ChaseDiscoverySignals {
  const rawText = chaseRawSignalText(chase);
  const inferredSignals: string[] = [];
  let promoLike = PROMO_RELEASE_PATTERNS.some((pattern) => pattern.test(rawText));
  let specialReleaseLike = promoLike || SPECIAL_RELEASE_PATTERNS.some((pattern) => pattern.test(rawText));

  for (const hint of KNOWN_RELEASE_HINTS) {
    if (!hint.pattern.test(rawText)) continue;
    inferredSignals.push(hint.signals);
    promoLike = promoLike || hint.promoLike === true;
    specialReleaseLike = specialReleaseLike || hint.specialReleaseLike === true;
  }

  if (promoLike) inferredSignals.push('promo black star promo release-story character promo');
  if (specialReleaseLike) inferredSignals.push('special release limited release unusual release path');

  return {
    text: [rawText, ...inferredSignals].join(' '),
    promoLike,
    specialReleaseLike
  };
}

export function hasPromoLeaningDiscoveryProfile(chases: Chase[]): boolean {
  if (chases.length === 0) return false;
  const promoSignals = chases.filter((chase) => inferChaseDiscoverySignals(chase).promoLike);
  return promoSignals.length >= 2 || promoSignals.length / chases.length >= 0.5;
}

function textMatchesPhrase(text: string, phrase: string): boolean {
  return text.includes(normalize(phrase));
}

function scoreCard(card: DiscoveryCatalogCard, signalText: string, signalTokens: Set<string>, hasFocus: boolean, hasProfileSignals: boolean): number {
  const isOnePieceCard = card.tags.some((tag) => /\bone piece\b/i.test(tag));
  const hasOnePieceSignal = /\b(one piece|luffy|nami|zoro|sabo)\b/i.test(signalText);
  if (isOnePieceCard && !hasOnePieceSignal) return 0;

  let score = !hasProfileSignals && card.starter ? 1 : 0;
  for (const keyword of card.keywords) {
    if (textMatchesPhrase(signalText, keyword)) score += keyword.includes(' ') ? 10 : 7;
  }
  for (const tag of card.tags) {
    if (textMatchesPhrase(signalText, tag)) score += tag.includes(' ') ? 6 : 4;
    for (const token of tokens(tag)) {
      if (signalTokens.has(token)) score += 1;
    }
  }
  for (const token of tokens(card.name)) {
    if (signalTokens.has(token)) score += 3;
  }
  if (hasFocus && score === (card.starter ? 1 : 0)) return 0;
  return score;
}

function pickLane(cards: DiscoveryCatalogCard[]): string {
  const laneScores = new Map<string, number>();
  for (const card of cards) laneScores.set(card.lane, (laneScores.get(card.lane) ?? 0) + 1);
  return [...laneScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'collector curiosities';
}

function pickDistinctLaneCards(cards: DiscoveryCatalogCard[], count: number, existingLanes = new Set<string>()): DiscoveryCatalogCard[] {
  const selected: DiscoveryCatalogCard[] = [];
  const seenLanes = new Set(existingLanes);
  for (const card of cards) {
    if (seenLanes.has(card.lane)) continue;
    selected.push(card);
    seenLanes.add(card.lane);
    if (selected.length >= count) break;
  }
  return selected;
}

export function selectDiscoverySuggestions(focus: string | null, chases: Chase[], count = 3): DiscoverySelection {
  const chaseText = chases.map((chase) => inferChaseDiscoverySignals(chase).text).join(' ');
  const signalText = normalize([focus, chaseText].filter(Boolean).join(' '));
  const signalTokens = new Set(tokens(signalText));
  const hasFocus = !!focus?.trim();
  const hasProfileSignals = signalText.trim().length > 0;
  const ranked = DISCOVERY_CATALOG
    .map((card) => ({ card, score: scoreCard(card, signalText, signalTokens, hasFocus, hasProfileSignals) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
    .map(({ card }) => card);
  const selected = pickDistinctLaneCards(ranked.length > 0 ? ranked : DISCOVERY_CATALOG.filter((card) => card.starter), count);
  if (selected.length < count && !hasProfileSignals) {
    selected.push(...pickDistinctLaneCards(DISCOVERY_CATALOG.filter((card) => card.starter), count - selected.length, new Set(selected.map((card) => card.lane))));
  }

  return {
    lane: pickLane(selected),
    suggestions: selected.map(({ name, why, lane, laneWhy, nearby, evidenceSearchTerm, evidenceAliases, requiredEvidenceTokens, minimumExampleTotalCad, maximumBaselineRawTotalCad, curiosityScore }) => ({
      name,
      why,
      lane,
      laneWhy,
      nearby,
      evidenceSearchTerm,
      evidenceAliases,
      requiredEvidenceTokens,
      minimumExampleTotalCad,
      maximumBaselineRawTotalCad,
      curiosityScore
    }))
  };
}