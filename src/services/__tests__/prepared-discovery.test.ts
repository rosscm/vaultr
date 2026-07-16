import { afterEach, describe, expect, it } from 'vitest';
import { addChase, removeAllChases, setUserAlertSettings, setUserPlan, upsertUserDiscoveryState } from '../chase-store.js';
import { deleteDiscoveryMarketCache, discoveryMarketCacheKey, upsertDiscoveryMarketCache } from '../discovery-market-cache.js';
import { deleteDiscoveryReferenceCache, discoveryReferenceCacheKey, upsertDiscoveryReferenceCache } from '../discovery-reference-cache.js';
import { getPreparedDiscoveryShelf, preparedDiscoveryStateKey } from '../prepared-discovery.js';

const cacheKeys: string[] = [];
const referenceKeys: string[] = [];
const userIds: string[] = [];

afterEach(() => {
  for (const cacheKey of cacheKeys.splice(0)) deleteDiscoveryMarketCache(cacheKey);
  for (const referenceKey of referenceKeys.splice(0)) deleteDiscoveryReferenceCache(referenceKey);
  for (const userId of userIds.splice(0)) removeAllChases(userId);
});

describe('prepared discovery shelf', () => {
  it('reads an existing persisted shelf with prepared market and image data', () => {
    const userId = `prepared-user-${Date.now()}`;
    userIds.push(userId);
    setUserPlan(userId, 'PRO');
    setUserAlertSettings(userId, { alertCurrency: 'CAD', shippingCountry: 'CA', shippingPostalCode: 'M5V 2T6' });
    addChase({ userId, cardName: 'Mew ex Paldean Fates 232', priority: 'GRAIL', maxPrice: 500 });

    const mode = preparedDiscoveryStateKey('PRO', 7);
    upsertUserDiscoveryState({
      userId,
      mode,
      profileFingerprint: 'fingerprint-1',
      suggestionNames: ['Mew ex Paldean Fates 232', 'Articuno Skyridge H3']
    });

    const marketKey = discoveryMarketCacheKey('Mew ex Paldean Fates 232', 'CAD', 'CA', undefined, { min: 0, max: 500 });
    cacheKeys.push(marketKey);
    upsertDiscoveryMarketCache({
      cacheKey: marketKey,
      suggestionName: 'Mew ex Paldean Fates 232',
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: {
        source: 'EBAY',
        listingId: 'listing-1',
        title: 'Mew ex Paldean Fates 232 Pokemon card',
        price: 95,
        currency: 'CAD',
        url: 'https://example.com/mew',
        imageUrl: 'https://example.com/listing.jpg',
        region: 'CA',
        listingType: 'BUY_IT_NOW'
      },
      typicalRawAskingTotal: 95,
      marketSampleSize: 4,
      typicalRawSoldTotal: 88,
      soldSampleSize: 3,
      fetchedAt: '2026-06-10T00:00:00.000Z'
    });

    const referenceKey = discoveryReferenceCacheKey('Mew ex Paldean Fates 232');
    referenceKeys.push(referenceKey);
    upsertDiscoveryReferenceCache({
      cacheKey: referenceKey,
      suggestionName: 'Mew ex Paldean Fates 232',
      imageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      sourceName: 'Pokemon TCG API',
      sourceCardId: 'sv4pt5-232'
    });

    const shelf = getPreparedDiscoveryShelf(userId);

    expect(shelf?.mode).toBe(mode);
    expect(shelf?.planTier).toBe('PRO');
    expect(shelf?.currency).toBe('CAD');
    expect(shelf?.marketReadyCount).toBe(1);
    expect(shelf?.imageReadyCount).toBe(1);
    expect(shelf?.items[0]).toMatchObject({
      position: 1,
      name: 'Mew ex Paldean Fates 232',
      imageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      imageSourceKind: 'CARD_REFERENCE',
      market: {
        status: 'READY',
        currency: 'CAD',
        askingTotal: 95,
        soldTotal: 88
      }
    });
    expect(shelf?.items[1].market.status).toBe('MISSING');
  });

  it('does not use marketplace images as the prepared shelf image fallback and treats listing-only rows as thin', () => {
    const userId = `prepared-thin-${Date.now()}`;
    userIds.push(userId);
    setUserPlan(userId, 'PRO');
    setUserAlertSettings(userId, { alertCurrency: 'CAD', shippingCountry: 'CA' });
    addChase({ userId, cardName: 'Zapdos ex Scarlet & Violet Black Star Promos 49', priority: 'HIGH', maxPrice: 500 });

    const mode = preparedDiscoveryStateKey('PRO', 7);
    upsertUserDiscoveryState({
      userId,
      mode,
      profileFingerprint: 'fingerprint-thin',
      suggestionNames: ['Zapdos ex Scarlet & Violet Black Star Promos 49']
    });

    const marketKey = discoveryMarketCacheKey('Zapdos ex Scarlet & Violet Black Star Promos 49', 'CAD', 'CA', undefined, { min: 0, max: 500 });
    cacheKeys.push(marketKey);
    upsertDiscoveryMarketCache({
      cacheKey: marketKey,
      suggestionName: 'Zapdos ex Scarlet & Violet Black Star Promos 49',
      displayCurrency: 'CAD',
      destinationCountry: 'CA',
      listing: {
        source: 'EBAY',
        listingId: 'listing-thin',
        title: 'Zapdos ex Scarlet & Violet Black Star Promos 49 Pokemon card',
        price: 41,
        currency: 'CAD',
        url: 'https://example.com/zapdos-thin',
        imageUrl: 'https://example.com/zapdos-listing.jpg',
        region: 'CA',
        listingType: 'BUY_IT_NOW'
      },
      fetchedAt: '2026-06-10T00:00:00.000Z'
    });

    const shelf = getPreparedDiscoveryShelf(userId);

    expect(shelf?.items[0]?.imageUrl).toBeUndefined();
    expect(shelf?.items[0]?.market.status).toBe('THIN');
  });
});
