import { db } from './db.js';
import type { Listing } from '../types.js';
import type { SupportedCurrency } from './currency.js';

export type DiscoveryMarketSourceStatus = 'RATE_LIMITED' | 'TIMEOUT' | 'ERROR';

export type DiscoveryMarketCacheEntry = {
  cacheKey: string;
  suggestionName: string;
  displayCurrency: SupportedCurrency;
  destinationCountry?: string;
  listingId?: string;
  listingTitle?: string;
  listingUrl?: string;
  imageUrl?: string;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  typicalRawSoldTotal?: number;
  soldSampleSize?: number;
  sourceStatus?: DiscoveryMarketSourceStatus;
  fetchedAt: string;
  updatedAt: string;
};

type DiscoveryMarketCacheRow = {
  cache_key: string;
  suggestion_name: string;
  display_currency: SupportedCurrency;
  destination_country: string | null;
  listing_id: string | null;
  listing_title: string | null;
  listing_url: string | null;
  image_url: string | null;
  typical_raw_asking_total: number | null;
  market_sample_size: number | null;
  typical_raw_sold_total: number | null;
  sold_sample_size: number | null;
  source_status: DiscoveryMarketSourceStatus | null;
  fetched_at: string;
  updated_at: string;
};

type UpsertDiscoveryMarketCacheInput = {
  cacheKey: string;
  suggestionName: string;
  displayCurrency: SupportedCurrency;
  destinationCountry?: string;
  listing?: Listing;
  imageUrl?: string;
  typicalRawAskingTotal?: number;
  marketSampleSize?: number;
  typicalRawSoldTotal?: number;
  soldSampleSize?: number;
  sourceStatus?: DiscoveryMarketSourceStatus;
  fetchedAt?: string;
};

const getDiscoveryMarketCacheStmt = db.prepare(`
  SELECT cache_key, suggestion_name, display_currency, destination_country, listing_id, listing_title, listing_url, image_url,
         typical_raw_asking_total, market_sample_size, typical_raw_sold_total, sold_sample_size, source_status, fetched_at, updated_at
  FROM discovery_market_cache
  WHERE cache_key = ?
`);

const upsertDiscoveryMarketCacheStmt = db.prepare(`
  INSERT INTO discovery_market_cache (
    cache_key, suggestion_name, display_currency, destination_country, listing_id, listing_title, listing_url, image_url,
    typical_raw_asking_total, market_sample_size, typical_raw_sold_total, sold_sample_size, source_status, fetched_at, updated_at
  )
  VALUES (
    @cache_key, @suggestion_name, @display_currency, @destination_country, @listing_id, @listing_title, @listing_url, @image_url,
    @typical_raw_asking_total, @market_sample_size, @typical_raw_sold_total, @sold_sample_size, @source_status, @fetched_at, @updated_at
  )
  ON CONFLICT(cache_key) DO UPDATE SET
    suggestion_name = excluded.suggestion_name,
    display_currency = excluded.display_currency,
    destination_country = excluded.destination_country,
    listing_id = excluded.listing_id,
    listing_title = excluded.listing_title,
    listing_url = excluded.listing_url,
    image_url = excluded.image_url,
    typical_raw_asking_total = excluded.typical_raw_asking_total,
    market_sample_size = excluded.market_sample_size,
    typical_raw_sold_total = excluded.typical_raw_sold_total,
    sold_sample_size = excluded.sold_sample_size,
    source_status = excluded.source_status,
    fetched_at = excluded.fetched_at,
    updated_at = excluded.updated_at
`);

const deleteDiscoveryMarketCacheStmt = db.prepare(`
  DELETE FROM discovery_market_cache
  WHERE cache_key = ?
`);

function mapDiscoveryMarketCacheRow(row: DiscoveryMarketCacheRow): DiscoveryMarketCacheEntry {
  return {
    cacheKey: row.cache_key,
    suggestionName: row.suggestion_name,
    displayCurrency: row.display_currency,
    destinationCountry: row.destination_country ?? undefined,
    listingId: row.listing_id ?? undefined,
    listingTitle: row.listing_title ?? undefined,
    listingUrl: row.listing_url ?? undefined,
    imageUrl: row.image_url ?? undefined,
    typicalRawAskingTotal: row.typical_raw_asking_total ?? undefined,
    marketSampleSize: row.market_sample_size ?? undefined,
    typicalRawSoldTotal: row.typical_raw_sold_total ?? undefined,
    soldSampleSize: row.sold_sample_size ?? undefined,
    sourceStatus: row.source_status ?? undefined,
    fetchedAt: row.fetched_at,
    updatedAt: row.updated_at
  };
}

export function discoveryMarketCacheKey(
  suggestionName: string,
  displayCurrency: SupportedCurrency,
  destinationCountry?: string,
  _destinationPostalCode?: string,
  range?: { min: number; max: number }
): string {
  return JSON.stringify([
    suggestionName.trim().toLowerCase(),
    displayCurrency,
    destinationCountry?.trim().toUpperCase() ?? '',
    range ? [Math.max(0, Math.round(range.min)), Math.max(0, Math.round(range.max))] : []
  ]);
}

export function getDiscoveryMarketCache(cacheKey: string): DiscoveryMarketCacheEntry | null {
  const row = getDiscoveryMarketCacheStmt.get(cacheKey) as DiscoveryMarketCacheRow | undefined;
  return row ? mapDiscoveryMarketCacheRow(row) : null;
}

export function deleteDiscoveryMarketCache(cacheKey: string): void {
  deleteDiscoveryMarketCacheStmt.run(cacheKey);
}

export function upsertDiscoveryMarketCache(input: UpsertDiscoveryMarketCacheInput): void {
  const now = new Date().toISOString();
  upsertDiscoveryMarketCacheStmt.run({
    cache_key: input.cacheKey,
    suggestion_name: input.suggestionName,
    display_currency: input.displayCurrency,
    destination_country: input.destinationCountry ?? null,
    listing_id: input.listing?.listingId ?? null,
    listing_title: input.listing?.title ?? null,
    listing_url: input.listing?.url ?? null,
    image_url: input.imageUrl ?? input.listing?.imageUrl ?? input.listing?.thumbnailUrl ?? null,
    typical_raw_asking_total: input.typicalRawAskingTotal ?? null,
    market_sample_size: input.marketSampleSize ?? null,
    typical_raw_sold_total: input.typicalRawSoldTotal ?? null,
    sold_sample_size: input.soldSampleSize ?? null,
    source_status: input.sourceStatus ?? null,
    fetched_at: input.fetchedAt ?? now,
    updated_at: now
  });
}

export function listingFromDiscoveryMarketCache(entry: DiscoveryMarketCacheEntry): Listing | undefined {
  if (!entry.listingId || !entry.listingTitle || !entry.listingUrl) return undefined;
  return {
    source: 'EBAY',
    listingId: entry.listingId,
    title: entry.listingTitle,
    price: entry.typicalRawAskingTotal ?? entry.typicalRawSoldTotal ?? 0,
    currency: entry.displayCurrency,
    url: entry.listingUrl,
    imageUrl: entry.imageUrl,
    thumbnailUrl: entry.imageUrl,
    region: 'OTHER',
    listingType: 'OTHER'
  };
}
