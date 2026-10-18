import type { Chase, Listing } from '../types.js';
import { buildEbaySearchKeywords } from './ebay.js';

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
const SHOPIFY_MAX_PAGES = 20;
const SHOPIFY_FEED_TIME_BUDGET_MS = 20_000;
const SHOPIFY_FETCH_TIMEOUT_MS = 10_000;
const SHOPIFY_SUGGEST_LIMIT = 10;
// Product feed is cached per store — fetched once per poll cycle, shared across all chases
const SHOPIFY_FEED_CACHE_TTL_MS = 270_000; // 4.5 min, just under the 300s poll interval
const SHOPIFY_PARTIAL_CACHE_TTL_MS = 30_000;

export type ShopifyCoverage = 'EXHAUSTED' | 'TRUNCATED' | 'INTERRUPTED';
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
    error?: string;
  };
  search: {
    status: ShopifyOperationStatus;
    productCount: number;
    error?: string;
  };
};

export type TrustedShopifySearchResult = {
  listings: Listing[];
  status: 'SUCCESS' | 'EMPTY' | 'PARTIAL' | 'FAILURE';
  shops: TrustedShopifyShopResult[];
};

type ShopifyFeedResult = {
  products: ShopifyProduct[];
  coverage: ShopifyCoverage;
  pagesFetched: number;
  fromCache: boolean;
  error?: string;
};

const shopifyFeedCache = new Map<string, { result: ShopifyFeedResult; expiresAt: number }>();
const shopifyFeedRequests = new Map<string, Promise<ShopifyFeedResult>>();

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
    if (!response.ok) throw new Error(`Shopify request failed: ${response.status}`);
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

async function fetchProductByHandle(shop: TrustedShopifyShop, handle: string): Promise<ShopifyProduct> {
  const url = new URL(shop.productsUrl);
  url.pathname = `/products/${encodeURIComponent(handle)}.js`;
  url.search = '';

  return fetchShopifyJson<ShopifyProduct>(url);
}

async function searchShopProducts(shop: TrustedShopifyShop, chase: Chase): Promise<{ products: ShopifyProduct[]; error?: string }> {
  const url = new URL(shop.productsUrl);
  url.pathname = '/search/suggest.json';
  url.search = '';
  url.searchParams.set('q', chase.queryName?.trim() || chase.cardName);
  url.searchParams.set('resources[type]', 'product');
  url.searchParams.set('resources[limit]', String(SHOPIFY_SUGGEST_LIMIT));

  try {
    const body = await fetchShopifyJson<ShopifySuggestResponse>(url);
    const suggestions = body.resources?.results?.products ?? [];
    const hydrated = await Promise.allSettled(
      suggestions
        .filter((product) => product.handle && hasChaseTokens(product, chase))
        .map((product) => fetchProductByHandle(shop, product.handle as string))
    );
    const products = hydrated.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failedHydrations = hydrated.length - products.length;
    return {
      products,
      error: failedHydrations > 0 ? `${failedHydrations} targeted product hydration request(s) failed` : undefined
    };
  } catch (error) {
    return { products: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchShopProductsUncached(shop: TrustedShopifyShop): Promise<ShopifyFeedResult> {
  const startedAt = Date.now();
  const products: ShopifyProduct[] = [];
  let pagesFetched = 0;

  try {
    for (let page = 1; page <= SHOPIFY_MAX_PAGES; page += 1) {
      if (Date.now() - startedAt >= SHOPIFY_FEED_TIME_BUDGET_MS) {
        return { products, coverage: 'TRUNCATED', pagesFetched, fromCache: false, error: 'Feed time budget exhausted' };
      }
      const url = new URL(shop.productsUrl);
      url.searchParams.set('limit', String(SHOPIFY_PAGE_LIMIT));
      url.searchParams.set('page', String(page));

      const body = await fetchShopifyJson<ShopifyProductsResponse>(url);
      pagesFetched += 1;
      const pageProducts = Array.isArray(body.products) ? body.products : [];
      products.push(...pageProducts);
      if (pageProducts.length < SHOPIFY_PAGE_LIMIT) {
        return { products, coverage: 'EXHAUSTED', pagesFetched, fromCache: false };
      }
    }
    return { products, coverage: 'TRUNCATED', pagesFetched, fromCache: false, error: 'Feed page budget exhausted' };
  } catch (error) {
    return {
      products,
      coverage: 'INTERRUPTED',
      pagesFetched,
      fromCache: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchShopProducts(shop: TrustedShopifyShop): Promise<ShopifyFeedResult> {
  const cached = shopifyFeedCache.get(shop.productsUrl);
  if (cached && Date.now() < cached.expiresAt) return { ...cached.result, fromCache: true };
  const inFlight = shopifyFeedRequests.get(shop.productsUrl);
  if (inFlight) return { ...(await inFlight), fromCache: true };

  const request = fetchShopProductsUncached(shop);
  shopifyFeedRequests.set(shop.productsUrl, request);
  try {
    const result = await request;
    const ttl = result.coverage === 'EXHAUSTED' ? SHOPIFY_FEED_CACHE_TTL_MS : SHOPIFY_PARTIAL_CACHE_TTL_MS;
    shopifyFeedCache.set(shop.productsUrl, { result, expiresAt: Date.now() + ttl });
    return result;
  } finally {
    shopifyFeedRequests.delete(shop.productsUrl);
  }
}

async function searchTrustedShop(shop: TrustedShopifyShop, chase: Chase): Promise<TrustedShopifyShopResult> {
  const [searchResult, feedResult] = await Promise.all([searchShopProducts(shop, chase), fetchShopProducts(shop)]);
  const productsById = new Map<number, ShopifyProduct>();
  for (const product of [...feedResult.products, ...searchResult.products]) productsById.set(product.id, product);
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

  const feedStatus: ShopifyOperationStatus =
    feedResult.coverage === 'EXHAUSTED' ? 'SUCCESS' : feedResult.products.length > 0 ? 'PARTIAL' : 'FAILURE';
  const searchStatus: ShopifyOperationStatus = searchResult.error
    ? searchResult.products.length > 0 ? 'PARTIAL' : 'FAILURE'
    : 'SUCCESS';
  const failedCompletely = feedStatus === 'FAILURE' && searchStatus === 'FAILURE';
  return {
    shop: shop.name,
    listings,
    status: failedCompletely ? 'FAILURE' : feedStatus !== 'SUCCESS' || searchStatus !== 'SUCCESS' ? 'PARTIAL' : 'SUCCESS',
    feed: {
      status: feedStatus,
      coverage: feedResult.coverage,
      productCount: feedResult.products.length,
      pagesFetched: feedResult.pagesFetched,
      fromCache: feedResult.fromCache,
      error: feedResult.error
    },
    search: {
      status: searchStatus,
      productCount: searchResult.products.length,
      error: searchResult.error
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
