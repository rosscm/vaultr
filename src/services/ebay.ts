import type { Chase, Listing } from '../types.js';

const EBAY_FINDING_ENDPOINT_PROD = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_FINDING_ENDPOINT_SANDBOX = 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1';
const EBAY_SHOPPING_ENDPOINT_PROD = 'https://open.api.ebay.com/shopping';
const EBAY_SHOPPING_ENDPOINT_SANDBOX = 'https://open.api.sandbox.ebay.com/shopping';

function getEbayFindingEndpoint(): string {
  const env = (process.env.EBAY_ENV ?? 'PRODUCTION').toUpperCase();
  return env === 'SANDBOX' ? EBAY_FINDING_ENDPOINT_SANDBOX : EBAY_FINDING_ENDPOINT_PROD;
}

function getEbayShoppingEndpoint(): string {
  const env = (process.env.EBAY_ENV ?? 'PRODUCTION').toUpperCase();
  return env === 'SANDBOX' ? EBAY_SHOPPING_ENDPOINT_SANDBOX : EBAY_SHOPPING_ENDPOINT_PROD;
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

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function collectFindingErrors(json: any): any[] {
  const messages = json?.errorMessage;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => (Array.isArray(message?.error) ? message.error : []));
}

function isFindingRateLimitError(json: any): boolean {
  return collectFindingErrors(json).some((error) => {
    const ids = Array.isArray(error?.errorId) ? error.errorId : [];
    const domain = Array.isArray(error?.domain) ? error.domain.join(' ') : '';
    const subdomain = Array.isArray(error?.subdomain) ? error.subdomain.join(' ') : '';
    const message = Array.isArray(error?.message) ? error.message.join(' ') : '';
    return (
      ids.includes('10001') ||
      /ratelimiter/i.test(`${domain} ${subdomain}`) ||
      /exceeded the number of times/i.test(message)
    );
  });
}

async function parseJsonResponse(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function enrichListingFromShoppingApi(listing: Listing, appId: string): Promise<Listing> {
  const endpoint = getEbayShoppingEndpoint();
  const params = new URLSearchParams({
    callname: 'GetSingleItem',
    responseencoding: 'JSON',
    appid: appId,
    version: '967',
    siteid: '0',
    ItemID: listing.listingId,
    IncludeSelector: 'Details,ShippingCosts'
  });

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`);
    if (!response.ok) return listing;
    const json: any = await response.json();
    const item = json?.Item;
    if (!item) return listing;

    const fallbackSeller = item?.Seller?.UserID;
    const fallbackSellerFeedbackPercent = Number(item?.Seller?.PositiveFeedbackPercent);
    const fallbackSellerFeedbackScore = Number(item?.Seller?.FeedbackScore);
    const fallbackShippingCost = Number(item?.ShippingCostSummary?.ShippingServiceCost?.Value);
    const fallbackShippingCurrency = item?.ShippingCostSummary?.ShippingServiceCost?.CurrencyID ?? listing.currency;
    const fallbackImageUrl = firstNonEmptyString([
      item?.PictureURLSuperSize,
      item?.PictureURL?.[0],
      item?.PictureURL,
      item?.GalleryPlusPictureURL?.[0],
      item?.GalleryPlusPictureURL,
      item?.GalleryURL
    ]);

    return {
      ...listing,
      seller: listing.seller ?? fallbackSeller ?? listing.seller,
      sellerFeedbackPercent:
        listing.sellerFeedbackPercent ??
        (Number.isNaN(fallbackSellerFeedbackPercent) ? undefined : fallbackSellerFeedbackPercent),
      sellerFeedbackScore:
        listing.sellerFeedbackScore ?? (Number.isNaN(fallbackSellerFeedbackScore) ? undefined : fallbackSellerFeedbackScore),
      shippingCost: listing.shippingCost ?? (Number.isNaN(fallbackShippingCost) ? undefined : fallbackShippingCost),
      shippingCurrency:
        listing.shippingCurrency ?? (Number.isNaN(fallbackShippingCost) ? undefined : fallbackShippingCurrency),
      imageUrl: listing.imageUrl ?? fallbackImageUrl ?? undefined,
      thumbnailUrl: listing.thumbnailUrl ?? listing.imageUrl ?? fallbackImageUrl ?? undefined
    };
  } catch {
    return listing;
  }
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
  const json: any = await parseJsonResponse(response);
  if (isFindingRateLimitError(json)) {
    throw new Error(`eBay rate limit exceeded: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`eBay request failed: ${response.status}`);
  }

  const items = json?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item ?? [];

  const listings = items
    .map((item: any) => {
      const listingId = item?.itemId?.[0];
      const title = item?.title?.[0];
      const viewItemURL = item?.viewItemURL?.[0];
      const galleryURL = firstNonEmptyString([item?.galleryURL?.[0], item?.galleryPlusPictureURL?.[0]]);
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
        imageUrl: galleryURL || undefined,
        thumbnailUrl: galleryURL || undefined,
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

  const needsEnrichment = listings.filter(
    (listing: Listing) =>
      !listing.seller ||
      listing.sellerFeedbackPercent === undefined ||
      listing.sellerFeedbackScore === undefined ||
      listing.shippingCost === undefined ||
      !listing.imageUrl
  );

  if (needsEnrichment.length === 0) return listings;

  const enrichedById = new Map<string, Listing>();
  for (const listing of needsEnrichment) {
    const enriched = await enrichListingFromShoppingApi(listing, appId);
    enrichedById.set(listing.listingId, enriched);
  }

  return listings.map((listing: Listing) => enrichedById.get(listing.listingId) ?? listing);
}
