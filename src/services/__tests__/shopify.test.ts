import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chase } from '../../types.js';
import { db } from '../db.js';
import {
  commitTrustedShopCatalogBatch,
  countTrustedShopCatalogProducts,
  ensureTrustedShopCatalogState,
  findTrustedShopCatalogCandidates,
  getTrustedShopCatalogState
} from '../trusted-shop-catalog.js';
import {
  advanceTrustedShopifyCatalogCoverage,
  searchTrustedShopifyListings,
  searchTrustedShopifyListingsDetailed
} from '../shopify.js';

function baseChase(overrides: Partial<Chase> = {}): Chase {
  return {
    id: 'chase-1', userId: 'user-1', cardName: 'Mew XY Black Star Promos XY192',
    queryName: 'Mew XY192', createdAt: new Date().toISOString(), ...overrides
  };
}

function product(id: number, handle: string, overrides: Record<string, unknown> = {}) {
  return {
    id, title: 'Mew XY192 Promo Holo', handle, product_type: 'Singles', tags: ['Brand_Pokemon'],
    variants: [{ id: id * 10, available: true, price: '59.99', option1: 'Near Mint' }], ...overrides
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function clearCatalog(): void {
  db.prepare('DELETE FROM trusted_shop_catalog_products').run();
  db.prepare('DELETE FROM trusted_shop_catalog_state').run();
}

describe('progressive trusted Shopify catalog coverage', () => {
  beforeEach(clearCatalog);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances beyond page 20 across bounded batches and recovers products outside the old window', async () => {
    const requestedGhostPages: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (url.pathname.endsWith('/deep-mew.js')) return jsonResponse(product(99_999, 'deep-mew'));
      if (url.pathname !== '/products.json') throw new Error(`Unexpected fetch ${url}`);
      if (!url.hostname.includes('ghostgames')) return jsonResponse({ products: [] });
      const page = Number(url.searchParams.get('page'));
      requestedGhostPages.push(page);
      if (page <= 21) {
        return jsonResponse({
          products: Array.from({ length: 250 }, (_, index) => product(page * 1000 + index, `page-${page}-${index}`, {
            title: `Unrelated Pokemon Single ${page}-${index}`
          }))
        });
      }
      return jsonResponse({ products: [product(99_999, 'deep-mew')] });
    }));

    for (let batch = 0; batch < 5; batch += 1) await advanceTrustedShopifyCatalogCoverage({ force: true });

    expect(requestedGhostPages).toContain(21);
    expect(requestedGhostPages).toContain(22);
    expect(getTrustedShopCatalogState('theghostgames')).toMatchObject({ coverageStatus: 'COMPLETE_OBSERVED', lastCompletedPages: 22 });
    expect(countTrustedShopCatalogProducts('theghostgames')).toBe(5_251);
    expect((await searchTrustedShopifyListings(baseChase())).some((listing) => listing.url.includes('/products/deep-mew'))).toBe(true);
  });

  it('resumes the persisted cursor and deduplicates concurrent scan requests', async () => {
    const pageCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/products.json') return jsonResponse({ resources: { results: { products: [] } } });
      pageCalls.push(`${url.hostname}:${url.searchParams.get('page')}`);
      const page = Number(url.searchParams.get('page'));
      return jsonResponse({ products: Array.from({ length: 250 }, (_, index) => product(page * 1000 + index, `${url.hostname}-${page}-${index}`)) });
    }));

    await Promise.all([
      advanceTrustedShopifyCatalogCoverage({ force: true }),
      advanceTrustedShopifyCatalogCoverage({ force: true })
    ]);
    expect(pageCalls).toHaveLength(15);
    expect(getTrustedShopCatalogState('hobbiesville')?.nextPage).toBe(6);

    pageCalls.length = 0;
    await advanceTrustedShopifyCatalogCoverage({ force: true });
    expect(pageCalls).toContain('hobbiesville.com:6');
    expect(getTrustedShopCatalogState('hobbiesville')?.nextPage).toBe(11);
  });

  it('retains completed pages after an interrupted batch and retries from the failed page', async () => {
    let failPageTwo = true;
    const requested: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== '/products.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (!url.hostname.includes('hobbiesville')) return jsonResponse({ products: [] });
      const page = Number(url.searchParams.get('page'));
      requested.push(page);
      if (page === 1) return jsonResponse({ products: Array.from({ length: 250 }, (_, index) => product(index + 1, `kept-${index}`)) });
      if (page === 2 && failPageTwo) throw new Error('temporary feed failure');
      return jsonResponse({ products: [] });
    }));

    await advanceTrustedShopifyCatalogCoverage({ force: true });
    expect(getTrustedShopCatalogState('hobbiesville')).toMatchObject({ coverageStatus: 'INTERRUPTED', nextPage: 2, pagesScanned: 1, retryCount: 1 });
    expect(countTrustedShopCatalogProducts('hobbiesville')).toBe(250);

    failPageTwo = false;
    await advanceTrustedShopifyCatalogCoverage({ force: true });
    expect(requested.filter((page) => page === 1)).toHaveLength(1);
    expect(requested.filter((page) => page === 2)).toHaveLength(2);
    expect(getTrustedShopCatalogState('hobbiesville')?.coverageStatus).toBe('COMPLETE_OBSERVED');
  });

  it('reconciles products only after a completed later sweep', () => {
    const first = ensureTrustedShopCatalogState('hobbiesville');
    commitTrustedShopCatalogBatch({
      shopSlug: 'hobbiesville', sweepId: first.sweepId, startPage: 1, pagesFetched: 1,
      products: [product(1, 'still-here'), product(2, 'removed-later')], exhausted: true
    });
    expect(countTrustedShopCatalogProducts('hobbiesville')).toBe(2);

    const second = getTrustedShopCatalogState('hobbiesville')!;
    commitTrustedShopCatalogBatch({
      shopSlug: 'hobbiesville', sweepId: second.sweepId, startPage: 1, pagesFetched: 1,
      products: [product(1, 'still-here')], exhausted: true
    });
    expect(countTrustedShopCatalogProducts('hobbiesville')).toBe(1);
    expect(findTrustedShopCatalogCandidates('hobbiesville', 'removed-later')).toEqual([]);
  });

  it('ranks indexed candidates across all Chase tokens instead of requiring the first token', () => {
    const state = ensureTrustedShopCatalogState('hobbiesville');
    commitTrustedShopCatalogBatch({
      shopSlug: 'hobbiesville', sweepId: state.sweepId, startPage: 1, pagesFetched: 1,
      products: [product(6001, 'multi-token', { title: 'Shining Mew Promo 151' })], exhausted: true
    });

    expect(findTrustedShopCatalogCandidates('hobbiesville', 'CoroCoro Shining Mew 151')).toEqual([
      expect.objectContaining({ id: 6001 })
    ]);
  });

  it('rejects stale unavailable variants and tombstones products removed from the current endpoint', async () => {
    const state = ensureTrustedShopCatalogState('hobbiesville');
    commitTrustedShopCatalogBatch({
      shopSlug: 'hobbiesville', sweepId: state.sweepId, startPage: 1, pagesFetched: 1,
      products: [product(7001, 'stale-available'), product(7002, 'removed-product')], exhausted: true
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (url.pathname.endsWith('/stale-available.js')) {
        return jsonResponse(product(7001, 'stale-available', { variants: [{ id: 70010, available: false, price: '59.99' }] }));
      }
      if (url.pathname.endsWith('/removed-product.js')) return jsonResponse({}, false, 404);
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await searchTrustedShopifyListingsDetailed(baseChase());
    expect(result.listings).toEqual([]);
    expect(result.shops.find((shop) => shop.shop === 'Hobbiesville')?.revalidation).toMatchObject({
      candidatesChecked: 2,
      current: 1,
      unavailable: 1,
      failures: 0
    });
    expect(getTrustedShopCatalogState('hobbiesville')).toMatchObject({ revalidationSuccesses: 1, revalidationUnavailable: 1 });
    expect(countTrustedShopCatalogProducts('hobbiesville')).toBe(1);
  });

  it('bounds and shares candidate hydration across concurrent Chase searches', async () => {
    const state = ensureTrustedShopCatalogState('hobbiesville');
    commitTrustedShopCatalogBatch({
      shopSlug: 'hobbiesville', sweepId: state.sweepId, startPage: 1, pagesFetched: 1,
      products: Array.from({ length: 20 }, (_, index) => product(8000 + index, `bounded-${index}`)), exhausted: true
    });
    let active = 0;
    let maxActive = 0;
    const detailCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (url.pathname.endsWith('.js')) {
        detailCalls.push(url.pathname);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        const index = Number(url.pathname.match(/bounded-(\d+)/)?.[1] ?? 0);
        return jsonResponse(product(8000 + index, `bounded-${index}`));
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    await Promise.all([
      searchTrustedShopifyListingsDetailed(baseChase()),
      searchTrustedShopifyListingsDetailed(baseChase({ id: 'chase-2' }))
    ]);
    expect(new Set(detailCalls).size).toBe(12);
    expect(detailCalls).toHaveLength(12);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('keeps bounded targeted search supplementary when catalog coverage has no candidate', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') {
        if (url.hostname.includes('derpycards')) {
          return jsonResponse({ resources: { results: { products: [product(8500, 'targeted-only', { variants: [] })] } } });
        }
        if (url.hostname.includes('ghostgames')) throw new Error('targeted search unavailable');
        return jsonResponse({ resources: { results: { products: [] } } });
      }
      if (url.pathname.endsWith('/targeted-only.js')) return jsonResponse(product(8500, 'targeted-only'));
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await searchTrustedShopifyListingsDetailed(baseChase());
    expect(result.listings.some((listing) => listing.url.includes('/products/targeted-only'))).toBe(true);
    expect(result.shops.find((shop) => shop.shop === 'DerpyCards')?.status).toBe('SUCCESS');
    expect(result.shops.find((shop) => shop.shop === 'The Ghost Games')?.status).toBe('PARTIAL');
    expect(result.status).toBe('PARTIAL');
  });

  it('preserves classification, price normalization, and healthy provider outcomes during an incomplete sweep', async () => {
    const state = ensureTrustedShopCatalogState('theghostgames');
    commitTrustedShopCatalogBatch({
      shopSlug: 'theghostgames', sweepId: state.sweepId, startPage: 1, pagesFetched: 1,
      products: [product(9001, 'underscore', { product_type: '', tags: ['Type_Single', 'Brand_Pokemon'], variants: [{ id: 90010, available: true, price: 2599 }] })],
      exhausted: false
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/search/suggest.json') return jsonResponse({ resources: { results: { products: [] } } });
      if (url.pathname.endsWith('/underscore.js')) {
        return jsonResponse(product(9001, 'underscore', { product_type: '', tags: ['Type_Single', 'Brand_Pokemon'], variants: [{ id: 90010, available: true, price: 2599 }] }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const result = await searchTrustedShopifyListingsDetailed(baseChase());
    const ghost = result.shops.find((shop) => shop.shop === 'The Ghost Games');
    expect(result.status).toBe('SUCCESS');
    expect(result.listings).toEqual(expect.arrayContaining([expect.objectContaining({ price: 25.99, listingId: 'shopify-theghostgames-9001-90010' })]));
    expect(ghost?.feed).toMatchObject({ coverage: 'IN_PROGRESS', nextPage: 2, fromCache: true });
  });
});
