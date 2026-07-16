import type { DiscoveryCandidate } from '../commands/discover.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';
import { extractNumber, isJapaneseReferenceSuggestion, leadingName, pokemonTcgQueriesForSuggestion, setHintForSuggestion } from './discovery-reference-cache.js';

type ProviderLanguage = 'ENGLISH' | 'JAPANESE';
type DiscoveryCardImage = {
  name: string;
  url: string;
  sourceName?: string;
  sourceCardId?: string;
  sourceKind: 'CARD_REFERENCE' | 'MARKET_LISTING';
};

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { id?: string; name?: string };
  images?: { small?: string; large?: string };
};

export type CanonicalProviderRecord = {
  provider: 'Pokemon TCG' | 'TCGdex Japanese';
  sourceCardId: string;
  canonicalCardId: string;
  canonicalName: string;
  setId?: string;
  setName: string;
  cardNumber: string;
  language: ProviderLanguage;
  imageUrl: string;
};

export type CanonicalResolutionOutcome =
  | 'RESOLVED'
  | 'NO_RESULTS'
  | 'AMBIGUOUS'
  | 'PRINTING_MISMATCH'
  | 'LANGUAGE_MISMATCH'
  | 'LOOKUP_NOT_ATTEMPTED'
  | 'INSUFFICIENT_PRINTING_EVIDENCE'
  | 'MISSING_TRUSTED_IMAGE'
  | 'MISSING_STABLE_SOURCE_ID';

export type CanonicalLookupEvidence = {
  lookupKey: string;
  normalizedIdentity: {
    name?: string;
    set?: string;
    number?: string;
    denominator?: string;
    language?: ProviderLanguage;
  };
  queryVariants: string[];
  provider: 'Pokemon TCG' | 'TCGdex Japanese';
  providerResults: Array<CanonicalProviderRecord & { rejectionReason?: string }>;
  acceptedSourceCardId?: string;
  outcome: CanonicalResolutionOutcome;
};

export type CanonicalLookupEvidenceMap = Record<string, CanonicalLookupEvidence>;

export type DiscoveryCanonicalResolutionResult = {
  candidate: DiscoveryCandidate;
  evidence?: CanonicalLookupEvidence;
};

type ResolveOptions = {
  replayEvidence?: CanonicalLookupEvidenceMap;
};

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const CANONICAL_RESOLUTION_CONCURRENCY = 6;
const CANONICAL_LOOKUP_TIMEOUT_MS = 12000;
const SET_ALIASES: string[][] = [
  ['151', 'pokemon 151', 'pokemon card 151', 'scarlet & violet 151'],
  ['expedition', 'expedition base set'],
  ['gym heroes'],
  ['lost origin', 'lost origin trainer gallery'],
  ['secret wonders'],
  ['team rocket'],
  ['celebrations classic collection', 'celebrations: classic collection'],
  ['sm black star promos', 'sm black star promo', 'sun & moon promo', 'sun & moon promos', 'sun & moon black star promos', 'sm promos'],
  ['swsh black star promos', 'swsh black star promo', 'sword & shield promo', 'sword & shield promos', 'sword & shield black star promos'],
  ['wizards black star promos', 'wizards black star promo'],
  ['nintendo black star promos', 'nintendo black star promo']
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeIdentityName(value: string): string {
  return compactWhitespace(
    value
      .replace(/\b20\d{2}\b/g, ' ')
      .replace(/\bpokemon tcg\b/gi, ' ')
      .replace(/\bpokemon card\b/gi, ' ')
      .replace(/\bsun\s*&\s*moon\b/gi, ' ')
      .replace(/\bnear mint\b|\bnm\/m\b|\bnm\b|\blp\b|\bmp\b|\bgraded\b|\braw\b|\brare\b|\bholo\b/gi, ' ')
      .replace(/\bpromo\b|\bpromos\b|\bblack star\b/gi, ' ')
      .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
      .replace(/\b(?:xy|sm|swsh|svp|bw|dp|hgss)\d+\b/gi, ' ')
      .replace(/\band\b/gi, '&')
      .replace(/\b([A-Za-z][A-Za-z.'’&\s]+?)\s+GX\b/g, '$1-GX')
      .replace(/\b([A-Za-z][A-Za-z.'’&\s]+?)\s+EX\b/g, '$1-EX')
  );
}

function normalizedNameKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeIdentityName(value);
  return normalized ? normalize(normalized) : undefined;
}

function normalizeCardNumber(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, '').toUpperCase();
  const slashPrefix = /^([A-Z]{0,4}\d{1,3})\/\d+$/i.exec(trimmed)?.[1];
  if (slashPrefix) return slashPrefix.toUpperCase();
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
  return trimmed;
}

function extractDenominator(value: string): string | undefined {
  return /\b[A-Z]{0,4}\d{1,3}\s*\/\s*(\d{1,3})\b/i.exec(value)?.[1]
    ?? /\b\d{1,3}\s*\/\s*(\d{1,3})\b/i.exec(value)?.[1];
}

function languageForSuggestion(suggestion: DiscoverySuggestion): ProviderLanguage | undefined {
  return isJapaneseReferenceSuggestion(suggestion) ? 'JAPANESE' : 'ENGLISH';
}

function discoveryPrintingIdentity(suggestion: DiscoverySuggestion): CanonicalLookupEvidence['normalizedIdentity'] {
  const sourceText = [suggestion.name, suggestion.evidenceSearchTerm, ...(suggestion.evidenceAliases ?? [])].filter(Boolean).join(' ');
  return {
    name: leadingName(suggestion.name) || leadingName(sourceText) || undefined,
    set: setHintForSuggestion(sourceText),
    number: normalizeCardNumber(extractNumber(sourceText)),
    denominator: extractDenominator(sourceText),
    language: languageForSuggestion(suggestion)
  };
}

export function discoveryCanonicalLookupKey(suggestion: DiscoverySuggestion): string {
  const identity = discoveryPrintingIdentity(suggestion);
  return [
    identity.language ?? 'UNKNOWN',
    normalizedNameKey(identity.name) ?? 'unknown-name',
    normalize(identity.set ?? ''),
    identity.number ?? '',
    identity.denominator ?? ''
  ].join('|');
}

function providerRecordFromPokemonCard(card: PokemonTcgCard): CanonicalProviderRecord | null {
  const imageUrl = card.images?.large ?? card.images?.small;
  if (!card.id || !card.name || !card.number || !card.set?.name || !imageUrl) return null;
  return {
    provider: 'Pokemon TCG',
    sourceCardId: card.id,
    canonicalCardId: card.id,
    canonicalName: card.name,
    setId: card.set.id,
    setName: card.set.name,
    cardNumber: card.number,
    language: 'ENGLISH',
    imageUrl
  };
}

function isMarketplaceLikeImageUrl(url: string | undefined): boolean {
  return !!url && /ebayimg|ebay\.|marketplace|seller|listing|bigcommerce|shopify/i.test(url);
}

function isAllowlistedProviderSourceName(sourceName: string | undefined): boolean {
  return !!sourceName && (
    /^Pokemon TCG(?:\s*\(|$)/i.test(sourceName)
    || /^TCGdex Japanese(?:\s*\(|$)/i.test(sourceName)
  );
}

function providerDisplayName(record: CanonicalProviderRecord): string {
  return compactWhitespace(`${record.canonicalName} ${record.setName} ${record.cardNumber}`);
}

function normalizedSetIdentity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalize(value)
    .replace(/\bpromos\b/g, 'promo')
    .replace(/\bblack star\b/g, 'black star')
    .trim();
  if (!normalized) return undefined;
  for (const aliases of SET_ALIASES) {
    if (aliases.some((alias) => normalize(alias) === normalized)) return normalize(aliases[0]!);
  }
  return normalized;
}

function explicitSetMatch(requested: string | undefined, resolved: string | undefined): boolean {
  if (!requested) return true;
  if (!resolved) return false;
  const left = normalizedSetIdentity(requested);
  const right = normalizedSetIdentity(resolved);
  return !!left && !!right && left === right;
}

function compatibilityReasons(
  identity: CanonicalLookupEvidence['normalizedIdentity'],
  record: CanonicalProviderRecord
): string[] {
  const reasons: string[] = [];
  if (!record.sourceCardId || !record.canonicalCardId) reasons.push('missing stable source ID');
  if (!record.imageUrl || isMarketplaceLikeImageUrl(record.imageUrl)) reasons.push('missing trusted image');
  if (identity.language && identity.language !== record.language) reasons.push('language mismatch');
  if (identity.number && normalizeCardNumber(identity.number) !== normalizeCardNumber(record.cardNumber)) reasons.push('card-number mismatch');
  if (!explicitSetMatch(identity.set, record.setName)) reasons.push('set mismatch');
  const requestedName = normalizedNameKey(identity.name);
  const resolvedName = normalizedNameKey(record.canonicalName);
  if (requestedName && resolvedName && requestedName !== resolvedName && !requestedName.includes(resolvedName) && !resolvedName.includes(requestedName)) {
    reasons.push('name mismatch');
  }
  return reasons;
}

async function fetchPokemonCardsByQuery(query: string): Promise<PokemonTcgCard[]> {
  const params = new URLSearchParams({
    q: query,
    pageSize: '8',
    select: 'id,name,number,set,images'
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANONICAL_LOOKUP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return [];
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Pokemon TCG request failed: ${response.status}`);
  const json = await response.json();
  return Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [];
}

async function fetchPokemonCardById(sourceCardId: string): Promise<PokemonTcgCard | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANONICAL_LOOKUP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${POKEMON_TCG_ENDPOINT}/${encodeURIComponent(sourceCardId)}`, { signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return null;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Pokemon TCG card request failed: ${response.status}`);
  const json = await response.json();
  return (json?.data as PokemonTcgCard | undefined) ?? null;
}

async function livePokemonResolution(suggestion: DiscoverySuggestion): Promise<CanonicalLookupEvidence> {
  const lookupKey = discoveryCanonicalLookupKey(suggestion);
  const identity = discoveryPrintingIdentity(suggestion);
  const queryVariants = pokemonTcgQueriesForSuggestion(suggestion);
  const providerResults = new Map<string, CanonicalProviderRecord & { rejectionReason?: string }>();
  let directAcceptedSourceCardId: string | undefined;

  const existingSourceCardId = suggestion.referenceSourceCardId?.trim();
  if (existingSourceCardId) {
    const directCard = await fetchPokemonCardById(existingSourceCardId);
    const directRecord = directCard ? providerRecordFromPokemonCard(directCard) : null;
    if (directRecord) {
      const reasons = compatibilityReasons(identity, directRecord);
      providerResults.set(directRecord.sourceCardId, {
        ...directRecord,
        rejectionReason: reasons.length > 0 ? reasons.join(', ') : undefined
      });
      if (reasons.length === 0) directAcceptedSourceCardId = directRecord.sourceCardId;
    }
  }
  if (directAcceptedSourceCardId) {
    return {
      lookupKey,
      normalizedIdentity: identity,
      queryVariants,
      provider: 'Pokemon TCG',
      providerResults: [...providerResults.values()],
      acceptedSourceCardId: directAcceptedSourceCardId,
      outcome: 'RESOLVED'
    };
  }

  for (const query of queryVariants) {
    for (const card of await fetchPokemonCardsByQuery(query)) {
      const record = providerRecordFromPokemonCard(card);
      if (!record || providerResults.has(record.sourceCardId)) continue;
      const reasons = compatibilityReasons(identity, record);
      providerResults.set(record.sourceCardId, {
        ...record,
        rejectionReason: reasons.length > 0 ? reasons.join(', ') : undefined
      });
    }
  }

  const accepted = [...providerResults.values()].filter((record) => !record.rejectionReason);
  if (accepted.length === 1) {
    return {
      lookupKey,
      normalizedIdentity: identity,
      queryVariants,
      provider: 'Pokemon TCG',
      providerResults: [...providerResults.values()],
      acceptedSourceCardId: accepted[0]!.sourceCardId,
      outcome: 'RESOLVED'
    };
  }
  if (accepted.length > 1) {
    return {
      lookupKey,
      normalizedIdentity: identity,
      queryVariants,
      provider: 'Pokemon TCG',
      providerResults: [...providerResults.values()],
      outcome: 'AMBIGUOUS'
    };
  }
  const rejectionReasons = new Set([...providerResults.values()].map((record) => record.rejectionReason).filter(Boolean));
  let outcome: CanonicalResolutionOutcome = 'NO_RESULTS';
  if (rejectionReasons.has('language mismatch')) outcome = 'LANGUAGE_MISMATCH';
  else if (rejectionReasons.size > 0) outcome = 'PRINTING_MISMATCH';
  return {
    lookupKey,
    normalizedIdentity: identity,
    queryVariants,
    provider: 'Pokemon TCG',
    providerResults: [...providerResults.values()],
    outcome
  };
}

function evidenceRecordByAcceptedSourceId(evidence: CanonicalLookupEvidence): CanonicalProviderRecord | undefined {
  if (!evidence.acceptedSourceCardId) return undefined;
  return evidence.providerResults.find((record) => record.sourceCardId === evidence.acceptedSourceCardId);
}

function candidateNeedsCanonicalResolution(candidate: DiscoveryCandidate): boolean {
  const sourceText = [candidate.suggestion.name, candidate.suggestion.evidenceSearchTerm, ...(candidate.suggestion.evidenceAliases ?? [])]
    .filter(Boolean)
    .join(' ');
  const hasStableSourceCardId = !!candidate.suggestion.referenceSourceCardId?.trim() || !!candidate.image?.sourceCardId?.trim();
  const hasLookupIdentity = !!extractNumber(sourceText) || !!setHintForSuggestion(sourceText);
  const hasUntrustedReferenceShell = hasStableSourceCardId && (
    candidate.image?.sourceKind !== 'CARD_REFERENCE'
    || !isAllowlistedProviderSourceName(candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName)
    || isMarketplaceLikeImageUrl(candidate.suggestion.referenceImageUrl)
    || isMarketplaceLikeImageUrl(candidate.image?.url)
  );
  if (!hasLookupIdentity && !hasUntrustedReferenceShell) return false;
  return !candidate.suggestion.referenceSourceCardId?.trim()
    || candidate.image?.sourceKind !== 'CARD_REFERENCE'
    || hasUntrustedReferenceShell
    || /^20\d{2}\s+Pokemon TCG/i.test(candidate.suggestion.name)
    || /^Pokemon Card\b/i.test(candidate.suggestion.name)
    || /\beBay\b|\bNear Mint\b|\bNM\/M\b|\bLP\b|\bMP\b/i.test(candidate.suggestion.name)
    || /_{3,}/.test(candidate.suggestion.name)
    || /\b(?:Near Mint|NM|LP|MP|raw card|Pokemon card raw)\b/i.test(candidate.suggestion.name);
}

function candidateFromAcceptedRecord(candidate: DiscoveryCandidate, record: CanonicalProviderRecord): DiscoveryCandidate {
  const displayName = providerDisplayName(record);
  const image: DiscoveryCardImage = {
    name: displayName,
    url: record.imageUrl,
    sourceName: `${record.provider}${record.setName ? ` (${record.setName})` : ''}`,
    sourceCardId: record.sourceCardId,
    sourceKind: 'CARD_REFERENCE'
  };
  return {
    ...candidate,
    suggestion: {
      ...candidate.suggestion,
      name: displayName,
      referenceSourceName: image.sourceName,
      referenceSourceCardId: record.sourceCardId,
      referenceImageUrl: record.imageUrl
    },
    image
  };
}

export async function resolveWeeklyDiscoveryCanonicalReferences(
  candidates: DiscoveryCandidate[],
  options: ResolveOptions = {}
): Promise<{ candidates: DiscoveryCandidate[]; evidence: CanonicalLookupEvidenceMap }> {
  const evidence: CanonicalLookupEvidenceMap = {};
  const resolved = [...candidates];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CANONICAL_RESOLUTION_CONCURRENCY, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const candidate = candidates[index]!;
      if (!candidateNeedsCanonicalResolution(candidate)) {
        resolved[index] = candidate;
        continue;
      }
      const lookupKey = discoveryCanonicalLookupKey(candidate.suggestion);
      const lookupEvidence = options.replayEvidence
        ? options.replayEvidence[lookupKey] ?? {
            lookupKey,
            normalizedIdentity: discoveryPrintingIdentity(candidate.suggestion),
            queryVariants: pokemonTcgQueriesForSuggestion(candidate.suggestion),
            provider: 'Pokemon TCG',
            providerResults: [],
            outcome: 'LOOKUP_NOT_ATTEMPTED' as const
          }
        : await livePokemonResolution(candidate.suggestion);
      evidence[lookupKey] = lookupEvidence;
      const accepted = evidenceRecordByAcceptedSourceId(lookupEvidence);
      resolved[index] = accepted ? candidateFromAcceptedRecord(candidate, accepted) : candidate;
    }
  });
  await Promise.all(workers);
  return { candidates: resolved, evidence };
}
