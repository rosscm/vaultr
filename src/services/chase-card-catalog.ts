export type ChaseCardAutocompleteChoice = {
  name: string;
  value: string;
};

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string };
};

type TcgDexCardSummary = {
  id?: string;
  localId?: string;
  name?: string;
};

type TcgDexCard = TcgDexCardSummary & {
  set?: { name?: string; id?: string; cardCount?: { official?: number; total?: number } };
};

const POKEMON_TCG_ENDPOINT = 'https://api.pokemontcg.io/v2/cards';
const TCGDEX_JA_CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/ja/cards';
const AUTOCOMPLETE_TIMEOUT_MS = 2600;
const AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60 * 1000;
const autocompleteCache = new Map<string, { expiresAt: number; choices: ChaseCardAutocompleteChoice[] }>();

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function truncateChoice(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

function uniqueChoices(choices: ChaseCardAutocompleteChoice[], limit: number): ChaseCardAutocompleteChoice[] {
  const seen = new Set<string>();
  const unique: ChaseCardAutocompleteChoice[] = [];
  for (const choice of choices) {
    const key = normalize(choice.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
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

function pokemonTcgSearchQuery(query: string): string {
  const terms = normalize(query).split(' ').filter(Boolean).slice(0, 4);
  if (terms.length === 0) return '';
  const number = /\b(?:[a-z]{0,4}\d{1,4}|\d{1,4}\s*\/\s*\d{1,4})\b/i.exec(query)?.[0]?.replace(/\s/g, '');
  const nameTerms = terms.filter((term) => !/^\d+$/.test(term) && !/^\d+\/\d+$/.test(term));
  const parts = nameTerms.map((term) => `name:${term}*`);
  if (number) parts.push(`number:${number.replace(/\/\d+$/, '')}`);
  return parts.join(' ');
}

async function pokemonTcgAutocompleteChoices(query: string, limit: number): Promise<ChaseCardAutocompleteChoice[]> {
  const q = pokemonTcgSearchQuery(query);
  if (!q) return [];
  const params = new URLSearchParams({ q, pageSize: String(Math.min(limit, 25)), select: 'id,name,number,set' });
  const json = await fetchJsonWithTimeout(`${POKEMON_TCG_ENDPOINT}?${params.toString()}`);
  const cards = Array.isArray(json?.data) ? (json.data as PokemonTcgCard[]) : [];
  return cards
    .filter((card) => card.name && card.number)
    .map((card) => {
      const setName = card.set?.name;
      const value = [card.name, setName, card.number].filter(Boolean).join(' ');
      return { name: truncateChoice(setName ? `${card.name} — ${setName} #${card.number}` : `${card.name} #${card.number}`), value: truncateChoice(value) };
    });
}

function tcgDexPrintedTotal(card: TcgDexCard): number | undefined {
  return card.set?.cardCount?.official ?? card.set?.cardCount?.total;
}

function tcgDexDisplayName(card: TcgDexCard, query: string): string | undefined {
  if (!card.name || !card.localId) return undefined;
  const querySubject = normalize(query)
    .split(' ')
    .filter((term) => term.length >= 2 && !/^\d+$/.test(term) && !['card', 'cards', 'japanese', 'pokemon'].includes(term))[0];
  const displaySubject = querySubject ? querySubject.replace(/^./, (letter) => letter.toUpperCase()) : card.name;
  const setLabel = card.set?.id ?? card.set?.name;
  const total = tcgDexPrintedTotal(card);
  const numberLabel = total ? `${card.localId}/${String(total).padStart(3, '0')}` : card.localId;
  return [displaySubject, 'Japanese', setLabel, numberLabel].filter(Boolean).join(' ');
}

async function tcgDexAutocompleteChoices(query: string, limit: number): Promise<ChaseCardAutocompleteChoice[]> {
  const normalizedQuery = normalize(query);
  const slashMatch = /\b(0?\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(query);
  const requestedTotal = slashMatch?.[2] ? Number.parseInt(slashMatch[2], 10) : undefined;
  const localId = (slashMatch?.[1] ?? /\b0?\d{1,3}\b/.exec(query)?.[0])?.trim().padStart(3, '0');
  const urls = [
    `${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ name: query }).toString()}`,
    ...(localId ? [`${TCGDEX_JA_CARDS_ENDPOINT}?${new URLSearchParams({ localId }).toString()}`] : [])
  ];
  const summaries = (await Promise.all(urls.map((url) => fetchJsonWithTimeout(url).catch(() => []))))
    .flat()
    .filter((card): card is TcgDexCardSummary => !!card && typeof card === 'object');
  const candidateLimit = requestedTotal === undefined ? Math.min(limit, 8) : 80;
  const filtered = summaries
    .filter((card) => {
      const text = normalize([card.name, card.localId, card.id].filter(Boolean).join(' '));
      return normalizedQuery.split(' ').filter(Boolean).every((term) => text.includes(term)) || (!!localId && card.localId === localId);
    })
    .slice(0, candidateLimit);
  const detailed = await Promise.all(
    filtered.map((card) => card.id ? fetchJsonWithTimeout(`${TCGDEX_JA_CARDS_ENDPOINT}/${encodeURIComponent(card.id)}`).catch(() => card) : card)
  );
  return detailed
    .filter((card) => requestedTotal === undefined || tcgDexPrintedTotal(card as TcgDexCard) === requestedTotal)
    .map((card) => tcgDexDisplayName(card as TcgDexCard, query))
    .filter((name): name is string => !!name)
    .map((name) => ({ name: truncateChoice(name), value: truncateChoice(name) }));
}

export async function autocompleteChaseCards(query: string, limit = 25): Promise<ChaseCardAutocompleteChoice[]> {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];
  const cached = autocompleteCache.get(normalizedQuery);
  if (cached && cached.expiresAt > Date.now()) return cached.choices.slice(0, limit);

  const [pokemonChoices, japaneseChoices] = await Promise.all([
    pokemonTcgAutocompleteChoices(query, limit).catch(() => []),
    tcgDexAutocompleteChoices(query, limit).catch(() => [])
  ]);
  const choices = uniqueChoices([...pokemonChoices, ...japaneseChoices], limit);
  autocompleteCache.set(normalizedQuery, { expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS, choices });
  return choices;
}

export function clearChaseCardAutocompleteCache(): void {
  autocompleteCache.clear();
}