export type PokemonReleaseAlias = {
  label: string;
  setNamePrefix: string;
  allowNumberlessFallback?: boolean;
};

export type KnownChaseCardRefinement = {
  pattern: RegExp;
  cardName: string;
  ebayKeywords: string;
};

export const POKEMON_RELEASE_ALIASES: Array<{ pattern: RegExp; alias: PokemonReleaseAlias }> = [
  { pattern: /\bcorocoro\b.*\bjumbo\b|\bjumbo\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Jumbo Promo', setNamePrefix: 'CoroCoro', allowNumberlessFallback: true } },
  { pattern: /\bcorocoro\b.*\bmagazine\b|\bmagazine\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Magazine Promo', setNamePrefix: 'CoroCoro', allowNumberlessFallback: true } },
  { pattern: /\bcorocoro\b.*\bmanga\b|\bmanga\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Manga Promo', setNamePrefix: 'CoroCoro', allowNumberlessFallback: true } },
  { pattern: /\bmcdonald'?s\b/i, alias: { label: "McDonald's Promo", setNamePrefix: "McDonald's" } },
  { pattern: /\bpok(?:e|é)mon\s*center\b/i, alias: { label: 'Pokemon Center Promo', setNamePrefix: 'Pokemon Center' } },
  { pattern: /\bblack\s*star\s*promos?\b/i, alias: { label: 'Black Star Promos', setNamePrefix: 'Black Star Promos' } },
  { pattern: /\btoys?\s*r\s*us\b/i, alias: { label: 'Toys R Us Promo', setNamePrefix: 'generations' } },
  { pattern: /\bcorocoro\b/i, alias: { label: 'CoroCoro Promo', setNamePrefix: 'CoroCoro' } }
];

export const POKEMON_PROMO_PUBLICATION_TERMS = new Set(['corocoro', 'coro coro', 'mcdonald', 'mcdonalds', 'center']);
export const POKEMON_PROMO_STYLE_STOP_TERMS = new Set(['promo', 'promos', 'promotional', 'shining', 'holo', 'foil', 'magazine', 'manga', 'japanese', 'jumbo']);

export const JAPANESE_SUBJECT_ALIASES: Record<string, string[]> = {
  blastoise: ['カメックス'],
  bulbasaur: ['フシギダネ'],
  charmander: ['ヒトカゲ'],
  charmeleon: ['リザード'],
  charizard: ['リザードン'],
  eevee: ['イーブイ'],
  espeon: ['エーフィ'],
  flareon: ['ブースター'],
  gardevoir: ['サーナイト'],
  glaceon: ['グレイシア'],
  ivysaur: ['フシギソウ'],
  jolteon: ['サンダース'],
  leafeon: ['リーフィア'],
  mew: ['ミュウ'],
  pichu: ['ピチュー'],
  pikachu: ['ピカチュウ'],
  raichu: ['ライチュウ'],
  squirtle: ['ゼニガメ'],
  sylveon: ['ニンフィア'],
  umbreon: ['ブラッキー'],
  vaporeon: ['シャワーズ'],
  venusaur: ['フシギバナ'],
  wartortle: ['カメール']
};

export const KNOWN_CHASE_CARD_REFINEMENTS: KnownChaseCardRefinement[] = [
  {
    pattern: /\bgardevoir\b.*\b(?:japanese\b.*)?0?87\s*\/\s*0?63\b/i,
    cardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
    ebayKeywords: 'Mega Gardevoir ex 087/063 M1S Japanese'
  },
  {
    pattern: /\bumbreon\b.*\b(?:ex\b.*)?(?:japanese\b.*)?217\s*\/\s*187\b/i,
    cardName: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
    ebayKeywords: 'Umbreon ex SAR Terastal Festival Japanese 217/187'
  }
];

export function knownChaseCardRefinement(value: string): KnownChaseCardRefinement | undefined {
  return KNOWN_CHASE_CARD_REFINEMENTS.find(({ pattern }) => pattern.test(value));
}

export function normalizeChaseCardName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const refinement = knownChaseCardRefinement(normalized);
  if (refinement) return refinement.cardName;

  let result = normalized
    .replace(/pok[eé]mon/gi, 'Pokemon')
    .replace(/pokemon\s*center/gi, 'Pokemon Center')
    .replace(/mcdonald'?s/gi, "McDonald's")
    .replace(/toys?\s*r\s*us/gi, 'Toys R Us')
    .replace(/black\s*star\s*(?:promos?|promo)/gi, 'Black Star Promos')
    .replace(/coro\s*coro/gi, 'CoroCoro');

  result = result.replace(/\bCoroCoro\b[\s-]*(?:Jumbo|Magazine|Manga)[\s-]*(?:Promo|Promos?)?/gi, (match) => {
    if (/Jumbo/i.test(match)) return 'CoroCoro Jumbo Promo';
    if (/Magazine/i.test(match)) return 'CoroCoro Magazine Promo';
    if (/Manga/i.test(match)) return 'CoroCoro Manga Promo';
    return 'CoroCoro Promo';
  });
  result = result.replace(/\bCoroCoro\b[\s-]*(?:Promo|Promos?|Promotional|Promotional Cards?|Cards?)\b/gi, 'CoroCoro Promo');
  result = result.replace(/\bCoroCoro\b(?!\s+(?:Jumbo|Magazine|Manga|Promo|Promos|Promotional)\b)/gi, 'CoroCoro Promo');
  result = result.replace(/\bMcDonald's\b(?!\s+Promo\b)/gi, "McDonald's Promo");
  result = result.replace(/\bPokemon Center\b\s+promos?\b/gi, 'Pokemon Center Promo');
  result = result.replace(/\bPokemon Center\b(?!\s+Promo\b)/gi, 'Pokemon Center Promo');
  result = result.replace(/\bToys R Us\b(?!\s+Promo\b)/gi, 'Toys R Us Promo');
  result = result.replace(/\bBlack Star\b(?!\s+Promos\b)/gi, 'Black Star Promos');

  return result.replace(/\s+/g, ' ').trim();
}