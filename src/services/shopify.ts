import type { Chase, Listing } from '../types.js';
import { buildEbaySearchKeywords } from './ebay.js';
import {
  commitTrustedShopCatalogBatch,
  countTrustedShopCatalogProducts,
  ensureTrustedShopCatalogState,
  failTrustedShopCatalogBatch,
  findTrustedShopCatalogCandidates,
  getTrustedShopCatalogState,
  limitTrustedShopCatalogCoverage,
  listTrustedShopCatalogStates,
  markTrustedShopCatalogProductUnavailable,
  recordTrustedShopRevalidation,
  trustedShopCatalogBatchDue,
  type TrustedShopCatalogState
} from './trusted-shop-catalog.js';

type TrustedShopifyShop = {
  slug: string;
  name: string;
  productsUrl: string;
  currency: string;
  region: Listing['region'];
};

type ShopifyVariant = {
  id: number;
  title?: string | null;
  option1?: string | null;
  available?: boolean;
  price?: string | number | null;
  updated_at?: string | null;
};

type ShopifyImage = {
  src?: string | null;
};

type ShopifyProduct = {
  id: number;
  title?: string | null;
  handle?: string | null;
  product_type?: string | null;
  type?: string | null;
  tags?: string[];
  variants?: ShopifyVariant[];
  images?: Array<ShopifyImage | string>;
  featured_image?: string | ShopifyImage | null;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
};

type ShopifyProductsResponse = {
  products?: ShopifyProduct[];
};

type ShopifySuggestResponse = {
  resources?: {
    results?: {
      products?: ShopifyProduct[];
    };
  };
};

const TRUSTED_SHOPIFY_SHOPS: TrustedShopifyShop[] = [
  {
    slug: 'hobbiesville',
    name: 'Hobbiesville',
    productsUrl: 'https://hobbiesville.com/products.json',
    currency: 'CAD',
    region: 'CA'
  },
  {
    slug: 'derpycards',
    name: 'DerpyCards',
    productsUrl: 'https://derpycards.ca/products.json',
    currency: 'CAD',
    region: 'CA'
  },
  {
    slug: 'theghostgames',
    name: 'The Ghost Games',
    productsUrl: 'https://www.theghostgames.ca/products.json',
    currency: 'CAD',
    region: 'CA'
  }
];

export function listTrustedShopifyShopNames(): string[] {
  return TRUSTED_SHOPIFY_SHOPS.map((shop) => shop.name);
}

const SHOPIFY_PAGE_LIMIT = 250;
const SHOPIFY_SCAN_BATCH_PAGES = 5;
const SHOPIFY_SCAN_BATCH_TIME_BUDGET_MS = 12_000;
const SHOPIFY_FETCH_TIMEOUT_MS = 10_000;
const SHOPIFY_SUGGEST_LIMIT = 10;
const SHOPIFY_CANDIDATE_LIMIT = 12;
const SHOPIFY_CANDIDATE_HYDRATION_CONCURRENCY = 3;
const SHOPIFY_PRODUCT_CACHE_TTL_MS = 60_000;
const SHOPIFY_CATALOG_WORK_INTERVAL_MS = 60_000;

export type ShopifyCoverage = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE_OBSERVED' | 'INTERRUPTED' | 'LIMITED_PROVIDER_BOUNDARY';
export type ShopifyOperationStatus = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

export type TrustedShopifyShopResult = {
  shop: string;
  listings: Listing[];
  status: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  feed: {
    status: ShopifyOperationStatus;
    coverage: ShopifyCoverage;
    productCount: number;
    pagesFetched: number;
    fromCache: boolean;
    nextPage: number;
    lastSuccessfulBatchAt?: string;
    lastCompletedSweepAt?: string;
    nextRunAt: string;
    retryCount: number;
    error?: string;
  };
  search: {
    status: ShopifyOperationStatus;
    productCount: number;
    error?: string;
  };
  revalidation: {
    candidatesChecked: number;
    current: number;
    unavailable: number;
    failures: number;
    durationMs: number;
    lastRevalidationAt?: string;
    totalCurrent: number;
    totalUnavailable: number;
    totalFailures: number;
  };
};

export type TrustedShopifySearchResult = {
  listings: Listing[];
  status: 'SUCCESS' | 'EMPTY' | 'PARTIAL' | 'FAILURE';
  shops: TrustedShopifyShopResult[];
};

const shopifyScanRequests = new Map<string, Promise<TrustedShopCatalogState>>();
const shopifyProductCache = new Map<string, { product: ShopifyProduct | null; expiresAt: number }>();
const shopifyProductRequests = new Map<string, Promise<CurrentProductResult>>();
let trustedShopCatalogWorkerStarted = false;
const loggedCatalogStates = new Map<string, { fingerprint: string; loggedAt: number }>();

class ShopifyHttpError extends Error {
  constructor(readonly status: number) {
    super(`Shopify request failed: ${status}`);
    this.name = 'ShopifyHttpError';
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMetadata(text: string): string {
  return normalize(text.replace(/[_:]+/g, ' '));
}

function toTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasChaseTokens(product: ShopifyProduct, chase: Chase): boolean {
  const title = normalize(product.title ?? '');
  const productTokens = new Set(toTokens(product.title ?? ''));
  const chaseNeedle = chase.queryName?.trim() || buildEbaySearchKeywords(chase);
  const chaseTokens = toTokens(chaseNeedle);
  if (chaseTokens.length === 0) return false;
  if (title.includes(normalize(chaseNeedle))) return true;

  const hits = chaseTokens.filter((token) => productTokens.has(token)).length;
  return hits / chaseTokens.length >= 0.7;
}

function isSingleCardProduct(product: ShopifyProduct): boolean {
  const productType = normalize(product.product_type ?? product.type ?? '');
  const title = normalize(product.title ?? '');
  const tags = (product.tags ?? []).map((tag) => normalizeMetadata(tag));
  const joined = tags.join(' ');
  const hasSingleSignal =
    productType === 'single' || productType === 'singles' || joined.includes('type single') || joined.includes('pokemon single');
  const hasSupportedBrand = /\b(pokemon|onepiece|one piece|bandai)\b/.test(`${joined} ${productType} ${title}`);
  return hasSingleSignal && hasSupportedBrand;
}

function normalizeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function imageUrlFromProduct(product: ShopifyProduct): string | undefined {
  const firstImage = product.images?.[0];
  if (typeof firstImage === 'string') return normalizeImageUrl(firstImage);
  if (firstImage?.src) return normalizeImageUrl(firstImage.src);
  if (typeof product.featured_image === 'string') return normalizeImageUrl(product.featured_image);
  return normalizeImageUrl(product.featured_image?.src ?? undefined);
}

function variantPrice(variant: ShopifyVariant): number {
  if (typeof variant.price === 'number') return variant.price / 100;
  return Number(variant.price);
}

function productUrl(shop: TrustedShopifyShop, product: ShopifyProduct, variant: ShopifyVariant): string {
  const base = new URL(shop.productsUrl);
  const handle = product.handle ?? String(product.id);
  return `${base.origin}/products/${encodeURIComponent(handle)}?variant=${variant.id}`;
}

function conditionFromVariant(variant: ShopifyVariant): string | undefined {
  const condition = variant.option1 ?? variant.title ?? undefined;
  return condition ? `Raw ${condition}` : 'Raw';
}

async function fetchShopifyJson<T>(url: URL): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Vaultr trusted shop monitor'
      }
    });
    if (!response.ok) throw new ShopifyHttpError(response.status);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVariantListing(shop: TrustedShopifyShop, product: ShopifyProduct, variant: ShopifyVariant): Listing | null {
  if (!product.title || !product.handle || !variant.available) return null;
  const price = variantPrice(variant);
  if (!Number.isFinite(price) || price <= 0) return null;
  const imageUrl = imageUrlFromProduct(product);
  const variantCondition = variant.option1 ?? variant.title ?? undefined;
  const title = variantCondition ? `${product.title} (${variantCondition})` : product.title;

  return {
    source: 'SHOPIFY',
    listingId: `shopify-${shop.slug}-${product.id}-${variant.id}`,
    title,
    price,
    currency: shop.currency,
    url: productUrl(shop, product, variant),
    imageUrl,
    thumbnailUrl: imageUrl,
    seller: shop.name,
    postedAt: variant.updated_at ?? product.updated_at ?? product.published_at ?? product.created_at ?? undefined,
    region: shop.region,
    condition: conditionFromVariant(variant),
    listingType: 'BUY_IT_NOW'
  };
}

type CurrentProductResult = {
  product: ShopifyProduct | null;
  status: 'SUCCESS' | 'UNAVAILABLE' | 'FAILURE';
  fromCache: boolean;
  error?: string;
};

async function fetchProductByHandle(shop: TrustedShopifyShop, handle: string): Promise<ShopifyProduct> {
  const url = new URL(shop.productsUrl);
  url.pathname = `/products/${encodeURIComponent(handle)}.js`;
  url.search = '';

  return fetchShopifyJson<ShopifyProduct>(url);
}

async function fetchCurrentProduct(shop: TrustedShopifyShop, handle: string): Promise<CurrentProductResult> {
  const key = `${shop.slug}:${handle}`;
  const cached = shopifyProductCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { product: cached.product, status: cached.product ? 'SUCCESS' : 'UNAVAILABLE', fromCache: true };
  }
  const inFlight = shopifyProductRequests.get(key);
  if (inFlight) return inFlight;

  const request = fetchProductByHandle(shop, handle)
    .then((product): CurrentProductResult => {
      shopifyProductCache.set(key, { product, expiresAt: Date.now() + SHOPIFY_PRODUCT_CACHE_TTL_MS });
      return { product, status: 'SUCCESS', fromCache: false };
    })
    .catch((error: unknown): CurrentProductResult => {
      const message = error instanceof Error ? error.message : String(error);
      if (/\b404\b/.test(message)) {
        shopifyProductCache.set(key, { product: null, expiresAt: Date.now() + SHOPIFY_PRODUCT_CACHE_TTL_MS });
        return { product: null, status: 'UNAVAILABLE', fromCache: false };
      }
      return { product: null, status: 'FAILURE', fromCache: false, error: message };
    });
  shopifyProductRequests.set(key, request);
  try {
    return await request;
  } finally {
    shopifyProductRequests.delete(key);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

type CurrentProductsResult = {
  products: ShopifyProduct[];
  successes: number;
  unavailable: number;
  failures: number;
  error?: string;
};

async function hydrateCurrentProducts(shop: TrustedShopifyShop, products: ShopifyProduct[]): Promise<CurrentProductsResult> {
  const unique = [...new Map(products.filter((product) => product.handle).map((product) => [product.handle as string, product])).values()]
    .slice(0, SHOPIFY_CANDIDATE_LIMIT);
  const results = await mapWithConcurrency(unique, SHOPIFY_CANDIDATE_HYDRATION_CONCURRENCY, (product) => fetchCurrentProduct(shop, product.handle as string));
  const hydrated = results.flatMap((result) => (result.product ? [result.product] : []));
  const successes = results.filter((result) => result.status === 'SUCCESS').length;
  const unavailable = results.filter((result) => result.status === 'UNAVAILABLE').length;
  const failures = results.filter((result) => result.status === 'FAILURE').length;
  return {
    products: hydrated,
    successes,
    unavailable,
    failures,
    error: failures > 0 ? `${failures} current product request(s) failed` : undefined
  };
}

async function searchShopProducts(shop: TrustedShopifyShop, chase: Chase): Promise<CurrentProductsResult> {
  const url = new URL(shop.productsUrl);
  url.pathname = '/search/suggest.json';
  url.search = '';
  url.searchParams.set('q', chase.queryName?.trim() || chase.cardName);
  url.searchParams.set('resources[type]', 'product');
  url.searchParams.set('resources[limit]', String(SHOPIFY_SUGGEST_LIMIT));

  try {
    const body = await fetchShopifyJson<ShopifySuggestResponse>(url);
    const suggestions = body.resources?.results?.products ?? [];
    return hydrateCurrentProducts(shop, suggestions.filter((product) => product.handle && hasChaseTokens(product, chase)));
  } catch (error) {
    return { products: [], successes: 0, unavailable: 0, failures: 1, error: error instanceof Error ? error.message : String(error) };
  }
}

async function scanTrustedShopCatalogBatch(shop: TrustedShopifyShop, force = false): Promise<TrustedShopCatalogState> {
  const initial = ensureTrustedShopCatalogState(shop.slug);
  if (!force && !trustedShopCatalogBatchDue(initial)) return initial;
  const inFlight = shopifyScanRequests.get(shop.slug);
  if (inFlight) return inFlight;

  const request = (async () => {
    const state = getTrustedShopCatalogState(shop.slug) ?? initial;
    const startedAt = Date.now();
    const products: ShopifyProduct[] = [];
    let pagesFetched = 0;
    let exhausted = false;
    let failure: string | undefined;

    for (let offset = 0; offset < SHOPIFY_SCAN_BATCH_PAGES; offset += 1) {
      if (Date.now() - startedAt >= SHOPIFY_SCAN_BATCH_TIME_BUDGET_MS) break;
      const url = new URL(shop.productsUrl);
      url.searchParams.set('limit', String(SHOPIFY_PAGE_LIMIT));
      url.searchParams.set('page', String(state.nextPage + offset));
      try {
        const body = await fetchShopifyJson<ShopifyProductsResponse>(url);
        pagesFetched += 1;
        const pageProducts = Array.isArray(body.products) ? body.products : [];
        products.push(...pageProducts);
        if (pageProducts.length < SHOPIFY_PAGE_LIMIT) {
          exhausted = true;
          break;
        }
      } catch (error) {
        const requestedPage = state.nextPage + offset;
        if (error instanceof ShopifyHttpError && error.status === 400 && requestedPage >= 101 && state.pagesScanned >= 100) {
          return limitTrustedShopCatalogCoverage({
            shopSlug: shop.slug,
            reason: 'Provider rejects products pagination beyond page 100 (HTTP 400); indexed coverage retained'
          });
        }
        failure = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    let updated = state;
    if (pagesFetched > 0) {
      updated = commitTrustedShopCatalogBatch({
        shopSlug: shop.slug,
        sweepId: state.sweepId,
        startPage: state.nextPage,
        pagesFetched,
        products,
        exhausted
      });
    }
    if (failure) return failTrustedShopCatalogBatch({ shopSlug: shop.slug, error: failure });
    if (pagesFetched === 0) return failTrustedShopCatalogBatch({ shopSlug: shop.slug, error: 'Catalog batch ended before a page completed' });
    return updated;
  })();
  shopifyScanRequests.set(shop.slug, request);
  try {
    return await request;
  } finally {
    shopifyScanRequests.delete(shop.slug);
  }
}

export async function advanceTrustedShopifyCatalogCoverage(options: { force?: boolean } = {}): Promise<TrustedShopCatalogState[]> {
  return Promise.all(TRUSTED_SHOPIFY_SHOPS.map((shop) => scanTrustedShopCatalogBatch(shop, options.force)));
}

export function trustedShopifyCatalogHealth(): TrustedShopCatalogState[] {
  return listTrustedShopCatalogStates();
}

export function startTrustedShopifyCatalogWorker(): void {
  if (trustedShopCatalogWorkerStarted) return;
  trustedShopCatalogWorkerStarted = true;
  const run = () => {
    void advanceTrustedShopifyCatalogCoverage()
      .then((states) => {
        for (const state of states) {
          const fingerprint = [state.coverageStatus, state.nextPage, state.pagesScanned, state.productsSeen, state.retryCount, state.lastError ?? ''].join('|');
          const prior = loggedCatalogStates.get(state.shopSlug);
          const now = Date.now();
          if (prior?.fingerprint === fingerprint && now - prior.loggedAt < 15 * 60_000) continue;
          loggedCatalogStates.set(state.shopSlug, { fingerprint, loggedAt: now });
          console.info(
            `[Trusted shops catalog] shop=${state.shopSlug} coverage=${state.coverageStatus} ` +
            `nextPage=${state.nextPage} pages=${state.pagesScanned} products=${state.productsSeen} ` +
            `lastProgress=${state.lastSuccessfulBatchAt ?? 'never'} nextRun=${state.coverageStatus === 'LIMITED_PROVIDER_BOUNDARY' ? 'none' : state.nextRunAt} ` +
            `failures=${state.retryCount} reason=${state.lastError ?? 'none'}`
          );
        }
      })
      .catch((error) => {
        console.error('[Trusted shops catalog] background batch failed', error);
      });
  };
  setInterval(run, SHOPIFY_CATALOG_WORK_INTERVAL_MS);
  run();
}

async function indexedShopProducts(shop: TrustedShopifyShop, chase: Chase): Promise<CurrentProductsResult> {
  const searchText = chase.queryName?.trim() || buildEbaySearchKeywords(chase);
  const indexed = findTrustedShopCatalogCandidates(shop.slug, searchText, SHOPIFY_CANDIDATE_LIMIT * 8)
    .filter((product) => isSingleCardProduct(product as ShopifyProduct) && hasChaseTokens(product as ShopifyProduct, chase))
    .slice(0, SHOPIFY_CANDIDATE_LIMIT) as ShopifyProduct[];
  const result = await hydrateCurrentProducts(shop, indexed);
  for (const product of indexed) {
    if (!product.handle) continue;
    const hydrated = result.products.some((current) => current.id === product.id);
    if (!hydrated && result.unavailable > 0) {
      const cached = shopifyProductCache.get(`${shop.slug}:${product.handle}`);
      if (cached?.product === null) markTrustedShopCatalogProductUnavailable(shop.slug, product.id);
    }
  }
  return result;
}

async function searchTrustedShop(shop: TrustedShopifyShop, chase: Chase): Promise<TrustedShopifyShopResult> {
  const startedAt = Date.now();
  const [searchResult, indexedResult] = await Promise.all([searchShopProducts(shop, chase), indexedShopProducts(shop, chase)]);
  const productsById = new Map<number, ShopifyProduct>();
  for (const product of [...indexedResult.products, ...searchResult.products]) productsById.set(product.id, product);
  const revalidation = {
    successes: searchResult.successes + indexedResult.successes,
    unavailable: searchResult.unavailable + indexedResult.unavailable,
    failures: searchResult.failures + indexedResult.failures
  };
  if (revalidation.successes + revalidation.unavailable + revalidation.failures > 0) {
    recordTrustedShopRevalidation({ shopSlug: shop.slug, ...revalidation });
  }
  const state = ensureTrustedShopCatalogState(shop.slug);
  const listings: Listing[] = [];
  const seenListingIds = new Set<string>();

  for (const product of productsById.values()) {
    if (!isSingleCardProduct(product)) continue;
    if (!hasChaseTokens(product, chase)) continue;

    for (const variant of product.variants ?? []) {
      const listing = normalizeVariantListing(shop, product, variant);
      if (listing && !seenListingIds.has(listing.listingId)) {
        seenListingIds.add(listing.listingId);
        listings.push(listing);
      }
    }
  }

  const indexedStatus: ShopifyOperationStatus = indexedResult.error
    ? indexedResult.products.length > 0 ? 'PARTIAL' : 'FAILURE'
    : 'SUCCESS';
  const searchStatus: ShopifyOperationStatus = searchResult.error
    ? searchResult.products.length > 0 ? 'PARTIAL' : 'FAILURE'
    : 'SUCCESS';
  const failedCompletely = indexedStatus === 'FAILURE' && searchStatus === 'FAILURE';
  return {
    shop: shop.name,
    listings,
    status: failedCompletely ? 'FAILURE' : indexedStatus !== 'SUCCESS' || searchStatus !== 'SUCCESS' ? 'PARTIAL' : 'SUCCESS',
    feed: {
      status: state.coverageStatus === 'INTERRUPTED' || state.coverageStatus === 'LIMITED_PROVIDER_BOUNDARY' ? 'PARTIAL' : 'SUCCESS',
      coverage: state.coverageStatus,
      productCount: countTrustedShopCatalogProducts(shop.slug),
      pagesFetched: state.pagesScanned,
      fromCache: true,
      nextPage: state.nextPage,
      lastSuccessfulBatchAt: state.lastSuccessfulBatchAt,
      lastCompletedSweepAt: state.lastCompletedSweepAt,
      nextRunAt: state.nextRunAt,
      retryCount: state.retryCount,
      error: state.lastError
    },
    search: {
      status: searchStatus,
      productCount: searchResult.products.length,
      error: searchResult.error
    },
    revalidation: {
      candidatesChecked: revalidation.successes + revalidation.unavailable + revalidation.failures,
      current: revalidation.successes,
      unavailable: revalidation.unavailable,
      failures: revalidation.failures,
      durationMs: Date.now() - startedAt,
      lastRevalidationAt: state.lastRevalidationAt,
      totalCurrent: state.revalidationSuccesses,
      totalUnavailable: state.revalidationUnavailable,
      totalFailures: state.revalidationFailures
    }
  };
}

export async function searchTrustedShopifyListingsDetailed(chase: Chase): Promise<TrustedShopifySearchResult> {
  const shops = await Promise.all(TRUSTED_SHOPIFY_SHOPS.map((shop) => searchTrustedShop(shop, chase)));
  const listings = shops.flatMap((shop) => shop.listings);
  const successes = shops.filter((shop) => shop.status !== 'FAILURE').length;
  const status = successes === 0 ? 'FAILURE' : successes < shops.length || shops.some((shop) => shop.status === 'PARTIAL') ? 'PARTIAL' : listings.length === 0 ? 'EMPTY' : 'SUCCESS';
  return { listings, status, shops };
}

export async function searchTrustedShopifyListings(chase: Chase): Promise<Listing[]> {
  return (await searchTrustedShopifyListingsDetailed(chase)).listings;
}
