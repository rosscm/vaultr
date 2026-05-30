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
    const listings = await searchEbayListings(baseChase(), { country: 'US', postalCode: '90210' });

    expect(listings[0]?.shippingCost).toBe(7.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not send imprecise country-only context that can reduce Browse shipping costs', async () => {
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
    const listings = await searchEbayListings(baseChase(), { country: 'CA' });
    const browseHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(browseHeaders['X-EBAY-C-ENDUSERCTX']).toBeUndefined();
    expect(listings[0]?.shippingCost).toBe(7.5);
    expect(listings[0]?.shippingDestinationCountry).toBeUndefined();
  });

  it('enriches missing Browse shipping with Shopping details using the legacy item id', async () => {
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
          Item: {
            ShippingCostSummary: {
              ShippingServiceCost: { Value: '12.34', CurrencyID: 'USD' }
            }
          }
        })
      );

    const { searchEbayListings } = await import('../ebay.js');
    const listings = await searchEbayListings(baseChase(), { country: 'US', postalCode: '90210' });
    const shoppingUrl = String(fetchMock.mock.calls[2]?.[0]);

    expect(listings[0]?.shippingCost).toBe(12.34);
    expect(listings[0]?.shippingCurrency).toBe('USD');
    expect(shoppingUrl).toContain('GetSingleItem');
    expect(shoppingUrl).toContain('ItemID=1234567890');
  });
});