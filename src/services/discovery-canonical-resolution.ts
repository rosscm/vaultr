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

export type DiscoveryCanonicalResolutionRuntimeStats = {
  totalCandidates: number;
  noResolutionNeeded: number;
  completeTrustedBindings: number;
  resolutionRequired: number;
  directSourceCardIdCandidates: number;
  uniqueLookupKeys: number;
  duplicateLookupKeys: number;
  replayEvidenceHits: number;
  replayEvidenceMisses: number;
  providerRequests: number;
  directIdRequests: number;
  queryRequests: number;
  successfulResolutions: number;
  noResults: number;
  ambiguousResults: number;
  compatibilityRejections: number;
  failures: number;
  timeouts: number;
  successfulRebindings: number;
  unresolvedCandidates: number;
  coalescedRequests: number;
  classificationMs: number;
  trustedBindingValidationMs: number;
  lookupKeyMs: number;
  evidenceLookupMs: number;
  directIdProviderMs: number;
  queryProviderMs: number;
  compatibilityMs: number;
  rebindingMs: number;
  finalMergeMs: number;
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

const canonicalResolutionRuntimeStats: DiscoveryCanonicalResolutionRuntimeStats = {
  totalCandidates: 0,
  noResolutionNeeded: 0,
  completeTrustedBindings: 0,
  resolutionRequired: 0,
  directSourceCardIdCandidates: 0,
  uniqueLookupKeys: 0,
  duplicateLookupKeys: 0,
  replayEvidenceHits: 0,
  replayEvidenceMisses: 0,
  providerRequests: 0,
  directIdRequests: 0,
  queryRequests: 0,
  successfulResolutions: 0,
  noResults: 0,
  ambiguousResults: 0,
  compatibilityRejections: 0,
  failures: 0,
  timeouts: 0,
  successfulRebindings: 0,
  unresolvedCandidates: 0,
  coalescedRequests: 0,
  classificationMs: 0,
  trustedBindingValidationMs: 0,
  lookupKeyMs: 0,
  evidenceLookupMs: 0,
  directIdProviderMs: 0,
  queryProviderMs: 0,
  compatibilityMs: 0,
  rebindingMs: 0,
  finalMergeMs: 0
};

export function snapshotDiscoveryCanonicalResolutionRuntimeStats(): DiscoveryCanonicalResolutionRuntimeStats {
  return { ...canonicalResolutionRuntimeStats };
}

function addCanonicalResolutionRuntimeStat<K extends keyof DiscoveryCanonicalResolutionRuntimeStats>(
  key: K,
  value: DiscoveryCanonicalResolutionRuntimeStats[K]
): void {
  canonicalResolutionRuntimeStats[key] += value as number;
}

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

function isTrustedProviderImageUrl(url: string | undefined): boolean {
  return !!url && !isMarketplaceLikeImageUrl(url);
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

function trustedCanonicalBindingFromCandidate(candidate: DiscoveryCandidate): CanonicalProviderRecord | null {
  const sourceCardId = candidate.suggestion.referenceSourceCardId?.trim() ?? candidate.image?.sourceCardId?.trim();
  const sourceName = candidate.suggestion.referenceSourceName ?? candidate.image?.sourceName;
  const imageUrl = candidate.suggestion.referenceImageUrl ?? candidate.image?.url;
  const imageSourceKind = candidate.image?.sourceKind;
  if (!sourceCardId || !sourceName || !imageUrl || imageSourceKind !== 'CARD_REFERENCE') return null;
  if (!isAllowlistedProviderSourceName(sourceName) || !isTrustedProviderImageUrl(imageUrl)) return null;
  const identity = discoveryPrintingIdentity(candidate.suggestion);
  const setMatch = /\(([^)]+)\)\s*$/.exec(sourceName)?.[1]?.trim();
  const inferredProvider = /^TCGdex Japanese(?:\s*\(|$)/i.test(sourceName) ? 'TCGdex Japanese' : 'Pokemon TCG';
  const canonicalName = identity.name;
  const cardNumber = identity.number;
  const setName = setMatch ?? identity.set;
  if (!canonicalName || !cardNumber || !setName) return null;
  const language = identity.language ?? (inferredProvider === 'TCGdex Japanese' ? 'JAPANESE' : 'ENGLISH');
  const record: CanonicalProviderRecord = {
    provider: inferredProvider,
    sourceCardId,
    canonicalCardId: sourceCardId,
    canonicalName,
    setName,
    cardNumber,
    language,
    imageUrl
  };
  return compatibilityReasons(identity, record).length === 0 ? record : null;
}

async function fetchPokemonCardsByQuery(query: string): Promise<PokemonTcgCard[]> {
  canonicalResolutionRuntimeStats.providerRequests += 1;
  canonicalResolutionRuntimeStats.queryRequests += 1;
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
    if ((error as Error).name === 'AbortError') {
      canonicalResolutionRuntimeStats.timeouts += 1;
      return [];
    }
    canonicalResolutionRuntimeStats.failures += 1;
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
  canonicalResolutionRuntimeStats.providerRequests += 1;
  canonicalResolutionRuntimeStats.directIdRequests += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANONICAL_LOOKUP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${POKEMON_TCG_ENDPOINT}/${encodeURIComponent(sourceCardId)}`, { signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      canonicalResolutionRuntimeStats.timeouts += 1;
      return null;
    }
    canonicalResolutionRuntimeStats.failures += 1;
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
    canonicalResolutionRuntimeStats.directSourceCardIdCandidates += 1;
    const directStartedAt = Date.now();
    const directCard = await fetchPokemonCardById(existingSourceCardId);
    addCanonicalResolutionRuntimeStat('directIdProviderMs', Date.now() - directStartedAt);
    const directRecord = directCard ? providerRecordFromPokemonCard(directCard) : null;
    if (directRecord) {
      const compatibilityStartedAt = Date.now();
      const reasons = compatibilityReasons(identity, directRecord);
      addCanonicalResolutionRuntimeStat('compatibilityMs', Date.now() - compatibilityStartedAt);
      providerResults.set(directRecord.sourceCardId, {
        ...directRecord,
        rejectionReason: reasons.length > 0 ? reasons.join(', ') : undefined
      });
      if (reasons.length > 0) canonicalResolutionRuntimeStats.compatibilityRejections += 1;
      if (reasons.length === 0) directAcceptedSourceCardId = directRecord.sourceCardId;
    }
  }
  if (directAcceptedSourceCardId) {
    canonicalResolutionRuntimeStats.successfulResolutions += 1;
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
    const queryStartedAt = Date.now();
    for (const card of await fetchPokemonCardsByQuery(query)) {
      const record = providerRecordFromPokemonCard(card);
      if (!record || providerResults.has(record.sourceCardId)) continue;
      const compatibilityStartedAt = Date.now();
      const reasons = compatibilityReasons(identity, record);
      addCanonicalResolutionRuntimeStat('compatibilityMs', Date.now() - compatibilityStartedAt);
      providerResults.set(record.sourceCardId, {
        ...record,
        rejectionReason: reasons.length > 0 ? reasons.join(', ') : undefined
      });
      if (reasons.length > 0) canonicalResolutionRuntimeStats.compatibilityRejections += 1;
    }
    addCanonicalResolutionRuntimeStat('queryProviderMs', Date.now() - queryStartedAt);
  }

  const accepted = [...providerResults.values()].filter((record) => !record.rejectionReason);
  if (accepted.length === 1) {
    canonicalResolutionRuntimeStats.successfulResolutions += 1;
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
    canonicalResolutionRuntimeStats.ambiguousResults += 1;
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
  if (outcome === 'NO_RESULTS') canonicalResolutionRuntimeStats.noResults += 1;
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
  const startedAt = Date.now();
  const evidence: CanonicalLookupEvidenceMap = {};
  const resolved = [...candidates];
  canonicalResolutionRuntimeStats.totalCandidates += candidates.length;
  const keyCounts = new Map<string, number>();
  const classificationStartedAt = Date.now();
  const candidatePlans = candidates.map((candidate) => {
    const trustedBindingStartedAt = Date.now();
    const trustedBinding = trustedCanonicalBindingFromCandidate(candidate);
    addCanonicalResolutionRuntimeStat('trustedBindingValidationMs', Date.now() - trustedBindingStartedAt);
    if (trustedBinding) canonicalResolutionRuntimeStats.completeTrustedBindings += 1;
    const needsResolution = !trustedBinding && candidateNeedsCanonicalResolution(candidate);
    if (!needsResolution) canonicalResolutionRuntimeStats.noResolutionNeeded += 1;
    else canonicalResolutionRuntimeStats.resolutionRequired += 1;
    const lookupStartedAt = Date.now();
    const lookupKey = needsResolution ? discoveryCanonicalLookupKey(candidate.suggestion) : undefined;
    addCanonicalResolutionRuntimeStat('lookupKeyMs', Date.now() - lookupStartedAt);
    if (lookupKey) keyCounts.set(lookupKey, (keyCounts.get(lookupKey) ?? 0) + 1);
    return { candidate, trustedBinding, needsResolution, lookupKey };
  });
  addCanonicalResolutionRuntimeStat('classificationMs', Date.now() - classificationStartedAt);
  canonicalResolutionRuntimeStats.uniqueLookupKeys += keyCounts.size;
  canonicalResolutionRuntimeStats.duplicateLookupKeys += [...keyCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const lookupPromises = new Map<string, Promise<CanonicalLookupEvidence>>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CANONICAL_RESOLUTION_CONCURRENCY, candidatePlans.length) }, async () => {
    while (cursor < candidatePlans.length) {
      const index = cursor;
      cursor += 1;
      const plan = candidatePlans[index]!;
      const candidate = plan.candidate;
      if (plan.trustedBinding) {
        const rebindingStartedAt = Date.now();
        resolved[index] = candidateFromAcceptedRecord(candidate, plan.trustedBinding);
        canonicalResolutionRuntimeStats.successfulRebindings += 1;
        addCanonicalResolutionRuntimeStat('rebindingMs', Date.now() - rebindingStartedAt);
        continue;
      }
      if (!plan.needsResolution || !plan.lookupKey) {
        resolved[index] = candidate;
        continue;
      }
      const lookupKey = plan.lookupKey;
      const evidenceLookupStartedAt = Date.now();
      let lookupPromise = lookupPromises.get(lookupKey);
      if (lookupPromise) {
        canonicalResolutionRuntimeStats.coalescedRequests += 1;
      } else {
        lookupPromise = options.replayEvidence
          ? Promise.resolve(options.replayEvidence[lookupKey] ?? {
              lookupKey,
              normalizedIdentity: discoveryPrintingIdentity(candidate.suggestion),
              queryVariants: pokemonTcgQueriesForSuggestion(candidate.suggestion),
              provider: 'Pokemon TCG',
              providerResults: [],
              outcome: 'LOOKUP_NOT_ATTEMPTED' as const
            })
          : livePokemonResolution(candidate.suggestion);
        lookupPromises.set(lookupKey, lookupPromise);
      }
      addCanonicalResolutionRuntimeStat('evidenceLookupMs', Date.now() - evidenceLookupStartedAt);
      if (options.replayEvidence?.[lookupKey]) canonicalResolutionRuntimeStats.replayEvidenceHits += 1;
      else if (options.replayEvidence) canonicalResolutionRuntimeStats.replayEvidenceMisses += 1;
      const lookupEvidence = await lookupPromise;
      evidence[lookupKey] = lookupEvidence;
      const accepted = evidenceRecordByAcceptedSourceId(lookupEvidence);
      const rebindingStartedAt = Date.now();
      if (accepted && compatibilityReasons(discoveryPrintingIdentity(candidate.suggestion), accepted).length === 0) {
        resolved[index] = candidateFromAcceptedRecord(candidate, accepted);
        canonicalResolutionRuntimeStats.successfulRebindings += 1;
      } else {
        resolved[index] = candidate;
        canonicalResolutionRuntimeStats.unresolvedCandidates += 1;
      }
      addCanonicalResolutionRuntimeStat('rebindingMs', Date.now() - rebindingStartedAt);
    }
  });
  await Promise.all(workers);
  addCanonicalResolutionRuntimeStat('finalMergeMs', Date.now() - startedAt);
  return { candidates: resolved, evidence };
}
