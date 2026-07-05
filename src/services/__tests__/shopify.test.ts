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
});

