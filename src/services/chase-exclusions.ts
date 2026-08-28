export type DefaultExcludedTitlePattern = {
  term: string;
  pattern: RegExp;
};

export const DEFAULT_EXCLUDED_TITLE_PATTERNS: DefaultExcludedTitlePattern[] = [
  { term: 'proxy', pattern: /\bproxy\b/ },
  { term: 'custom', pattern: /\bcustom\b/ },
  { term: 'reprint', pattern: /\breprints?\b/ },
  { term: 'replica', pattern: /\breplicas?\b/ },
  { term: 'orica', pattern: /\borica\b/ },
  { term: 'fan art', pattern: /\bfan\s*art\b|\bfanart\b/ },
  { term: 'novelty', pattern: /\bnovelty\b/ },
  { term: 'keychain', pattern: /\bkey\s*chains?\b|\bkeychains?\b/ },
  { term: 'sticker', pattern: /\bstickers?\b/ },
  { term: 'extended art', pattern: /\bextended\s+art(?:work)?\b/ },
  { term: 'acrylic case', pattern: /\bacrylic\s+(?:cases?|card|display|holder)\b/ },
  { term: 'magnetic case', pattern: /\bmagnetic\s+(?:cases?|card|display|holder)\b/ },
  { term: 'card case', pattern: /\b(?:card|tcg|ccg|trading\s+card)\s+cases?\b|\bcase\s+card\b|\bart\s+case\b/ },
  { term: 'card holder', pattern: /\b(?:card|tcg|ccg|trading\s+card)\s+holders?\b/ },
  { term: 'display accessory', pattern: /\b(?:display|protector)\s+cases?\b|\b(?:display|protector)\s+case\b|\bcases?\s+(?:for|only)\b|\bslab\s+stand\b/ },
  { term: 'display card', pattern: /\bdisplay\s+cards?\b/ },
  { term: 'frame', pattern: /\b(?:art|display|photo|magnetic)?\s*frames?\b/ },
  { term: 'stand', pattern: /\bstands?\b/ },
  { term: 'no card', pattern: /\bno\s+card\b/ },
  { term: 'handmade art', pattern: /\bhand[ -]?drawn\b|\bsketch\s+card\b/ },
  { term: 'code card', pattern: /\b(?:online|digital|download|redemption|tcg\s+online|ptcgo|ptcgl)\s+codes?\b|\bcodes?\s+cards?\b/ },
  { term: 'multi-card lot', pattern: /\b\d+\s*x\b|\bx\s*\d+\b|\blot\s+of\b|\b(?:pokemon\s+)?\w+\s+cards?\s+lots?\b|\blots?\s+\w+\s+pokemon\s+cards?\b/ }
];

const LEGACY_DEFAULT_EXCLUSION_TERMS = new Set([
  ...DEFAULT_EXCLUDED_TITLE_PATTERNS.map((entry) => normalizeExclusionTerm(entry.term)),
  'lot'
]);

export function normalizeExclusionTerm(value: string): string {
  return value.toLowerCase().replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function defaultExcludedTitleTerm(title: string): string | undefined {
  const normalized = normalizeExclusionTerm(title).replace(/\btoys\s*r\s*us\b/g, 'retail promo');
  return DEFAULT_EXCLUDED_TITLE_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.term;
}

export function isDefaultOrLegacyExclusionTerm(value: string): boolean {
  return LEGACY_DEFAULT_EXCLUSION_TERMS.has(normalizeExclusionTerm(value));
}

export function customExclusionTerms(terms: string[] | undefined): string[] {
  if (!terms || terms.length === 0) return [];
  return terms.filter((term) => !isDefaultOrLegacyExclusionTerm(term));
}
