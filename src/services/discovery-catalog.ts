import type { Chase } from '../types.js';

export type DiscoverySuggestion = {
  name: string;
  why: string;
  lane: string;
  laneWhy: string;
  nearby: string[];
  minimumExampleTotalCad?: number;
};

type DiscoveryCatalogCard = DiscoverySuggestion & {
  keywords: string[];
  tags: string[];
  starter?: boolean;
};

export type DiscoverySelection = {
  lane: string;
  suggestions: DiscoverySuggestion[];
};

const STOP_WORDS = new Set(['and', 'card', 'cards', 'for', 'from', 'pokemon', 'the', 'with']);

const DISCOVERY_CATALOG: DiscoveryCatalogCard[] = [
  {
    name: 'Pikachu 012 Nintendo Black Star Promo',
    lane: 'quiet character promos',
    laneWhy: 'character-led promos with release-story charm and binder-page personality',
    nearby: ['Pikachu XY95 Black Star Promo', 'Pikachu RC29 Generations'],
    keywords: ['pikachu', 'promo', 'black star', 'nintendo', '012'],
    tags: ['character promo', 'nintendo era', 'black star promo', 'pikachu'],
    why: 'follows the Pikachu lane into a quieter Nintendo-era promo with strong binder-page charm',
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
    why: 'adds vending-machine era texture for collectors who like Japanese release stories'
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

function textMatchesPhrase(text: string, phrase: string): boolean {
  return text.includes(normalize(phrase));
}

function scoreCard(card: DiscoveryCatalogCard, signalText: string, signalTokens: Set<string>, hasFocus: boolean): number {
  let score = card.starter ? 1 : 0;
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
  const chaseText = chases.map((chase) => [chase.cardName, chase.targetNote, chase.grade, chase.condition, chase.listingType].filter(Boolean).join(' ')).join(' ');
  const signalText = normalize([focus, chaseText].filter(Boolean).join(' '));
  const signalTokens = new Set(tokens(signalText));
  const hasFocus = !!focus?.trim();
  const ranked = DISCOVERY_CATALOG
    .map((card) => ({ card, score: scoreCard(card, signalText, signalTokens, hasFocus) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
    .map(({ card }) => card);
  const selected = pickDistinctLaneCards(ranked.length > 0 ? ranked : DISCOVERY_CATALOG.filter((card) => card.starter), count);
  if (selected.length < count) {
    selected.push(...pickDistinctLaneCards(DISCOVERY_CATALOG.filter((card) => card.starter), count - selected.length, new Set(selected.map((card) => card.lane))));
  }

  return {
    lane: pickLane(selected),
    suggestions: selected.map(({ name, why, lane, laneWhy, nearby, minimumExampleTotalCad }) => ({
      name,
      why,
      lane,
      laneWhy,
      nearby,
      minimumExampleTotalCad
    }))
  };
}