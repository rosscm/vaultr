import fs from 'node:fs';
import path from 'node:path';
import { queryCardCatalogRecords } from '../card-catalog-db.js';
import { curatedJapanesePromoProvenanceStatus } from './curated-japanese-promo-audit.js';
import { normalizeCatalogCardNumber, normalizeCatalogText } from './normalize.js';
import { catalogSubjectsEquivalent, subjectIdentityTerms } from './search.js';
import { CURATED_JAPANESE_PROMOS, type CuratedJapanesePromoPrinting } from './supplements/curated-japanese-promos.js';
import type { StoredCardCatalogRecord } from './types.js';

export type PokumonJapanesePromoPrinting = {
  url: string;
  name: string;
  sourceTitle?: string;
  language: 'ja';
  promoSet?: string;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  releaseYear?: number;
  releaseType?: string;
  releaseEvent?: string;
  illustrator?: string;
  finish?: string;
  surface?: string;
  imageUrl?: string;
};

export type PokumonCoverageStatus = 'ALREADY_REPRESENTED' | 'EXISTING_REVIEW' | 'MISSING' | 'AMBIGUOUS';

export type PokumonCoverageRecord = {
  url: string;
  name: string;
  promoSet?: string;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  sourceTitle?: string;
  releaseYear?: number;
  releaseType?: string;
  releaseEvent?: string;
  illustrator?: string;
  finish?: string;
  surface?: string;
  status: PokumonCoverageStatus;
  reason: string;
  imageStatus: 'PRESENT' | 'MISSING';
  imageUrl?: string;
  matches: Array<{ source: string; sourceCardId: string; name: string; setName?: string; cardNumber?: string; printedTotal?: string }>;
};

export type PokumonCoverageReport = {
  total: number;
  alreadyRepresented: number;
  missing: number;
  existingReview: number;
  ambiguous: number;
  withImage: number;
  withoutImage: number;
  byPromoSet: Record<string, number>;
  records: PokumonCoverageRecord[];
};

export const POKUMON_COMPLETE_JAPANESE_PROMO_SETS = ['t', 'p', 'j', 'play', 'ppp', 'adv-p', 'pcg-p', 'dp-p', 'dpt-p', 'l-p'] as const;
export const POKUMON_INDIVIDUAL_SEED_URLS = ['https://pokumon.com/card/hama-chans-slowking-corocoro-1999-unnumbered/'] as const;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/’/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absoluteUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, 'https://pokumon.com').toString();
}

function titleFromHtml(html: string): string | undefined {
  const h1 = /<h1[^>]*>(?<value>[\s\S]*?)<\/h1>/i.exec(html)?.groups?.value;
  const ogTitle = /<meta property=["']og:title["'][^>]+content=["'](?<value>[^"']+)["']/i.exec(html)?.groups?.value;
  const title = /<title[^>]*>(?<value>[\s\S]*?)<\/title>/i.exec(html)?.groups?.value;
  return decodeHtml((h1 ?? ogTitle ?? title ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .replace(/\s*-\s*Pokumon\s*$/i, '')
    .replace(/\s*\|\s*Pokumon.*$/i, '')
    .trim() || undefined;
}

function slugParts(url: string): string[] {
  return new URL(url).pathname.split('/').filter(Boolean).at(-1)?.split('-').filter(Boolean) ?? [];
}

function nameFromTitleOrSlug(url: string, html: string): string {
  const title = titleFromHtml(html);
  if (title) return cleanPokumonSubject(title);
  const parts = slugParts(url);
  const numberIndex = parts.findIndex((part) => /^\d{1,3}$/.test(part));
  const nameParts = numberIndex > 0 ? parts.slice(0, numberIndex) : parts.slice(0, Math.max(parts.indexOf('corocoro'), parts.indexOf('japanese'), parts.indexOf('unnumbered'))).filter(Boolean);
  return nameParts.map((part) => part === 'chans' ? "chan's" : part).join(' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanPokumonSubject(title: string): string {
  const withoutPokumon = decodeHtml(title).replace(/\s*-\s*Pokumon\s*$/i, '').trim();
  const sourceTitle = cleanPokumonSourceTitle(withoutPokumon);
  const hama = /^Hama-chan'?s\s+(?<subject>.+)$/i.exec(sourceTitle);
  const subject = hama?.groups?.subject ?? sourceTitle;
  return subject
    .replace(/\s*\d{1,3}\s*\/\s*(?:\d{1,3}|[A-Z])\b.*$/i, '')
    .replace(/\s*\(\s*\d{1,3}\s*\/\s*[A-Z0-9]+\s*\)\s*$/i, '')
    .replace(/\s+(?:CoroCoro|Japanese|Pokemon Card Trainers|Pokémon Card Trainers)\b.*$/i, '')
    .replace(/\s+Unnumbered\s*$/i, '')
    .trim();
}

function cleanPokumonSourceTitle(title: string): string {
  let cleaned = decodeHtml(title).replace(/\s*-\s*Pokumon\s*$/i, '').trim();
  while (/\s*\([^)]*\)\s*$/.test(cleaned)) cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return cleaned;
}

function ogDescription(html: string): string | undefined {
  const value = /<meta property=["']og:description["'][^>]+content=["'](?<value>[^"']+)["']/i.exec(html)?.groups?.value
    ?? /<meta name=["']description["'][^>]+content=["'](?<value>[^"']+)["']/i.exec(html)?.groups?.value;
  return value ? decodeHtml(value).replace(/\s+/g, ' ').trim() : undefined;
}

function imageFromHtml(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["'](?<url>[^"']+)["']/i.exec(html)?.groups?.url;
  if (og) return absoluteUrl(decodeHtml(og));
  return undefined;
}

export function parsePokumonPromoSetIndex(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/href=["'](?<href>[^"']*\/card\/[^"']+)["']/gi)) {
    if (match.groups?.href) urls.add(absoluteUrl(decodeHtml(match.groups.href)));
  }
  return [...urls].sort();
}

export function parsePokumonCardPage(url: string, html: string): PokumonJapanesePromoPrinting {
  const parts = slugParts(url);
  const numberIndex = parts.findIndex((part) => /^\d{1,3}$/.test(part));
  const nextToken = numberIndex >= 0 ? parts[numberIndex + 1] : undefined;
  const printedTotal = nextToken && /^\d{1,3}$/.test(nextToken) ? nextToken.padStart(3, '0') : undefined;
  const setToken = numberIndex >= 0 && !printedTotal ? parts[numberIndex + 1]?.toUpperCase() : undefined;
  const isUnnumbered = parts.includes('unnumbered') || numberIndex < 0;
  const sourcePageTitle = titleFromHtml(html);
  const sourceTitle = sourcePageTitle ? cleanPokumonSourceTitle(sourcePageTitle) : undefined;
  const description = ogDescription(html);
  const contextText = `${sourcePageTitle ?? ''} ${description ?? ''} ${html}`;
  const year = (description ?? parts.join(' ')).split(/\D+/).map((part) => Number(part)).find((part) => part >= 1996 && part <= 2035);
  const releaseEvent = description?.replace(/\s+Find on.*$/i, '').trim() || sourceTitle;
  return {
    url,
    name: nameFromTitleOrSlug(url, html),
    sourceTitle,
    language: 'ja',
    promoSet: setToken,
    cardNumber: numberIndex >= 0 ? `${parts[numberIndex].padStart(3, '0')}${setToken ? `/${setToken}` : ''}` : undefined,
    printedTotal,
    isUnnumbered,
    releaseYear: year,
    releaseType: /magazine|corocoro|card trainers/i.test(contextText) ? 'Magazine Promo' : 'pokumon_promo',
    releaseEvent,
    illustrator: extractKnownText(contextText, ['Yukiko Baba', 'Masatoshi Hamada']),
    finish: extractKnownText(contextText, ['Non-holo']),
    surface: extractKnownText(contextText, ['Glossy']),
    imageUrl: imageFromHtml(html)
  };
}

function extractKnownText(text: string, values: string[]): string | undefined {
  return values.find((value) => text.includes(value));
}

function releaseMatches(printing: Pick<PokumonJapanesePromoPrinting, 'promoSet' | 'releaseEvent' | 'url'>, candidateText: string): boolean {
  const haystack = normalizeCatalogText(candidateText);
  const release = normalizeCatalogText([printing.promoSet, printing.releaseEvent, new URL(printing.url).pathname].filter(Boolean).join(' '));
  if (printing.promoSet && haystack.includes(normalizeCatalogText(printing.promoSet))) return true;
  const terms = release.split(' ').filter((term) => term.length >= 4 && !['card', 'japanese', 'promo', 'pokemon', 'unnumbered'].includes(term));
  return terms.some((term) => haystack.includes(term));
}

function baseCardNumber(value: string | undefined): string | undefined {
  return value?.split('/')[0];
}

function sameStructuredNumber(printing: PokumonJapanesePromoPrinting, cardNumber: string | undefined, printedTotal: string | undefined): boolean {
  if (!printing.cardNumber) return false;
  if (normalizeCatalogCardNumber(printing.cardNumber) === normalizeCatalogCardNumber(cardNumber)) return true;
  if (normalizeCatalogCardNumber(baseCardNumber(printing.cardNumber)) !== normalizeCatalogCardNumber(cardNumber)) return false;
  if (printing.printedTotal && normalizeCatalogCardNumber(printing.printedTotal) !== normalizeCatalogCardNumber(printedTotal)) return false;
  return Boolean(printing.promoSet);
}

function curatedMatch(printing: PokumonJapanesePromoPrinting, record: CuratedJapanesePromoPrinting): boolean {
  if (!catalogSubjectsEquivalent(printing.name, record.name, record.aliases)) return false;
  if (printing.cardNumber && !sameStructuredNumber(printing, record.cardNumber, record.printedTotal)) return false;
  if (printing.printedTotal && normalizeCatalogCardNumber(printing.printedTotal) !== normalizeCatalogCardNumber(record.printedTotal)) return false;
  if (!printing.cardNumber && !releaseMatches(printing, [record.promoContext, record.releaseEvent, ...(record.additionalReleaseEvents ?? [])].join(' '))) return false;
  if (printing.promoSet && !releaseMatches(printing, [record.promoContext, record.releaseEvent, ...(record.additionalReleaseEvents ?? [])].join(' '))) return false;
  return true;
}

function catalogMatch(printing: PokumonJapanesePromoPrinting, record: StoredCardCatalogRecord): boolean {
  if (!catalogSubjectsEquivalent(printing.name, record.name, record.aliases?.map((alias) => alias.alias))) return false;
  if (record.language !== 'ja') return false;
  if (printing.cardNumber && !sameStructuredNumber(printing, record.cardNumber, record.printedTotal)) return false;
  if (printing.printedTotal && normalizeCatalogCardNumber(printing.printedTotal) !== normalizeCatalogCardNumber(record.printedTotal)) return false;
  if (!printing.cardNumber && !releaseMatches(printing, [record.setName, record.translatedSetName, record.promoContext, record.releaseEvent, record.series].join(' '))) return false;
  if (printing.promoSet && !releaseMatches(printing, [record.setName, record.translatedSetName, record.promoContext, record.releaseEvent, record.series].join(' '))) return false;
  return true;
}

function candidateCatalogRecords(printing: PokumonJapanesePromoPrinting, dbPath?: string): StoredCardCatalogRecord[] {
  return queryCardCatalogRecords({
    dbPath,
    subject: printing.name,
    subjectAliases: subjectIdentityTerms(printing.name),
    normalizedQuery: normalizeCatalogText(printing.name),
    normalizedCardNumber: normalizeCatalogCardNumber(baseCardNumber(printing.cardNumber)),
    releaseContext: printing.promoSet ?? printing.releaseEvent,
    limit: 50
  });
}

export function auditPokumonJapanesePromoInventory(printings: PokumonJapanesePromoPrinting[], options: { dbPath?: string; curatedRecords?: CuratedJapanesePromoPrinting[] } = {}): PokumonCoverageReport {
  const curatedRecords = options.curatedRecords ?? CURATED_JAPANESE_PROMOS;
  const records = printings.map((printing) => {
    const catalogMatches = candidateCatalogRecords(printing, options.dbPath).filter((record) => catalogMatch(printing, record));
    const curatedMatches = curatedRecords.filter((record) => record.verificationStatus === 'VERIFIED' && curatedMatch(printing, record));
    const reviewMatches = curatedRecords.filter((record) => record.verificationStatus !== 'VERIFIED' && curatedMatch(printing, record));
    const represented = [...new Map([
      ...catalogMatches.map((record) => ({ source: record.source, sourceCardId: record.sourceCardId, name: record.name, setName: record.translatedSetName ?? record.setName, cardNumber: record.cardNumber, printedTotal: record.printedTotal })),
      ...curatedMatches.map((record) => ({ source: 'CURATED', sourceCardId: record.curationId, name: record.name, setName: record.promoContext, cardNumber: record.cardNumber, printedTotal: record.printedTotal }))
    ].map((match) => [`${match.source}:${match.sourceCardId}`, match])).values()];
    const status: PokumonCoverageStatus = represented.length === 1 ? 'ALREADY_REPRESENTED' : represented.length > 1 ? 'AMBIGUOUS' : reviewMatches.length > 0 ? 'EXISTING_REVIEW' : 'MISSING';
    return {
      url: printing.url,
      name: printing.name,
      promoSet: printing.promoSet,
      cardNumber: printing.cardNumber,
      printedTotal: printing.printedTotal,
      isUnnumbered: printing.isUnnumbered,
      sourceTitle: printing.sourceTitle,
      releaseYear: printing.releaseYear,
      releaseType: printing.releaseType,
      releaseEvent: printing.releaseEvent,
      illustrator: printing.illustrator,
      finish: printing.finish,
      surface: printing.surface,
      status,
      reason: status === 'ALREADY_REPRESENTED' ? 'exact printing already represented' : status === 'AMBIGUOUS' ? 'multiple plausible exact-printing matches' : status === 'EXISTING_REVIEW' ? 'matching curated review seed exists' : 'no exact local canonical match',
      imageStatus: printing.imageUrl ? 'PRESENT' as const : 'MISSING' as const,
      imageUrl: printing.imageUrl,
      matches: represented
    };
  }).sort((a, b) => a.url.localeCompare(b.url));
  const statusCount = (status: PokumonCoverageStatus) => records.filter((record) => record.status === status).length;
  return {
    total: records.length,
    alreadyRepresented: statusCount('ALREADY_REPRESENTED'),
    missing: statusCount('MISSING'),
    existingReview: statusCount('EXISTING_REVIEW'),
    ambiguous: statusCount('AMBIGUOUS'),
    withImage: records.filter((record) => record.imageStatus === 'PRESENT').length,
    withoutImage: records.filter((record) => record.imageStatus === 'MISSING').length,
    byPromoSet: records.reduce<Record<string, number>>((counts, record) => {
      const key = record.promoSet ?? 'UNNUMBERED';
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    records
  };
}

export async function fetchPokumonJapanesePromoSnapshot(options: {
  cacheDir: string;
  sets?: readonly string[];
  seedUrls?: readonly string[];
  allowNetwork?: boolean;
  limitPages?: number;
  delayMs?: number;
}): Promise<PokumonJapanesePromoPrinting[]> {
  const sets = options.sets ?? POKUMON_COMPLETE_JAPANESE_PROMO_SETS;
  const seedUrls = options.seedUrls ?? POKUMON_INDIVIDUAL_SEED_URLS;
  const urls = new Set<string>(seedUrls);
  for (const set of sets) {
    const indexUrl = `https://pokumon.com/promo_set/${set}/`;
    const html = await readCachedPokumonPage(indexUrl, options);
    if (html) parsePokumonPromoSetIndex(html).forEach((url) => urls.add(url));
  }
  const printings: PokumonJapanesePromoPrinting[] = [];
  for (const url of [...urls].sort().slice(0, options.limitPages ?? 50)) {
    const html = await readCachedPokumonPage(url, options);
    if (html) printings.push(parsePokumonCardPage(url, html));
  }
  return printings;
}

async function readCachedPokumonPage(url: string, options: { cacheDir: string; allowNetwork?: boolean; delayMs?: number }): Promise<string | undefined> {
  const file = path.join(options.cacheDir, encodeURIComponent(url));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (!options.allowNetwork) return undefined;
  await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5000));
  const response = await fetch(url, { headers: { 'User-Agent': 'Vaultr catalog research (https://github.com/rosscm/vaultr)' } });
  if (response.status === 429) throw new Error('Pokumon returned 429; stopping snapshot');
  if (response.status >= 500) throw new Error(`Pokumon returned ${response.status}; stopping snapshot`);
  if (!response.ok) return undefined;
  const html = await response.text();
  fs.mkdirSync(options.cacheDir, { recursive: true });
  fs.writeFileSync(file, html);
  return html;
}

export function curatedJapanesePromoInventoryHealth(records = CURATED_JAPANESE_PROMOS): { total: number; verified: number; traceable: number } {
  return {
    total: records.length,
    verified: records.filter((record) => record.verificationStatus === 'VERIFIED').length,
    traceable: records.filter((record) => curatedJapanesePromoProvenanceStatus(record) === 'TRACEABLE').length
  };
}
