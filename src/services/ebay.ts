import type { Chase, Listing } from '../types.js';

const EBAY_FINDING_ENDPOINT_PROD = 'https://svcs.ebay.com/services/search/FindingService/v1';
const EBAY_FINDING_ENDPOINT_SANDBOX = 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1';
const EBAY_SHOPPING_ENDPOINT_PROD = 'https://open.api.ebay.com/shopping';
const EBAY_SHOPPING_ENDPOINT_SANDBOX = 'https://open.api.sandbox.ebay.com/shopping';
const EBAY_BROWSE_ENDPOINT_PROD = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_BROWSE_ENDPOINT_SANDBOX = 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_OAUTH_ENDPOINT_PROD = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_OAUTH_ENDPOINT_SANDBOX = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';

let cachedBrowseToken: { token: string; expiresAtMs: number } | undefined;

function getEbayEnv(): 'PRODUCTION' | 'SANDBOX' {
  const env = (process.env.EBAY_ENV ?? 'PRODUCTION').toUpperCase();
  return env === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
}

function getEbayFindingEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_FINDING_ENDPOINT_SANDBOX : EBAY_FINDING_ENDPOINT_PROD;
}

function getEbayShoppingEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_SHOPPING_ENDPOINT_SANDBOX : EBAY_SHOPPING_ENDPOINT_PROD;
}

function getEbayBrowseEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_BROWSE_ENDPOINT_SANDBOX : EBAY_BROWSE_ENDPOINT_PROD;
}

function getEbayOauthEndpoint(): string {
  return getEbayEnv() === 'SANDBOX' ? EBAY_OAUTH_ENDPOINT_SANDBOX : EBAY_OAUTH_ENDPOINT_PROD;
}

function getEbaySearchApi(): 'BROWSE' | 'FINDING' {
  const api = (process.env.EBAY_SEARCH_API ?? 'BROWSE').toUpperCase();
  return api === 'FINDING' ? 'FINDING' : 'BROWSE';
}

function mapCountryToRegion(countryCode?: string): 'CA' | 'US' | 'OTHER' {
  if (!countryCode) return 'OTHER';
  if (countryCode === 'CA') return 'CA';
  if (countryCode === 'US') return 'US';
  return 'OTHER';
}

function mapFindingListingType(raw?: string): 'AUCTION' | 'BUY_IT_NOW' | 'OTHER' {
  const t = (raw ?? '').toLowerCase();
  if (t === 'auction') return 'AUCTION';
  if (t === 'fixedprice' || t === 'storeinventory') return 'BUY_IT_NOW';
  return 'OTHER';
}

function mapBrowseListingType(buyingOptions?: unknown): 'AUCTION' | 'BUY_IT_NOW' | 'OTHER' {
  if (!Array.isArray(buyingOptions)) return 'OTHER';
  const options = buyingOptions.map((option) => String(option).toUpperCase());
  if (options.includes('AUCTION')) return 'AUCTION';
  if (options.includes('FIXED_PRICE')) return 'BUY_IT_NOW';
  return 'OTHER';
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
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

function isBrowseRateLimitError(response: Response, json: any): boolean {
  if (response.status === 429) return true;
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.some((error) => /rate|limit|quota/i.test(`${error?.errorId ?? ''} ${error?.category ?? ''} ${error?.message ?? ''}`));
}

async function parseJsonResponse(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getBrowseAccessToken(): Promise<string> {
  if (cachedBrowseToken && cachedBrowseToken.expiresAtMs > Date.now() + 60_000) {
    return cachedBrowseToken.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID ?? process.env.EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_CLIENT_ID/EBAY_APP_ID or EBAY_CLIENT_SECRET for eBay Browse API');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope'
  });

  const response = await fetch(getEbayOauthEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json: any = await parseJsonResponse(response);
  if (!response.ok || !json?.access_token) {
    throw new Error(`eBay OAuth token request failed: ${response.status}`);
  }

  const expiresInSeconds = Number(json.expires_in ?? 7200);
  cachedBrowseToken = {
    token: json.access_token,
    expiresAtMs: Date.now() + Math.max(60, expiresInSeconds) * 1000
  };

  return cachedBrowseToken.token;
}

function mapBrowseItemToListing(item: any): Listing | null {
  const listingId = item?.itemId;
  const title = item?.title;
  const url = item?.itemWebUrl;
  const price = parseNumber(item?.price?.value);
  const currency = item?.price?.currency ?? 'USD';
  if (!listingId || !title || !url || price === undefined) return null;

  const shipping = Array.isArray(item?.shippingOptions) ? item.shippingOptions[0] : undefined;
  const shippingCost = parseNumber(shipping?.shippingCost?.value);
  const imageUrl = firstNonEmptyString([
    item?.image?.imageUrl,
    item?.thumbnailImages?.[0]?.imageUrl,
    item?.additionalImages?.[0]?.imageUrl
  ]);

  return {
    source: 'EBAY',
    listingId,
    title,
    price,
    currency,
    shippingCost,
    shippingCurrency: shippingCost === undefined ? undefined : shipping?.shippingCost?.currency ?? currency,
    url,
    imageUrl,
    thumbnailUrl: firstNonEmptyString([item?.thumbnailImages?.[0]?.imageUrl, imageUrl]),
    seller: item?.seller?.username,
    sellerFeedbackPercent: parseNumber(item?.seller?.feedbackPercentage),
    sellerFeedbackScore: parseNumber(item?.seller?.feedbackScore),
    postedAt: item?.itemCreationDate ?? item?.itemOriginDate,
    region: mapCountryToRegion(item?.itemLocation?.country),
    condition: item?.condition,
    listingType: mapBrowseListingType(item?.buyingOptions)
  };
}

async function searchEbayBrowseListings(chase: Chase): Promise<Listing[]> {
  const token = await getBrowseAccessToken();
  const keywords = chase.grade ? `${chase.cardName} ${chase.grade}` : chase.cardName;
  const params = new URLSearchParams({
    q: keywords,
    limit: process.env.EBAY_SEARCH_LIMIT ?? '10',
    sort: process.env.EBAY_BROWSE_SORT ?? 'newlyListed'
  });

  const response = await fetch(`${getEbayBrowseEndpoint()}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_US'
    }
  });
  const json: any = await parseJsonResponse(response);
  if (isBrowseRateLimitError(response, json)) {
    throw new Error(`eBay rate limit exceeded: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`eBay Browse request failed: ${response.status}`);
  }

  const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
  return items
    .map(mapBrowseItemToListing)
    .filter((listing: Listing | null): listing is Listing => listing !== null);
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

async function searchEbayFindingListings(chase: Chase): Promise<Listing[]> {
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
    'paginationInput.entriesPerPage': process.env.EBAY_SEARCH_LIMIT ?? '10',
    sortOrder: 'StartTimeNewest'
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
        listingType: mapFindingListingType(rawListingType)
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

export async function searchEbayListings(chase: Chase): Promise<Listing[]> {
  return getEbaySearchApi() === 'BROWSE' ? searchEbayBrowseListings(chase) : searchEbayFindingListings(chase);
}
