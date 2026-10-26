import type { DiscoverySuggestion } from './discovery-catalog.js';

const COLLECTOR_TERMS = [
  'special illustration rare', 'illustration rare', 'trainer gallery', 'galarian gallery',
  'black star', 'special delivery', 'classic collection', 'alt art', 'alternate art',
  'full art', 'secret rare', 'gold star', 'tag team', 'southern islands', 'team rocket',
  'gym challenge', 'gym heroes', 'e-reader', 'deck exclusive', 'intro pack', 'odd release',
  'limited release', 'unique release', 'magazine promo', 'special set', 'small set',
  'numbered set', 'pokemon center', 'corocoro', 'magazine', 'vending', 'masaki', 'munch',
  'poncho', 'staff', 'winner', 'prerelease', 'stamped', 'japanese', 'promo', 'exclusive',
  'vintage', 'crystal', 'shining', 'sar', 'sir', 'vmax', 'vstar', 'gx', 'ex'
] as const;

function normalize(value: string): string {
  return value.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\bcoro coro\b/g, 'corocoro')
    .replace(/\boddball release\b/g, 'odd release');
}

function matchingTerms(text: string, supplied: string[]): string[] {
  const terms = new Set<string>();
  for (const phrase of COLLECTOR_TERMS) {
    if (new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) terms.add(phrase);
  }
  for (const value of supplied) {
    const term = normalize(value);
    if (term.length < 2 || /^\d+$/.test(term) || ['card', 'cards', 'pokemon', 'collector'].includes(term)) continue;
    terms.add(term);
  }
  return [...terms].sort();
}

function termsOfType(terms: string[], allowed: string[]): string[] {
  const available = new Set(terms);
  return allowed.filter((term) => available.has(term));
}

function subjectTerms(suggestion: DiscoverySuggestion, collectorTerms: string[]): string[] {
  const name = normalize(suggestion.canonicalReference?.canonicalName ?? suggestion.name);
  const excluded = new Set([...collectorTerms.flatMap((term) => term.split(' ')), 'card', 'pokemon']);
  return [...new Set(name.split(' ').filter((term) => term.length >= 3 && !excluded.has(term) && !/^\d+$/.test(term)))].slice(0, 4);
}

export function discoveryLearningFeatures(suggestion: DiscoverySuggestion): Record<string, unknown> {
  const reference = suggestion.canonicalReference;
  const supplied = [...(suggestion.sourceTasteTokens ?? []), ...(suggestion.requiredEvidenceTokens ?? [])];
  const text = normalize([
    suggestion.name,
    reference?.canonicalName,
    reference?.setName,
    reference?.cardNumber,
    suggestion.lane,
    ...supplied
  ].filter((value): value is string => !!value).join(' '));
  const collectorTerms = matchingTerms(text, supplied);
  if (reference?.language === 'JAPANESE' && !collectorTerms.includes('japanese')) collectorTerms.push('japanese');
  collectorTerms.sort();

  const traits: Record<string, string[]> = {
    subject: subjectTerms(suggestion, collectorTerms),
    region: termsOfType(collectorTerms, ['japanese']),
    channel: termsOfType(collectorTerms, ['corocoro', 'magazine', 'pokemon center', 'vending', 'masaki', 'munch', 'poncho']),
    releaseShape: termsOfType(collectorTerms, ['promo', 'black star', 'special delivery', 'classic collection', 'exclusive', 'deck exclusive', 'intro pack', 'odd release', 'limited release', 'unique release', 'magazine promo', 'special set', 'small set', 'numbered set', 'staff', 'winner', 'prerelease', 'stamped']),
    era: termsOfType(collectorTerms, ['vintage', 'e-reader', 'southern islands', 'team rocket', 'gym challenge', 'gym heroes']),
    artShape: termsOfType(collectorTerms, ['special illustration rare', 'illustration rare', 'trainer gallery', 'galarian gallery', 'alt art', 'alternate art', 'full art', 'secret rare', 'gold star', 'sar', 'sir', 'crystal', 'shining']),
    format: termsOfType(collectorTerms, ['tag team', 'vmax', 'vstar', 'gx', 'ex'])
  };

  const result: Record<string, unknown> = {
    collectorTerms,
    collectorTraits: Object.fromEntries(Object.entries(traits).filter(([, values]) => values.length > 0))
  };
  if (reference?.language === 'JAPANESE') result.japaneseSignal = true;
  if (collectorTerms.some((term) => ['promo', 'black star', 'special delivery', 'magazine promo'].includes(term))) result.promoSignal = true;
  if (collectorTerms.includes('e-reader')) result.eReaderSignal = true;
  if (collectorTerms.some((term) => ['special illustration rare', 'illustration rare', 'trainer gallery', 'galarian gallery', 'alt art', 'alternate art', 'full art', 'secret rare', 'sar', 'sir'].includes(term))) result.premiumFormatContext = true;
  return result;
}
