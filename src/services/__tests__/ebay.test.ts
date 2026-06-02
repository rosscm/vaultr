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

describe('searchEbayListings Browse shipping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    process.env = {
      ...ORIGINAL_ENV,
      EBAY_SEARCH_API: 'BROWSE',
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

  it('uses Browse item details for country-only destination shipping instead of Browse search defaults', async () => {
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

    expect(browseHeaders['X-EBAY-C-ENDUSERCTX']).toBeUndefined();
    expect(itemDetailsUrl).toContain('/buy/browse/v1/item/v1%7C1234567890%7C0');
    expect(itemDetailsHeaders['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country=CA');
    expect(listings[0]?.shippingCost).toBe(18.5);
    expect(listings[0]?.shippingCurrency).toBe('CAD');
    expect(listings[0]?.shippingDestinationCountry).toBe('CA');
  });

  it('falls back to Shopping details using the legacy item id when Browse item details has no shipping', async () => {
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
              itemLocation: { country: 'US' },
              buyingOptions: ['FIXED_PRICE']
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          shippingOptions: []
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          Item: {
            ShippingCostSummary: {
              ShippingServiceCost: { Value: '12.34', CurrencyID: 'USD' }
            }
          }
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings(baseChase(), { country: 'US', postalCode: '90210' });
    const itemDetailsHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    const shoppingUrl = String(fetchMock.mock.calls[3]?.[0]);

    expect(listings[0]?.shippingCost).toBe(12.34);
    expect(listings[0]?.shippingCurrency).toBe('USD');
    expect(itemDetailsHeaders['X-EBAY-C-ENDUSERCTX']).toBe('contextualLocation=country=US,zip=90210');
    expect(shoppingUrl).toContain('GetSingleItem');
    expect(shoppingUrl).toContain('ItemID=1234567890');
    expect(shoppingUrl).toContain('DestinationCountryCode=US');
    expect(shoppingUrl).toContain('DestinationPostalCode=90210');
  });

  it('does not call Finding fallback after Browse returns a rate limit', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'rate limit exceeded' }] }, false, 429));

    const { searchEbayListings } = await import('../ebay.js');
    await expect(searchEbayListings(baseChase())).rejects.toThrow(/rate limit/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
});