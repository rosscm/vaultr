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

  const response = await fetch(`${endpoint}?${params.toString()}`);
  if (!response.ok) return [];

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
      const seller = item?.sellerInfo?.[0]?.sellerUserName?.[0];
      const sellerFeedbackPercent = Number(item?.sellerInfo?.[0]?.positiveFeedbackPercent?.[0]);
      const postedAt = item?.listingInfo?.[0]?.startTime?.[0];
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
        url: viewItemURL,
        seller,
        sellerFeedbackPercent: Number.isNaN(sellerFeedbackPercent) ? undefined : sellerFeedbackPercent,
        postedAt,
        region: mapCountryToRegion(countryCode),
        condition
      };

      return listing;
    })
    .filter((listing: Listing | null): listing is Listing => listing !== null);
}
