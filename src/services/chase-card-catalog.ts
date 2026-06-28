export type ChaseCardAutocompleteChoice = {
  name: string;
  value: string;
};

type ChaseCardCatalogResult = ChaseCardAutocompleteChoice & {
  imageUrl?: string;
};

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string; printedTotal?: number };
};

type PokemonReleaseAlias = {
  label: string;
  setNamePrefix: string;
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

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const TCGDEX_JA_CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
const AUTOCOMPLETE_TIMEOUT_MS = 2600;
const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;
const POKEMON_AUTOCOMPLETE_LIMIT = 16;
const POKEMON_QUERY_VARIANT_LIMIT = 8;
const POKEMON_CONTEXT_STOP_TERMS = new Set(['card', 'cards', 'pokemon', 'tcg']);
const POKEMON_NUMBER_PREFIX_TERMS = new Set(['bw', 'dp', 'rc', 'sm', 'sv', 'swsh', 'xy']);
const POKEMON_RELEASE_ALIASES: Array<{ pattern: RegExp; alias: PokemonReleaseAlias }> = [
  { pattern: /\bcorocoro\b.*\bjumbo\b|\bjumbo\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Jumbo Promo', setNamePrefix: 'CoroCoro' } },
  { pattern: /\bcorocoro\b.*\bmagazine\b|\bmagazine\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Magazine Promo', setNamePrefix: 'CoroCoro' } },
  { pattern: /\bcorocoro\b.*\bmanga\b|\bmanga\b.*\bcorocoro\b/i, alias: { label: 'CoroCoro Manga Promo', setNamePrefix: 'CoroCoro' } },
  { pattern: /\bmcdonald'?s\b/i, alias: { label: "McDonald's Promo", setNamePrefix: "McDonald's" } },
  { pattern: /\bpok(?:e|é)mon\s*center\b/i, alias: { label: 'Pokemon Center Promo', setNamePrefix: 'Pokemon Center' } },
  { pattern: /\bblack\s*star\s*promos?\b/i, alias: { label: 'Black Star Promos', setNamePrefix: 'Black Star Promos' } },
  { pattern: /\btoys?\s*r\s*us\b/i, alias: { label: 'Toys R Us Promo', setNamePrefix: 'generations' } },
  { pattern: /\bcorocoro\b/i, alias: { label: 'CoroCoro Promo', setNamePrefix: 'CoroCoro' } }
];
const POKEMON_PROMO_PUBLICATION_TERMS = new Set(['corocoro', 'coro coro', 'mcdonald', 'mcdonalds', 'center']);
const POKEMON_PROMO_STYLE_STOP_TERMS = new Set(['promo', 'promos', 'promotional', 'shining', 'holo', 'foil', 'magazine', 'manga', 'japanese', 'jumbo']);
const BARE_CARD_NUMBER_HELPER_TEXT = 'Keep typing: add the card name with this number';
const JAPANESE_SUBJECT_ALIASES: Record<string, string[]> = {
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
const autocompleteCache = new Map<string, { expiresAt: number; choices: ChaseCardAutocompleteChoice[] }>();
const autocompletePreviewCache = new Map<string, { expiresAt: number; imageUrl?: string }>();

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
    autocompletePreviewCache.set(key, { expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS, imageUrl: choice.imageUrl });
    unique.push({ name: truncateChoice(choice.name), value: truncateChoice(choice.value) });
    if (unique.length >= limit) break;
  }
  return unique;
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTOCOMPLETE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Card autocomplete request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
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
  const candidate = terms.find((term) => /^[a-z]{1,4}\d{0,4}$/.test(term) && !POKEMON_CONTEXT_STOP_TERMS.has(term));
  if (!candidate) return undefined;
  const hasDigit = /\d/.test(candidate);
  if (!hasDigit && candidate !== 'rc') return undefined;
  return candidate;
}

function pokemonTcgCardMatchesQuerySubject(card: PokemonTcgCard, querySubject: string | undefined): boolean {
  if (!querySubject || !card.name) return true;
  return normalize(card.name).split(' ').includes(querySubject);
}

function pokemonTcgCardMatchesNumberPrefix(card: PokemonTcgCard, numberPrefix: string | undefined): boolean {
  if (!numberPrefix) return true;
  return normalize(card.number ?? '').startsWith(numberPrefix);
}

async function pokemonTcgAutocompleteChoices(query: string, limit: number): Promise<ChaseCardCatalogResult[]> {
  const queries = pokemonTcgSearchQueries(query);
  if (queries.length === 0) return [];
  const responses = await Promise.all(queries.map(async (q) => {
    try {
      const params = new URLSearchParams({ q, pageSize: String(Math.min(limit, POKEMON_AUTOCOMPLETE_LIMIT)), select: 'id,name,number,set' });
      const json = await fetchJsonWithTimeout(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`);
      return Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [];
    } catch {
      return [];
    }
  }));
  const cards = responses.flat();
  const querySubject = pokemonTcgQuerySubject(query);
  const numberPrefix = pokemonTcgRequestedNumberPrefix(query);
  const releaseAlias = pokemonTcgReleaseAlias(query);
  const releaseAliasSetNamePrefix = releaseAlias ? normalize(releaseAlias.setNamePrefix) : undefined;
  const includePrintedTotal = !!requestedCollectorNumber(query);
  return cards
    .filter((card) => card.name && card.number)
    .filter((card) => pokemonTcgCardMatchesQuerySubject(card, querySubject))
    .filter((card) => pokemonTcgCardMatchesNumberPrefix(card, numberPrefix))
    .filter((card) => !releaseAlias || pokemonTcgReleaseSetMatches(card, releaseAlias))
    .map((card) => {
      const setName = card.set?.name;
      const releaseLabel = pokemonTcgReleaseChoiceLabel(card, releaseAlias);
      const numberLabel = pokemonTcgChoiceNumberLabel(card, releaseAlias, includePrintedTotal);
      const value = [card.name, releaseLabel ?? setName, numberLabel].filter(Boolean).join(' ');
      return {
        name: truncateChoice(releaseLabel ? `${card.name} — ${releaseLabel} #${numberLabel}` : setName ? `${card.name} — ${setName} #${numberLabel}` : `${card.name} #${numberLabel}`),
        value: truncateChoice(value),
        imageUrl: pokemonTcgImageUrl(card)
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

function requestedCollectorNumber(query: string): RequestedCollectorNumber | undefined {
  const match = /\b(0?\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(query);
  if (!match) return undefined;
  return { localId: match[1].padStart(3, '0'), totalPrefix: match[2] };
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
  return normalizeTcgDexQuery(query)
    .split(' ')
    .filter((term) => term.length >= 2 && !/^\d+$/.test(term) && !['card', 'cards', 'japanese', 'pokemon'].includes(term))[0];
}

function tcgDexCardMatchesQuerySubject(card: TcgDexCard, querySubject: string | undefined): boolean {
  const knownSubject = tcgDexKnownSubject(querySubject);
  if (!knownSubject) return !querySubject;
  const aliases = JAPANESE_SUBJECT_ALIASES[knownSubject];
  if (!aliases) return false;
  return aliases.some((alias) => card.name?.includes(alias));
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
  const [nameSummariesRaw, aliasNameSummariesRaw, localIdSummariesRaw] = await Promise.all([
    fetchJsonWithTimeout(nameUrl).catch(() => []),
    Promise.all(aliasNameUrls.map((url) => fetchJsonWithTimeout(url).catch(() => []))),
    Promise.all(localIds.map((localId) => fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ localId }).toString()}`).catch(() => [])))
  ]);
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
    filtered.map((card) => card.id ? fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}/${encodeURIComponent(card.id)}`).catch(() => card) : card)
  );
  return detailed
    .filter((card) => requestedTotalPrefix === undefined || printedTotalMatchesPrefix(tcgDexPrintedTotal(card as TcgDexCard), requestedTotalPrefix))
    .filter((card) => tcgDexCardMatchesQuerySubject(card as TcgDexCard, querySubject))
    .flatMap((card) => {
      const name = tcgDexDisplayName(card as TcgDexCard, query);
      return name ? [{ name, imageUrl: tcgDexImageUrl(card as TcgDexCard) }] : [];
    })
    .map((card) => ({ name: truncateChoice(card.name), value: truncateChoice(card.name), imageUrl: card.imageUrl }));
}

export async function autocompleteChaseCards(query: string, limit = 25): Promise<ChaseCardAutocompleteChoice[]> {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];
  const helperChoice = bareCardNumberHelperChoice(query);
  if (helperChoice) return [helperChoice];
  const cached = autocompleteCache.get(normalizedQuery);
  if (cached && cached.expiresAt > Date.now()) return cached.choices.slice(0, limit);

  const [pokemonChoices, japaneseChoices] = await Promise.all([
    pokemonTcgAutocompleteChoices(query, limit).catch((error) => {
      console.error('pokemonTcgAutocompleteChoices failed', error);
      return [];
    }),
    tcgDexAutocompleteChoices(query, limit).catch((error) => {
      console.error('tcgDexAutocompleteChoices failed', error);
      return [];
    })
  ]);
  const sourceOrderedChoices = hasTcgDexAutocompleteSignal(query) ? [...japaneseChoices, ...pokemonChoices] : [...pokemonChoices, ...japaneseChoices];
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
  const fallbackChoice = choices.length === 0 ? japanesePromoFallbackChoice(query) : undefined;
  if (fallbackChoice) return [fallbackChoice];
  if (choices.length > 0) autocompleteCache.set(normalizedQuery, { expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS, choices });
  return choices;
}

export function clearChaseCardAutocompleteCache(): void {
  autocompleteCache.clear();
  autocompletePreviewCache.clear();
}

export function getCachedChaseCardPreviewImage(cardName: string): string | undefined {
  const cached = autocompletePreviewCache.get(normalize(cardName));
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.imageUrl;
}