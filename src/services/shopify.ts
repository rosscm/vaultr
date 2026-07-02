import type { Chase, Listing } from '../types.js';

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
const SHOPIFY_MAX_PAGES = 3;
const SHOPIFY_FETCH_TIMEOUT_MS = 10_000;
// Product feed is cached per store — fetched once per poll cycle, shared across all chases
const SHOPIFY_FEED_CACHE_TTL_MS = 270_000; // 4.5 min, just under the 300s poll interval
const shopifyFeedCache = new Map<string, { products: ShopifyProduct[]; expiresAt: number }>();

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const chaseTokens = toTokens(chase.cardName);
  if (chaseTokens.length === 0) return false;
  if (title.includes(normalize(chase.cardName))) return true;

  const hits = chaseTokens.filter((token) => productTokens.has(token)).length;
  return hits / chaseTokens.length >= 0.7;
}

function isSingleCardProduct(product: ShopifyProduct): boolean {
  const productType = normalize(product.product_type ?? product.type ?? '');
  const tags = (product.tags ?? []).map((tag) => normalize(tag));
  const joined = tags.join(' ');
  const hasSingleSignal =
    productType === 'single' || productType === 'singles' || joined.includes('type single') || joined.includes('type_single') || joined.includes('pokemon single');
  const hasSupportedBrand = /\b(pokemon|onepiece|one piece|bandai)\b/.test(joined);
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

async function fetchProductByHandle(shop: TrustedShopifyShop, handle: string): Promise<ShopifyProduct | null> {
  const url = new URL(shop.productsUrl);
  url.pathname = `/products/${encodeURIComponent(handle)}.js`;
  url.search = '';

  try {
    return await fetchShopifyJson<ShopifyProduct>(url);
  } catch {
    return null;
  }
}

async function searchShopProducts(shop: TrustedShopifyShop, chase: Chase): Promise<ShopifyProduct[]> {
  const url = new URL(shop.productsUrl);
  url.pathname = '/search/suggest.json';
  url.search = '';
  url.searchParams.set('q', chase.queryName?.trim() || chase.cardName);
  url.searchParams.set('resources[type]', 'product');
  url.searchParams.set('resources[limit]', '10');

  let body: ShopifySuggestResponse;
  try {
    body = await fetchShopifyJson<ShopifySuggestResponse>(url);
  } catch {
    return [];
  }
  const suggestions = body.resources?.results?.products ?? [];
  const hydrated = await Promise.all(
    suggestions
      .filter((product) => product.handle && hasChaseTokens(product, chase))
      .map((product) => fetchProductByHandle(shop, product.handle as string))
  );

  return hydrated.filter((product): product is ShopifyProduct => product !== null);
}

async function fetchShopProducts(shop: TrustedShopifyShop): Promise<ShopifyProduct[]> {
  const cached = shopifyFeedCache.get(shop.productsUrl);
  if (cached && Date.now() < cached.expiresAt) return cached.products;

  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= SHOPIFY_MAX_PAGES; page += 1) {
    const url = new URL(shop.productsUrl);
    url.searchParams.set('limit', String(SHOPIFY_PAGE_LIMIT));
    url.searchParams.set('page', String(page));

    const body = await fetchShopifyJson<ShopifyProductsResponse>(url);
    const pageProducts = Array.isArray(body.products) ? body.products : [];
    if (pageProducts.length === 0) break;
    products.push(...pageProducts);
    if (pageProducts.length < SHOPIFY_PAGE_LIMIT) break;
  }

  shopifyFeedCache.set(shop.productsUrl, { products, expiresAt: Date.now() + SHOPIFY_FEED_CACHE_TTL_MS });
  return products;
}

export async function searchTrustedShopifyListings(chase: Chase): Promise<Listing[]> {
  const listings: Listing[] = [];
  const seenListingIds = new Set<string>();

  for (const shop of TRUSTED_SHOPIFY_SHOPS) {
    let products: ShopifyProduct[] = [];
    try {
      const [searchedProducts, feedProducts] = await Promise.all([searchShopProducts(shop, chase), fetchShopProducts(shop)]);
      const productsById = new Map<number, ShopifyProduct>();
      for (const product of [...feedProducts, ...searchedProducts]) {
        productsById.set(product.id, product);
      }
      products = [...productsById.values()];
    } catch (error) {
      console.error(`Trusted Shopify source ${shop.name} failed`, error);
      continue;
    }

    for (const product of products) {
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
  }

  return listings;
}