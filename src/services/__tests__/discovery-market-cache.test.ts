import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteDiscoveryMarketCache,
  discoveryMarketCacheKey,
  getDiscoveryMarketCache,
  listingFromDiscoveryMarketCache,
  upsertDiscoveryMarketCache
} from '../discovery-market-cache.js';

const testKey = `test|${Date.now()}|cache`;
const cacheKey = discoveryMarketCacheKey(testKey, 'CAD', 'CA');

afterEach(() => {
  deleteDiscoveryMarketCache(cacheKey);
});

describe('discovery market cache', () => {
  it('uses country-level cache keys so postal regions do not fragment market reads', () => {
    expect(discoveryMarketCacheKey('Mew Southern Islands Promo', 'CAD', 'CA', 'M5V 2T6')).toBe(
      discoveryMarketCacheKey('Mew Southern Islands Promo', 'CAD', 'CA')
    );
  });

  it('keeps user price ranges separate in market cache keys', () => {
    const uncapped = discoveryMarketCacheKey('Mew Southern Islands Promo', 'CAD', 'CA');
    const budget = discoveryMarketCacheKey('Mew Southern Islands Promo', 'CAD', 'CA', undefined, { min: 0, max: 100 });
    const biggerBudget = discoveryMarketCacheKey('Mew Southern Islands Promo', 'CAD', 'CA', undefined, { min: 0, max: 300 });

    expect(budget).not.toBe(uncapped);
    expect(budget).not.toBe(biggerBudget);
  });

  it('does not collide cache keys when suggestion names contain delimiter characters', () => {
    expect(discoveryMarketCacheKey('Mew|CAD', 'CAD', 'CA')).not.toBe(discoveryMarketCacheKey('Mew', 'CAD', 'CAD|CA'));
  });

  it('round-trips cached listing and market data', () => {
    upsertDiscoveryMarketCache({
      cacheKey,
      suggestionName: testKey,
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: {
        source: 'EBAY',
        listingId: 'cache-listing-1',
        title: 'Mew Southern Islands Pokemon',
        price: 42,
        currency: 'CAD',
        url: 'https://www.ebay.example/item/cache-listing-1',
        imageUrl: 'https://i.ebayimg.example/mew.jpg',
        region: 'OTHER',
        listingType: 'BUY_IT_NOW'
      },
      typicalRawAskingTotal: 42,
      marketSampleSize: 3,
      typicalRawSoldTotal: 37,
      soldSampleSize: 4
    });

    const entry = getDiscoveryMarketCache(cacheKey);
    expect(entry?.suggestionName).toBe(testKey);
    expect(entry?.typicalRawAskingTotal).toBe(42);
    expect(entry?.marketSampleSize).toBe(3);
    expect(entry?.typicalRawSoldTotal).toBe(37);
    expect(entry?.soldSampleSize).toBe(4);
    expect(entry?.imageUrl).toBe('https://i.ebayimg.example/mew.jpg');

    const listing = listingFromDiscoveryMarketCache(entry!);
    expect(listing?.listingId).toBe('cache-listing-1');
    expect(listing?.url).toBe('https://www.ebay.example/item/cache-listing-1');
  });
});
