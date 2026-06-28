import type { Chase } from '../types.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';

export type SourceCatalogStatus = 'UNSUPPORTED' | 'NOT_FOUND' | 'TIMEOUT' | 'ERROR';

export type SourceBackedDiscoveryResult = {
  suggestions: DiscoverySuggestion[];
  sourceStatus?: SourceCatalogStatus;
};

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  set?: { name?: string; series?: string; releaseDate?: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  nationalPokedexNumbers?: number[];
  types?: string[];
};

type TcgDexCardSummary = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
};

type TcgDexCard = TcgDexCardSummary & {
  category?: string;
  rarity?: string;
  set?: { id?: string; name?: string; cardCount?: { official?: number; total?: number }; cards?: { official?: number; total?: number } };
  dexId?: number[];
  types?: string[];
  stage?: string;
  suffix?: string;
};

type SourceTasteProfile = {
  cards: PokemonTcgCard[];
  signalCount: number;
  dexNumbers: Set<number>;
  dexNames: Map<number, string>;
  explicitFormatCounts: Map<string, number>;
  formatCounts: Map<string, number>;
  ordinaryExSupportCount: number;
  ordinaryVmaxSupportCount: number;
  types: Set<string>;
  subtypes: Set<string>;
  setTokens: Set<string>;
  releaseYears: number[];
  kantoRatio: number;
  japaneseSignalRatio: number;
  hasPriorityJapaneseSignal: boolean;
};

type SourceIdentityTermSignal = { term: string; weight: number; firstIndex: number };

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const TCGDEX_JA_CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
const SOURCE_CATALOG_TIMEOUT_MS = 7000;
const SOURCE_CATALOG_PAGE_SIZE = 48;
const TCGDEX_SOURCE_CATALOG_PAGE_SIZE = 18;
const TCGDEX_MAX_DEX_SUMMARY_MATCHES = 60;
const SOURCE_API_CACHE_TTL_MS = 15 * 60 * 1000;
const SOURCE_PROFILE_TIMEOUT_MS = 6000;
const SOURCE_PROFILE_CHASE_LIMIT = 9;
const SOURCE_PROFILE_PRIMARY_TERM_LIMIT = 2;
const SOURCE_PROFILE_FALLBACK_TERM_LIMIT = 2;
const TCGDEX_PROFILE_CHASE_LIMIT = 4;
const TCGDEX_PROFILE_TERM_LIMIT = 2;
const ACTIVE_CARD_TOKEN_STOP_WORDS = new Set(['card', 'cards', 'holo', 'hp', 'it', 'lp', 'mp', 'nm', 'mint', 'near', 'pokemon', 'raw', 'the', 'trading', 'with']);
const SOURCE_PROFILE_IDENTITY_STOP_WORDS = new Set([
  'black',
  'collection',
  'corocoro',
  'crystal',
  'delta',
  'ex',
  'exclusive',
  'gx',
  'japanese',
  'jp',
  'jpn',
  'mega',
  'promo',
  'promotional',
  'radiant',
  'release',
  'shining',
  'special',
  'star',
  'v',
  'vmax',
  'vstar'
]);
const SOURCE_TASTE_TRAIT_TERMS = new Set([
  'art rare',
  'black star',
  'classic collection',
  'collector',
  'corocoro',
  'deck exclusive',
  'e-reader',
  'exclusive',
  'full art',
  'illustration',
  'illustration rare',
  'japanese',
  'magazine',
  'magazine promo',
  'mcdonalds',
  'numbered set',
  'odd release',
  'promo',
  'rare',
  'retail',
  'small set',
  'special',
  'special set',
  'tag team',
  'trainer gallery',
  'unique',
  'vintage'
]);
const JAPANESE_PROMO_CODE_PATTERN = /\b(?:\d{1,3}\s*\/\s*(?:XY|SM|S|SV)-P|(?:XY|SM|S|SV)-P\s*-?\s*\d{1,3})\b/i;
const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const JAPANESE_RELEASE_MARKER_PATTERN = /\b(?:coro\s?coro|vending|masaki|munch|poncho|battle\s*festa|players?\s+club|fan\s+club|trainers?\s+magazine|yu\s?nagaba|precious\s+collector|kanazawa|yokohama|sapporo|pokemon\s+center)\b/i;
type SourceApiCacheEntry = {
  expiresAt: number;
  json?: any;
  promise?: Promise<any>;
};

type SourceProfileCacheEntry = {
  expiresAt: number;
  promise: Promise<SourceTasteProfile>;
};

const sourceApiResponseCache = new Map<string, SourceApiCacheEntry>();
const sourceTasteProfileCache = new Map<string, SourceProfileCacheEntry>();

export function clearDiscoverySourceCatalogCache(): void {
  sourceApiResponseCache.clear();
  sourceTasteProfileCache.clear();
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeSearchText(value: string): string {
  return normalize(value).replace(/[^a-z0-9/ -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function displayIdentityTerm(value: string): string {
  return normalizeSearchText(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function compactIdentifier(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, '');
}

function activeCardTokens(value: string): string[] {
  return normalizedTokens(value).filter((token) => !ACTIVE_CARD_TOKEN_STOP_WORDS.has(token));
}

function activeCardStrongIdentifiers(value: string): string[] {
  const identifiers = new Set<string>();
  for (const match of value.matchAll(/\b(?:[A-Z]{0,4}\d{1,3}\s*\/\s*\d{1,3}|(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}|H\d{1,2})\b/gi)) {
    identifiers.add(compactIdentifier(match[0]));
  }
  return [...identifiers];
}

function activeCardWeakIdentifiers(value: string): string[] {
  const identifiers = new Set<string>();
  for (const match of value.matchAll(/\b([A-Z]{0,4}\d{1,3})\s*\/\s*\d{1,3}\b/gi)) {
    identifiers.add(compactIdentifier(match[1]));
  }
  return [...identifiers];
}

function isActiveChaseEchoText(text: string, activeChases: Chase[]): boolean {
  const compactText = compactIdentifier(text);
  const textTokens = new Set(activeCardTokens(text));
  return activeChases.some((chase) => {
    const chaseTokens = activeCardTokens(chase.cardName);
    const primaryToken = chaseTokens[0];
    const hasPrimaryToken = !!primaryToken && textTokens.has(primaryToken);

    const strongIdentifiers = activeCardStrongIdentifiers(chase.cardName);
    if (strongIdentifiers.length > 0 && strongIdentifiers.some((identifier) => compactText.includes(identifier))) return true;

    const weakIdentifiers = activeCardWeakIdentifiers(chase.cardName);
    if (hasPrimaryToken && weakIdentifiers.length > 0 && weakIdentifiers.some((identifier) => compactText.includes(identifier))) return true;

    if (!hasPrimaryToken) return false;

    const matchedTokenCount = chaseTokens.filter((token) => textTokens.has(token)).length;
    return chaseTokens.length >= 3 && matchedTokenCount >= Math.min(3, chaseTokens.length);
  });
}

function sourceText(suggestion: DiscoverySuggestion): string {
  return [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '')}"`;
}

function uniqueValuesPreservingOrder(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function isSourceTasteTraitTerm(value: string): boolean {
  return SOURCE_TASTE_TRAIT_TERMS.has(normalizeSearchText(value));
}

function sourceSubjectTokens(value: string): Set<string> {
  return new Set(
    normalizedTokens(value).filter(
      (token) => token.length >= 3 && !/\d/.test(token) && !ACTIVE_CARD_TOKEN_STOP_WORDS.has(token) && !SOURCE_PROFILE_IDENTITY_STOP_WORDS.has(token) && !isSourceTasteTraitTerm(token)
    )
  );
}

function sanitizeInheritedSourceTasteTokens(parentTokens: string[] | undefined, concreteSubjectText: string, extraTokens: string[] = []): string[] {
  const concreteSubjectTokens = sourceSubjectTokens(concreteSubjectText);
  const sanitizedParentTokens = (parentTokens ?? []).filter((token) => {
    const normalizedToken = normalizeSearchText(token);
    if (!normalizedToken) return false;
    if (isSourceTasteTraitTerm(normalizedToken)) return true;
    const tokenSubjectParts = normalizedTokens(normalizedToken).filter(
      (part) => part.length >= 3 && !/\d/.test(part) && !ACTIVE_CARD_TOKEN_STOP_WORDS.has(part) && !SOURCE_PROFILE_IDENTITY_STOP_WORDS.has(part) && !isSourceTasteTraitTerm(part)
    );
    if (tokenSubjectParts.length === 0) return true;
    return tokenSubjectParts.every((part) => concreteSubjectTokens.has(part));
  });
  return uniqueValuesPreservingOrder([...sanitizedParentTokens, ...extraTokens]);
}

function uniqueSuggestionsByName(suggestions: DiscoverySuggestion[]): DiscoverySuggestion[] {
  const seen = new Set<string>();
  const unique: DiscoverySuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = normalizeSearchText(suggestion.name);
    if (seen.has(key)) continue;
    unique.push(suggestion);
    seen.add(key);
  }
  return unique;
}

export function pokemonTcgCatalogQueriesForSuggestion(suggestion: DiscoverySuggestion): string[] {
  const text = sourceText(suggestion);
  if (!/\bpokemon\b/i.test(text)) return [];
  if (/\b(one piece|luffy|nami|zoro|sabo)\b/i.test(text)) return [];
  if (isNicheJapaneseExclusiveSuggestion(suggestion)) return [];

  const queries: string[] = [];
  const normalized = normalizeSearchText(text);
  const requiredTokens = new Set((suggestion.requiredEvidenceTokens ?? []).map((token) => normalizeSearchText(token)).filter(Boolean));

  if (requiredTokens.has('illustration') || /\billustration rare\b/i.test(text)) queries.push('supertype:Pokemon rarity:"Illustration Rare"');
  if (requiredTokens.has('e-reader') || /\be[- ]?reader\b/i.test(text)) {
    queries.push('supertype:Pokemon set.series:"E-Card"');
    queries.push('supertype:Pokemon set.name:Expedition');
    queries.push('supertype:Pokemon set.name:Aquapolis');
    queries.push('supertype:Pokemon set.name:Skyridge');
  }
  if (requiredTokens.has('vintage') || /\bvintage\b/i.test(text)) {
    queries.push('supertype:Pokemon set.series:Base');
    queries.push('supertype:Pokemon set.series:Gym');
    queries.push('supertype:Pokemon set.series:Neo');
    queries.push('supertype:Pokemon set.series:"E-Card"');
    queries.push('supertype:Pokemon set.series:EX');
  }
  if (requiredTokens.has('promo') || /\bpromo\b/i.test(text)) queries.push('supertype:Pokemon rarity:Promo');
  if (/\bspecial release\b/i.test(text)) queries.push('supertype:Pokemon rarity:Promo');
  if (/\bcollector\b/i.test(normalized)) queries.push('supertype:Pokemon');

  return [...new Set(queries)];
}

function hasJapaneseTaste(suggestion: DiscoverySuggestion): boolean {
  if (isRetailEReaderPromoSuggestion(suggestion) || isNicheJapaneseExclusiveSuggestion(suggestion)) return false;
  const source = normalizeSearchText([sourceText(suggestion), ...(suggestion.sourceTasteTokens ?? [])].join(' '));
  return /\bjapanese\b/.test(source);
}

function isRetailEReaderPromoSuggestion(suggestion: DiscoverySuggestion): boolean {
  const text = [sourceText(suggestion), ...(suggestion.sourceTasteTokens ?? []), ...(suggestion.requiredEvidenceTokens ?? [])].join(' ');
  return /\bmcdonald'?s\b/i.test(text) && /\be[- ]?reader\b/i.test(text);
}

function retailEReaderPromoSubjectToken(suggestion: DiscoverySuggestion): string | undefined {
  return (suggestion.requiredEvidenceTokens ?? suggestion.sourceTasteTokens ?? [])
    .map(normalizeSearchText)
    .find((token) => token.length >= 3 && !['e-reader', 'mcdonalds', 'promo'].includes(token));
}

function isNicheJapaneseExclusiveSuggestion(suggestion: DiscoverySuggestion): boolean {
  const text = [sourceText(suggestion), ...(suggestion.sourceTasteTokens ?? []), ...(suggestion.requiredEvidenceTokens ?? [])].join(' ');
  return /\bjapanese\b/i.test(text) && /\b(?:bulbasaur deck|intro pack|vhs|deck exclusive|exclusive|unique|unusual|odd(?:ball)? release)\b/i.test(text);
}



function exactRetailEReaderSubjectRank(card: PokemonTcgCard, suggestion: DiscoverySuggestion): number {
  const subjectToken = retailEReaderPromoSubjectToken(suggestion);
  if (!isRetailEReaderPromoSuggestion(suggestion) || !subjectToken) return 0;
  return (card.name ?? '').trim().toLowerCase() === subjectToken ? 1 : 0;
}

function hasJapaneseChaseSignal(chase: Chase): boolean {
  const text = [chase.cardName, chase.targetNote].filter(Boolean).join(' ');
  return /\b(japanese|japan|jp|jpn)\b/i.test(text) || JAPANESE_PROMO_CODE_PATTERN.test(text) || JAPANESE_SCRIPT_PATTERN.test(text) || JAPANESE_RELEASE_MARKER_PATTERN.test(text);
}

function chaseSignalWeight(chase: Chase): number {
  if (chase.tasteWeight !== undefined) return chase.tasteWeight;
  if (chase.priority === 'GRAIL') return 2.4;
  if (chase.priority === 'HIGH') return 1.6;
  return 1;
}

function japaneseSignalRatio(activeChases: Chase[]): number {
  const totalWeight = activeChases.reduce((sum, chase) => sum + chaseSignalWeight(chase), 0);
  if (totalWeight <= 0) return 0;
  const japaneseWeight = activeChases.filter(hasJapaneseChaseSignal).reduce((sum, chase) => sum + chaseSignalWeight(chase), 0);
  return japaneseWeight / totalWeight;
}

function hasPriorityJapaneseSignal(activeChases: Chase[]): boolean {
  return activeChases.some((chase) => hasJapaneseChaseSignal(chase) && (chase.priority === 'GRAIL' || chase.priority === 'HIGH' || chaseSignalWeight(chase) >= 1.6));
}

function activeChaseSearchTerms(chase: Chase): Array<{ name: string; number?: string }> {
  const text = normalizeSearchText(chase.cardName);
  const hasJapanesePromoCode = JAPANESE_PROMO_CODE_PATTERN.test(chase.cardName);
  const slashNumber = hasJapanesePromoCode ? undefined : /\b([a-z]{0,4}\d{1,3})\s*\/\s*\d{1,3}\b/i.exec(chase.cardName)?.[1];
  const codedNumber = hasJapanesePromoCode ? undefined : /\b(?:(?:gg|tg|rc|xy|sm|swsh|svp|bw|dp|hgss)\s?-?\d{1,4}|h\d{1,2})\b/i.exec(chase.cardName)?.[0];
  const number = (slashNumber ?? codedNumber)?.replace(/\s|-/g, '').toUpperCase();
  const nameTokens = text
    .replace(JAPANESE_PROMO_CODE_PATTERN, ' ')
    .replace(/\b(?:[a-z]{0,4}\d{1,3}\s*\/\s*\d{1,3}|(?:gg|tg|rc|xy|sm|swsh|svp|bw|dp|hgss)\s?-?\d{1,4}|h\d{1,2})\b/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !ACTIVE_CARD_TOKEN_STOP_WORDS.has(token));
  const joinedName = nameTokens.slice(0, 4).join(' ');
  const terms: Array<{ name: string; number?: string }> = [];
  if (joinedName) terms.push({ name: joinedName, number });
  for (const token of nameTokens.slice(0, 4)) terms.push({ name: token, number });
  return terms.filter((term, index) => terms.findIndex((candidate) => candidate.name === term.name && candidate.number === term.number) === index);
}

function pokemonTcgQueryForActiveTerm(term: { name: string; number?: string }): string {
  return term.number ? `name:${quoted(term.name)} number:${term.number}` : `name:${quoted(term.name)}`;
}

function isUsefulIdentityTerm(term: { name: string; number?: string }): boolean {
  if (term.number) return false;
  const termTokens = normalizedTokens(term.name);
  return termTokens.length === 1 && termTokens[0].length >= 3 && !SOURCE_PROFILE_IDENTITY_STOP_WORDS.has(termTokens[0]);
}

function normalizeTokenSet(values: Array<string | undefined>): Set<string> {
  return new Set(values.filter((value): value is string => !!value).flatMap((value) => normalizedTokens(value)).filter((token) => token.length >= 2));
}

function cardFormatTokensFromText(value: string): Set<string> {
  const text = normalizeSearchText(value);
  const tokens = new Set<string>();
  if (/\btag team\b/.test(text)) tokens.add('tag team');
  if (/\billustration rare\b|\bart rare\b|\balt art\b|\balternate art\b|\bsar\b|\bar\b/.test(text)) tokens.add('illustration');
  if (/\bfull art\b|\bfa\b/.test(text)) tokens.add('full art');
  if (/\btrainer gallery\b|\bgalarian gallery\b|\bgallery\b|\bgg\s?-?\d{1,3}\b|\btg\s?-?\d{1,3}\b/.test(text)) tokens.add('gallery');
  if (/\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(text)) tokens.add('e-reader');
  if (/\bradiant\b/.test(text)) tokens.add('radiant');
  if (/\bdelta species\b|\bdelta\b/.test(text)) tokens.add('delta');
  if (/\bvstar\b/.test(text)) tokens.add('vstar');
  if (/\bvmax\b/.test(text)) tokens.add('vmax');
  if (/\bgx\b/.test(text)) tokens.add('gx');
  if (/\bex\b/.test(text)) tokens.add('ex');
  if (/\bv\b/.test(text)) tokens.add('v');
  return tokens;
}

function cardFormatTokens(card: PokemonTcgCard): Set<string> {
  const tokens = cardFormatTokensFromText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  const size = setSize(card);
  if (size !== undefined && size <= 30) tokens.add('small set');
  return tokens;
}

function setSize(card: PokemonTcgCard): number | undefined {
  const size = card.set?.printedTotal ?? card.set?.total;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : undefined;
}

function isPremiumIllustrationRarity(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.rarity, card.name, card.number].filter(Boolean).join(' '));
  return /\b(?:special illustration rare|special art rare|secret illustration rare|illustration rare|sir|sar)\b/.test(text);
}

function isOrdinaryExCard(card: PokemonTcgCard): boolean {
  return cardFormatTokens(card).has('ex') && !isPremiumIllustrationRarity(card);
}

function hasPremiumVmaxContext(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, card.number].filter(Boolean).join(' '));
  return (
    isPremiumIllustrationRarity(card) ||
    /\b(?:alt art|alternate art|full art|gallery|trainer gallery|galarian gallery|rare secret|secret rare|hyper rare|rainbow rare)\b/.test(text) ||
    /\b(?:special delivery|munch|poncho|pokemon center|kanazawa|yokohama|sapporo)\b/.test(text)
  );
}

function isOrdinaryVmaxCard(card: PokemonTcgCard): boolean {
  return cardFormatTokens(card).has('vmax') && !hasPremiumVmaxContext(card);
}

function hasPremiumCollectorShape(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series].filter(Boolean).join(' '));
  const formats = cardFormatTokens(card);
  if (isPremiumIllustrationRarity(card)) return true;
  if (hasPremiumVmaxContext(card)) return true;
  if (/\billustration collection\b/.test(text)) return true;
  if (/\b(?:special delivery|munch|poncho|pokemon center|kanazawa|yokohama|sapporo)\b/.test(text)) return true;
  return ['tag team', 'illustration', 'full art', 'gallery', 'e-reader', 'radiant', 'delta', 'vstar', 'gx'].some((format) => formats.has(format));
}

function isModernPlainPromo(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  const nameTokens = normalizedTokens(card.name ?? '').filter((token) => !['ex', 'gx', 'v', 'vmax', 'vstar'].includes(token));
  const year = releaseYear(card);
  return year >= 2017 && nameTokens.length <= 2 && /\bpromo|black star|promos\b/.test(text) && !hasPremiumCollectorShape(card) && !isOrdinaryExCard(card);
}

function isModernPromo(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  const year = releaseYear(card);
  return (year >= 2017 || /\bscarlet|violet|sword|shield\b/.test(text)) && /\bpromo|black star|promos\b/.test(text);
}

function isOrdinaryModernMainSetCard(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  const year = releaseYear(card);
  if (year < 2017) return false;
  if (/\bpromo|black star|promos\b/.test(text)) return false;
  if (hasPremiumCollectorShape(card) || isOrdinaryExCard(card)) return false;
  return /\b(?:common|uncommon|rare|rare holo)\b/.test(text);
}

function isOrdinaryLowRarityMainSetCard(card: PokemonTcgCard): boolean {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  if (/\bpromo|black star|promos\b/.test(text)) return false;
  if (hasPremiumCollectorShape(card) || isOrdinaryExCard(card)) return false;
  return /\b(?:common|uncommon)\b/.test(text);
}

function addFormatCounts(formatCounts: Map<string, number>, formats: Iterable<string>): void {
  for (const format of formats) formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1);
}

async function fetchPokemonCards(query: string, pageSize: number): Promise<PokemonTcgCard[]> {
  const params = new URLSearchParams({
    q: query,
    pageSize: String(pageSize),
    select: 'id,name,number,rarity,supertype,subtypes,set,images,nationalPokedexNumbers,types',
    orderBy: '-set.releaseDate'
  });
  const json = await fetchJsonWithTimeout(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`, SOURCE_CATALOG_TIMEOUT_MS);
  return Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [];
}

async function fetchTcgDexJapaneseSummaries(dexId: number): Promise<TcgDexCardSummary[]> {
  const params = new URLSearchParams({ dexId: String(dexId) });
  const json = await fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}?${params.toString()}`, SOURCE_CATALOG_TIMEOUT_MS);
  return Array.isArray(json) ? (json as TcgDexCardSummary[]) : [];
}

async function fetchTcgDexJapaneseSummariesByName(name: string): Promise<TcgDexCardSummary[]> {
  const params = new URLSearchParams({ name });
  const json = await fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}?${params.toString()}`, SOURCE_CATALOG_TIMEOUT_MS);
  return Array.isArray(json) ? (json as TcgDexCardSummary[]) : [];
}

async function fetchTcgDexJapaneseCard(id: string): Promise<TcgDexCard | null> {
  const json = await fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}/${encodeURIComponent(id)}`, SOURCE_CATALOG_TIMEOUT_MS).catch(() => null);
  return json && typeof json === 'object' ? (json as TcgDexCard) : null;
}

async function fetchDexNumbersForIdentityTerm(term: string): Promise<number[]> {
  const cards = await fetchPokemonCards(`name:${quoted(term)}`, 5).catch(() => []);
  return [...new Set(cards.filter((card) => cardMatchesIdentityTerm(card, term)).flatMap((card) => card.nationalPokedexNumbers ?? []).filter((dex) => Number.isFinite(dex)))];
}

function cardIdentityName(card: PokemonTcgCard): string {
  return normalizeSearchText(card.name ?? '')
    .replace(/\b(?:ex|gx|v|max|vmax|vstar|radiant|tag team)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cardMatchesIdentityTerm(card: PokemonTcgCard, term: string): boolean {
  const identity = cardIdentityName(card);
  const normalizedTerm = normalizeSearchText(term);
  return !!identity && identity === normalizedTerm;
}

async function resolveActiveChaseSourceCards(activeChases: Chase[]): Promise<PokemonTcgCard[]> {
  const cards: PokemonTcgCard[] = [];
  const seenIds = new Set<string>();
  for (const chase of activeChases.slice(0, SOURCE_PROFILE_CHASE_LIMIT)) {
    let resolvedChase = false;
    for (const term of activeChaseSearchTerms(chase).slice(0, SOURCE_PROFILE_PRIMARY_TERM_LIMIT)) {
      const results = await fetchPokemonCards(pokemonTcgQueryForActiveTerm(term), 3).catch(() => []);
      const card = results.find(
        (candidate) =>
          normalize(candidate.supertype ?? '') === 'pokemon' &&
          isActiveChaseEchoText([cardDisplayName(candidate), cardEvidenceSearchTerm(candidate)].filter(Boolean).join(' '), [chase])
      );
      if (!card?.id || seenIds.has(card.id)) continue;
      cards.push(card);
      seenIds.add(card.id);
      resolvedChase = true;
      break;
    }
    if (resolvedChase) continue;
    for (const term of activeChaseSearchTerms(chase).filter(isUsefulIdentityTerm).slice(0, SOURCE_PROFILE_FALLBACK_TERM_LIMIT)) {
      const results = await fetchPokemonCards(`name:${quoted(term.name)}`, 5).catch(() => []);
      const card = results.find((candidate) => normalize(candidate.supertype ?? '') === 'pokemon' && cardMatchesIdentityTerm(candidate, term.name) && (candidate.nationalPokedexNumbers?.length ?? 0) > 0);
      if (!card?.id || seenIds.has(card.id)) continue;
      cards.push(card);
      seenIds.add(card.id);
      break;
    }
  }
  return cards;
}

function sourceTasteProfileFromCards(cards: PokemonTcgCard[], activeChases: Chase[], japaneseSignalRatio = 0, hasPriorityJapaneseSignal = false): SourceTasteProfile {
  const dexNumbers = new Set(cards.flatMap((card) => card.nationalPokedexNumbers ?? []).filter((dex) => Number.isFinite(dex)));
  const dexNames = new Map<number, string>();
  const explicitFormatCounts = new Map<string, number>();
  const formatCounts = new Map<string, number>();
  let explicitExSignalCount = 0;
  let resolvedOrdinaryExCount = 0;
  let explicitVmaxSignalCount = 0;
  let resolvedOrdinaryVmaxCount = 0;
  for (const chase of activeChases) {
    const explicitFormats = cardFormatTokensFromText([chase.cardName, chase.targetNote].filter(Boolean).join(' '));
    if (explicitFormats.has('ex')) explicitExSignalCount += 1;
    if (explicitFormats.has('vmax')) explicitVmaxSignalCount += 1;
    addFormatCounts(explicitFormatCounts, explicitFormats);
    addFormatCounts(formatCounts, explicitFormats);
  }
  for (const card of cards) {
    const name = card.name
      ?.replace(/[-\s]+(?:ex|gx|v|max|vmax|vstar)\b/gi, '')
      .replace(/\btag team\b/gi, '')
      .replace(/[-\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    for (const dex of card.nationalPokedexNumbers ?? []) {
      if (!dexNames.has(dex)) dexNames.set(dex, name);
    }
    addFormatCounts(formatCounts, cardFormatTokens(card));
    if (isOrdinaryExCard(card)) resolvedOrdinaryExCount += 1;
    if (isOrdinaryVmaxCard(card)) resolvedOrdinaryVmaxCount += 1;
  }
  const ordinaryExSupportCount = explicitExSignalCount > 0 ? resolvedOrdinaryExCount : 0;
  const ordinaryVmaxSupportCount = explicitVmaxSignalCount > 0 ? resolvedOrdinaryVmaxCount : 0;
  const types = new Set(cards.flatMap((card) => card.types ?? []).map(normalizeSearchText).filter(Boolean));
  const subtypes = new Set(cards.flatMap((card) => card.subtypes ?? []).map(normalizeSearchText).filter(Boolean));
  const setTokens = normalizeTokenSet(cards.flatMap((card) => [card.set?.name, card.set?.series, card.rarity, setSize(card) !== undefined && setSize(card)! <= 30 ? 'small set' : undefined]));
  const releaseYears = cards.map(releaseYear).filter((year) => year > 0);
  const dexValues = [...dexNumbers];
  const kantoRatio = dexValues.length === 0 ? 0 : dexValues.filter((dex) => dex >= 1 && dex <= 151).length / dexValues.length;
  return { cards, signalCount: activeChases.length, dexNumbers, dexNames, explicitFormatCounts, formatCounts, ordinaryExSupportCount, ordinaryVmaxSupportCount, types, subtypes, setTokens, releaseYears, kantoRatio, japaneseSignalRatio, hasPriorityJapaneseSignal };
}

function sourceTasteProfileCacheKey(activeChases: Chase[]): string {
  return activeChases
    .slice(0, SOURCE_PROFILE_CHASE_LIMIT)
    .map((chase) => [chase.cardName, chase.targetNote ?? '', chase.priority ?? '', chase.tasteSource ?? '', chase.tasteWeight ?? ''].join('|'))
    .join('||');
}

async function withFallbackTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function sourceTasteProfile(activeChases: Chase[]): Promise<SourceTasteProfile> {
  const now = Date.now();
  const cacheKey = sourceTasteProfileCacheKey(activeChases);
  const cached = sourceTasteProfileCache.get(cacheKey);
  const fallbackProfile = sourceTasteProfileFromCards([], activeChases, japaneseSignalRatio(activeChases), hasPriorityJapaneseSignal(activeChases));
  if (cached && cached.expiresAt > now) return withFallbackTimeout(cached.promise, SOURCE_PROFILE_TIMEOUT_MS, fallbackProfile);

  const sourceCardsPromise = resolveActiveChaseSourceCards(activeChases).catch(() => []);
  const promise = sourceCardsPromise.then((cards) =>
    sourceTasteProfileFromCards(cards, activeChases, japaneseSignalRatio(activeChases), hasPriorityJapaneseSignal(activeChases))
  );
  sourceTasteProfileCache.set(cacheKey, { expiresAt: now + SOURCE_API_CACHE_TTL_MS, promise });
  try {
    return await withFallbackTimeout(promise, SOURCE_PROFILE_TIMEOUT_MS, fallbackProfile);
  } catch (error) {
    sourceTasteProfileCache.delete(cacheKey);
    throw error;
  }
}

function sourceIdentityTermSignalsFromChases(chases: Chase[], limit: number): SourceIdentityTermSignal[] {
  const terms = new Map<string, SourceIdentityTermSignal>();
  let firstIndex = 0;
  for (const chase of chases) {
    const weight = chaseSignalWeight(chase);
    const chaseTerms = activeChaseSearchTerms(chase)
      .flatMap((term) => normalizedTokens(term.name))
      .filter((token) => token.length >= 3 && /[a-z]/i.test(token) && !/\d/.test(token) && !SOURCE_PROFILE_IDENTITY_STOP_WORDS.has(token));
    for (const term of chaseTerms) {
      const existing = terms.get(term);
      if (existing) {
        existing.weight = Math.max(existing.weight, weight);
        continue;
      }
      terms.set(term, { term, weight, firstIndex });
      firstIndex += 1;
    }
  }
  return [...terms.values()].sort((left, right) => right.weight - left.weight || left.firstIndex - right.firstIndex).slice(0, limit);
}

function sourceIdentityTermsFromChases(chases: Chase[], limit: number): string[] {
  return sourceIdentityTermSignalsFromChases(chases, limit).map((signal) => signal.term);
}

function sourceIdentityTermWeightByTerm(chases: Chase[]): Map<string, number> {
  return new Map(sourceIdentityTermSignalsFromChases(chases, Number.POSITIVE_INFINITY).map((signal) => [signal.term, signal.weight]));
}

function queryNameAnchorTerm(query: string): string | undefined {
  const term = /(?:^|\s)name:"([^"]+)"/i.exec(query)?.[1];
  return term ? normalizeSearchText(term) : undefined;
}

function anchorBoostForWeight(weight: number | undefined): number {
  return weight === undefined ? 80 : 60 + Math.round(weight * 35);
}

function hasEReaderProfileEvidence(profile: SourceTasteProfile): boolean {
  return profile.formatCounts.has('e-reader') || ['e-card', 'expedition', 'aquapolis', 'skyridge'].some((token) => profile.setTokens.has(token));
}

function hasSmallSetProfileEvidence(profile: SourceTasteProfile): boolean {
  return profile.formatCounts.has('small set') || profile.setTokens.has('small set');
}

function expandedQueriesForProfile(baseQueries: string[], profile: SourceTasteProfile, activeChases: Chase[] = []): string[] {
  const queries = [...baseQueries];
  const profileTerms = sourceIdentityTermsFromChases(activeChases, 12);
  const promoBase = baseQueries.find((query) => /rarity:Promo/i.test(query));
  if (promoBase) {
    if (profile.kantoRatio >= 0.5) queries.push(`${promoBase} nationalPokedexNumbers:[1 TO 151]`);
    for (const subtype of ['tag team', 'gx', 'ex', 'basic']) {
      if (subtype === 'ex' && profile.ordinaryExSupportCount === 0) continue;
      if (profile.subtypes.has(subtype)) queries.push(`${promoBase} subtypes:${subtype.includes(' ') ? quoted(subtype.toUpperCase()) : subtype.toUpperCase()}`);
    }
    for (const type of [...profile.types].slice(0, 3)) queries.push(`${promoBase} types:${type}`);
    for (const term of profileTerms) queries.push(`${promoBase} name:${quoted(term)}`);
  }
  const broadPokemonBases = baseQueries.filter((query) => /^supertype:Pokemon$/i.test(query));
  for (const base of broadPokemonBases) {
    for (const term of profileTerms.slice(0, 8)) queries.push(`${base} name:${quoted(term)}`);
  }
  const retailEReaderPromoBases = baseQueries.filter((query) => /nintendo black star promos/i.test(query));
  for (const base of retailEReaderPromoBases) {
    for (const term of profileTerms.slice(0, 8)) queries.push(`${base} name:${quoted(term)}`);
  }
  const profileEReaderBases = ['supertype:Pokemon set.series:"E-Card"', 'supertype:Pokemon set.name:Expedition', 'supertype:Pokemon set.name:Aquapolis', 'supertype:Pokemon set.name:Skyridge'];
  const explicitEReaderBases = baseQueries.filter((query) => /set\.(?:series|name):/i.test(query) && /e-card|expedition|aquapolis|skyridge/i.test(query));
  const eReaderBases = explicitEReaderBases.length > 0 ? explicitEReaderBases : hasEReaderProfileEvidence(profile) ? profileEReaderBases : [];
  if (explicitEReaderBases.length === 0 && eReaderBases.length > 0) queries.push(...eReaderBases);
  if (hasSmallSetProfileEvidence(profile)) queries.push('supertype:Pokemon');
  if (eReaderBases.length > 0) {
    const targetedBases = eReaderBases.filter((query) => /set\.series:/i.test(query));
    const targetTerms = profileTerms.slice(0, 8);
    if (targetTerms.length > 0 && targetedBases.length > 0) {
      const nonEReaderQueries = queries.filter((query) => !eReaderBases.includes(query));
      queries.length = 0;
      queries.push(...nonEReaderQueries);
    }
    for (const term of targetTerms) {
      for (const base of targetedBases.length > 0 ? targetedBases : eReaderBases) queries.push(`${base} name:${quoted(term)}`);
    }
  }
  return [...new Set(queries)];
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const now = Date.now();
  const cached = sourceApiResponseCache.get(url);
  if (cached && cached.expiresAt > now) {
    if (cached.json !== undefined) return cached.json;
    if (cached.promise) return cached.promise;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const promise = (async () => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Pokemon TCG catalog request failed: ${response.status}`);
    return await response.json();
  })();
  sourceApiResponseCache.set(url, { expiresAt: now + SOURCE_API_CACHE_TTL_MS, promise });

  try {
    const json = await promise;
    sourceApiResponseCache.set(url, { expiresAt: Date.now() + SOURCE_API_CACHE_TTL_MS, json });
    return json;
  } catch (error) {
    sourceApiResponseCache.delete(url);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cardDisplayName(card: PokemonTcgCard): string | undefined {
  if (!card.name) return undefined;
  const setName = card.set?.name;
  const number = card.number;
  return [card.name, setName, number].filter(Boolean).join(' ');
}

function cardEvidenceSearchTerm(card: PokemonTcgCard): string | undefined {
  if (!card.name) return undefined;
  return [card.name, card.set?.name, card.number, 'Pokemon card'].filter(Boolean).join(' ');
}

function requiredCardEvidenceTokens(card: PokemonTcgCard): string[] {
  const tokens = normalizedTokens(card.name ?? '').slice(0, 2);
  if (card.number) tokens.push(card.number.toLowerCase());
  return [...new Set(tokens)].slice(0, 4);
}

function hashText(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function releaseYear(card: PokemonTcgCard): number {
  const year = Number(/^\d{4}/.exec(card.set?.releaseDate ?? '')?.[0]);
  return Number.isFinite(year) ? year : 0;
}

function sourceSuggestionFromPokemonCard(parent: DiscoverySuggestion, card: PokemonTcgCard): DiscoverySuggestion | null {
  const officialName = cardDisplayName(card);
  const name = officialName;
  const officialEvidenceSearchTerm = cardEvidenceSearchTerm(card);
  const evidenceSearchTerm = officialEvidenceSearchTerm;
  const imageUrl = card.images?.large ?? card.images?.small;
  if (!card.id || !name || !evidenceSearchTerm) return null;

  const setName = card.set?.name;
  const setLabel = setName ? ` from ${setName}` : '';
  const sourceTasteTokens = sanitizeInheritedSourceTasteTokens(parent.sourceTasteTokens, card.name ?? name);
  return {
    ...parent,
    name,
    lane: parent.lane.replace(/\bthread\b/i, 'source match'),
    laneWhy: `${parent.laneWhy}; source catalog surfaced ${card.name}${setLabel}`,
    why: parent.why,
    nearby: parent.nearby,
    evidenceSearchTerm,
    evidenceAliases: uniqueValuesPreservingOrder([name, evidenceSearchTerm, officialName, officialEvidenceSearchTerm].filter((value): value is string => !!value)),
    requiredEvidenceTokens: requiredCardEvidenceTokens(card),
    sourceTasteTokens,
    referenceImageUrl: imageUrl,
    referenceSourceName: setName ? `Pokemon TCG (${setName})` : 'Pokemon TCG',
    referenceSourceCardId: card.id,
    curiosityScore: (parent.curiosityScore ?? 0) + 2
  };
}

function tcgDexImageUrl(card: TcgDexCard): string | undefined {
  return card.image ? `${card.image}/high.png` : undefined;
}

function hasJapaneseScript(value: string | undefined): boolean {
  return !!value && JAPANESE_SCRIPT_PATTERN.test(value);
}

function tcgDexEnglishCardName(card: TcgDexCard, profile: SourceTasteProfile): string {
  if (card.name && !hasJapaneseScript(card.name)) return card.name;
  const dexNames = (card.dexId ?? []).map((dex) => profile.dexNames.get(dex)).filter((name): name is string => !!name);
  return dexNames.length > 0 ? dexNames.join(' & ') : 'Pokemon';
}

function tcgDexEnglishSetLabel(card: TcgDexCard): string | undefined {
  if (card.set?.id) return card.set.id;
  if (card.set?.name && !hasJapaneseScript(card.set.name)) return card.set.name;
  return undefined;
}

function tcgDexSetPrintedTotal(card: TcgDexCard): number | undefined {
  const total = card.set?.cardCount?.official ?? card.set?.cardCount?.total ?? card.set?.cards?.official ?? card.set?.cards?.total;
  return Number.isFinite(total) && total && total > 0 ? total : undefined;
}

function tcgDexNumberLabel(card: TcgDexCard): string | undefined {
  if (!card.localId) return undefined;
  const total = tcgDexSetPrintedTotal(card);
  return total ? `${card.localId}/${String(total).padStart(card.localId.length, '0')}` : card.localId;
}

function isSmallJapaneseSpecialSet(card: TcgDexCard): boolean {
  const total = tcgDexSetPrintedTotal(card);
  if (total !== undefined && total > 0 && total <= 30) return true;
  const text = normalizeSearchText([card.set?.name, card.set?.id, card.suffix, card.rarity].filter(Boolean).join(' '));
  return /\b(?:deck|box|promo|special|collection|battle|gift|vending|limited|exclusive)\b/.test(text);
}

function sourceSuggestionFromTcgDexJapaneseCard(parent: DiscoverySuggestion, card: TcgDexCard, profile: SourceTasteProfile): DiscoverySuggestion | null {
  if (!card.id || !card.name || !card.image) return null;
  const displayName = tcgDexEnglishCardName(card, profile);
  const setLabel = tcgDexEnglishSetLabel(card);
  const numberLabel = tcgDexNumberLabel(card);
  const name = [displayName, 'Japanese', setLabel, numberLabel].filter(Boolean).join(' ');
  const evidenceSearchTerm = [displayName, 'Japanese Pokemon card', setLabel, numberLabel].filter(Boolean).join(' ');
  const cardKey = normalizeSearchText([displayName, setLabel, numberLabel].filter(Boolean).join(' ')).split(/\s+/).slice(0, 4).join('-') || 'japanese-card';
  const sourceTasteTokens = sanitizeInheritedSourceTasteTokens(parent.sourceTasteTokens, displayName, ['japanese', ...(isSmallJapaneseSpecialSet(card) ? ['special set', 'small set', 'numbered set'] : [])]);
  return {
    ...parent,
    name,
    lane: parent.lane.replace(/\bthread\b/i, 'Japanese source match'),
    laneWhy: `${parent.laneWhy}; Japanese source catalog surfaced ${displayName}${setLabel ? ` from ${setLabel}` : ''}`,
    evidenceSearchTerm,
    evidenceAliases: [name, evidenceSearchTerm],
    requiredEvidenceTokens: [cardKey, 'japanese', ...(numberLabel?.includes('/') ? [numberLabel] : [])],
    sourceTasteTokens,
    referenceImageUrl: tcgDexImageUrl(card),
    referenceSourceName: setLabel ? `TCGdex Japanese (${setLabel})` : 'TCGdex Japanese',
    referenceSourceCardId: card.id,
    curiosityScore: (parent.curiosityScore ?? 0) + 3
  };
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sourceProfileScore(card: PokemonTcgCard, profile: SourceTasteProfile): number {
  const cardDexNumbers = card.nationalPokedexNumbers ?? [];
  const cardTypes = new Set((card.types ?? []).map(normalizeSearchText));
  const cardSubtypes = new Set((card.subtypes ?? []).map(normalizeSearchText));
  const cardSetTokens = normalizeTokenSet([card.set?.name, card.set?.series, card.rarity]);
  const exactDexScore = cardDexNumbers.filter((dex) => profile.dexNumbers.has(dex)).length * 14;
  const kantoScore = profile.kantoRatio >= 0.5 && cardDexNumbers.some((dex) => dex >= 1 && dex <= 151) ? 12 : 0;
  const typeScore = [...cardTypes].filter((type) => profile.types.has(type)).length * 6;
  const subtypeScore = [...cardSubtypes].filter((subtype) => profile.subtypes.has(subtype)).length * 7;
  const setShapeScore = [...cardSetTokens].filter((token) => profile.setTokens.has(token)).length * 3;
  const profileYear = average(profile.releaseYears);
  const year = releaseYear(card);
  const eraScore = profileYear && year > 0 ? Math.max(0, 10 - Math.abs(year - profileYear)) : 0;
  return exactDexScore + kantoScore + typeScore + subtypeScore + setShapeScore + eraScore;
}

function tcgDexJapaneseScore(card: TcgDexCard, profile: SourceTasteProfile): number {
  const dexNumbers = card.dexId ?? [];
  const types = new Set((card.types ?? []).map(normalizeSearchText));
  const cardText = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.id, card.stage, card.suffix].filter(Boolean).join(' '));
  const exactDexScore = dexNumbers.filter((dex) => profile.dexNumbers.has(dex)).length * 18;
  const kantoScore = profile.kantoRatio >= 0.5 && dexNumbers.some((dex) => dex >= 1 && dex <= 151) ? 14 : 0;
  const typeScore = [...types].filter((type) => profile.types.has(type)).length * 7;
  const specialShapeScore = [
    /\b(ex|gx|v|max|vmax|vstar|star|delta|promo|pr|pcg|pmcg|neo|e[1-5])\b/.test(cardText),
    !!card.image,
    !!card.rarity && !/\bnone\b/.test(cardText)
  ].filter(Boolean).length * 5;
  const imageScore = card.image ? 12 : -18;
  const sourcePreferenceScore = 24;
  const smallSpecialSetScore = isSmallJapaneseSpecialSet(card) ? 28 : 0;
  const ordinaryModernRarityPenalty = isOrdinaryModernJapaneseRarity(card) ? 36 : 0;
  const deterministicVarietyScore = hashText(card.id ?? card.name ?? '') % 5;
  return sourcePreferenceScore + exactDexScore + kantoScore + typeScore + specialShapeScore + imageScore + smallSpecialSetScore + deterministicVarietyScore - ordinaryModernRarityPenalty;
}

function isOrdinaryModernJapaneseRarity(card: TcgDexCard): boolean {
  const text = normalizeSearchText([card.rarity, card.set?.id, card.set?.name, card.suffix, card.localId].filter(Boolean).join(' '));
  const setId = normalizeSearchText(card.set?.id ?? '');
  const isModernEraSet = /^(?:sv|svi|s)[a-z0-9-]*$/.test(setId) || /\bscarlet|violet\b/.test(text);
  if (!isModernEraSet) return false;
  if (/\b(?:sar|sir|ar|chr|csr|sr|hr|ur|secret|promo|pr|ex|gx|vmax|vstar|radiant|shiny|master ball|poke ball)\b/.test(text)) return false;
  if (/\b(?:rare|holo rare|double rare|common|uncommon)\b/.test(text)) return true;
  return false;
}

function matchesJapaneseCollectorQuality(card: TcgDexCard): boolean {
  if (isSmallJapaneseSpecialSet(card)) return true;
  return !isOrdinaryModernJapaneseRarity(card);
}

function matchesTcgDexProfileAnchor(card: TcgDexCard, profile: SourceTasteProfile): boolean {
  if (profile.dexNumbers.size === 0) return true;
  return (card.dexId ?? []).some((dex) => profile.dexNumbers.has(dex));
}

function isBroadCollectorSuggestion(suggestion: DiscoverySuggestion): boolean {
  const taste = (suggestion.sourceTasteTokens ?? []).map(normalizeSearchText).filter(Boolean);
  const text = normalizeSearchText([sourceText(suggestion), ...taste].join(' '));
  return taste.includes('collector') || /\bcollector\b/.test(text);
}

function isVintageSuggestion(suggestion: DiscoverySuggestion): boolean {
  const taste = (suggestion.sourceTasteTokens ?? []).map(normalizeSearchText).filter(Boolean);
  const text = normalizeSearchText([sourceText(suggestion), ...taste, ...(suggestion.requiredEvidenceTokens ?? [])].join(' '));
  return taste.includes('vintage') || /\bvintage\b|\be[- ]?reader\b|\bexpedition\b|\baquapolis\b|\bskyridge\b/.test(text);
}

function hasExactPokemonProfileAnchor(card: PokemonTcgCard, profile: SourceTasteProfile): boolean {
  if (profile.dexNumbers.size === 0) return true;
  return (card.nationalPokedexNumbers ?? []).some((dex) => profile.dexNumbers.has(dex));
}

function isTraitDiscoverySuggestion(suggestion: DiscoverySuggestion): boolean {
  const text = normalizeSearchText([sourceText(suggestion), ...(suggestion.sourceTasteTokens ?? []), ...(suggestion.requiredEvidenceTokens ?? [])].join(' '));
  return (
    /\bdiscovery\b/i.test(suggestion.lane) ||
    /\bbroad source-backed card backfill\b/i.test(suggestion.laneWhy) ||
    /\b(?:artwork|illustration rare|visual format)\b/.test(text)
  );
}

function matchesPokemonTcgProfileAnchor(card: PokemonTcgCard, suggestion: DiscoverySuggestion, profile: SourceTasteProfile): boolean {
  if (isBroadCollectorSuggestion(suggestion) && profile.dexNumbers.size === 0) return false;
  if (hasExactPokemonProfileAnchor(card, profile)) return true;
  if (isTraitDiscoverySuggestion(suggestion) && profile.dexNumbers.size > 0) return false;
  return !isBroadCollectorSuggestion(suggestion);
}

function matchesActivePokemonIdentityTerm(card: PokemonTcgCard, activeChases: Chase[]): boolean {
  const cardTokens = new Set(activeCardTokens(card.name ?? ''));
  if (cardTokens.size === 0) return false;
  return activeChases.some((chase) =>
    activeChaseSearchTerms(chase)
      .filter((term) => isUsefulIdentityTerm(term))
      .some((term) => activeCardTokens(term.name).some((token) => cardTokens.has(token)))
  );
}

function matchesTraitDiscoverySubject(card: PokemonTcgCard, suggestion: DiscoverySuggestion, profile: SourceTasteProfile, activeChases: Chase[]): boolean {
  if (!isTraitDiscoverySuggestion(suggestion) || activeChases.length === 0) return true;
  if (profile.dexNumbers.size > 0 && hasExactPokemonProfileAnchor(card, profile)) return true;
  return matchesActivePokemonIdentityTerm(card, activeChases);
}

function matchesVintageProfileEvidence(card: PokemonTcgCard, suggestion: DiscoverySuggestion, profile: SourceTasteProfile, hasAnchoredQuery: boolean): boolean {
  if (!isVintageSuggestion(suggestion) || profile.signalCount === 0) return true;
  const hasExactDexEvidence = profile.dexNumbers.size > 0 && hasExactPokemonProfileAnchor(card, profile);
  return hasExactDexEvidence || hasAnchoredQuery;
}

function isGenericSourceThread(suggestion: DiscoverySuggestion): boolean {
  return /\bpromo|special|collector\b/i.test(sourceText(suggestion));
}

function matchesCardFormatProfile(card: PokemonTcgCard, suggestion: DiscoverySuggestion, profile: SourceTasteProfile): boolean {
  const parentTasteTokens = new Set((suggestion.sourceTasteTokens ?? []).map(normalizeSearchText));
  for (const format of cardFormatTokens(card)) {
    if (format !== 'ex' && format !== 'vmax') continue;
    const isOrdinaryFormatCard = format === 'ex' ? isOrdinaryExCard(card) : isOrdinaryVmaxCard(card);
    if (!isOrdinaryFormatCard) continue;
    if (parentTasteTokens.has(format) && profile.cards.length === 0) continue;
    if (!isGenericSourceThread(suggestion)) continue;
    if (format === 'ex' && profile.ordinaryExSupportCount === 0) return false;
    if (format === 'vmax' && profile.ordinaryVmaxSupportCount === 0) return false;
  }
  return true;
}

function matchesCollectorQualityProfile(card: PokemonTcgCard, suggestion: DiscoverySuggestion, profile: SourceTasteProfile, hasAnchoredQuery: boolean): boolean {
  if (isRetailEReaderPromoSuggestion(suggestion)) {
    const subjectToken = retailEReaderPromoSubjectToken(suggestion);
    const cardTokens = new Set(activeCardTokens(card.name ?? ''));
    return /\bnintendo black star promos?\b/i.test(card.set?.name ?? '') && (!subjectToken || cardTokens.has(subjectToken));
  }
  if (isBroadCollectorSuggestion(suggestion) && profile.signalCount > 0 && profile.dexNumbers.size === 0 && !hasPremiumCollectorShape(card)) return false;
  if (isGenericSourceThread(suggestion) && !isVintageSuggestion(suggestion) && isOrdinaryLowRarityMainSetCard(card)) return false;
  if (isGenericSourceThread(suggestion) && isOrdinaryModernMainSetCard(card)) return false;
  if (isGenericSourceThread(suggestion) && isModernPromo(card) && !hasAnchoredQuery && !hasPremiumCollectorShape(card)) return false;
  return !(isGenericSourceThread(suggestion) && isModernPlainPromo(card));
}

function shouldPreferJapaneseOnly(suggestion: DiscoverySuggestion, profile: SourceTasteProfile): boolean {
  const explicitJapaneseThread = /\bjapanese\b/i.test([sourceText(suggestion), ...(suggestion.requiredEvidenceTokens ?? [])].join(' '));
  return explicitJapaneseThread || profile.japaneseSignalRatio >= 0.85;
}

function japaneseSuggestionCap(suggestion: DiscoverySuggestion, profile: SourceTasteProfile, limit: number): number {
  if (shouldPreferJapaneseOnly(suggestion, profile)) return limit;
  if (profile.japaneseSignalRatio >= 0.5 || profile.hasPriorityJapaneseSignal) return Math.max(1, Math.ceil(limit / 2));
  return 1;
}

function candidateScore(card: PokemonTcgCard, parent: DiscoverySuggestion, profile: SourceTasteProfile): number {
  const text = normalizeSearchText([card.name, card.rarity, card.set?.name, card.set?.series, ...(card.subtypes ?? [])].filter(Boolean).join(' '));
  const required = parent.requiredEvidenceTokens ?? [];
  const tasteTokens = parent.sourceTasteTokens ?? [];
  const requiredScore = required.filter((token) => text.includes(normalizeSearchText(token))).length * 10;
  const tasteScore = tasteTokens.filter((token) => {
    const normalizedToken = normalizeSearchText(token);
    return normalizedToken.length >= 2 && text.includes(normalizedToken);
  }).length * 7;
  const profileShapeScore = [
    /\bpromo\b/.test(text),
    /\b(ex|v|vstar|radiant|illustration|trainer gallery|special illustration)\b/.test(text) || (cardFormatTokens(card).has('vmax') && hasPremiumVmaxContext(card)),
    /\bblack star|promos?\b/.test(text)
  ].filter(Boolean).length * 5;
  const imageScore = card.images?.large || card.images?.small ? 4 : 0;
  const rarityScore = card.rarity ? 2 : 0;
  const recencyScore = Math.min(5, Math.max(0, releaseYear(card) - 2018));
  const parentTasteTokens = new Set(tasteTokens.map(normalizeSearchText));
  const candidateFormats = [...cardFormatTokens(card)];
  const offProfileFormatPenalty = candidateFormats.reduce((sum, format) => {
    if (format === 'ex' && !isOrdinaryExCard(card)) return sum;
    if (parentTasteTokens.has(format)) return sum;
    const support = profile.formatCounts.get(format) ?? 0;
    if (support === 0) return sum + 40;
    if (support === 1 && /\bpromo|special|collector\b/i.test(sourceText(parent))) return sum + 18;
    return sum;
  }, 0);
  const modernPlainPromoPenalty = isModernPlainPromo(card) ? (hasExactPokemonProfileAnchor(card, profile) ? 30 : 50) : 0;
  const retailEReaderSubject = retailEReaderPromoSubjectToken(parent);
  const exactRetailEReaderSubjectBoost = isRetailEReaderPromoSuggestion(parent) && retailEReaderSubject && (card.name ?? '').trim().toLowerCase() === retailEReaderSubject ? 1000 : 0;
  const deterministicVarietyScore = hashText(card.id ?? card.name ?? '') % 5;
  return requiredScore + tasteScore + sourceProfileScore(card, profile) + profileShapeScore + imageScore + rarityScore + recencyScore + exactRetailEReaderSubjectBoost + deterministicVarietyScore - offProfileFormatPenalty - modernPlainPromoPenalty;
}

async function resolveTcgDexJapaneseCards(
  suggestion: DiscoverySuggestion,
  tasteProfileChases: Chase[],
  activeChases: Chase[],
  profile: SourceTasteProfile,
  limit: number
): Promise<DiscoverySuggestion[]> {
  if (isRetailEReaderPromoSuggestion(suggestion) || isNicheJapaneseExclusiveSuggestion(suggestion)) return [];
  if (!hasJapaneseTaste(suggestion) && profile.japaneseSignalRatio < 0.5 && !profile.hasPriorityJapaneseSignal) return [];

  const summariesById = new Map<string, TcgDexCardSummary>();
  for (const dexId of [...profile.dexNumbers].slice(0, 8)) {
    const summaries = await fetchTcgDexJapaneseSummaries(dexId).catch(() => []);
    if (summaries.length > TCGDEX_MAX_DEX_SUMMARY_MATCHES) continue;
    for (const summary of summaries.slice(0, TCGDEX_SOURCE_CATALOG_PAGE_SIZE)) {
      if (summary.id) summariesById.set(summary.id, summary);
    }
  }

  for (const chase of tasteProfileChases.slice(0, TCGDEX_PROFILE_CHASE_LIMIT)) {
    for (const term of activeChaseSearchTerms(chase).filter((searchTerm) => /[a-z]/i.test(searchTerm.name) && isUsefulIdentityTerm(searchTerm)).slice(0, TCGDEX_PROFILE_TERM_LIMIT)) {
      const dexNumbers = await fetchDexNumbersForIdentityTerm(term.name);
      for (const dexId of dexNumbers) {
        profile.dexNumbers.add(dexId);
        if (!profile.dexNames.has(dexId)) profile.dexNames.set(dexId, displayIdentityTerm(term.name));
        const summaries = await fetchTcgDexJapaneseSummaries(dexId).catch(() => []);
        if (summaries.length > TCGDEX_MAX_DEX_SUMMARY_MATCHES) continue;
        for (const summary of summaries.slice(0, TCGDEX_SOURCE_CATALOG_PAGE_SIZE)) {
          if (summary.id) summariesById.set(summary.id, summary);
        }
      }
      const summaries = await fetchTcgDexJapaneseSummariesByName(term.name).catch(() => []);
      for (const summary of summaries.slice(0, TCGDEX_SOURCE_CATALOG_PAGE_SIZE)) {
        if (summary.id) summariesById.set(summary.id, summary);
      }
    }
  }

  const cards = await Promise.all(
    [...summariesById.values()].slice(0, TCGDEX_SOURCE_CATALOG_PAGE_SIZE).map(async (summary) => (summary.id ? fetchTcgDexJapaneseCard(summary.id) : null))
  );
  const rankedCards = cards
    .filter((card): card is TcgDexCard => !!card && normalize(card.category ?? '') === 'pokemon' && matchesTcgDexProfileAnchor(card, profile) && matchesJapaneseCollectorQuality(card))
    .sort((left, right) => tcgDexJapaneseScore(right, profile) - tcgDexJapaneseScore(left, profile));

  const suggestions: DiscoverySuggestion[] = [];
  const seenNames = new Set<string>();
  for (const card of rankedCards) {
    const sourceSuggestion = sourceSuggestionFromTcgDexJapaneseCard(suggestion, card, profile);
    if (!sourceSuggestion) continue;
    if (isActiveChaseEchoText(sourceSuggestion.name, activeChases) || isActiveChaseEchoText(sourceSuggestion.evidenceSearchTerm ?? '', activeChases)) continue;
    const key = normalizeSearchText(sourceSuggestion.name);
    if (seenNames.has(key)) continue;
    suggestions.push(sourceSuggestion);
    seenNames.add(key);
    if (suggestions.length >= limit) break;
  }

  return suggestions;
}

export async function resolveSourceBackedDiscoveryCards(
  suggestion: DiscoverySuggestion,
  activeChases: Chase[],
  limit = 4,
  tasteProfileChases: Chase[] = activeChases
): Promise<SourceBackedDiscoveryResult> {
  const queries = pokemonTcgCatalogQueriesForSuggestion(suggestion);

  try {
    const profile = await sourceTasteProfile(tasteProfileChases);
    const japaneseSuggestions = await resolveTcgDexJapaneseCards(suggestion, tasteProfileChases, activeChases, profile, limit);
    const curatedSuggestions: DiscoverySuggestion[] = [];
    if (japaneseSuggestions.length > 0 && shouldPreferJapaneseOnly(suggestion, profile)) {
      return { suggestions: uniqueSuggestionsByName([...curatedSuggestions, ...japaneseSuggestions]).slice(0, limit) };
    }
    if (queries.length === 0) {
      const suggestions = uniqueSuggestionsByName([...curatedSuggestions, ...japaneseSuggestions]).slice(0, limit);
      return suggestions.length > 0 ? { suggestions } : { suggestions: [], sourceStatus: 'UNSUPPORTED' };
    }

    const cardsById = new Map<string, PokemonTcgCard>();
    const anchoredQueryCardScores = new Map<string, number>();
    const anchorWeightsByTerm = sourceIdentityTermWeightByTerm(tasteProfileChases);
    const expandedQueries = expandedQueriesForProfile(queries, profile, tasteProfileChases);
    const queryResults = await Promise.all(expandedQueries.map(async (query) => ({ query, cards: await fetchPokemonCards(query, SOURCE_CATALOG_PAGE_SIZE).catch(() => []) })));
    for (const { query, cards } of queryResults) {
      const anchorTerm = queryNameAnchorTerm(query);
      const anchorBoost = anchorBoostForWeight(anchorTerm ? anchorWeightsByTerm.get(anchorTerm) : undefined);
      for (const card of cards) {
        if (!card.id || normalize(card.supertype ?? '') !== 'pokemon') continue;
        cardsById.set(card.id, card);
        if (anchorTerm) anchoredQueryCardScores.set(card.id, Math.max(anchoredQueryCardScores.get(card.id) ?? 0, anchorBoost));
      }
    }

    const rankedCardScore = (card: PokemonTcgCard) => candidateScore(card, suggestion, profile) + (anchoredQueryCardScores.get(card.id ?? '') ?? 0);
    const rankedCards = [...cardsById.values()].sort((left, right) => {
      const retailSubjectDelta = exactRetailEReaderSubjectRank(right, suggestion) - exactRetailEReaderSubjectRank(left, suggestion);
      if (retailSubjectDelta !== 0) return retailSubjectDelta;
      return rankedCardScore(right) - rankedCardScore(left);
    });
    const japaneseSeed = japaneseSuggestions.slice(0, japaneseSuggestionCap(suggestion, profile, limit));
    const suggestions: DiscoverySuggestion[] = [...curatedSuggestions, ...japaneseSeed];
    const seenNames = new Set(japaneseSeed.map((sourceSuggestion) => normalizeSearchText(sourceSuggestion.name)));
    for (const curatedSuggestion of curatedSuggestions) seenNames.add(normalizeSearchText(curatedSuggestion.name));
    const seenPokemonSubjects = new Map<string, number>();
    const pokemonSubjectLimit = profile.signalCount >= 6 ? 2 : 1;
    for (const card of rankedCards) {
      const hasAnchoredQuery = anchoredQueryCardScores.has(card.id ?? '');
      if (
        !matchesPokemonTcgProfileAnchor(card, suggestion, profile) ||
        !matchesTraitDiscoverySubject(card, suggestion, profile, tasteProfileChases) ||
        !matchesVintageProfileEvidence(card, suggestion, profile, hasAnchoredQuery) ||
        !matchesCardFormatProfile(card, suggestion, profile) ||
        !matchesCollectorQualityProfile(card, suggestion, profile, hasAnchoredQuery)
      )
        continue;
      const sourceSuggestion = sourceSuggestionFromPokemonCard(suggestion, card);
      if (!sourceSuggestion) continue;
      if (isActiveChaseEchoText(sourceSuggestion.name, activeChases) || isActiveChaseEchoText(sourceSuggestion.evidenceSearchTerm ?? '', activeChases)) continue;
      const subjectKey = normalizeSearchText(card.name ?? '');
      if (subjectKey && (seenPokemonSubjects.get(subjectKey) ?? 0) >= pokemonSubjectLimit) continue;
      const key = normalizeSearchText(sourceSuggestion.name);
      if (seenNames.has(key)) continue;
      suggestions.push(sourceSuggestion);
      seenNames.add(key);
      if (subjectKey) seenPokemonSubjects.set(subjectKey, (seenPokemonSubjects.get(subjectKey) ?? 0) + 1);
      if (suggestions.length >= limit) break;
    }

    for (const japaneseSuggestion of japaneseSuggestions.slice(japaneseSeed.length)) {
      if (suggestions.length >= limit) break;
      const key = normalizeSearchText(japaneseSuggestion.name);
      if (seenNames.has(key)) continue;
      suggestions.push(japaneseSuggestion);
      seenNames.add(key);
    }

    return suggestions.length > 0 ? { suggestions } : { suggestions: [], sourceStatus: 'NOT_FOUND' };
  } catch (error) {
    return { suggestions: [], sourceStatus: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR' };
  }
}
