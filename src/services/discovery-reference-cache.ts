import { db } from './db.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';

export type DiscoveryReferenceStatus = 'NOT_FOUND' | 'UNSUPPORTED' | 'TIMEOUT' | 'ERROR';

export type DiscoveryReferenceCacheEntry = {
  cacheKey: string;
  suggestionName: string;
  imageUrl?: string;
  sourceName?: string;
  sourceCardId?: string;
  sourceStatus?: DiscoveryReferenceStatus;
  fetchedAt: string;
  updatedAt: string;
};

type DiscoveryReferenceCacheRow = {
  cache_key: string;
  suggestion_name: string;
  image_url: string | null;
  source_name: string | null;
  source_card_id: string | null;
  source_status: DiscoveryReferenceStatus | null;
  fetched_at: string;
  updated_at: string;
};

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string };
  images?: { small?: string; large?: string };
};

type UpsertDiscoveryReferenceCacheInput = {
  cacheKey: string;
  suggestionName: string;
  imageUrl?: string;
  sourceName?: string;
  sourceCardId?: string;
  sourceStatus?: DiscoveryReferenceStatus;
  fetchedAt?: string;
};

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const ONE_PIECE_CARD_IMAGE_BASE_URL = 'https://en.onepiece-cardgame.com/images/cardlist/card';
const REFERENCE_FETCH_TIMEOUT_MS = 12000;

const SET_HINTS: Array<{ pattern: RegExp; setName: string }> = [
  { pattern: /southern islands?/i, setName: 'Southern Islands' },
  { pattern: /cosmic eclipse/i, setName: 'Cosmic Eclipse' },
  { pattern: /champion'?s path/i, setName: "Champion's Path" },
  { pattern: /celebrations.*classic collection|classic collection.*celebrations/i, setName: 'Celebrations: Classic Collection' },
  { pattern: /celebrations/i, setName: 'Celebrations' },
  { pattern: /crown zenith/i, setName: 'Crown Zenith' },
  { pattern: /destined rivals/i, setName: 'Destined Rivals' },
  { pattern: /pokemon\s+151|\b151\b/i, setName: '151' },
  { pattern: /mcdonald'?s|18\s?\/\s?25|25th anniversary/i, setName: "McDonald's Collection 2021" },
  { pattern: /evolutions/i, setName: 'Evolutions' },
  { pattern: /fusion strike/i, setName: 'Fusion Strike' },
  { pattern: /legendary treasures/i, setName: 'Legendary Treasures' },
  { pattern: /lost origin/i, setName: 'Lost Origin' },
  { pattern: /fates collide/i, setName: 'Fates Collide' },
  { pattern: /generations/i, setName: 'Generations' },
  { pattern: /paldean fates/i, setName: 'Paldean Fates' },
  { pattern: /supreme victors/i, setName: 'Supreme Victors' },
  { pattern: /aquapolis/i, setName: 'Aquapolis' },
  { pattern: /expedition/i, setName: 'Expedition Base Set' },
  { pattern: /skyridge/i, setName: 'Skyridge' },
  { pattern: /neo discovery/i, setName: 'Neo Discovery' },
  { pattern: /neo destiny/i, setName: 'Neo Destiny' },
  { pattern: /gym challenge/i, setName: 'Gym Challenge' },
  { pattern: /gym heroes/i, setName: 'Gym Heroes' },
  { pattern: /deoxys/i, setName: 'Deoxys' },
  { pattern: /undaunted/i, setName: 'Undaunted' },
  { pattern: /hidden fates/i, setName: 'Hidden Fates' },
  { pattern: /surging sparks/i, setName: 'Surging Sparks' },
  { pattern: /unified minds/i, setName: 'Unified Minds' },
  { pattern: /vivid voltage/i, setName: 'Vivid Voltage' },
  { pattern: /sm black star|sun & moon black star/i, setName: 'SM Black Star Promos' },
  { pattern: /swsh black star|sword & shield black star/i, setName: 'SWSH Black Star Promos' },
  { pattern: /nintendo black star/i, setName: 'Nintendo Black Star Promos' }
];

const getDiscoveryReferenceCacheStmt = db.prepare(`
  SELECT cache_key, suggestion_name, image_url, source_name, source_card_id, source_status, fetched_at, updated_at
  FROM discovery_reference_cache
  WHERE cache_key = ?
`);

const upsertDiscoveryReferenceCacheStmt = db.prepare(`
  INSERT INTO discovery_reference_cache (
    cache_key, suggestion_name, image_url, source_name, source_card_id, source_status, fetched_at, updated_at
  )
  VALUES (
    @cache_key, @suggestion_name, @image_url, @source_name, @source_card_id, @source_status, @fetched_at, @updated_at
  )
  ON CONFLICT(cache_key) DO UPDATE SET
    suggestion_name = excluded.suggestion_name,
    image_url = COALESCE(excluded.image_url, discovery_reference_cache.image_url),
    source_name = COALESCE(excluded.source_name, discovery_reference_cache.source_name),
    source_card_id = COALESCE(excluded.source_card_id, discovery_reference_cache.source_card_id),
    source_status = CASE
      WHEN excluded.image_url IS NULL AND discovery_reference_cache.image_url IS NOT NULL THEN discovery_reference_cache.source_status
      ELSE excluded.source_status
    END,
    fetched_at = excluded.fetched_at,
    updated_at = excluded.updated_at
`);

const deleteDiscoveryReferenceCacheStmt = db.prepare(`
  DELETE FROM discovery_reference_cache
  WHERE cache_key = ?
`);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compactName(value: string): string {
  return value
    .replace(/\bPokemon\b/gi, '')
    .replace(/\b(card|cards|promo|holo|secret rare|illustration rare|art rare|trainer gallery|parallel|leader|trading)\b/gi, '')
    .replace(/\bsurging sparks\b\s*\d{1,3}\b/gi, '')
    .replace(/\b(?:sun & moon black star promos?|sm black star promos?|sword & shield black star promos?|swsh black star promos?|xy black star promos?|bw black star promos?|black star promos?|black star|mcdonald'?s|anniversary|vending series|web series)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '')}"`;
}

function extractNumber(value: string): string | undefined {
  const slashNumber = /\b([A-Z]{0,4}\d{1,3})\s*\/\s*\d{1,3}\b/i.exec(value)?.[1];
  if (slashNumber) return slashNumber.toUpperCase();
  const codeNumber = /\b(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}\b/i.exec(value)?.[0];
  if (codeNumber) return codeNumber.replace(/\s|-/g, '').toUpperCase();
  const holoNumber = /\bH\d{1,2}\b/i.exec(value)?.[0];
  if (holoNumber) return holoNumber.toUpperCase();
  const surgingSparksNumber = /\bsurging sparks\b.*\b([1-9]\d{1,2})\b/i.exec(value)?.[1];
  if (surgingSparksNumber) return surgingSparksNumber;
  const setNumber = /\b(?:base set|champion'?s path|celebrations|classic collection|destined rivals|evolutions|fusion strike|generations|legendary treasures|lost origin|paldean fates|surging sparks|unified minds|vivid voltage|expedition|aquapolis|skyridge|gym heroes|gym challenge|neo discovery|neo destiny|fossil|jungle|team rocket|xy black star promos?|bw black star promos?|swsh black star promos?)\b.*\b([1-9]\d{0,2})\b/i.exec(value)?.[1];
  if (setNumber) return setNumber;
  const standalone = /\b0\d{2}\b/.exec(value)?.[0];
  return standalone;
}

function leadingName(value: string): string {
  const beforeNumber = value.split(/\b(?:[A-Z]{0,4}\d{1,3}\s*\/\s*\d{1,3}|(?:GG|TG|RC|XY|SM|SWSH|SVP|BW|DP|HGSS)\s?-?\d{1,4}|H\d{1,2}|0\d{2})\b/i)[0];
  return compactName(beforeNumber)
    .replace(/\b(?:southern islands?|champion'?s path|celebrations|classic collection|classic|crown zenith|cosmic eclipse|destined rivals|evolutions|fusion strike|generations|legendary treasures|lost origin|paldean fates|pokemon 151|triplet beat|fossil|aquapolis|expedition|neo discovery|neo destiny|gym challenge|gym heroes|deoxys|fates collide|undaunted|hidden fates|surging sparks|unified minds|vivid voltage)\b/gi, '')
    .replace(/\b(?:base set|skyridge|xy|bw|swsh)\b/gi, '')
    .replace(/\s*:\s*/g, ' ')
    .replace(/\b[1-9]\d{0,2}\b\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function setHintForSuggestion(value: string): string | undefined {
  return SET_HINTS.find((hint) => hint.pattern.test(value))?.setName;
}

function isUnsupportedReferenceSuggestion(value: string): boolean {
  return (
    /\b(one piece|luffy|nami|zoro|sabo)\b/i.test(value) ||
    /\bmcdonald'?s\b/i.test(value) && /\be[- ]?(?:reader|series)\b/i.test(value) && /\b0?\d{1,2}\s?\/\s?018\b/i.test(value) ||
    /\braichu\b/i.test(value) && /\b(?:no\.?\s*)?0?26\b/i.test(value) && /\b(?:bulbasaur deck|intro pack|vhs)\b/i.test(value)
  );
}

function onePieceSourceText(suggestion: DiscoverySuggestion): string {
  return [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
}

function isOnePieceReferenceSuggestion(suggestion: DiscoverySuggestion): boolean {
  return /\b(one piece|luffy|nami|zoro|sabo)\b/i.test(onePieceSourceText(suggestion));
}

function extractOnePieceCardCode(value: string): string | undefined {
  return /\b(?:OP|ST|EB|PRB|P)-?\d{2,3}-\d{3}\b/i.exec(value)?.[0].toUpperCase();
}

function onePieceImagePathCandidates(suggestion: DiscoverySuggestion): string[] {
  const sourceText = onePieceSourceText(suggestion);
  const code = extractOnePieceCardCode(sourceText);
  if (!code) return [];

  const variants: string[] = [];
  if (/\b(parallel|alternate|alt art|manga)\b/i.test(sourceText)) variants.push(`${code}_p1`);
  variants.push(code, `${code}_p1`, `${code}_p2`, `${code}_p3`);
  return [...new Set(variants)].map((variant) => `${ONE_PIECE_CARD_IMAGE_BASE_URL}/${variant}.png`);
}

export function onePieceCardImageCandidatesForSuggestion(suggestion: DiscoverySuggestion): string[] {
  if (!isOnePieceReferenceSuggestion(suggestion)) return [];
  return onePieceImagePathCandidates(suggestion);
}

function shouldAllowBroadNameFallback(value: string): boolean {
  if (/\b\d{1,3}\s?\/\s?\d{1,3}\b/i.test(value)) return false;
  return !/\b(triplet beat|japanese|vending|web series)\b/i.test(value);
}

function mapDiscoveryReferenceCacheRow(row: DiscoveryReferenceCacheRow): DiscoveryReferenceCacheEntry {
  return {
    cacheKey: row.cache_key,
    suggestionName: row.suggestion_name,
    imageUrl: row.image_url ?? undefined,
    sourceName: row.source_name ?? undefined,
    sourceCardId: row.source_card_id ?? undefined,
    sourceStatus: row.source_status ?? undefined,
    fetchedAt: row.fetched_at,
    updatedAt: row.updated_at
  };
}

function isTransientReferenceStatus(status: DiscoveryReferenceStatus | undefined): boolean {
  return status === 'TIMEOUT' || status === 'ERROR';
}

function cachedReferenceAgeMs(entry: DiscoveryReferenceCacheEntry): number | undefined {
  const fetchedAtMs = new Date(entry.fetchedAt).getTime();
  return Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : undefined;
}

export function discoveryReferenceCacheKey(suggestionName: string): string {
  return normalize(suggestionName);
}

export function pokemonTcgQueriesForSuggestion(suggestion: DiscoverySuggestion): string[] {
  const sourceText = [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
  if (isUnsupportedReferenceSuggestion(sourceText)) return [];

  const number = extractNumber(sourceText);
  const name = leadingName(suggestion.name) || leadingName(sourceText);
  const setName = setHintForSuggestion(sourceText);
  const allowBroadFallback = shouldAllowBroadNameFallback(sourceText);
  const queries: string[] = [];

  if (name && number) {
    if (setName) queries.push(`name:${quoted(name)} number:${/^0\d+$/.test(number) ? Number(number) : number} set.name:${quoted(setName)}`);
    queries.push(`name:${quoted(name)} number:${number}`);
    if (/^0\d+$/.test(number)) queries.push(`name:${quoted(name)} number:${Number(number)}`);
  }
  if (name && setName) queries.push(`name:${quoted(name)} set.name:${quoted(setName)}`);

  const compact = compactName(suggestion.name);
  if (allowBroadFallback && compact && compact !== name) queries.push(`name:${quoted(compact)}`);
  if (allowBroadFallback && name) queries.push(`name:${quoted(name)}`);

  return [...new Set(queries)];
}

export function getDiscoveryReferenceCache(cacheKey: string): DiscoveryReferenceCacheEntry | null {
  const row = getDiscoveryReferenceCacheStmt.get(cacheKey) as DiscoveryReferenceCacheRow | undefined;
  return row ? mapDiscoveryReferenceCacheRow(row) : null;
}

export function deleteDiscoveryReferenceCache(cacheKey: string): void {
  deleteDiscoveryReferenceCacheStmt.run(cacheKey);
}

export function upsertDiscoveryReferenceCache(input: UpsertDiscoveryReferenceCacheInput): void {
  const now = new Date().toISOString();
  upsertDiscoveryReferenceCacheStmt.run({
    cache_key: input.cacheKey,
    suggestion_name: input.suggestionName,
    image_url: input.imageUrl ?? null,
    source_name: input.sourceName ?? null,
    source_card_id: input.sourceCardId ?? null,
    source_status: input.sourceStatus ?? null,
    fetched_at: input.fetchedAt ?? now,
    updated_at: now
  });
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Pokemon TCG request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function imageExistsWithTimeout(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return response.ok && /^image\//i.test(response.headers.get('content-type') ?? '');
  } finally {
    clearTimeout(timeout);
  }
}

function referenceFromCard(card: PokemonTcgCard, suggestionName: string, fallbackSetName?: string): DiscoveryReferenceCacheEntry | null {
  const imageUrl = card.images?.large ?? card.images?.small;
  if (!card.id || !card.name || !imageUrl) return null;
  const sourceSetName = card.set?.name ?? fallbackSetName;
  const setName = sourceSetName ? ` (${sourceSetName})` : '';
  const now = new Date().toISOString();
  return {
    cacheKey: discoveryReferenceCacheKey(suggestionName),
    suggestionName,
    imageUrl,
    sourceName: `Pokemon TCG${setName}`,
    sourceCardId: card.id,
    fetchedAt: now,
    updatedAt: now
  };
}

async function fetchOnePieceReferenceImage(suggestion: DiscoverySuggestion): Promise<DiscoveryReferenceCacheEntry | null> {
  const cacheKey = discoveryReferenceCacheKey(suggestion.name);
  const candidates = onePieceCardImageCandidatesForSuggestion(suggestion);
  if (candidates.length === 0) return null;

  for (const imageUrl of candidates) {
    if (!(await imageExistsWithTimeout(imageUrl, REFERENCE_FETCH_TIMEOUT_MS))) continue;
    const sourceCardId = /\/([^/]+)\.png$/i.exec(imageUrl)?.[1];
    const now = new Date().toISOString();
    return {
      cacheKey,
      suggestionName: suggestion.name,
      imageUrl,
      sourceName: 'One Piece Card Game official cardlist',
      sourceCardId,
      fetchedAt: now,
      updatedAt: now
    };
  }

  return {
    cacheKey,
    suggestionName: suggestion.name,
    sourceStatus: 'NOT_FOUND',
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function fetchDiscoveryReferenceImage(suggestion: DiscoverySuggestion): Promise<DiscoveryReferenceCacheEntry> {
  const cacheKey = discoveryReferenceCacheKey(suggestion.name);
  if (suggestion.referenceImageUrl) {
    const now = new Date().toISOString();
    return {
      cacheKey,
      suggestionName: suggestion.name,
      imageUrl: suggestion.referenceImageUrl,
      sourceName: suggestion.referenceSourceName ?? 'Curated reference',
      sourceCardId: suggestion.referenceSourceCardId,
      fetchedAt: now,
      updatedAt: now
    };
  }

  if (isOnePieceReferenceSuggestion(suggestion)) {
    try {
      const onePieceReference = await fetchOnePieceReferenceImage(suggestion);
      if (onePieceReference) return onePieceReference;
    } catch (error) {
      const status = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
      return {
        cacheKey,
        suggestionName: suggestion.name,
        sourceStatus: status,
        fetchedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
  }

  const sourceText = [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
  const sourceSetName = setHintForSuggestion(sourceText);
  const queries = pokemonTcgQueriesForSuggestion(suggestion);
  if (queries.length === 0) {
    return {
      cacheKey,
      suggestionName: suggestion.name,
      sourceStatus: 'UNSUPPORTED',
      fetchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  try {
    for (const query of queries) {
      const params = new URLSearchParams({ q: query, pageSize: '3', select: 'id,name,number,set.name,images' });
      const json = await fetchJsonWithTimeout(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`, REFERENCE_FETCH_TIMEOUT_MS);
      const cards = Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [];
      const reference = cards.map((card) => referenceFromCard(card, suggestion.name, sourceSetName)).find((entry): entry is DiscoveryReferenceCacheEntry => !!entry);
      if (reference) return reference;
    }
    return {
      cacheKey,
      suggestionName: suggestion.name,
      sourceStatus: 'NOT_FOUND',
      fetchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    const status = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
    return {
      cacheKey,
      suggestionName: suggestion.name,
      sourceStatus: status,
      fetchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}

export async function getOrFetchDiscoveryReferenceImage(suggestion: DiscoverySuggestion, ttlMs: number): Promise<DiscoveryReferenceCacheEntry | null> {
  const cacheKey = discoveryReferenceCacheKey(suggestion.name);
  const cached = getDiscoveryReferenceCache(cacheKey);
  if (suggestion.referenceImageUrl && !cached?.imageUrl) {
    const fetched = await fetchDiscoveryReferenceImage(suggestion);
    upsertDiscoveryReferenceCache(fetched);
    return fetched;
  }
  const ageMs = cached ? cachedReferenceAgeMs(cached) : undefined;
  if (cached && ageMs !== undefined && ageMs < ttlMs && !isTransientReferenceStatus(cached.sourceStatus)) return cached;

  const fetched = await fetchDiscoveryReferenceImage(suggestion);
  if (!isTransientReferenceStatus(fetched.sourceStatus)) upsertDiscoveryReferenceCache(fetched);
  return fetched;
}
