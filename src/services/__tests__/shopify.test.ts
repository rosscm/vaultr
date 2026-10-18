import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chase } from '../../types.js';

const ORIGINAL_ENV = { ...process.env };

function baseChase(overrides: Partial<Chase> = {}): Chase {
  return {
    id: 'chase-1',
    userId: 'user-1',
    cardName: 'Mew XY Black Star Promos XY192',
    queryName: 'Mew XY192',
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

describe('searchTrustedShopifyListings', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('matches Shopify products using the chase query name rather than only the raw card name', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search/suggest.json')) return jsonResponse({ resources: { results: { products: [] } } });
      if (url.includes('/products.json')) {
        if (!url.includes('page=1')) return jsonResponse({ products: [] });
        return jsonResponse({
          products: [
            {
              id: 1,
              title: 'Mew XY192 Promo Holo',
              handle: 'mew-xy192-promo-holo',
              product_type: 'Singles',
              tags: ['Pokemon'],
              variants: [
                {
                  id: 11,
                  available: true,
                  price: '59.99',
                  option1: 'Near Mint'
                }
              ]
            }
          ]
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListings } = await import('../shopify.js');
    const listings = await searchTrustedShopifyListings(baseChase());

    expect(listings.some((listing) => listing.title.includes('Mew XY192 Promo Holo'))).toBe(true);
  });

  it('accepts clear single-card Shopify products even when the brand signal lives in the title instead of tags', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search/suggest.json')) return jsonResponse({ resources: { results: { products: [] } } });
      if (url.includes('/products.json')) {
        if (!url.includes('page=1')) return jsonResponse({ products: [] });
        return jsonResponse({
          products: [
            {
              id: 2,
              title: 'Pokemon Mew XY192 Promo Holo',
              handle: 'pokemon-mew-xy192-promo-holo',
              product_type: 'Singles',
              tags: [],
              variants: [
                {
                  id: 22,
                  available: true,
                  price: '64.99',
                  option1: 'Near Mint'
                }
              ]
            }
          ]
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListings } = await import('../shopify.js');
    const listings = await searchTrustedShopifyListings(baseChase());

    expect(listings.some((listing) => listing.title.includes('Pokemon Mew XY192 Promo Holo'))).toBe(true);
  });

  it('recognizes observed underscore and colon brand tags without admitting non-singles or unsupported games', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search/suggest.json')) return jsonResponse({ resources: { results: { products: [] } } });
      if (!url.includes('page=1')) return jsonResponse({ products: [] });
      return jsonResponse({
        products: [
          { id: 1, title: 'Mew XY192', handle: 'underscore', tags: ['Type_Single', 'Brand_Pokemon'], variants: [{ id: 11, available: true, price: '10.00' }] },
          { id: 2, title: 'Mew XY192', handle: 'plural', tags: ['Type:Single', 'Brands_Pokemon'], variants: [{ id: 22, available: true, price: '11.00' }] },
          { id: 3, title: 'Mew XY192 Booster Box', handle: 'sealed', tags: ['Brand_Pokemon'], product_type: 'Sealed', variants: [{ id: 33, available: true, price: '12.00' }] },
          { id: 4, title: 'Magic Mew XY192', handle: 'unsupported', tags: ['Type_Single', 'Brand_Magic'], variants: [{ id: 44, available: true, price: '13.00' }] }
        ]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListings } = await import('../shopify.js');
    const listings = await searchTrustedShopifyListings(baseChase());

    expect(listings.map((listing) => listing.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/products/underscore'),
      expect.stringContaining('/products/plural')
    ]));
    expect(listings).toHaveLength(6);
    expect(listings.some((listing) => listing.url.includes('/products/sealed'))).toBe(false);
    expect(listings.some((listing) => listing.url.includes('/products/unsupported'))).toBe(false);
  });

  it('continues beyond page five and reports an exhausted feed separately from bounded truncation', async () => {
    const page = Array.from({ length: 250 }, (_, index) => ({
      id: index + 1,
      title: 'Unrelated Pokemon Single',
      handle: `unrelated-${index + 1}`,
      product_type: 'Single',
      tags: ['Brand:Pokemon'],
      variants: []
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      const requestedPage = Number(url.searchParams.get('page'));
      if (url.hostname.includes('ghostgames')) {
        if (requestedPage <= 5) return jsonResponse({ products: page });
        if (requestedPage === 6) {
          return jsonResponse({ products: [{ id: 2000, title: 'Mew XY192', handle: 'page-six', tags: ['Type_Single', 'Brands:Pokemon'], variants: [{ id: 2001, available: true, price: '19.95' }] }] });
        }
      }
      return jsonResponse({ products: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListingsDetailed } = await import('../shopify.js');
    const result = await searchTrustedShopifyListingsDetailed(baseChase());
    const ghost = result.shops.find((shop) => shop.shop === 'The Ghost Games');

    expect(ghost?.feed).toMatchObject({ coverage: 'EXHAUSTED', pagesFetched: 6, productCount: 1251 });
    expect(result.listings.some((listing) => listing.url.includes('/products/page-six'))).toBe(true);
  });

  it('reports page-budget exhaustion as partial coverage instead of complete inventory', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (!url.hostname.includes('ghostgames')) return jsonResponse({ products: [] });
      const page = Number(url.searchParams.get('page'));
      return jsonResponse({
        products: Array.from({ length: 250 }, (_, index) => ({
          id: page * 1000 + index,
          title: 'Unrelated Pokemon Single',
          handle: `page-${page}-${index}`,
          product_type: 'Single',
          tags: ['Brand_Pokemon'],
          variants: []
        }))
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListingsDetailed } = await import('../shopify.js');
    const result = await searchTrustedShopifyListingsDetailed(baseChase());
    const ghost = result.shops.find((shop) => shop.shop === 'The Ghost Games');

    expect(result.status).toBe('PARTIAL');
    expect(ghost?.feed).toMatchObject({ coverage: 'TRUNCATED', pagesFetched: 20, productCount: 5000 });
  });

  it('shares feed requests across concurrent chases while keeping targeted searches separate', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search/suggest.json')) return jsonResponse({ resources: { results: { products: [] } } });
      return jsonResponse({ products: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListingsDetailed } = await import('../shopify.js');
    await Promise.all([
      searchTrustedShopifyListingsDetailed(baseChase()),
      searchTrustedShopifyListingsDetailed(baseChase({ id: 'chase-2', queryName: 'Pikachu XY95' }))
    ]);

    const feedCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/products.json'));
    const searchCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/search/suggest.json'));
    expect(feedCalls).toHaveLength(3);
    expect(searchCalls).toHaveLength(6);
  });

  it('preserves search, feed, and healthy-store results across independent failures', async () => {
    const product = (id: number, handle: string, price: string, available = true) => ({
      id,
      title: 'Mew XY192',
      handle,
      product_type: 'Single',
      tags: ['Brand_Pokemon'],
      variants: [{ id: id * 10, available, price }]
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname.includes('hobbiesville')) {
        if (url.pathname === '/search/suggest.json') throw new Error('search down');
        return jsonResponse({ products: url.searchParams.get('page') === '1' ? [product(1, 'feed-survives', '15.25'), product(9, 'unavailable', '9.00', false)] : [] });
      }
      if (url.hostname.includes('derpycards')) {
        if (url.pathname === '/products.json') throw new Error('feed down');
        if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [{ id: 2, title: 'Mew XY192', handle: 'search-survives' }] } } });
        return jsonResponse(product(2, 'search-survives', '16.75'));
      }
      throw new Error('store down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchTrustedShopifyListingsDetailed } = await import('../shopify.js');
    const result = await searchTrustedShopifyListingsDetailed(baseChase());

    expect(result.status).toBe('PARTIAL');
    expect(result.listings.map((listing) => listing.price)).toEqual(expect.arrayContaining([15.25, 16.75]));
    expect(result.listings.some((listing) => listing.url.includes('unavailable'))).toBe(false);
    expect(result.shops.map((shop) => shop.status)).toEqual(['PARTIAL', 'PARTIAL', 'FAILURE']);
  });
});

