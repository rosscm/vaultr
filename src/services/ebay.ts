import type { Chase, Listing } from '../types.js';
import { setBackoffUntil } from './poller-state.js';

export type ShippingDestination = {
  country?: string;
  postalCode?: string;
};

export type EbaySearchOptions = {
  enrichMissingShipping?: boolean;
  maxPrice?: number;
  maxPriceCurrency?: string;
};

export type EbaySoldSearchOptions = {
  keywords?: string;
  pageCount?: number;
};

const EBAY_FINDING_ENDPOINT_PROD = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_FINDING_ENDPOINT_SANDBOX = 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1';
const EBAY_BROWSE_ENDPOINT_PROD = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_BROWSE_ENDPOINT_SANDBOX = 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_BROWSE_ITEM_ENDPOINT_PROD = 'https://api.ebay.com/buy/browse/v1/item';
const EBAY_BROWSE_ITEM_ENDPOINT_SANDBOX = 'https://api.sandbox.ebay.com/buy/browse/v1/item';
const EBAY_OAUTH_ENDPOINT_PROD = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_OAUTH_ENDPOINT_SANDBOX = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

let cachedBrowseToken: { token: string; expiresAtMs: number } | undefined;
const ebayRequestTimestamps: number[] = [];
const ebaySearchCache = new Map<string, { listings: Listing[]; expiresAtMs: number }>();
let ebayRequestQueue = Promise.resolve();

class EbayRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayRateLimitError';
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function ebayBackoffSeconds(): number {
  const seconds = Number(process.env.EBAY_BACKOFF_BASE_SECONDS ?? '900');
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 900;
}

function ebayMaxRequestsPerMinute(): number {
  const requests = Number(process.env.EBAY_MAX_REQUESTS_PER_MINUTE ?? '6');
  return Number.isFinite(requests) && requests > 0 ? Math.max(1, Math.floor(requests)) : 6;
}

function ebayMinRequestGapMs(): number {
  const gapMs = Number(process.env.EBAY_MIN_REQUEST_GAP_MS ?? '0');
  return Number.isFinite(gapMs) && gapMs > 0 ? Math.floor(gapMs) : 0;
}

function ebaySearchCacheTtlMs(): number {
  const seconds = Number(process.env.EBAY_SEARCH_CACHE_TTL_SECONDS ?? '120');
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : 0;
}

function boundedPositiveIntegerEnv(key: string, fallback: number, max: number): number {
  const value = Number(process.env[key] ?? String(fallback));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.floor(value));
}

function ebaySearchLimit(): number {
  return boundedPositiveIntegerEnv('EBAY_SEARCH_LIMIT', 25, 50);
}

function ebaySoldSearchLimit(): number {
  return boundedPositiveIntegerEnv('EBAY_SOLD_SEARCH_LIMIT', ebaySearchLimit(), 50);
}

function ebayMaxEnrichItemsPerSearch(): number {
  return boundedPositiveIntegerEnv('EBAY_MAX_ENRICH_ITEMS_PER_SEARCH', 3, 10);
}

function cloneListings(listings: Listing[]): Listing[] {
  return listings.map((listing) => ({ ...listing }));
}

function ebaySearchCacheKey(chase: Chase, destination: ShippingDestination | undefined, options: EbaySearchOptions): string {
  return JSON.stringify([
    getEbayEnv(),
    'BROWSE',
    getEbayBrowseMarketplaceId(destination),
    ebaySearchLimit(),
    process.env.EBAY_BROWSE_SORT ?? 'newlyListed',
    searchMaxPriceFilter(options) ?? '',
    chase.cardName.trim().toLowerCase(),
    chase.grade?.trim().toLowerCase() ?? '',
    normalizeCountryCode(destination?.country) ?? '',
    destination?.postalCode?.trim().toUpperCase() ?? '',
    options.enrichMissingShipping === false ? 'light' : 'full'
  ]);
}

function getCachedEbaySearch(cacheKey: string): Listing[] | null {
  const entry = ebaySearchCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) {
    ebaySearchCache.delete(cacheKey);
    return null;
  }
  return cloneListings(entry.listings);
}

function setCachedEbaySearch(cacheKey: string, listings: Listing[]): void {
  const ttlMs = ebaySearchCacheTtlMs();
  if (ttlMs <= 0) return;
  ebaySearchCache.set(cacheKey, { listings: cloneListings(listings), expiresAtMs: Date.now() + ttlMs });
}

function pruneEbayRequestWindow(nowMs: number): void {
  const oneMinuteAgo = nowMs - 60_000;
  while (ebayRequestTimestamps.length > 0 && ebayRequestTimestamps[0] < oneMinuteAgo) ebayRequestTimestamps.shift();
}

async function waitForEbayRequestBudget(): Promise<void> {
  const waitTurn = async () => {
    const maxRequestsPerMinute = ebayMaxRequestsPerMinute();
    const minGapMs = ebayMinRequestGapMs();
    let nowMs = Date.now();
    pruneEbayRequestWindow(nowMs);

    const oldestRequestMs = ebayRequestTimestamps[0];
    const windowWaitMs = ebayRequestTimestamps.length >= maxRequestsPerMinute && oldestRequestMs !== undefined ? oldestRequestMs + 60_000 - nowMs : 0;
    const lastRequestMs = ebayRequestTimestamps.at(-1);
    const gapWaitMs = lastRequestMs !== undefined ? lastRequestMs + minGapMs - nowMs : 0;
    const waitMs = Math.max(0, windowWaitMs, gapWaitMs);
    if (waitMs > 0) await sleep(waitMs);

    nowMs = Date.now();
    pruneEbayRequestWindow(nowMs);
    ebayRequestTimestamps.push(nowMs);
  };

  const nextTurn = ebayRequestQueue.then(waitTurn, waitTurn);
  ebayRequestQueue = nextTurn.then(() => undefined, () => undefined);
  return nextTurn;
}

async function fetchEbay(url: string, init?: RequestInit): Promise<Response> {
  await waitForEbayRequestBudget();
  return fetch(url, init);
}

function rememberEbayRateLimit(): void {
  setBackoffUntil(new Date(Date.now() + ebayBackoffSeconds() * 1000));
}

function isEbayRateLimitMessage(message: string): boolean {
  return message.includes('429') || /rate limit|quota|ratelimiter|exceeded the number of times|EbayRateLimitError/i.test(message);
}

function isEbayRateLimitError(error: unknown): boolean {
  return error instanceof EbayRateLimitError || isEbayRateLimitMessage(error instanceof Error ? error.message : String(error));
}

function getEbayEnv(): 'PRODUCTION' | 'SANDBOX' {
  const env = (process.env.EBAY_ENV ?? 'PRODUCTION').toUpperCase();
  return env === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
}

function getEbayFindingEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_FINDING_ENDPOINT_SANDBOX : EBAY_FINDING_ENDPOINT_PROD;
}

function getEbayBrowseEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_BROWSE_ENDPOINT_SANDBOX : EBAY_BROWSE_ENDPOINT_PROD;
}

function getEbayBrowseItemEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_BROWSE_ITEM_ENDPOINT_SANDBOX : EBAY_BROWSE_ITEM_ENDPOINT_PROD;
}

function getEbayBrowseMarketplaceId(destination?: ShippingDestination): string {
  const destinationCountry = getDeliveryCountry(destination);
  if (destinationCountry === 'CA') return 'EBAY_CA';
  if (destinationCountry === 'US') return 'EBAY_US';
  return process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_US';
}

function getEbayOauthEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_OAUTH_ENDPOINT_SANDBOX : EBAY_OAUTH_ENDPOINT_PROD;
}

function mapCountryToRegion(countryCode?: string): 'CA' | 'US' | 'OTHER' {
  if (!countryCode) return 'OTHER';
  if (countryCode === 'CA') return 'CA';
  if (countryCode === 'US') return 'US';
  return 'OTHER';
}

function mapFindingListingType(raw?: string): 'AUCTION' | 'BUY_IT_NOW' | 'OTHER' {
  const t = (raw ?? '').toLowerCase();
  if (t === 'auction') return 'AUCTION';
  if (t === 'fixedprice' || t === 'storeinventory') return 'BUY_IT_NOW';
  return 'OTHER';
}

function findingSellingState(raw?: string): string {
  return String(raw ?? '').trim().toUpperCase();
}

function mapBrowseListingType(buyingOptions?: unknown): 'AUCTION' | 'BUY_IT_NOW' | 'OTHER' {
  if (!Array.isArray(buyingOptions)) return 'OTHER';
  const options = buyingOptions.map((option) => String(option).toUpperCase());
  if (options.includes('AUCTION')) return 'AUCTION';
  if (options.includes('FIXED_PRICE')) return 'BUY_IT_NOW';
  return 'OTHER';
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function browseShippingOptionWithCost(shippingOptions: unknown): any | undefined {
  if (!Array.isArray(shippingOptions)) return undefined;
  return shippingOptions.find((option) => parseNumber(option?.shippingCost?.value) !== undefined) ?? shippingOptions[0];
}

function normalizeCountryCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function getDeliveryCountry(destination: ShippingDestination | undefined): string | undefined {
  return normalizeCountryCode(destination?.country);
}

function getDeliveryPostalCode(destination: ShippingDestination | undefined): string | undefined {
  const normalized = destination?.postalCode?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function getBrowseEndUserContext(destination: ShippingDestination | undefined): string | undefined {
  const country = getDeliveryCountry(destination);
  const postalCode = getDeliveryPostalCode(destination);
  if (!country) return undefined;

  return postalCode ? `contextualLocation=country=${country},zip=${postalCode}` : `contextualLocation=country=${country}`;
}

function getBrowseItemEndUserContext(destination: ShippingDestination | undefined): string | undefined {
  const country = getDeliveryCountry(destination);
  const postalCode = getDeliveryPostalCode(destination);
  if (!country) return undefined;

  return postalCode ? `contextualLocation=country=${country},zip=${postalCode}` : `contextualLocation=country=${country}`;
}

function destinationLabel(country: string, postalCode: string | undefined): string {
  return postalCode ? `${country} ${postalCode}` : country;
}

function shipToLocationMatchesDestination(location: unknown, destinationCountry: string): boolean {
  const normalized = String(location ?? '').trim().toUpperCase();
  return normalized === destinationCountry || normalized === 'WORLDWIDE';
}

function deriveShippingEligibilityFromOptions(
  shippingOptions: unknown,
  destinationCountry: string | undefined,
  destinationPostalCode: string | undefined
): Pick<Listing, 'shippingDestinationCountry' | 'shippingDestinationPostalCode' | 'shippingEligibility' | 'shippingEligibilityMessage'> {
  if (!destinationCountry) return {};

  const destination = destinationLabel(destinationCountry, destinationPostalCode);
  if (!Array.isArray(shippingOptions) || shippingOptions.length === 0) {
    return {
      shippingDestinationCountry: destinationCountry,
      shippingDestinationPostalCode: destinationPostalCode,
      shippingEligibility: 'MAY_NOT_SHIP',
      shippingEligibilityMessage: `May not ship to ${destination}`
    };
  }

  const shipping = browseShippingOptionWithCost(shippingOptions);
  if (parseNumber(shipping?.shippingCost?.value) === undefined) {
    return {
      shippingDestinationCountry: destinationCountry,
      shippingDestinationPostalCode: destinationPostalCode,
      shippingEligibility: 'UNKNOWN',
      shippingEligibilityMessage: `Shipping availability to ${destination} is unknown`
    };
  }

  return {
    shippingDestinationCountry: destinationCountry,
    shippingDestinationPostalCode: destinationPostalCode,
    shippingEligibility: 'AVAILABLE',
    shippingEligibilityMessage: `Shipping shown for ${destination}`
  };
}

function deriveShippingEligibilityFromShipToLocations(
  shipToLocations: unknown,
  destinationCountry: string | undefined,
  destinationPostalCode: string | undefined
): Pick<Listing, 'shippingDestinationCountry' | 'shippingDestinationPostalCode' | 'shippingEligibility' | 'shippingEligibilityMessage'> {
  if (!destinationCountry) return {};

  const destination = destinationLabel(destinationCountry, destinationPostalCode);
  const locations = Array.isArray(shipToLocations) ? shipToLocations : [];
  if (locations.length === 0) {
    return {
      shippingDestinationCountry: destinationCountry,
      shippingDestinationPostalCode: destinationPostalCode,
      shippingEligibility: 'UNKNOWN',
      shippingEligibilityMessage: `Shipping availability to ${destination} is unknown`
    };
  }

  const shipsToDestination = locations.some((location) => shipToLocationMatchesDestination(location, destinationCountry));
  return {
    shippingDestinationCountry: destinationCountry,
    shippingDestinationPostalCode: destinationPostalCode,
    shippingEligibility: shipsToDestination ? 'AVAILABLE' : 'MAY_NOT_SHIP',
    shippingEligibilityMessage: shipsToDestination ? `Ships to ${destination}` : `May not ship to ${destination}`
  };
}

function gradeSearchTerm(grade: string | undefined): string | undefined {
  const normalized = (grade ?? '').trim().toLowerCase();
  if (normalized === 'ungraded' || normalized === 'raw') return undefined;
  return grade;
}

function buildEbaySearchKeywords(chase: Chase): string {
  const base = chase.cardName ?? '';
  let s = base;

  // Remove common verbose promo/publication phrases but keep essential tokens
  const promoPatterns = [
    /\bBlack Star Promos?\b/gi,
    /\bCoroCoro(?:\s+Jumbo|\s+Magazine|\s+Manga)?\b/gi,
    /\bMcDonald'?s(?:\s+Promo(?:s)?)?\b/gi,
    /\bPokemon Center(?:\s+Promo)?\b/gi,
    /\bToys\s*R\s*Us(?:\s+Promo)?\b/gi,
    /\bPromotional?\b/gi,
    /\bPromos?\b/gi,
    /\bMagazine\b/gi,
    /\bManga\b/gi
  ];
  for (const re of promoPatterns) s = s.replace(re, ' ');

  // Normalize spaced series+number like "XY 95" -> "XY95" and "XY/95" -> "XY95"
  s = s.replace(/\b([A-Za-z]{1,4})\s*\/?\s*(\d{1,4})\b/g, (_m, a, b) => `${a}${b}`);

  // Preserve alphanumeric tokens (e.g. XY95), then remove isolated standalone series tokens
  const seriesMatches = Array.from(new Set((s.match(/\b([A-Za-z]{1,4})(?=\d)/gi) || []).map((m) => m.replace(/\d+/g, ''))));
  for (const series of seriesMatches) {
    // remove lone occurrences of the series word but don't touch alphanumeric tokens already paired with numbers
    s = s.replace(new RegExp(`\\b${series}\\b`, 'gi'), ' ');
  }

  // Cleanup lingering words that are noisy for marketplace searches
  s = s
    .replace(/\bJapanese\b/gi, ' ')
    .replace(/\bPokemon\b\s+cards?\b/gi, 'Pokemon card')
    .replace(/\s+/g, ' ')
    .trim();

  return s.length > 0 ? s : base;
}


function searchMaxPriceFilter(options: EbaySearchOptions): string | undefined {
  const maxPrice = Number(options.maxPrice);
  const currency = options.maxPriceCurrency?.trim().toUpperCase();
  if (!Number.isFinite(maxPrice) || maxPrice <= 0 || !currency || !/^[A-Z]{3}$/.test(currency)) return undefined;
  return `price:[..${maxPrice.toFixed(2)}],priceCurrency:${currency}`;
}

function ebaySoldSearchPageCount(options: EbaySoldSearchOptions): number {
  const configured = Number(options.pageCount ?? process.env.EBAY_SOLD_SEARCH_PAGES ?? '1');
  return Number.isFinite(configured) && configured > 0 ? Math.min(5, Math.floor(configured)) : 1;
}

function ebaySoldSearchKeywords(chase: Chase, options: EbaySoldSearchOptions): string {
  const baseKeywords = options.keywords?.trim() || buildEbaySearchKeywords(chase);
  const gradeTerm = gradeSearchTerm(chase.grade);
  return gradeTerm ? `${baseKeywords} ${gradeTerm}` : baseKeywords;
}

function dedupeListingsById(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  const unique: Listing[] = [];
  for (const listing of listings) {
    const key = listing.listingId || `${listing.title}|${listing.price}|${listing.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(listing);
  }
  return unique;
}

function collectFindingErrors(json: any): any[] {
  const messages = json?.errorMessage;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => (Array.isArray(message?.error) ? message.error : []));
}

function isFindingRateLimitError(json: any): boolean {
  return collectFindingErrors(json).some((error) => {
    const ids = Array.isArray(error?.errorId) ? error.errorId : [];
    const domain = Array.isArray(error?.domain) ? error.domain.join(' ') : '';
    const subdomain = Array.isArray(error?.subdomain) ? error.subdomain.join(' ') : '';
    const message = Array.isArray(error?.message) ? error.message.join(' ') : '';
    return (
      ids.includes('10001') ||
      /ratelimiter/i.test(`${domain} ${subdomain}`) ||
      /exceeded the number of times/i.test(message)
    );
  });
}

function isBrowseRateLimitError(response: Response, json: any): boolean {
  if (response.status === 429) return true;
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.some((error: any) => /rate|limit|quota/i.test(`${error?.errorId ?? ''} ${error?.category ?? ''} ${error?.message ?? ''}`));
}

async function parseJsonResponse(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getBrowseAccessToken(): Promise<string> {
  if (cachedBrowseToken && cachedBrowseToken.expiresAtMs > Date.now() + 60_000) {
    return cachedBrowseToken.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID ?? process.env.EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_CLIENT_ID/EBAY_APP_ID or EBAY_CLIENT_SECRET for eBay Browse API');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope'
  });

  const response = await fetchEbay(getEbayOauthEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json: any = await parseJsonResponse(response);
  if (!response.ok || !json?.access_token) {
    throw new Error(`eBay OAuth token request failed: ${response.status}`);
  }

  const expiresInSeconds = Number(json.expires_in ?? 7200);
  cachedBrowseToken = {
    token: json.access_token,
    expiresAtMs: Date.now() + Math.max(60, expiresInSeconds) * 1000
  };

  return cachedBrowseToken.token;
}

function mapBrowseItemToListing(item: any, destination?: ShippingDestination): Listing | null {
  const listingId = item?.itemId;
  const title = item?.title;
  const url = item?.itemWebUrl;
  const price = parseNumber(item?.price?.value);
  const currency = item?.price?.currency ?? 'USD';
  if (!listingId || !title || !url || price === undefined) return null;

  const shipping = browseShippingOptionWithCost(item?.shippingOptions);
  const shippingCost = parseNumber(shipping?.shippingCost?.value);
  const deliveryCountry = getDeliveryCountry(destination);
  const deliveryPostalCode = getDeliveryPostalCode(destination);
  const shippingEligibility = deriveShippingEligibilityFromOptions(
    item?.shippingOptions,
    deliveryCountry,
    deliveryPostalCode
  );
  const imageUrl = firstNonEmptyString([
    item?.image?.imageUrl,
    item?.thumbnailImages?.[0]?.imageUrl,
    item?.additionalImages?.[0]?.imageUrl
  ]);

  return {
    source: 'EBAY',
    listingId,
    title,
    price,
    currency,
    shippingCost,
    shippingCurrency: shippingCost === undefined ? undefined : shipping?.shippingCost?.currency ?? currency,
    ...shippingEligibility,
    url,
    imageUrl,
    thumbnailUrl: firstNonEmptyString([item?.thumbnailImages?.[0]?.imageUrl, imageUrl]),
    seller: item?.seller?.username,
    sellerFeedbackPercent: parseNumber(item?.seller?.feedbackPercentage),
    sellerFeedbackScore: parseNumber(item?.seller?.feedbackScore),
    postedAt: item?.itemCreationDate ?? item?.itemOriginDate,
    region: mapCountryToRegion(item?.itemLocation?.country),
    condition: item?.condition,
    listingType: mapBrowseListingType(item?.buyingOptions)
  };
}

async function searchEbayBrowseListings(chase: Chase, destination?: ShippingDestination, options: EbaySearchOptions = {}): Promise<Listing[]> {
  const token = await getBrowseAccessToken();
  const gradeTerm = gradeSearchTerm(chase.grade);
  const keywords = gradeTerm ? `${chase.cardName} ${gradeTerm}` : chase.cardName;
  const params = new URLSearchParams({
    q: keywords,
    limit: String(ebaySearchLimit()),
    sort: process.env.EBAY_BROWSE_SORT ?? 'newlyListed'
  });
  const maxPriceFilter = searchMaxPriceFilter(options);
  if (maxPriceFilter) params.append('filter', maxPriceFilter);

  const endUserContext = getBrowseEndUserContext(destination);
  const contextualDestination = endUserContext ? destination : undefined;
  const marketplaceId = getEbayBrowseMarketplaceId(destination);
  const response = await fetchEbay(`${getEbayBrowseEndpoint()}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
      ...(endUserContext ? { 'X-EBAY-C-ENDUSERCTX': endUserContext } : {})
    }
  });
  const json: any = await parseJsonResponse(response);
  if (isBrowseRateLimitError(response, json)) {
    throw new EbayRateLimitError(`eBay rate limit exceeded: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`eBay Browse request failed: ${response.status}`);
  }

  const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
  const listings = items
    .map((item: any) => mapBrowseItemToListing(item, contextualDestination))
    .filter((listing: Listing | null): listing is Listing => listing !== null);

  if (options.enrichMissingShipping === false) return listings;

  const needsDestinationShipping = getDeliveryCountry(destination) !== undefined;
  const needsEnrichment = listings
    .filter((listing: Listing) => needsDestinationShipping || listing.shippingCost === undefined)
    .slice(0, ebayMaxEnrichItemsPerSearch());
  if (needsEnrichment.length === 0) return listings;

  const enrichedById = new Map<string, Listing>();
  for (const listing of needsEnrichment) {
    const enriched = await enrichListingFromBrowseItemApi(listing, token, destination);
    enrichedById.set(listing.listingId, enriched);
  }

  return listings.map((listing: Listing) => enrichedById.get(listing.listingId) ?? listing);
}

async function enrichListingFromBrowseItemApi(listing: Listing, token: string, destination?: ShippingDestination): Promise<Listing> {
  try {
    const endUserContext = getBrowseItemEndUserContext(destination);
    const response = await fetchEbay(`${getEbayBrowseItemEndpoint()}/${encodeURIComponent(listing.listingId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': getEbayBrowseMarketplaceId(destination),
        ...(endUserContext ? { 'X-EBAY-C-ENDUSERCTX': endUserContext } : {})
      }
    });
    const json: any = await parseJsonResponse(response);
    if (isBrowseRateLimitError(response, json)) throw new EbayRateLimitError(`eBay rate limit exceeded: ${response.status}`);
    if (!response.ok) return listing;
    const destinationCountry = getDeliveryCountry(destination);
    const destinationPostalCode = getDeliveryPostalCode(destination);
    const shipping = browseShippingOptionWithCost(json?.shippingOptions);
    const shippingCost = parseNumber(shipping?.shippingCost?.value);
    if (shippingCost === undefined) {
      if (destinationCountry && Array.isArray(json?.shippingOptions)) {
        return {
          ...listing,
          ...deriveShippingEligibilityFromOptions(json.shippingOptions, destinationCountry, destinationPostalCode)
        };
      }
      return listing;
    }

    return {
      ...listing,
      shippingCost,
      shippingCurrency: shipping?.shippingCost?.currency ?? listing.currency,
      shippingDestinationCountry: destinationCountry ?? listing.shippingDestinationCountry,
      shippingDestinationPostalCode: destinationPostalCode ?? listing.shippingDestinationPostalCode,
      shippingEligibility: destinationCountry ? 'AVAILABLE' : listing.shippingEligibility,
      shippingEligibilityMessage: destinationCountry
        ? `Shipping shown for ${destinationLabel(destinationCountry, destinationPostalCode)}`
        : listing.shippingEligibilityMessage
    };
  } catch (error) {
    if (isEbayRateLimitError(error)) {
      rememberEbayRateLimit();
      throw error;
    }
    return listing;
  }
}

export async function enrichEbayListingDetails(listing: Listing, destination?: ShippingDestination): Promise<Listing> {
  if (listing.source !== 'EBAY') return listing;
  try {
    const token = await getBrowseAccessToken();
    const browseEnriched = await enrichListingFromBrowseItemApi(listing, token, destination);
    return browseEnriched;
  } catch {
    return listing;
  }
}

function mapFindingItemToListing(item: any, destination?: ShippingDestination): Listing | null {
  const sellingState = findingSellingState(item?.sellingStatus?.[0]?.sellingState?.[0]);
  if (sellingState && sellingState !== 'ENDEDWITHSALES') return null;

  const listingId = item?.itemId?.[0];
  const title = item?.title?.[0];
  const viewItemURL = item?.viewItemURL?.[0];
  const galleryURL = firstNonEmptyString([item?.galleryURL?.[0], item?.galleryPlusPictureURL?.[0]]);
  const currentPrice = item?.sellingStatus?.[0]?.currentPrice?.[0];
  const rawPrice = currentPrice?.__value__;
  const currency = currentPrice?.['@currencyId'] ?? 'USD';
  const seller = item?.sellerInfo?.[0]?.sellerUserName?.[0] ?? item?.sellerInfo?.[0]?.sellerUserName;
  const sellerFeedbackPercent = Number(item?.sellerInfo?.[0]?.positiveFeedbackPercent?.[0]);
  const sellerFeedbackScore = Number(item?.sellerInfo?.[0]?.feedbackScore?.[0]);
  const shippingServiceCost = item?.shippingInfo?.[0]?.shippingServiceCost?.[0];
  const shipToLocations = item?.shippingInfo?.[0]?.shipToLocations;
  const rawShippingCost = shippingServiceCost?.__value__;
  const shippingCurrency = shippingServiceCost?.['@currencyId'] ?? currency;
  const shippingCost = Number(rawShippingCost);
  const postedAt = item?.listingInfo?.[0]?.endTime?.[0] ?? item?.listingInfo?.[0]?.startTime?.[0];
  const rawListingType = item?.listingInfo?.[0]?.listingType?.[0];
  const condition = item?.condition?.[0]?.conditionDisplayName?.[0];
  const countryCode = item?.country?.[0];
  const deliveryCountry = getDeliveryCountry(destination);
  const deliveryPostalCode = getDeliveryPostalCode(destination);
  const shippingEligibility = deriveShippingEligibilityFromShipToLocations(shipToLocations, deliveryCountry, deliveryPostalCode);
  const price = Number(rawPrice);

  if (!listingId || !title || !viewItemURL || Number.isNaN(price)) return null;

  return {
    source: 'EBAY',
    listingId,
    title,
    price,
    currency,
    shippingCost: Number.isNaN(shippingCost) ? undefined : shippingCost,
    shippingCurrency: Number.isNaN(shippingCost) ? undefined : shippingCurrency,
    ...shippingEligibility,
    url: viewItemURL,
    imageUrl: galleryURL || undefined,
    thumbnailUrl: galleryURL || undefined,
    seller,
    sellerFeedbackPercent: Number.isNaN(sellerFeedbackPercent) ? undefined : sellerFeedbackPercent,
    sellerFeedbackScore: Number.isNaN(sellerFeedbackScore) ? undefined : sellerFeedbackScore,
    postedAt,
    region: mapCountryToRegion(countryCode),
    condition,
    listingType: mapFindingListingType(rawListingType)
  } satisfies Listing;
}

export async function searchEbaySoldListings(chase: Chase, destination?: ShippingDestination, options: EbaySoldSearchOptions = {}): Promise<Listing[]> {
  const appId = process.env.EBAY_APP_ID;
  if (!appId) return [];
  const endpoint = getEbayFindingEndpoint();

  const keywords = ebaySoldSearchKeywords(chase, options);
  const pageCount = ebaySoldSearchPageCount(options);
  const allListings: Listing[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const params = new URLSearchParams({
      'OPERATION-NAME': 'findCompletedItems',
      'SERVICE-VERSION': '1.13.0',
      'SECURITY-APPNAME': appId,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': '',
      keywords,
      sortOrder: 'EndTimeSoonest',
      'paginationInput.entriesPerPage': String(ebaySoldSearchLimit()),
      'paginationInput.pageNumber': String(pageNumber)
    });
    params.append('outputSelector', 'SellerInfo');
    params.append('outputSelector', 'StoreInfo');
    params.append('itemFilter(0).name', 'SoldItemsOnly');
    params.append('itemFilter(0).value', 'true');
    const deliveryPostalCode = getDeliveryPostalCode(destination);
    if (deliveryPostalCode) params.append('buyerPostalCode', deliveryPostalCode);

    const response = await fetchEbay(`${endpoint}?${params.toString()}`);
    const json: any = await parseJsonResponse(response);
    if (isFindingRateLimitError(json)) {
      throw new EbayRateLimitError(`eBay rate limit exceeded: ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`eBay sold request failed: ${response.status}`);
    }

    const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];
    const listings = items.map((item: any) => mapFindingItemToListing(item, destination)).filter((listing: Listing | null): listing is Listing => listing !== null);
    allListings.push(...listings);
    if (items.length === 0) break;
  }

  return dedupeListingsById(allListings);
}

export async function searchEbayListings(chase: Chase, destination?: ShippingDestination, options: EbaySearchOptions = {}): Promise<Listing[]> {
  const cacheKey = ebaySearchCacheKey(chase, destination, options);
  const cached = getCachedEbaySearch(cacheKey);
  if (cached) return cached;

  try {
    const listings = await searchEbayBrowseListings(chase, destination, options);
    setCachedEbaySearch(cacheKey, listings);
    return cloneListings(listings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isEbayRateLimitMessage(message)) rememberEbayRateLimit();
    throw error;
  }
}
