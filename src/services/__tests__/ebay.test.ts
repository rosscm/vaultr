import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chase } from '../../types.js';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

function baseChase(): Chase {
  return {
    id: 'chase-1',
    userId: 'user-1',
    cardName: 'Umbreon VMAX',
    createdAt: new Date().toISOString()
  };
}

describe('buildEbaySearchKeywords', () => {
  it('keeps slash-number spacing for EX cards while compacting known promo series numbers', async () => {
    const { buildEbaySearchKeywords } = await import('../ebay.js');

    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Mega Gardevoir Ex 178/132' })).toBe('Mega Gardevoir Ex 178/132');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Charizard EX 101/108' })).toBe('Charizard EX 101/108');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Pikachu XY Black Star Promos XY95' })).toBe('Pikachu XY95');
  });

  it('keeps Japanese specificity for Japanese chases', async () => {
    const { buildEbaySearchKeywords } = await import('../ebay.js');

    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Mew Japanese 347/190' })).toBe('Mew Japanese 347/190');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Squirtle Japanese Promo 007/018' })).toBe('Squirtle Japanese 007/018');
  });

  it('refines source-backed Japanese chase numbers with release identity', async () => {
    const { buildEbaySearchKeywords } = await import('../ebay.js');

    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Gardevoir Japanese 087/063' })).toBe('Mega Gardevoir ex 087/063 M1S Japanese');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063' })).toBe('Mega Gardevoir ex 087/063 M1S Japanese');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Umbreon Japanese 217/187' })).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Umbreon EX 217/187' })).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
  });

  it('keeps CoroCoro Mew searches specific enough for the old-back promo', async () => {
    const { buildEbaySearchKeywords } = await import('../ebay.js');

    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Mew CoroCoro Promo 151' })).toBe('CoroCoro Shining Mew');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'CoroCoro Shining Mew' })).toBe('CoroCoro Shining Mew');
  });

  it('keeps retailer and publication release signals while dropping generic promo words', async () => {
    const { buildEbaySearchKeywords } = await import('../ebay.js');

    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Pikachu 26/83 Toys R Us promo' })).toBe('Pikachu 26/83 Toys R Us');
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: "Squirtle Japanese McDonald's Promo 007/018" })).toBe("Squirtle Japanese McDonald's 007/018");
    expect(buildEbaySearchKeywords({ ...baseChase(), cardName: 'Charmander Pokemon Center Promo 004/SV-P' })).toBe('Charmander Pokemon Center 004/SV-P');
  });
});

describe('searchEbayListings Browse shipping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      ...ORIGINAL_ENV,
      EBAY_CLIENT_ID: 'client-id',
      EBAY_CLIENT_SECRET: 'client-secret',
      EBAY_APP_ID: 'app-id',
      EBAY_SEARCH_LIMIT: '1'
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses a later Browse shipping option when the first option has no cost', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|1234567890|0',
              title: 'Umbreon VMAX Alt Art',
              itemWebUrl: 'https://example.com/item/1234567890',
              price: { value: '100.00', currency: 'USD' },
              shippingOptions: [{}, { shippingCost: { value: '7.50', currency: 'USD' } }],
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings(baseChase());

    expect(listings[0]?.shippingCost).toBe(7.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the destination marketplace and context for country-only destination searches', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|1234567890|0',
              title: 'Umbreon VMAX Alt Art',
              itemWebUrl: 'https://example.com/item/1234567890',
              price: { value: '100.00', currency: 'USD' },
              shippingOptions: [{ shippingCost: { value: '7.50', currency: 'USD' } }],
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: [
            {
              shippingCost: { value: '18.50', currency: 'CAD' },
              shippingServiceCode: 'eBay International Shipping'
            }
          ]
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings(baseChase(), { country: 'CA' });
    const browseHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const itemDetailsUrl = String(fetchMock.mock.calls[2]?.[0]);
    const itemDetailsHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;

    expect(browseHeaders['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_CA');
    expect(browseHeaders['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country=CA');
    expect(itemDetailsUrl).toContain('/buy/browse/v1/item/v1%7C1234567890%7C0');
    expect(itemDetailsHeaders['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country=CA');
    expect(listings[0]?.shippingCost).toBe(18.5);
    expect(listings[0]?.shippingCurrency).toBe('CAD');
    expect(listings[0]?.shippingDestinationCountry).toBe('CA');
  });

  it('marks destination shipping as unavailable when Browse item details has no shipping options', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: []
        })
      );

    const { enrichEbayListingDetails } = await import('../ebay.js');
    const listing = await enrichEbayListingDetails({
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US',
      listingType: 'BUY_IT_NOW'
    }, { country: 'CA' });

    expect(listing.shippingCost).toBeUndefined();
    expect(listing.shippingEligibility).toBe('MAY_NOT_SHIP');
    expect(listing.shippingEligibilityMessage).toBe('May not ship to CA');
  });

  it('does not treat non-priced Browse shipping options as confirmed destination shipping', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: [
            {
              shippingCostType: 'CALCULATED'
            }
          ]
        })
      );

    const { enrichEbayListingDetails } = await import('../ebay.js');
    const listing = await enrichEbayListingDetails({
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US',
      listingType: 'BUY_IT_NOW'
    }, { country: 'CA' });

    expect(listing.shippingCost).toBeUndefined();
    expect(listing.shippingEligibility).toBe('UNKNOWN');
    expect(listing.shippingEligibilityMessage).toBe('Shipping availability to CA is unknown');
  });

  it('does not call a legacy fallback after Browse returns a rate limit', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'rate limit exceeded' }] }, false, 429));

    const { searchEbayListings } = await import('../ebay.js');
    await expect(searchEbayListings(baseChase())).rejects.toThrow(/rate limit/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds a max price filter to Browse searches when alert options include a ceiling', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|317978401186|0',
              title: 'Umbreon ex SAR 217/187 Terastal Festival sv8a 2024 Pokemon Card Japanese',
              itemWebUrl: 'https://example.com/item/317978401186',
              price: { value: '536.37', currency: 'CAD' },
              shippingOptions: [{ shippingCost: { value: '0.00', currency: 'CAD' } }],
              itemLocation: { country: 'CA' },
              condition: 'Ungraded',
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings({ ...baseChase(), cardName: 'Umbreon 217/187', maxPrice: 550 }, { country: 'CA' }, {
      enrichMissingShipping: false,
      maxPrice: 550,
      maxPriceCurrency: 'CAD'
    });
    const url = String(fetchMock.mock.calls[1]?.[0]);
    const browseHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(decodeURIComponent(url)).toContain('filter=price:[..550.00],priceCurrency:CAD');
    expect(browseHeaders['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_CA');
    expect(listings[0]?.listingId).toBe('v1|317978401186|0');
  });

  it('caps Browse search result windows even when env asks for more', async () => {
    process.env.EBAY_SEARCH_LIMIT = '500';
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ itemSummaries: [] }));

    const { searchEbayListings } = await import('../ebay.js');
    await searchEbayListings(baseChase(), undefined, { enrichMissingShipping: false });
    const url = String(fetchMock.mock.calls[1]?.[0]);

    expect(url).toContain('limit=50');
  });

  it('caps per-search Browse item detail enrichment to avoid request amplification', async () => {
    process.env.EBAY_SEARCH_LIMIT = '3';
    process.env.EBAY_MAX_ENRICH_ITEMS_PER_SEARCH = '1';
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|1111111111|0',
              title: 'Umbreon VMAX Alt Art One',
              itemWebUrl: 'https://example.com/item/1111111111',
              price: { value: '100.00', currency: 'USD' },
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            },
            {
              itemId: 'v1|2222222222|0',
              title: 'Umbreon VMAX Alt Art Two',
              itemWebUrl: 'https://example.com/item/2222222222',
              price: { value: '120.00', currency: 'USD' },
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ shippingOptions: [{ shippingCost: { value: '9.25', currency: 'CAD' } }] }));

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings(baseChase(), { country: 'CA' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(listings[0]?.shippingCost).toBe(9.25);
    expect(listings[1]?.shippingCost).toBeUndefined();
  });

  it('reuses recent successful eBay searches from cache', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|1234567890|0',
              title: 'Umbreon VMAX Alt Art',
              itemWebUrl: 'https://example.com/item/1234567890',
              price: { value: '100.00', currency: 'USD' },
              shippingOptions: [{ shippingCost: { value: '7.50', currency: 'USD' } }],
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const first = await searchEbayListings(baseChase());
    first[0]!.title = 'Mutated locally';
    const second = await searchEbayListings(baseChase());

    expect(second[0]?.title).toBe('Umbreon VMAX Alt Art');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not collide cache keys when card names contain the delimiter character', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|1111111111|0',
              title: 'Umbreon Pipe VMAX',
              itemWebUrl: 'https://example.com/item/1111111111',
              price: { value: '100.00', currency: 'USD' },
              shippingOptions: [{ shippingCost: { value: '7.50', currency: 'USD' } }],
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: 'v1|2222222222|0',
              title: 'Umbreon Graded VMAX',
              itemWebUrl: 'https://example.com/item/2222222222',
              price: { value: '120.00', currency: 'USD' },
              shippingOptions: [{ shippingCost: { value: '8.50', currency: 'USD' } }],
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const first = await searchEbayListings({ ...baseChase(), cardName: 'Umbreon|VMAX' });
    const second = await searchEbayListings({ ...baseChase(), cardName: 'Umbreon', grade: 'VMAX' });

    expect(first[0]?.listingId).toBe('v1|1111111111|0');
    expect(second[0]?.listingId).toBe('v1|2222222222|0');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('enriches a selected alert listing without enriching the whole search window', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: [
            {
              shippingCost: { value: '9.25', currency: 'USD' }
            }
          ]
        })
      );

    const { enrichEbayListingDetails } = await import('../ebay.js');
    const listing = await enrichEbayListingDetails({
      source: 'EBAY',
      listingId: 'v1|1234567890|0',
      title: 'Umbreon VMAX Alt Art',
      price: 100,
      currency: 'USD',
      url: 'https://example.com/item/1234567890',
      region: 'US',
      listingType: 'BUY_IT_NOW'
    }, { country: 'US' });

    const itemDetailsUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(itemDetailsUrl).toContain('/buy/browse/v1/item/v1%7C1234567890%7C0');
    expect(listing.shippingCost).toBe(9.25);
    expect(listing.shippingCurrency).toBe('USD');
    expect(listing.shippingDestinationCountry).toBe('US');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('searchEbaySoldListings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      ...ORIGINAL_ENV,
      EBAY_APP_ID: 'app-id',
      EBAY_SEARCH_LIMIT: '2'
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses completed sold items from the Finding API', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        findCompletedItemsResponse: [
          {
            searchResult: [
              {
                item: [
                  {
                    itemId: ['1234567890'],
                    title: ['Umbreon VMAX Alt Art Raw'],
                    viewItemURL: ['https://example.com/sold/1234567890'],
                    galleryURL: ['https://example.com/sold.jpg'],
                    sellingStatus: [{ currentPrice: [{ __value__: '210.00', '@currencyId': 'USD' }], sellingState: ['EndedWithSales'] }],
                    shippingInfo: [{ shippingServiceCost: [{ __value__: '8.00', '@currencyId': 'USD' }], shipToLocations: ['Worldwide'] }],
                    listingInfo: [{ listingType: ['FixedPrice'], endTime: ['2026-06-01T00:00:00.000Z'] }],
                    country: ['US']
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    const { searchEbaySoldListings } = await import('../ebay.js');
    const listings = await searchEbaySoldListings(baseChase(), { country: 'CA' });
    const url = String(fetchMock.mock.calls[0]?.[0]);

    expect(url).toContain('OPERATION-NAME=findCompletedItems');
    expect(url).toContain('itemFilter%280%29.name=SoldItemsOnly');
    expect(url).toContain('itemFilter%280%29.value=true');
    expect(listings[0]?.price).toBe(210);
    expect(listings[0]?.shippingCost).toBe(8);
    expect(listings[0]?.listingType).toBe('BUY_IT_NOW');
  });

  it('caps sold search page sizes even when env asks for more', async () => {
    process.env.EBAY_SOLD_SEARCH_LIMIT = '500';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        findCompletedItemsResponse: [{ searchResult: [{ item: [] }] }]
      })
    );

    const { searchEbaySoldListings } = await import('../ebay.js');
    await searchEbaySoldListings(baseChase());
    const url = String(fetchMock.mock.calls[0]?.[0]);

    expect(url).toContain('paginationInput.entriesPerPage=50');
  });

  it('can collect multiple recent completed pages with an override keyword and dedupe repeats', async () => {
    const fetchMock = vi.mocked(fetch);
    const soldItem = (id: string, title: string, price: string) => ({
      itemId: [id],
      title: [title],
      viewItemURL: [`https://example.com/sold/${id}`],
      sellingStatus: [{ currentPrice: [{ __value__: price, '@currencyId': 'USD' }], sellingState: ['EndedWithSales'] }],
      shippingInfo: [{ shippingServiceCost: [{ __value__: '0.00', '@currencyId': 'USD' }], shipToLocations: ['Worldwide'] }],
      listingInfo: [{ listingType: ['FixedPrice'], endTime: ['2026-06-01T00:00:00.000Z'] }],
      country: ['US']
    });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          findCompletedItemsResponse: [{ searchResult: [{ item: [soldItem('123', 'Mew ex Paldean Fates 232', '900.00')] }] }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          findCompletedItemsResponse: [{ searchResult: [{ item: [soldItem('123', 'Mew ex Paldean Fates 232 duplicate', '900.00'), soldItem('456', 'Mew ex Paldean Fates 232 NM', '875.00')] }] }]
        })
      );

    const { searchEbaySoldListings } = await import('../ebay.js');
    const listings = await searchEbaySoldListings(baseChase(), undefined, { keywords: 'Mew ex Paldean Fates 232', pageCount: 2 });
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);

    expect(firstUrl).toContain('keywords=Mew+ex+Paldean+Fates+232');
    expect(firstUrl).toContain('sortOrder=EndTimeSoonest');
    expect(firstUrl).toContain('paginationInput.pageNumber=1');
    expect(secondUrl).toContain('paginationInput.pageNumber=2');
    expect(listings.map((listing) => listing.listingId)).toEqual(['123', '456']);
  });
});