import type { Chase, Listing } from '../types.js';

const EBAY_FINDING_ENDPOINT_PROD = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_FINDING_ENDPOINT_SANDBOX = 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1';

function getEbayFindingEndpoint(): string {
  const env = (process.env.EBAY_ENV ?? 'PRODUCTION').toUpperCase();
  return env === 'SANDBOX' ? EBAY_FINDING_ENDPOINT_SANDBOX : EBAY_FINDING_ENDPOINT_PROD;
}

function mapCountryToRegion(countryCode?: string): 'CA' | 'US' | 'OTHER' {
  if (!countryCode) return 'OTHER';
  if (countryCode === 'CA') return 'CA';
  if (countryCode === 'US') return 'US';
  return 'OTHER';
}

function mapListingType(raw?: string): 'AUCTION' | 'BUY_IT_NOW' | 'OTHER' {
  const t = (raw ?? '').toLowerCase();
  if (t === 'auction') return 'AUCTION';
  if (t === 'fixedprice' || t === 'storeinventory') return 'BUY_IT_NOW';
  return 'OTHER';
}

export async function searchEbayListings(chase: Chase): Promise<Listing[]> {
  const appId = process.env.EBAY_APP_ID;
  if (!appId) return [];
  const endpoint = getEbayFindingEndpoint();

  const keywords = chase.grade ? `${chase.cardName} ${chase.grade}` : chase.cardName;

  const params = new URLSearchParams({
    'OPERATION-NAME': 'findItemsByKeywords',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords,
    'paginationInput.entriesPerPage': '10',
    'sortOrder': 'StartTimeNewest'
  });
  params.append('outputSelector', 'SellerInfo');
  params.append('outputSelector', 'StoreInfo');

  const response = await fetch(`${endpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`eBay request failed: ${response.status}`);
  }

  const json: any = await response.json();
  const items = json?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item ?? [];

  return items
    .map((item: any) => {
      const listingId = item?.itemId?.[0];
      const title = item?.title?.[0];
      const viewItemURL = item?.viewItemURL?.[0];
      const currentPrice = item?.sellingStatus?.[0]?.currentPrice?.[0];
      const rawPrice = currentPrice?.__value__;
      const currency = currentPrice?.['@currencyId'] ?? 'USD';
      const seller = item?.sellerInfo?.[0]?.sellerUserName?.[0] ?? item?.sellerInfo?.[0]?.sellerUserName;
      const sellerFeedbackPercent = Number(item?.sellerInfo?.[0]?.positiveFeedbackPercent?.[0]);
      const sellerFeedbackScore = Number(item?.sellerInfo?.[0]?.feedbackScore?.[0]);
      const shippingServiceCost = item?.shippingInfo?.[0]?.shippingServiceCost?.[0];
      const rawShippingCost = shippingServiceCost?.__value__;
      const shippingCurrency = shippingServiceCost?.['@currencyId'] ?? currency;
      const shippingCost = Number(rawShippingCost);
      const postedAt = item?.listingInfo?.[0]?.startTime?.[0];
      const rawListingType = item?.listingInfo?.[0]?.listingType?.[0];
      const condition = item?.condition?.[0]?.conditionDisplayName?.[0];
      const countryCode = item?.country?.[0];
      const price = Number(rawPrice);

      if (!listingId || !title || !viewItemURL || Number.isNaN(price)) return null;

      const listing: Listing = {
        source: 'EBAY',
        listingId,
        title,
        price,
        currency,
        shippingCost: Number.isNaN(shippingCost) ? undefined : shippingCost,
        shippingCurrency: Number.isNaN(shippingCost) ? undefined : shippingCurrency,
        url: viewItemURL,
        seller,
        sellerFeedbackPercent: Number.isNaN(sellerFeedbackPercent) ? undefined : sellerFeedbackPercent,
        sellerFeedbackScore: Number.isNaN(sellerFeedbackScore) ? undefined : sellerFeedbackScore,
        postedAt,
        region: mapCountryToRegion(countryCode),
        condition,
        listingType: mapListingType(rawListingType)
      };

      return listing;
    })
    .filter((listing: Listing | null): listing is Listing => listing !== null);
}
