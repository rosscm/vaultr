import {
  JAPANESE_SUBJECT_ALIASES,
  POKEMON_PROMO_PUBLICATION_TERMS,
  POKEMON_PROMO_STYLE_STOP_TERMS,
  POKEMON_RELEASE_ALIASES,
  normalizeChaseCardName
} from './collector-card-aliases.js';
import type { PokemonReleaseAlias } from './collector-card-aliases.js';
import { hasHighConfidenceLocalCatalogMatch, searchLocalCardCatalog } from './card-catalog/search.js';
import type { LocalCardCatalogChoice } from './card-catalog/types.js';

export { normalizeChaseCardName } from './collector-card-aliases.js';

export type ChaseCardAutocompleteChoice = {
  name: string;
  value: string;
};

export type CachedChaseCardPreview = {
  imageUrl?: string;
  imageIdentity?: string;
  imageSourceName?: string;
  imageSourceKind?: 'CARD_REFERENCE' | 'MARKET_LISTING';
  imageSourceCardId?: string;
};

type ChaseCardCatalogResult = ChaseCardAutocompleteChoice & CachedChaseCardPreview;

export type TrustedChaseCardPreview = Required<Pick<CachedChaseCardPreview, 'imageUrl' | 'imageIdentity' | 'imageSourceKind' | 'imageSourceName' | 'imageSourceCardId'>>;

type CardCatalogProvider = 'POKEMONTCG' | 'TCGDEX_EN' | 'TCGDEX_JA';
type ProviderSearchStatus = 'SUCCESS' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UPSTREAM_ERROR';

type ProviderSearchResult = {
  provider: CardCatalogProvider;
  status: ProviderSearchStatus;
  choices: ChaseCardCatalogResult[];
  httpStatus?: number;
  durationMs: number;
  attempted: boolean;
};

export type ChaseCardAutocompleteResult = {
  choices: ChaseCardAutocompleteChoice[];
  availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  unavailable: boolean;
  stale: boolean;
};

export type TrustedChaseCardReferenceResolution =
  | {
      status: 'RESOLVED';
      requestedCardName: string;
      resolvedCardName: string;
      preview: TrustedChaseCardPreview;
    }
  | {
      status: 'NO_MATCH' | 'AMBIGUOUS' | 'FALLBACK_ONLY' | 'CONFLICTING_NUMBER' | 'CONFLICTING_RELEASE';
      requestedCardName: string;
      normalizedCardName: string;
      candidateCount?: number;
      candidates?: Array<{ name: string; value: string; imageSourceName?: string; imageSourceCardId?: string }>;
    };

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string; printedTotal?: number };
};

type TcgDexCardSummary = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
};

type TcgDexCard = TcgDexCardSummary & {
  set?: { name?: string; id?: string; cardCount?: { official?: number; total?: number } };
};

type ExactTrustedSourceChoice = {
  pattern: RegExp;
  choice: ChaseCardCatalogResult;
};

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const TCGDEX_EN_CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/en/cards';
const TCGDEX_JA_CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
const POKEMONTCG_AUTOCOMPLETE_TIMEOUT_MS = 5000;
const TCGDEX_AUTOCOMPLETE_TIMEOUT_MS = 3000;
const AUTOCOMPLETE_CACHE_TTL_MS = 60 * 60 * 1000;
const AUTOCOMPLETE_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTOCOMPLETE_STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const POKEMON_AUTOCOMPLETE_LIMIT = 16;
const POKEMON_QUERY_VARIANT_LIMIT = 8;
const POKEMON_CONTEXT_STOP_TERMS = new Set(['card', 'cards', 'pokemon', 'tcg']);
const POKEMON_NUMBER_PREFIX_TERMS = new Set(['bw', 'dp', 'rc', 'sm', 'sv', 'svp', 'swsh', 'xy']);
const BARE_CARD_NUMBER_HELPER_TEXT = 'Keep typing: add the card name with this number';
const autocompleteCache = new Map<string, { freshUntil: number; staleUntil: number; result: ChaseCardAutocompleteResult }>();
const autocompletePreviewCache = new Map<string, { expiresAt: number; preview: CachedChaseCardPreview }>();

const EXACT_TRUSTED_SOURCE_CHOICES: ExactTrustedSourceChoice[] = [
  {
    pattern: /\bsquirtle\b.*\bjapanese\b.*\bpromo\b.*0?07\s*\/\s*0?18\b|\bsquirtle\b.*\bmcdonald'?s\b.*0?07\s*\/\s*0?18\b|\bsquirtle\b.*0?07\s*\/\s*0?18\b.*\bmcdonald'?s\b/i,
    choice: {
      name: "Squirtle Japanese McDonald's Pokémon-e Minimum Pack 007/018",
      value: "Squirtle Japanese McDonald's Pokémon-e Minimum Pack 007/018",
      imageUrl: 'https://static.dextcg.com/cards/jpn_mcdemp/7.png',
      imageIdentity: "Squirtle Japanese McDonald's Pokémon-e Minimum Pack 007/018",
      imageSourceName: 'DEXTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'jpn_mcdemp-7'
    }
  },
  {
    pattern: /\bgardevoir\b.*\bpaldean\s+fates\b.*\b233\b|\bgardevoir\b.*\b233\b.*\bpaldean\s+fates\b/i,
    choice: {
      name: 'Gardevoir ex — Paldean Fates #233',
      value: 'Gardevoir ex Paldean Fates 233',
      imageUrl: 'https://images.pokemontcg.io/sv4pt5/233_hires.png',
      imageIdentity: 'Gardevoir ex Paldean Fates 233',
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'sv4pt5-233'
    }
  },
  {
    pattern: /\bpikachu\b.*\bxy\s*95\b|\bpikachu\b.*\bxy\s+black\s+star\s+promos\b.*\b95\b/i,
    choice: {
      name: 'Pikachu — XY Black Star Promos #XY95',
      value: 'Pikachu Black Star Promos XY95',
      imageUrl: 'https://images.pokemontcg.io/xyp/XY95_hires.png',
      imageIdentity: 'Pikachu Black Star Promos XY95',
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'xyp-XY95'
    }
  },
  {
    pattern: /\bmew\b.*\blegendary\s+treasures\b.*\brc\s*24\b|\bmew\b.*\brc\s*24\b.*\blegendary\s+treasures\b/i,
    choice: {
      name: 'Mew-EX — Legendary Treasures #RC24',
      value: 'Mew-EX Legendary Treasures RC24',
      imageUrl: 'https://images.pokemontcg.io/bw11/RC24_hires.png',
      imageIdentity: 'Mew-EX Legendary Treasures RC24',
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'bw11-RC24'
    }
  },
  {
    pattern: /\bmoltres\b.*\bzapdos\b.*\barticuno\b.*\bsm\s*210\b|\blegendary\s+birds\b.*\bsm\s*210\b/i,
    choice: {
      name: 'Moltres & Zapdos & Articuno-GX — SM Black Star Promos #SM210',
      value: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210',
      imageUrl: 'https://images.pokemontcg.io/smp/SM210_hires.png',
      imageIdentity: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210',
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'smp-SM210'
    }
  },
  {
    pattern: /\bumbreon\b.*\b(?:ex\b.*)?(?:japanese\b.*)?217\s*\/\s*187\b/i,
    choice: {
      name: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      value: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV8a/217/high.png',
      imageIdentity: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      imageSourceName: 'TCGDEX',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'SV8a-217'
    }
  },
  {
    pattern: /\bgardevoir\b.*\b(?:mega\b.*)?(?:ex\b.*)?(?:sar\b.*)?(?:mega\s+symphonia\b.*)?(?:japanese\b.*)?0?87\s*\/\s*0?63\b/i,
    choice: {
      name: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      value: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      imageUrl: 'https://static.dextcg.com/cards/jpn_m1s/87.png',
      imageIdentity: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      imageSourceName: 'DEXTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'jpn_m1s-87'
    }
  },
  {
    pattern: /\bmew\b.*\b(?:ex\b.*)?(?:sar\b.*)?(?:shiny\s+treasure\b.*)?(?:japanese\b.*)?347\s*\/\s*190\b/i,
    choice: {
      name: 'Mew ex SAR Shiny Treasure Japanese 347/190',
      value: 'Mew ex SAR Shiny Treasure Japanese 347/190',
      imageUrl: 'https://assets.tcgdex.net/ja/SV/SV4a/347/high.png',
      imageIdentity: 'Mew ex SAR Shiny Treasure Japanese 347/190',
      imageSourceName: 'TCGDEX',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'SV4a-347'
    }
  }
];

function exactTrustedSourceChoicesForQuery(query: string): ChaseCardCatalogResult[] {
  return EXACT_TRUSTED_SOURCE_CHOICES
    .filter(({ pattern }) => pattern.test(query))
    .map(({ choice }) => choice);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeTcgDexQuery(value: string): string {
  return normalize(value.replace(/\b(0?\d{1,3})([a-z][a-z0-9]*)\b/gi, '$1 $2'));
}

function truncateChoice(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

function bareCardNumberHelperChoice(query: string): ChaseCardAutocompleteChoice | undefined {
  const trimmed = query.trim();
  if (!/^0?\d{1,3}$/.test(trimmed)) return undefined;
  return { name: BARE_CARD_NUMBER_HELPER_TEXT, value: truncateChoice(trimmed) };
}

function uniqueChoices(choices: ChaseCardCatalogResult[], limit: number): ChaseCardAutocompleteChoice[] {
  const seen = new Set<string>();
  const unique: ChaseCardAutocompleteChoice[] = [];
  for (const choice of choices) {
    const key = normalize(choice.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cacheAutocompletePreview(choice.value, {
      imageUrl: choice.imageUrl,
      imageIdentity: choice.imageIdentity,
      imageSourceName: choice.imageSourceName,
      imageSourceKind: choice.imageSourceKind,
      imageSourceCardId: choice.imageSourceCardId
    });
    unique.push({ name: truncateChoice(choice.name), value: truncateChoice(choice.value) });
    if (unique.length >= limit) break;
  }
  return unique;
}

function cacheAutocompletePreview(cardName: string, preview: CachedChaseCardPreview): void {
  const expiresAt = Date.now() + AUTOCOMPLETE_CACHE_TTL_MS;
  const keys = new Set<string>([
    normalize(cardName),
    normalize(normalizeChaseCardName(cardName))
  ]);
  for (const key of keys) {
    if (!key) continue;
    autocompletePreviewCache.set(key, { expiresAt, preview });
  }
}

class ProviderFetchError extends Error {
  constructor(
    message: string,
    readonly status: Exclude<ProviderSearchStatus, 'SUCCESS'>,
    readonly provider: CardCatalogProvider,
    readonly durationMs: number,
    readonly httpStatus?: number
  ) {
    super(message);
  }
}

function providerTimeoutMs(provider: CardCatalogProvider): number {
  return provider === 'POKEMONTCG' ? POKEMONTCG_AUTOCOMPLETE_TIMEOUT_MS : TCGDEX_AUTOCOMPLETE_TIMEOUT_MS;
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderFetchError) {
    return error.status === 'TIMEOUT' || error.status === 'NETWORK_ERROR' || [500, 502, 503, 504].includes(error.httpStatus ?? 0);
  }
  return false;
}

function providerFailureFromError(error: unknown, provider: CardCatalogProvider, startedAt: number): ProviderFetchError {
  if (error instanceof ProviderFetchError) return error;
  const durationMs = Date.now() - startedAt;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderFetchError('Card autocomplete provider timed out', 'TIMEOUT', provider, durationMs);
  }
  return new ProviderFetchError('Card autocomplete provider network error', 'NETWORK_ERROR', provider, durationMs);
}

function logProviderFailure(error: ProviderFetchError, query: string): void {
  const http = error.httpStatus ? ` http=${error.httpStatus}` : '';
  console.warn(`card catalog provider failure provider=${error.provider} status=${error.status}${http} durationMs=${error.durationMs} query=${normalize(query)}`);
}

async function fetchJsonWithProvider(url: string, provider: CardCatalogProvider): Promise<any> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs(provider));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ProviderFetchError(
        `Card autocomplete request failed: ${response.status}`,
        response.status === 429 || response.status >= 500 ? 'UPSTREAM_ERROR' : 'NETWORK_ERROR',
        provider,
        Date.now() - startedAt,
        response.status
      );
    }
    return await response.json();
  } catch (error) {
    throw providerFailureFromError(error, provider, startedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(url: string, provider: CardCatalogProvider, query: string): Promise<any> {
  try {
    return await fetchJsonWithProvider(url, provider);
  } catch (error) {
    const first = providerFailureFromError(error, provider, Date.now());
    logProviderFailure(first, query);
    if (!isRetryableProviderError(first) || first.httpStatus === 429) throw first;
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      return await fetchJsonWithProvider(url, provider);
    } catch (retryError) {
      const second = providerFailureFromError(retryError, provider, Date.now());
      logProviderFailure(second, query);
      throw second;
    }
  }
}

async function providerSearch(
  provider: CardCatalogProvider,
  query: string,
  attempted: boolean,
  search: () => Promise<ChaseCardCatalogResult[]>
): Promise<ProviderSearchResult> {
  const startedAt = Date.now();
  if (!attempted) {
    return { provider, status: 'SUCCESS', choices: [], durationMs: 0, attempted: false };
  }
  try {
    return {
      provider,
      status: 'SUCCESS',
      choices: await search(),
      durationMs: Date.now() - startedAt,
      attempted: true
    };
  } catch (error) {
    const failure = providerFailureFromError(error, provider, startedAt);
    return {
      provider,
      status: failure.status,
      choices: [],
      httpStatus: failure.httpStatus,
      durationMs: failure.durationMs,
      attempted: true
    };
  }
}

function pokemonTcgSearchQueries(query: string): string[] {
  const allTerms = normalize(query).split(' ').filter(Boolean);
  const terms = allTerms.slice(0, 4);
  if (terms.length === 0) return [];
  const number = /\b(?:[a-z]{0,4}\d{1,4}|\d{1,4}\s*\/\s*\d{1,4})\b/i.exec(query)?.[0]?.replace(/\s/g, '');
  const publicationTerms = allTerms.filter((term) => POKEMON_PROMO_PUBLICATION_TERMS.has(term));
  const searchableTerms = terms.filter((term) => !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term) && !/^[a-z]{1,4}\d{1,4}$/.test(term) && !POKEMON_CONTEXT_STOP_TERMS.has(term) && !POKEMON_PROMO_PUBLICATION_TERMS.has(term) && !POKEMON_PROMO_STYLE_STOP_TERMS.has(term));
  if (searchableTerms.length === 0) return [];
  const releaseAlias = pokemonTcgReleaseAlias(query);
  const publicationSubject = allTerms.filter((term) => !POKEMON_PROMO_PUBLICATION_TERMS.has(term) && !POKEMON_PROMO_STYLE_STOP_TERMS.has(term) && !POKEMON_CONTEXT_STOP_TERMS.has(term))[0] ?? searchableTerms[0];

  const queries: string[] = [];
  const addQuery = (parts: string[]) => {
    if (queries.length >= POKEMON_QUERY_VARIANT_LIMIT) return;
    const q = parts.filter(Boolean).join(' ');
    if (q && !queries.includes(q)) queries.push(q);
  };

  const addPlannedQueries = (nameTerms: string[], contextTerms: string[]) => {
    const nameParts = nameTerms.map((term) => `name:${term}*`);
    if (nameParts.length === 0) return;
    if (contextTerms.length > 0) {
      addQuery([...nameParts, ...contextTerms.map((term) => `set.name:${term}*`)]);
      for (const term of contextTerms) {
        addQuery([...nameParts, `set.series:${term}`]);
        addQuery([...nameParts, `set.id:${term}`]);
        if (POKEMON_NUMBER_PREFIX_TERMS.has(term)) addQuery([...nameParts, `number:${term}*`]);
      }
    }
    if (number) addQuery([...nameParts, `number:${pokemonTcgNumberQueryValue(number)}`]);
  };

  if (number) addQuery([`name:${searchableTerms[0]}*`, `number:${pokemonTcgNumberQueryValue(number)}`]);
  if (releaseAlias) {
    const namePart = `name:${publicationTerms.length > 0 ? publicationSubject : searchableTerms[0]}*`;
    if (number) addQuery([namePart, `number:${pokemonTcgNumberQueryValue(number)}`, `set.name:${releaseAlias.setNamePrefix}*`]);
    addQuery([namePart, `set.name:${releaseAlias.setNamePrefix}*`]);
    if (publicationTerms.length > 0 || releaseAlias.setNamePrefix.toLowerCase() === 'corocoro') {
      addQuery([namePart, 'rarity:Promo']);
    }
  }

  if (searchableTerms.length >= 2) {
    for (let subjectLength = 1; subjectLength < searchableTerms.length; subjectLength++) {
      addPlannedQueries(searchableTerms.slice(0, subjectLength), searchableTerms.slice(subjectLength));
    }
  }

  addQuery(searchableTerms.map((term) => `name:${term}*`));
  addQuery([`name:${searchableTerms[0]}*`]);
  return queries;
}

function pokemonTcgNumberQueryValue(number: string): string {
  const value = number.replace(/\/\d+$/, '').toLowerCase();
  return /^[a-z]{1,4}\d{1,4}$/.test(value) ? `${value}*` : value;
}

function pokemonTcgReleaseSetMatches(card: PokemonTcgCard, releaseAlias: PokemonReleaseAlias): boolean {
  const normalizedSetName = normalize(card.set?.name ?? '');
  const normalizedPrefix = normalize(releaseAlias.setNamePrefix);
  return normalizedSetName.startsWith(normalizedPrefix) || normalizedSetName.includes(` ${normalizedPrefix}`);
}

function pokemonTcgReleaseAlias(query: string): PokemonReleaseAlias | undefined {
  return POKEMON_RELEASE_ALIASES.find(({ pattern }) => pattern.test(query))?.alias;
}

function pokemonTcgQuerySubject(query: string): string | undefined {
  return normalize(query)
    .split(' ')
    .filter((term) => term.length >= 2 && !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term) && !/^[a-z]{1,4}\d{1,4}$/.test(term) && !POKEMON_CONTEXT_STOP_TERMS.has(term) && !POKEMON_PROMO_PUBLICATION_TERMS.has(term) && !POKEMON_PROMO_STYLE_STOP_TERMS.has(term))[0];
}

function pokemonTcgRequestedNumberPrefix(query: string): string | undefined {
  const terms = normalize(query).split(' ').filter(Boolean).slice(1);
  return terms.find((term) => {
    if (POKEMON_CONTEXT_STOP_TERMS.has(term)) return false;
    if (term === 'rc') return true;
    return /^[a-z]{1,4}\d{1,4}$/.test(term);
  });
}

function pokemonTcgCardMatchesQuerySubject(card: PokemonTcgCard, querySubject: string | undefined): boolean {
  if (!querySubject || !card.name) return true;
  return normalize(card.name).split(' ').includes(querySubject);
}

function pokemonTcgCardMatchesNumberPrefix(card: PokemonTcgCard, numberPrefix: string | undefined): boolean {
  if (!numberPrefix) return true;
  return normalize(card.number ?? '').startsWith(numberPrefix);
}

function pokemonTcgCardMatchesCollectorNumber(card: PokemonTcgCard, collectorNumber: RequestedCollectorNumber | undefined): boolean {
  if (!collectorNumber) return true;
  const number = card.number ?? '';
  const localNumber = number.replace(/\/\d+$/, '');
  if (localNumber.padStart(3, '0') !== collectorNumber.localId) return false;
  if (!card.set?.printedTotal) return true;
  return printedTotalMatchesPrefix(card.set.printedTotal, collectorNumber.totalPrefix);
}

function pokemonTcgCardMatchesStandaloneNumber(card: PokemonTcgCard, cardNumber: RequestedStandaloneCardNumber | undefined): boolean {
  if (!cardNumber) return true;
  const number = card.number ?? '';
  if (!/^\d{1,4}$/.test(number)) return true;
  const normalizedNumber = number.padStart(3, '0');
  if (cardNumber.raw.length >= 3) return normalizedNumber === cardNumber.normalized;
  return localIdMatchesStandaloneRequest(number, cardNumber);
}

function pokemonTcgExplicitSetContextTerms(query: string, card: PokemonTcgCard): string[] {
  const nameTermCounts = new Map<string, number>();
  for (const term of normalize(card.name ?? '').split(' ').filter(Boolean)) {
    nameTermCounts.set(term, (nameTermCounts.get(term) ?? 0) + 1);
  }
  const requestedNumbers = [
    requestedCollectorNumber(query)?.localId,
    requestedStandaloneCardNumber(query)?.normalized,
    pokemonTcgRequestedNumberPrefix(query)
  ].filter((value): value is string => !!value);
  const requestedNumberTerms = new Set(requestedNumbers.flatMap((number) => [
    number,
    number.replace(/^0+/, '')
  ]));
  return normalize(query)
    .split(' ')
    .filter((term) => term.length >= 2)
    .filter((term) => {
      const remainingNameUses = nameTermCounts.get(term) ?? 0;
      if (remainingNameUses <= 0) return true;
      nameTermCounts.set(term, remainingNameUses - 1);
      return false;
    })
    .filter((term) => !requestedNumberTerms.has(term))
    .filter((term) => !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term) && !/^[a-z]{1,4}\d{1,4}$/.test(term))
    .filter((term) => !POKEMON_CONTEXT_STOP_TERMS.has(term))
    .filter((term) => !POKEMON_PROMO_PUBLICATION_TERMS.has(term))
    .filter((term) => !POKEMON_PROMO_STYLE_STOP_TERMS.has(term));
}

function pokemonTcgCardMatchesExplicitSetContext(card: PokemonTcgCard, query: string): boolean {
  if (pokemonTcgReleaseAlias(query)) return true;
  const terms = pokemonTcgExplicitSetContextTerms(query, card);
  if (terms.length < 2) return true;
  const setText = normalize(card.set?.name ?? '');
  return terms.every((term) => setText.includes(term));
}

async function pokemonTcgAutocompleteChoices(query: string, limit: number): Promise<ChaseCardCatalogResult[]> {
  const queries = pokemonTcgSearchQueries(query);
  if (queries.length === 0) return [];
  const responses = await Promise.all(queries.map(async (q): Promise<{ ok: true; cards: PokemonTcgCard[] } | { ok: false; error: unknown }> => {
    try {
      const params = new URLSearchParams({ q, pageSize: String(Math.min(limit, POKEMON_AUTOCOMPLETE_LIMIT)), select: 'id,name,number,set' });
      const json = await fetchJsonWithRetry(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`, 'POKEMONTCG', query);
      return { ok: true, cards: Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [] };
    } catch (error) {
      return { ok: false, error };
    }
  }));
  if (responses.length > 0 && responses.every((response) => !response.ok)) {
    throw (responses.find((response) => !response.ok) as { ok: false; error: unknown }).error;
  }
  const cards = responses.flatMap((response) => response.ok ? response.cards : []);
  const querySubject = pokemonTcgQuerySubject(query);
  const numberPrefix = pokemonTcgRequestedNumberPrefix(query);
  const releaseAlias = pokemonTcgReleaseAlias(query);
  const collectorNumber = requestedCollectorNumber(query);
  const standaloneCardNumber = requestedStandaloneCardNumber(query);
  const includePrintedTotal = !!requestedCollectorNumber(query);
  return cards
    .filter((card) => card.name && card.number)
    .filter((card) => pokemonTcgCardMatchesQuerySubject(card, querySubject))
    .filter((card) => pokemonTcgCardMatchesNumberPrefix(card, numberPrefix))
    .filter((card) => pokemonTcgCardMatchesCollectorNumber(card, collectorNumber))
    .filter((card) => pokemonTcgCardMatchesStandaloneNumber(card, standaloneCardNumber))
    .filter((card) => !releaseAlias || pokemonTcgReleaseSetMatches(card, releaseAlias))
    .filter((card) => pokemonTcgCardMatchesExplicitSetContext(card, query))
    .map((card) => {
      const setName = card.set?.name;
      const releaseLabel = pokemonTcgReleaseChoiceLabel(card, releaseAlias);
      const numberLabel = pokemonTcgChoiceNumberLabel(card, releaseAlias, includePrintedTotal);
      const value = [card.name, releaseLabel ?? setName, numberLabel].filter(Boolean).join(' ');
      return {
        name: truncateChoice(releaseLabel ? `${card.name} — ${releaseLabel} #${numberLabel}` : setName ? `${card.name} — ${setName} #${numberLabel}` : `${card.name} #${numberLabel}`),
        value: truncateChoice(value),
        imageUrl: pokemonTcgImageUrl(card),
        imageIdentity: normalizeChaseCardName(value),
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: card.id
      };
    });
}

function pokemonTcgChoiceNumberLabel(card: PokemonTcgCard, releaseAlias: PokemonReleaseAlias | undefined, includePrintedTotal: boolean): string | undefined {
  if (!card.number) return undefined;
  if ((!releaseAlias && !includePrintedTotal) || !card.set?.printedTotal || /^[a-z]/i.test(card.number)) return card.number;
  return `${card.number}/${card.set.printedTotal}`;
}

function pokemonTcgReleaseChoiceLabel(card: PokemonTcgCard, releaseAlias: PokemonReleaseAlias | undefined): string | undefined {
  if (!releaseAlias) return undefined;
  if (!pokemonTcgReleaseSetMatches(card, releaseAlias)) return undefined;
  return releaseAlias.label;
}

function pokemonTcgImageUrl(card: PokemonTcgCard): string | undefined {
  const setId = card.id?.split('-')[0];
  return setId && card.number ? `https://images.pokemontcg.io/${setId}/${encodeURIComponent(card.number)}_hires.png` : undefined;
}

function tcgDexPrintedTotal(card: TcgDexCard): number | undefined {
  return card.set?.cardCount?.official ?? card.set?.cardCount?.total;
}

function tcgDexImageUrl(card: TcgDexCard): string | undefined {
  return card.image ? `${card.image}/high.png` : undefined;
}

function hasTcgDexAutocompleteSignal(query: string): boolean {
  const querySubject = tcgDexQuerySubject(query);
  const hasLocalNumber = /\b0?\d{1,3}\b/.test(normalizeTcgDexQuery(query));
  return /\bjapanese\b/i.test(query) || /[\u3040-\u30ff\u3400-\u9fff]/.test(query) || !!(tcgDexKnownSubject(querySubject) && hasLocalNumber);
}

type RequestedCollectorNumber = {
  localId: string;
  totalPrefix: string;
};

type RequestedStandaloneCardNumber = {
  raw: string;
  normalized: string;
};

type RequestedAlphanumericCardNumber = {
  raw: string;
  prefix: string;
  digits: string;
};

function requestedCollectorNumber(query: string): RequestedCollectorNumber | undefined {
  const match = /\b(0?\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(query);
  if (!match) return undefined;
  return { localId: match[1].padStart(3, '0'), totalPrefix: match[2] };
}

function pokemonReleaseFallbackChoice(query: string): ChaseCardAutocompleteChoice | undefined {
  const releaseAlias = pokemonTcgReleaseAlias(query);
  if (!releaseAlias) return undefined;
  const subject = pokemonTcgQuerySubject(query);
  if (!subject) return undefined;
  const number = /\b(?:[a-z]{0,4}\d{1,4}|\d{1,4}\s*\/\s*\d{1,4})\b/i.exec(query)?.[0]?.replace(/\s/g, '');
  if (!number && !releaseAlias.allowNumberlessFallback) return undefined;
  const displaySubject = subject.replace(/^./, (letter) => letter.toUpperCase());
  const value = normalizeChaseCardName([displaySubject, releaseAlias.label, number].filter(Boolean).join(' '));
  return { name: value, value };
}

function japanesePromoFallbackChoice(query: string): ChaseCardAutocompleteChoice | undefined {
  const match = /\b(0?\d{1,3})\s*\/\s*(\d{2,3})\b/.exec(query);
  if (!match) return undefined;
  const knownSubject = tcgDexKnownSubject(tcgDexQuerySubject(query));
  if (!knownSubject) return undefined;
  const localId = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(localId) || !Number.isFinite(total) || total > 30 || localId > total) return undefined;
  const numberLabel = `${match[1].padStart(3, '0')}/${match[2].padStart(3, '0')}`;
  const displaySubject = knownSubject.replace(/^./, (letter) => letter.toUpperCase());
  const value = `${displaySubject} Japanese Promo ${numberLabel}`;
  return { name: value, value };
}

function requestedStandaloneCardNumber(query: string): RequestedStandaloneCardNumber | undefined {
  if (requestedCollectorNumber(query)) return undefined;
  const match = /\b0?\d{1,3}\b/.exec(query) ?? /\b(0?\d{1,3})(?=[a-z])/i.exec(query);
  const raw = match?.[1] ?? match?.[0];
  if (!raw) return undefined;
  return { raw, normalized: raw.padStart(3, '0') };
}

function requestedAlphanumericCardNumber(query: string): RequestedAlphanumericCardNumber | undefined {
  const match = /\b([a-z]{1,4})(\d{1,4})\b/i.exec(query);
  if (!match) return undefined;
  return {
    raw: match[0],
    prefix: match[1]!.toLowerCase(),
    digits: match[2]!
  };
}

function tcgDexLocalIdCandidates(rawLocalId: string | undefined, allowPrefix: boolean): string[] {
  if (!rawLocalId) return [];
  const candidates = new Set([rawLocalId.padStart(3, '0')]);
  if (allowPrefix && rawLocalId.length === 2) {
    for (let suffix = 0; suffix <= 9; suffix += 1) {
      candidates.add(`${rawLocalId}${suffix}`);
    }
  }
  return [...candidates];
}

function tcgDexEnglishLocalIdCandidates(query: string): string[] {
  const candidates = new Set<string>();
  const collectorNumber = requestedCollectorNumber(query);
  if (collectorNumber) {
    candidates.add(collectorNumber.localId.replace(/^0+/, '') || '0');
    candidates.add(collectorNumber.localId);
  }
  const standaloneNumber = requestedStandaloneCardNumber(query);
  if (standaloneNumber) {
    candidates.add(standaloneNumber.raw.replace(/^0+/, '') || '0');
    candidates.add(standaloneNumber.normalized);
  }
  const alphanumeric = requestedAlphanumericCardNumber(query);
  if (alphanumeric) {
    candidates.add(alphanumeric.raw.toUpperCase());
    candidates.add(`${alphanumeric.prefix.toUpperCase()}${alphanumeric.digits}`);
    candidates.add(alphanumeric.digits.replace(/^0+/, '') || '0');
    candidates.add(alphanumeric.digits.padStart(3, '0'));
  }
  return [...candidates].filter(Boolean);
}

function hasTcgDexEnglishAutocompleteSignal(query: string): boolean {
  if (/\bjapanese\b/i.test(query) || /[\u3040-\u30ff\u3400-\u9fff]/.test(query)) return false;
  const subject = pokemonTcgQuerySubject(query);
  if (!subject) return false;
  return subject.length >= 3 || tcgDexEnglishLocalIdCandidates(query).length > 0;
}

function tcgDexKnownSubject(querySubject: string | undefined): string | undefined {
  if (!querySubject) return undefined;
  if (JAPANESE_SUBJECT_ALIASES[querySubject]) return querySubject;
  if (querySubject.length < 3) return undefined;
  const matches = Object.keys(JAPANESE_SUBJECT_ALIASES).filter((subject) => subject.startsWith(querySubject));
  return matches.length === 1 ? matches[0] : undefined;
}

function tcgDexAliasNameQueries(querySubject: string | undefined): string[] {
  const knownSubject = tcgDexKnownSubject(querySubject);
  return knownSubject ? JAPANESE_SUBJECT_ALIASES[knownSubject] ?? [] : [];
}

function printedTotalMatchesPrefix(total: number | undefined, totalPrefix: string): boolean {
  if (total === undefined) return false;
  const totalText = String(total);
  const paddedTotalText = totalText.padStart(3, '0');
  return totalText.startsWith(totalPrefix) || paddedTotalText.startsWith(totalPrefix);
}

function choiceMatchesCollectorNumber(choice: ChaseCardCatalogResult, collectorNumber: RequestedCollectorNumber): boolean {
  const text = [choice.name, choice.value].join(' ');
  const slashNumbers = text.match(/\b0?\d{1,3}\s*\/\s*\d{1,3}\b/g) ?? [];
  return slashNumbers.some((number) => {
    const [localRaw, totalRaw] = number.split('/').map((part) => part.trim());
    return localRaw.padStart(3, '0') === collectorNumber.localId && totalRaw.startsWith(collectorNumber.totalPrefix);
  });
}

function localIdMatchesStandaloneRequest(localId: string, cardNumber: RequestedStandaloneCardNumber): boolean {
  const normalizedLocalId = localId.padStart(3, '0');
  const compactLocalId = normalizedLocalId.replace(/^0+/, '') || '0';
  return normalizedLocalId === cardNumber.normalized || compactLocalId.startsWith(cardNumber.raw);
}

function choiceMatchesStandaloneCardNumber(choice: ChaseCardCatalogResult, cardNumber: RequestedStandaloneCardNumber): boolean {
  const text = [choice.name, choice.value].join(' ');
  const slashNumbers = text.match(/\b0?\d{1,3}\s*\/\s*\d{1,3}\b/g) ?? [];
  if (slashNumbers.some((number) => localIdMatchesStandaloneRequest(number.split('/')[0]?.trim() ?? '', cardNumber))) return true;

  const hashNumbers = text.match(/#\s*0?\d{1,3}\b/g) ?? [];
  if (hashNumbers.some((number) => localIdMatchesStandaloneRequest(number.replace(/[^0-9]/g, ''), cardNumber))) return true;

  const tokens = normalize(text).split(' ').filter(Boolean);
  return tokens.some((token) => /^0?\d{1,3}$/.test(token) && localIdMatchesStandaloneRequest(token, cardNumber));
}

function fallbackOnlyChoice(query: string): ChaseCardAutocompleteChoice | undefined {
  return japanesePromoFallbackChoice(query) ?? pokemonReleaseFallbackChoice(query);
}

function choiceHasTrustedPreview(choice: ChaseCardCatalogResult): boolean {
  return !!choice.imageUrl &&
    !!choice.imageIdentity &&
    !!choice.imageSourceName &&
    !!choice.imageSourceCardId &&
    choice.imageSourceKind === 'CARD_REFERENCE';
}

function trustedChoicePreview(choice: ChaseCardCatalogResult): TrustedChaseCardPreview {
  return {
    imageUrl: choice.imageUrl!,
    imageIdentity: choice.imageIdentity!,
    imageSourceName: choice.imageSourceName!,
    imageSourceKind: 'CARD_REFERENCE',
    imageSourceCardId: choice.imageSourceCardId!
  };
}

function choiceMatchesStructuredIdentity(choice: ChaseCardCatalogResult, query: string): boolean {
  const normalizedQuery = normalize(normalizeChaseCardName(query));
  const normalizedChoiceIdentity = normalize(normalizeChaseCardName(choice.imageIdentity ?? choice.value));
  if (normalizedChoiceIdentity === normalizedQuery) return true;

  const subject = pokemonTcgQuerySubject(query) ?? tcgDexQuerySubject(query);
  if (subject && !normalize(choice.value).split(' ').includes(subject)) return false;

  const collectorNumber = requestedCollectorNumber(query);
  if (collectorNumber && !choiceMatchesCollectorNumber(choice, collectorNumber)) return false;

  const standaloneCardNumber = requestedStandaloneCardNumber(query);
  if (standaloneCardNumber && !choiceMatchesStandaloneCardNumber(choice, standaloneCardNumber)) return false;

  const numberPrefix = pokemonTcgRequestedNumberPrefix(query);
  if (numberPrefix && !normalize(choice.value).split(' ').some((term) => term.startsWith(numberPrefix))) return false;

  const releaseAlias = pokemonTcgReleaseAlias(query);
  if (releaseAlias && !normalize(choice.value).includes(normalize(releaseAlias.label))) return false;

  return !!subject || !!collectorNumber || !!standaloneCardNumber || !!numberPrefix || !!releaseAlias;
}

async function sourceBackedChaseCardChoices(query: string, limit: number, options: { dedupe?: boolean; includeExactTrustedFallback?: boolean } = {}): Promise<ChaseCardCatalogResult[]> {
  return (await sourceBackedChaseCardSearch(query, limit, options)).choices;
}

function localCatalogChoiceToCatalogResult(choice: LocalCardCatalogChoice): ChaseCardCatalogResult {
  return {
    name: choice.name,
    value: choice.value,
    imageUrl: choice.imageUrl,
    imageIdentity: choice.imageIdentity,
    imageSourceName: choice.imageSourceName,
    imageSourceKind: choice.imageSourceKind,
    imageSourceCardId: choice.imageSourceCardId
  };
}

async function sourceBackedChaseCardSearch(query: string, limit: number, options: { dedupe?: boolean; includeExactTrustedFallback?: boolean } = {}): Promise<{ choices: ChaseCardCatalogResult[]; providers: ProviderSearchResult[]; localChoices: ChaseCardCatalogResult[] }> {
  const exactTrustedChoices = options.includeExactTrustedFallback === true ? exactTrustedSourceChoicesForQuery(query) : [];
  const localSearchChoices = searchLocalCardCatalog(query, limit);
  const localChoices = localSearchChoices.map(localCatalogChoiceToCatalogResult);
  for (const choice of localChoices.filter(choiceHasTrustedPreview)) {
    cacheAutocompletePreview(choice.value, trustedChoicePreview(choice));
  }
  if (hasHighConfidenceLocalCatalogMatch(query, localSearchChoices)) {
    const choices = options.dedupe === false
      ? [...exactTrustedChoices, ...localChoices].sort((a, b) => autocompleteChoiceScore(b, query) - autocompleteChoiceScore(a, query))
      : rankAndDeduplicateSourceChoices([...exactTrustedChoices, ...localChoices], query);
    return { choices, providers: [], localChoices };
  }
  const [pokemonResult, tcgDexEnglishResult, japaneseResult] = await Promise.all([
    providerSearch('POKEMONTCG', query, pokemonTcgSearchQueries(query).length > 0, () => pokemonTcgAutocompleteChoices(query, limit)),
    providerSearch('TCGDEX_EN', query, hasTcgDexEnglishAutocompleteSignal(query), () => tcgDexEnglishAutocompleteChoices(query, limit)),
    providerSearch('TCGDEX_JA', query, hasTcgDexAutocompleteSignal(query), () => tcgDexAutocompleteChoices(query, limit))
  ]);
  const pokemonChoices = pokemonResult.choices;
  const tcgDexEnglishChoices = tcgDexEnglishResult.choices;
  const japaneseChoices = japaneseResult.choices;
  const choices = hasTcgDexAutocompleteSignal(query)
    ? [...exactTrustedChoices, ...localChoices, ...japaneseChoices, ...pokemonChoices, ...tcgDexEnglishChoices]
    : [...exactTrustedChoices, ...localChoices, ...pokemonChoices, ...tcgDexEnglishChoices, ...japaneseChoices];
  const rankedChoices = options.dedupe === false
    ? [...choices].sort((a, b) => autocompleteChoiceScore(b, query) - autocompleteChoiceScore(a, query))
    : rankAndDeduplicateSourceChoices(choices, query);
  return { choices: rankedChoices, providers: [pokemonResult, tcgDexEnglishResult, japaneseResult], localChoices };
}

function sourcePreference(choice: ChaseCardCatalogResult): number {
  if (choice.imageSourceName === 'POKEMONTCG') return 0;
  if (choice.imageSourceName === 'TCGDEX_EN') return 1;
  if (choice.imageSourceName === 'TCGDEX') return 0;
  return 3;
}

function choicePrimarySubject(choice: ChaseCardCatalogResult): string {
  return normalize(choice.value).split(' ').find((term) => term.length >= 2 && !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term) && !/^[a-z]{1,4}\d{1,4}$/.test(term)) ?? '';
}

function choiceLocalNumberKey(choice: ChaseCardCatalogResult): string {
  const text = normalize([choice.name, choice.value].join(' '));
  const prefixed = text.split(' ').find((term) => /^[a-z]{1,4}\d{1,4}$/.test(term));
  if (prefixed) return prefixed.replace(/^svp/, '');
  const slash = /\b0?(\d{1,4})\s*\/\s*\d{1,4}\b/.exec([choice.name, choice.value].join(' '));
  if (slash) return slash[1]!.replace(/^0+/, '') || '0';
  const bare = text.split(' ').find((term) => /^\d{1,4}$/.test(term));
  return bare?.replace(/^0+/, '') ?? '';
}

function choiceSetKey(choice: ChaseCardCatalogResult): string {
  return normalize(choice.value)
    .split(' ')
    .filter((term) => term.length >= 2)
    .filter((term) => term !== choicePrimarySubject(choice))
    .filter((term) => term !== choiceLocalNumberKey(choice))
    .filter((term) => !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term) && !/^[a-z]{1,4}\d{1,4}$/.test(term))
    .filter((term) => !POKEMON_CONTEXT_STOP_TERMS.has(term))
    .join(' ');
}

function choiceIdentityKey(choice: ChaseCardCatalogResult): string {
  const subject = choicePrimarySubject(choice);
  const number = choiceLocalNumberKey(choice);
  const set = choiceSetKey(choice)
    .replace(/\bblack star promos?\b/g, 'promo')
    .replace(/\bscarlet violet\b/g, 'sv');
  return [subject, number, set].filter(Boolean).join('|') || normalize(choice.value);
}

function autocompleteChoiceScore(choice: ChaseCardCatalogResult, query: string): number {
  let score = 0;
  const querySubject = pokemonTcgQuerySubject(query) ?? tcgDexQuerySubject(query);
  const choiceTerms = normalize(choice.value).split(' ');
  if (querySubject && choiceTerms.includes(querySubject)) score += 50;
  const collectorNumber = requestedCollectorNumber(query);
  if (collectorNumber && choiceMatchesCollectorNumber(choice, collectorNumber)) score += 120;
  const standaloneNumber = requestedStandaloneCardNumber(query);
  if (standaloneNumber && choiceMatchesStandaloneCardNumber(choice, standaloneNumber)) score += standaloneNumber.raw.length >= 3 ? 110 : 70;
  const prefixedNumber = requestedAlphanumericCardNumber(query);
  if (prefixedNumber) {
    const numberText = normalize(choice.value);
    if (numberText.includes(prefixedNumber.raw.toLowerCase())) score += 120;
    else if (choiceLocalNumberKey(choice) === (prefixedNumber.digits.replace(/^0+/, '') || '0')) score += 90;
  }
  const releaseAlias = pokemonTcgReleaseAlias(query);
  if (releaseAlias && normalize(choice.value).includes(normalize(releaseAlias.label))) score += 45;
  const explicitSetTerms = pokemonTcgExplicitSetContextTerms(query, { name: querySubject, number: choiceLocalNumberKey(choice) });
  if (explicitSetTerms.length >= 2 && explicitSetTerms.every((term) => normalize(choice.value).includes(term))) score += 35;
  if (choice.imageSourceKind === 'CARD_REFERENCE' && choice.imageUrl) score += 12;
  score -= sourcePreference(choice);
  return score;
}

function rankAndDeduplicateSourceChoices(choices: ChaseCardCatalogResult[], query: string): ChaseCardCatalogResult[] {
  const ranked = [...choices].sort((a, b) => autocompleteChoiceScore(b, query) - autocompleteChoiceScore(a, query));
  const byIdentity = new Map<string, ChaseCardCatalogResult>();
  for (const choice of ranked) {
    const key = choiceIdentityKey(choice);
    if (!byIdentity.has(key)) byIdentity.set(key, choice);
  }
  return [...byIdentity.values()];
}

function tcgDexDisplayName(card: TcgDexCard, query: string): string | undefined {
  if (!card.name || !card.localId) return undefined;
  const querySubject = tcgDexQuerySubject(query);
  const knownSubject = tcgDexKnownSubject(querySubject);
  const displaySubject = knownSubject ? knownSubject.replace(/^./, (letter) => letter.toUpperCase()) : querySubject ? querySubject.replace(/^./, (letter) => letter.toUpperCase()) : card.name;
  const total = tcgDexPrintedTotal(card);
  const numberLabel = total ? `${card.localId}/${String(total).padStart(3, '0')}` : card.localId;
  return [displaySubject, 'Japanese', numberLabel].filter(Boolean).join(' ');
}

function tcgDexQuerySubject(query: string): string | undefined {
  const terms = normalizeTcgDexQuery(query)
    .split(' ')
    .filter((term) => term.length >= 2 && !/^\d+$/.test(term) && !['card', 'cards', 'japanese', 'pokemon'].includes(term));
  return terms.find((term) => !!tcgDexKnownSubject(term)) ?? terms[0];
}

function tcgDexCardMatchesQuerySubject(card: TcgDexCard, querySubject: string | undefined): boolean {
  const knownSubject = tcgDexKnownSubject(querySubject);
  if (!knownSubject) return !querySubject;
  const aliases = JAPANESE_SUBJECT_ALIASES[knownSubject];
  if (!aliases) return false;
  return aliases.some((alias) => card.name?.includes(alias));
}

function tcgDexEnglishCardMatchesQuerySubject(card: TcgDexCard, querySubject: string | undefined): boolean {
  if (!querySubject || !card.name) return true;
  return normalize(card.name).split(' ').includes(querySubject);
}

function tcgDexEnglishCardMatchesNumber(card: TcgDexCard, query: string): boolean {
  if (!card.localId) return false;
  const localId = card.localId;
  const normalizedLocalId = normalize(localId).replace(/\s+/g, '');
  const collectorNumber = requestedCollectorNumber(query);
  if (collectorNumber) {
    const localMatches = localIdMatchesStandaloneRequest(localId.replace(/[^0-9]/g, ''), { raw: collectorNumber.localId.replace(/^0+/, '') || '0', normalized: collectorNumber.localId });
    return localMatches && printedTotalMatchesPrefix(tcgDexPrintedTotal(card), collectorNumber.totalPrefix);
  }
  const standaloneNumber = requestedStandaloneCardNumber(query);
  if (standaloneNumber) {
    const numericLocalId = localId.replace(/[^0-9]/g, '');
    if (!numericLocalId) return false;
    if (standaloneNumber.raw.length >= 3) return numericLocalId.padStart(3, '0') === standaloneNumber.normalized;
    return localIdMatchesStandaloneRequest(numericLocalId, standaloneNumber);
  }
  const alphanumeric = requestedAlphanumericCardNumber(query);
  if (alphanumeric) {
    const requested = `${alphanumeric.prefix}${alphanumeric.digits}`;
    const numericLocalId = localId.replace(/[^0-9]/g, '');
    return normalizedLocalId === requested || numericLocalId.replace(/^0+/, '') === alphanumeric.digits.replace(/^0+/, '');
  }
  return true;
}

function tcgDexEnglishDisplayName(card: TcgDexCard, query: string): string | undefined {
  if (!card.name || !card.localId) return undefined;
  const total = tcgDexPrintedTotal(card);
  const numberLabel = requestedCollectorNumber(query) && total ? `${card.localId}/${String(total).padStart(3, '0')}` : card.localId;
  const setName = card.set?.name ?? card.set?.id;
  return [card.name, setName, numberLabel].filter(Boolean).join(' ');
}

async function tcgDexEnglishAutocompleteChoices(query: string, limit: number): Promise<ChaseCardCatalogResult[]> {
  if (!hasTcgDexEnglishAutocompleteSignal(query)) return [];
  const querySubject = pokemonTcgQuerySubject(query);
  const localIds = tcgDexEnglishLocalIdCandidates(query);
  const nameUrl = querySubject
    ? `${TCGDEX_EN_CARDS_ENDPOINT}?${new URLSearchParams({ name: querySubject }).toString()}`
    : undefined;
  const [nameSummariesResult, localIdSummariesResults] = await Promise.all([
    nameUrl ? fetchJsonWithRetry(nameUrl, 'TCGDEX_EN', query).then((json) => ({ ok: true as const, json })).catch((error) => ({ ok: false as const, error })) : { ok: true as const, json: [] },
    Promise.all(localIds.map((localId) => fetchJsonWithRetry(`${TCGDEX_EN_CARDS_ENDPOINT}?${new URLSearchParams({ localId }).toString()}`, 'TCGDEX_EN', query).then((json) => ({ ok: true as const, json })).catch((error) => ({ ok: false as const, error }))))
  ]);
  const summaryResults = [nameSummariesResult, ...localIdSummariesResults];
  if (summaryResults.length > 0 && summaryResults.every((result) => !result.ok)) {
    throw (summaryResults.find((result) => !result.ok) as { ok: false; error: unknown }).error;
  }
  const nameSummariesRaw = nameSummariesResult.ok ? nameSummariesResult.json : [];
  const localIdSummariesRaw = localIdSummariesResults.flatMap((result) => result.ok ? result.json : []);
  const nameSummaries = (Array.isArray(nameSummariesRaw) ? nameSummariesRaw : []).filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const localIdSummaries = (Array.isArray(localIdSummariesRaw) ? localIdSummariesRaw : []).filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const summariesById = new Map<string, TcgDexCardSummary>();
  for (const card of [...localIdSummaries, ...nameSummaries]) {
    if (card.id && !summariesById.has(card.id)) summariesById.set(card.id, card);
  }
  const filtered = [...summariesById.values()]
    .filter((card) => tcgDexEnglishCardMatchesQuerySubject(card as TcgDexCard, querySubject))
    .slice(0, Math.min(limit * 2, 40));
  const detailed = await Promise.all(
    filtered.map((card) => card.id ? fetchJsonWithRetry(`${TCGDEX_EN_CARDS_ENDPOINT}/${encodeURIComponent(card.id)}`, 'TCGDEX_EN', query).catch(() => card) : card)
  );
  return detailed
    .filter((card) => tcgDexEnglishCardMatchesQuerySubject(card as TcgDexCard, querySubject))
    .filter((card) => tcgDexEnglishCardMatchesNumber(card as TcgDexCard, query))
    .filter((card) => pokemonTcgCardMatchesExplicitSetContext({
      name: (card as TcgDexCard).name,
      number: (card as TcgDexCard).localId,
      set: { name: (card as TcgDexCard).set?.name }
    }, query))
    .flatMap((card) => {
      const name = tcgDexEnglishDisplayName(card as TcgDexCard, query);
      return name
        ? [{
            name: truncateChoice(`${(card as TcgDexCard).name} — ${(card as TcgDexCard).set?.name ?? (card as TcgDexCard).set?.id ?? 'TCGdex'} #${(card as TcgDexCard).localId}`),
            value: truncateChoice(name),
            imageUrl: tcgDexImageUrl(card as TcgDexCard),
            imageIdentity: normalizeChaseCardName(name),
            imageSourceName: 'TCGDEX_EN',
            imageSourceKind: 'CARD_REFERENCE' as const,
            imageSourceCardId: (card as TcgDexCard).id
          }]
        : [];
    });
}

async function tcgDexAutocompleteChoices(query: string, limit: number): Promise<ChaseCardCatalogResult[]> {
  const normalizedQuery = normalizeTcgDexQuery(query);
  const slashMatch = /\b(0?\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(query);
  const requestedTotalPrefix = slashMatch?.[2];
  const standaloneCardNumber = requestedStandaloneCardNumber(query);
  const rawLocalId = slashMatch?.[1] ?? standaloneCardNumber?.raw;
  const localIds = tcgDexLocalIdCandidates(rawLocalId, !slashMatch);
  const localIdSet = new Set(localIds);
  if (!hasTcgDexAutocompleteSignal(query)) return [];
  const querySubject = tcgDexQuerySubject(query);
  const nameUrl = `${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ name: query }).toString()}`;
  const aliasNameUrls = tcgDexAliasNameQueries(querySubject).map((alias) => `${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ name: alias }).toString()}`);
  const [nameSummariesResult, aliasNameSummariesResults, localIdSummariesResults] = await Promise.all([
    fetchJsonWithRetry(nameUrl, 'TCGDEX_JA', query).then((json) => ({ ok: true as const, json })).catch((error) => ({ ok: false as const, error })),
    Promise.all(aliasNameUrls.map((url) => fetchJsonWithRetry(url, 'TCGDEX_JA', query).then((json) => ({ ok: true as const, json })).catch((error) => ({ ok: false as const, error })))),
    Promise.all(localIds.map((localId) => fetchJsonWithRetry(`${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ localId }).toString()}`, 'TCGDEX_JA', query).then((json) => ({ ok: true as const, json })).catch((error) => ({ ok: false as const, error }))))
  ]);
  const summaryResults = [nameSummariesResult, ...aliasNameSummariesResults, ...localIdSummariesResults];
  if (summaryResults.length > 0 && summaryResults.every((result) => !result.ok)) {
    throw (summaryResults.find((result) => !result.ok) as { ok: false; error: unknown }).error;
  }
  const nameSummariesRaw = nameSummariesResult.ok ? nameSummariesResult.json : [];
  const aliasNameSummariesRaw = aliasNameSummariesResults.flatMap((result) => result.ok ? result.json : []);
  const localIdSummariesRaw = localIdSummariesResults.flatMap((result) => result.ok ? result.json : []);
  const nameSummaries = (Array.isArray(nameSummariesRaw) ? nameSummariesRaw : []).filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const aliasNameSummaries = aliasNameSummariesRaw.flat().filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const localIdSummaries = localIdSummariesRaw.flat().filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const summaries = [...nameSummaries, ...aliasNameSummaries, ...localIdSummaries];
    const aliasMatchedIds = new Set(aliasNameSummaries.map((card) => card.id).filter((id): id is string => !!id));
  const candidateLimit = requestedTotalPrefix === undefined && localIds.length <= 1 ? Math.min(limit, 8) : 80;
  const filtered = summaries
    .filter((card) => {
      const text = normalize([card.name, card.localId, card.id].filter(Boolean).join(' '));
        return (!!card.id && aliasMatchedIds.has(card.id)) || normalizedQuery.split(' ').filter(Boolean).every((term) => text.includes(term)) || (!!card.localId && localIdSet.has(card.localId));
    })
    .filter((card) => localIdSet.size === 0 || (!!card.localId && standaloneCardNumber && localIdMatchesStandaloneRequest(card.localId, standaloneCardNumber)) || (!!card.localId && localIdSet.has(card.localId)))
    .slice(0, candidateLimit);
  const detailed = await Promise.all(
    filtered.map((card) => card.id ? fetchJsonWithRetry(`${TCGDEX_JA_CARDS_ENDPOINT}/${encodeURIComponent(card.id)}`, 'TCGDEX_JA', query).catch(() => card) : card)
  );
  return detailed
    .filter((card) => requestedTotalPrefix === undefined || printedTotalMatchesPrefix(tcgDexPrintedTotal(card as TcgDexCard), requestedTotalPrefix))
    .filter((card) => tcgDexCardMatchesQuerySubject(card as TcgDexCard, querySubject))
    .flatMap((card) => {
      const name = tcgDexDisplayName(card as TcgDexCard, query);
      return name
        ? [{
            name,
            imageUrl: tcgDexImageUrl(card as TcgDexCard),
            imageIdentity: normalizeChaseCardName(name),
            imageSourceName: 'TCGDEX',
            imageSourceKind: 'CARD_REFERENCE' as const,
            imageSourceCardId: (card as TcgDexCard).id
          }]
        : [];
    })
    .map((card) => ({
      name: truncateChoice(card.name),
      value: truncateChoice(card.name),
      imageUrl: card.imageUrl,
      imageIdentity: card.imageIdentity,
      imageSourceName: card.imageSourceName,
      imageSourceKind: card.imageSourceKind,
      imageSourceCardId: card.imageSourceCardId
    }));
}

function autocompleteResultFromChoices(
  choices: ChaseCardAutocompleteChoice[],
  availability: ChaseCardAutocompleteResult['availability'],
  stale = false
): ChaseCardAutocompleteResult {
  return { choices, availability, unavailable: availability === 'UNAVAILABLE', stale };
}

function providerAvailability(providers: ProviderSearchResult[], choices: ChaseCardAutocompleteChoice[], hasLocalChoices = false): ChaseCardAutocompleteResult['availability'] {
  if (hasLocalChoices && choices.length > 0) return 'AVAILABLE';
  const attempted = providers.filter((provider) => provider.attempted);
  const failed = attempted.filter((provider) => provider.status !== 'SUCCESS');
  if (attempted.length > 0 && failed.length === attempted.length) return 'UNAVAILABLE';
  if (failed.length > 0) return choices.length > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  return 'AVAILABLE';
}

function cacheAutocompleteResult(queryKey: string, result: ChaseCardAutocompleteResult): void {
  if (result.availability === 'UNAVAILABLE') return;
  const now = Date.now();
  const freshTtl = result.choices.length > 0 ? AUTOCOMPLETE_CACHE_TTL_MS : AUTOCOMPLETE_NEGATIVE_CACHE_TTL_MS;
  const staleTtl = result.choices.length > 0 ? AUTOCOMPLETE_STALE_CACHE_TTL_MS : freshTtl;
  autocompleteCache.set(queryKey, {
    freshUntil: now + freshTtl,
    staleUntil: now + staleTtl,
    result: { ...result, stale: false }
  });
}

export async function autocompleteChaseCardsWithStatus(query: string, limit = 25): Promise<ChaseCardAutocompleteResult> {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return autocompleteResultFromChoices([], 'AVAILABLE');
  const helperChoice = bareCardNumberHelperChoice(query);
  if (helperChoice) return autocompleteResultFromChoices([helperChoice], 'AVAILABLE');
  const cached = autocompleteCache.get(normalizedQuery);
  if (cached && cached.freshUntil > Date.now()) {
    return autocompleteResultFromChoices(cached.result.choices.slice(0, limit), cached.result.availability, false);
  }

  const search = await sourceBackedChaseCardSearch(query, limit);
  const sourceOrderedChoices = search.choices;
  const collectorNumber = requestedCollectorNumber(query);
  const standaloneCardNumber = requestedStandaloneCardNumber(query);
  const filteredChoices = collectorNumber
    ? sourceOrderedChoices.filter((choice) => choiceMatchesCollectorNumber(choice, collectorNumber))
    : standaloneCardNumber
      ? sourceOrderedChoices.filter((choice) => choiceMatchesStandaloneCardNumber(choice, standaloneCardNumber))
      : sourceOrderedChoices;
  // If the user included a known series token (e.g. 'xy'), prefer choices that mention that series.
  const seriesToken = normalize(query)
    .split(' ')
    .find((term) => POKEMON_NUMBER_PREFIX_TERMS.has(term));
  let prioritizedChoices = filteredChoices;
  if (seriesToken) {
    const token = seriesToken.toLowerCase();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenWordRe = new RegExp(`\\b${esc(token)}\\b`, 'i');
    const tokenNumberRe = new RegExp(`${esc(token)}\\s*\\d`, 'i');
    prioritizedChoices = [...filteredChoices].map((choice) => ({ choice, score: (() => {
      const text = normalize(choice.value);
      let score = 0;
      if (tokenNumberRe.test(text)) score += 3; // e.g. XY192
      if (tokenWordRe.test(text)) score += 2; // e.g. set name contains 'xy'
      if (text.includes(token)) score += 1; // fallback boost for any match
      return score;
    })() })).sort((a, b) => b.score - a.score).map((s) => s.choice);
  }
  const choices = uniqueChoices(prioritizedChoices, limit);
  const fallbackChoice = choices.length === 0 ? japanesePromoFallbackChoice(query) ?? pokemonReleaseFallbackChoice(query) : undefined;
  const finalChoices = fallbackChoice ? [fallbackChoice] : choices;
  let availability = providerAvailability(search.providers, finalChoices, search.localChoices.length > 0);
  if (availability === 'UNAVAILABLE' && cached && cached.staleUntil > Date.now() && cached.result.choices.length > 0) {
    return autocompleteResultFromChoices(cached.result.choices.slice(0, limit), 'PARTIAL', true);
  }
  if (finalChoices.length > 0 && availability === 'UNAVAILABLE') availability = 'PARTIAL';
  const result = autocompleteResultFromChoices(finalChoices, availability);
  cacheAutocompleteResult(normalizedQuery, result);
  return result;
}

export async function autocompleteChaseCards(query: string, limit = 25): Promise<ChaseCardAutocompleteChoice[]> {
  return (await autocompleteChaseCardsWithStatus(query, limit)).choices;
}

export async function resolveTrustedChaseCardReference(cardName: string): Promise<TrustedChaseCardReferenceResolution> {
  const normalizedCardName = normalizeChaseCardName(cardName);
  const exactResolution = resolveExactTrustedChaseCardReference(cardName);
  if (exactResolution?.status === 'RESOLVED') {
    cacheAutocompletePreview(cardName, exactResolution.preview);
    cacheAutocompletePreview(normalizedCardName, exactResolution.preview);
    cacheAutocompletePreview(exactResolution.resolvedCardName, exactResolution.preview);
    return exactResolution;
  }
  const queryVariants = [...new Set([cardName, normalizedCardName].map((value) => value.trim()).filter(Boolean))];
  const sourceChoices = (await Promise.all(queryVariants.map((query) => sourceBackedChaseCardChoices(query, 40, { dedupe: false, includeExactTrustedFallback: true })))).flat();
  const trustedMatches = sourceChoices
    .filter(choiceHasTrustedPreview)
    .filter((choice) => queryVariants.some((query) => choiceMatchesStructuredIdentity(choice, query)));
  const uniqueMatches = new Map<string, ChaseCardCatalogResult>();
  for (const match of trustedMatches) {
    const key = `${match.imageSourceName}:${match.imageSourceCardId}`;
    if (!uniqueMatches.has(key)) uniqueMatches.set(key, match);
  }
  const matches = [...uniqueMatches.values()];

  if (matches.length === 1) {
    const match = matches[0]!;
    const preview = trustedChoicePreview(match);
    cacheAutocompletePreview(cardName, preview);
    cacheAutocompletePreview(normalizedCardName, preview);
    cacheAutocompletePreview(match.value, preview);
    return {
      status: 'RESOLVED',
      requestedCardName: cardName,
      resolvedCardName: match.value,
      preview
    };
  }

  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      requestedCardName: cardName,
      normalizedCardName,
      candidateCount: matches.length,
      candidates: matches.slice(0, 5).map((match) => ({
        name: match.name,
        value: match.value,
        imageSourceName: match.imageSourceName,
        imageSourceCardId: match.imageSourceCardId
      }))
    };
  }

  if (queryVariants.some((query) => fallbackOnlyChoice(query))) {
    return {
      status: 'FALLBACK_ONLY',
      requestedCardName: cardName,
      normalizedCardName
    };
  }

  const hadNumberedSourceCandidate = sourceChoices.some((choice) => choiceHasTrustedPreview(choice));
  const hasRequestedNumber = queryVariants.some((query) => !!requestedCollectorNumber(query) || !!requestedStandaloneCardNumber(query) || !!pokemonTcgRequestedNumberPrefix(query));
  const hasRelease = queryVariants.some((query) => !!pokemonTcgReleaseAlias(query));
  return {
    status: hadNumberedSourceCandidate && hasRequestedNumber ? 'CONFLICTING_NUMBER' : hadNumberedSourceCandidate && hasRelease ? 'CONFLICTING_RELEASE' : 'NO_MATCH',
    requestedCardName: cardName,
    normalizedCardName,
    candidateCount: sourceChoices.length,
    candidates: sourceChoices.slice(0, 5).map((choice) => ({
      name: choice.name,
      value: choice.value,
      imageSourceName: choice.imageSourceName,
      imageSourceCardId: choice.imageSourceCardId
    }))
  };
}

export function resolveExactTrustedChaseCardReference(cardName: string): TrustedChaseCardReferenceResolution | undefined {
  const normalizedCardName = normalizeChaseCardName(cardName);
  const queryVariants = [...new Set([cardName, normalizedCardName].map((value) => value.trim()).filter(Boolean))];
  const matches = queryVariants.flatMap(exactTrustedSourceChoicesForQuery);
  const uniqueMatches = new Map<string, ChaseCardCatalogResult>();
  for (const match of matches) {
    const key = `${match.imageSourceName}:${match.imageSourceCardId}`;
    if (!uniqueMatches.has(key)) uniqueMatches.set(key, match);
  }
  const exactMatches = [...uniqueMatches.values()];
  if (exactMatches.length === 0) return undefined;
  if (exactMatches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      requestedCardName: cardName,
      normalizedCardName,
      candidateCount: exactMatches.length,
      candidates: exactMatches.slice(0, 5).map((match) => ({
        name: match.name,
        value: match.value,
        imageSourceName: match.imageSourceName,
        imageSourceCardId: match.imageSourceCardId
      }))
    };
  }
  const match = exactMatches[0]!;
  return {
    status: 'RESOLVED',
    requestedCardName: cardName,
    resolvedCardName: match.value,
    preview: trustedChoicePreview(match)
  };
}

export function clearChaseCardAutocompleteCache(): void {
  autocompleteCache.clear();
  autocompletePreviewCache.clear();
}

export function getCachedChaseCardPreview(cardName: string): CachedChaseCardPreview | undefined {
  const cached = autocompletePreviewCache.get(normalize(cardName));
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.preview;
}

export function getCachedChaseCardPreviewImage(cardName: string): string | undefined {
  return getCachedChaseCardPreview(cardName)?.imageUrl;
}

export const __chaseCardCatalogTestHooks = {
  cachePreview(cardName: string, preview: CachedChaseCardPreview): void {
    cacheAutocompletePreview(cardName, preview);
  },
  cachedPreview(cardName: string): CachedChaseCardPreview | undefined {
    return getCachedChaseCardPreview(cardName);
  },
  expireAutocompleteFreshCache(cardName: string): void {
    const key = normalize(cardName);
    const cached = autocompleteCache.get(key);
    if (cached) autocompleteCache.set(key, { ...cached, freshUntil: Date.now() - 1 });
  }
};
