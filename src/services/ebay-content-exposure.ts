export const EBAY_CONTENT_DISPLAY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isTrustedEbayContentFresh(
  retrievedAt: string | undefined,
  now = new Date(),
  maxAgeMs = EBAY_CONTENT_DISPLAY_MAX_AGE_MS
): boolean {
  if (!retrievedAt) return false;
  const retrievedMs = Date.parse(retrievedAt);
  const ageMs = now.getTime() - retrievedMs;
  return Number.isFinite(retrievedMs) && ageMs >= 0 && ageMs <= maxAgeMs;
}

export function suppressStaleEbayMarket<T extends {
  status: string;
  currency: string;
  fetchedAt?: string;
  updatedAt?: string;
}>(market: T, now = new Date()): T | { status: 'MISSING'; currency: T['currency']; contentSuppressed: true } {
  const values = market as Record<string, unknown>;
  const containsMarketplaceContent = ['askingTotal', 'askingRangeLow', 'askingRangeHigh', 'soldTotal', 'soldRangeLow', 'soldRangeHigh', 'listing']
    .some((key) => values[key] !== undefined);
  if (!containsMarketplaceContent) return market;
  const retrievedAt = market.fetchedAt ?? market.updatedAt;
  if (isTrustedEbayContentFresh(retrievedAt, now)) return market;
  return { status: 'MISSING', currency: market.currency, contentSuppressed: true };
}
