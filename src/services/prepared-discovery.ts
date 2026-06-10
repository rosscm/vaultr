import { getUserAlertSettings, getUserDiscoveryState, getUserPlan, listChases, listUserTasteMemoryChases } from './chase-store.js';
import type { SupportedCurrency } from './currency.js';
import { discoveryMarketCacheKey, getDiscoveryMarketCache, type DiscoveryMarketCacheEntry } from './discovery-market-cache.js';
import { discoveryReferenceCacheKey, getDiscoveryReferenceCache } from './discovery-reference-cache.js';
import { getEntitlementsForTier } from './entitlements.js';
import { activePlanChases, activePlanTier } from './plans.js';
import type { Chase, PlanTier } from '../types.js';

export type PreparedDiscoveryMarketStatus = 'READY' | 'THIN' | 'PENDING' | 'RATE_LIMITED' | 'TIMEOUT' | 'ERROR' | 'MISSING';

export type PreparedDiscoveryShelfItem = {
  position: number;
  name: string;
  imageUrl?: string;
  imageSourceName?: string;
  market: {
    status: PreparedDiscoveryMarketStatus;
    currency: SupportedCurrency;
    askingTotal?: number;
    askingSampleSize?: number;
    soldTotal?: number;
    soldSampleSize?: number;
    listing?: {
      id: string;
      title: string;
      url: string;
      imageUrl?: string;
    };
    fetchedAt?: string;
    updatedAt?: string;
  };
};

export type PreparedDiscoveryShelf = {
  userId: string;
  mode: string;
  planTier: PlanTier;
  visibleCount: number;
  currency: SupportedCurrency;
  destinationCountry?: string;
  marketRange?: { min: number; max: number };
  stateUpdatedAt: string;
  activeChaseCount: number;
  items: PreparedDiscoveryShelfItem[];
  marketReadyCount: number;
  imageReadyCount: number;
};

export const PREPARED_DISCOVERY_SELECTION_VERSION = 4;
export const PREPARED_DISCOVERY_STATE_BASE_KEY = 'ambient';

export function preparedDiscoveryVisibleCountForPlan(tier: PlanTier): number {
  return getEntitlementsForTier(tier).discoveryVisibleCards;
}

export function preparedDiscoveryStateKey(tier: PlanTier, visibleCount: number): string {
  return `${PREPARED_DISCOVERY_STATE_BASE_KEY}:v${PREPARED_DISCOVERY_SELECTION_VERSION}:${tier.toLowerCase()}:${visibleCount}`;
}

export function preparedDiscoveryMarketRangeFromChases(chases: Chase[]): { min: number; max: number } | undefined {
  const maxPrices = chases.map((chase) => chase.maxPrice).filter((price): price is number => price !== undefined && Number.isFinite(price) && price > 0);
  if (maxPrices.length === 0) return undefined;
  return { min: 0, max: Math.max(...maxPrices) };
}

function marketStatusFromCache(entry: DiscoveryMarketCacheEntry | null): PreparedDiscoveryMarketStatus {
  if (!entry) return 'MISSING';
  if (entry.sourceStatus === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (entry.sourceStatus === 'TIMEOUT') return 'TIMEOUT';
  if (entry.sourceStatus === 'ERROR') return 'ERROR';
  if (entry.typicalRawAskingTotal !== undefined || entry.typicalRawSoldTotal !== undefined || entry.listingUrl) return 'READY';
  return 'THIN';
}

function itemFromPreparedCaches(input: {
  name: string;
  position: number;
  currency: SupportedCurrency;
  destinationCountry?: string;
  marketRange?: { min: number; max: number };
}): PreparedDiscoveryShelfItem {
  const marketCacheKey = discoveryMarketCacheKey(input.name, input.currency, input.destinationCountry, undefined, input.marketRange);
  const market = getDiscoveryMarketCache(marketCacheKey);
  const reference = getDiscoveryReferenceCache(discoveryReferenceCacheKey(input.name));
  return {
    position: input.position,
    name: input.name,
    imageUrl: reference?.imageUrl ?? market?.imageUrl,
    imageSourceName: reference?.sourceName,
    market: {
      status: marketStatusFromCache(market),
      currency: market?.displayCurrency ?? input.currency,
      askingTotal: market?.typicalRawAskingTotal,
      askingSampleSize: market?.marketSampleSize,
      soldTotal: market?.typicalRawSoldTotal,
      soldSampleSize: market?.soldSampleSize,
      listing:
        market?.listingId && market.listingTitle && market.listingUrl
          ? {
              id: market.listingId,
              title: market.listingTitle,
              url: market.listingUrl,
              imageUrl: market.imageUrl
            }
          : undefined,
      fetchedAt: market?.fetchedAt,
      updatedAt: market?.updatedAt
    }
  };
}

export function getPreparedDiscoveryShelf(userId: string, requestedCount?: number): PreparedDiscoveryShelf | null {
  const plan = getUserPlan(userId);
  const planTier = activePlanTier(plan);
  const visibleCount = Math.min(requestedCount ?? preparedDiscoveryVisibleCountForPlan(planTier), preparedDiscoveryVisibleCountForPlan(planTier));
  const mode = preparedDiscoveryStateKey(planTier, visibleCount);
  const state = getUserDiscoveryState(userId, mode);
  if (!state || state.suggestionNames.length === 0) return null;

  const settings = getUserAlertSettings(userId);
  const storedChases = listChases(userId);
  const activeChases = activePlanChases(storedChases, plan);
  const tasteProfileChases = getEntitlementsForTier(planTier).discoveryDepth === 'full' ? [...activeChases, ...listUserTasteMemoryChases(userId)] : activeChases;
  const marketRange = preparedDiscoveryMarketRangeFromChases(tasteProfileChases);
  const items = state.suggestionNames.slice(0, visibleCount).map((name, index) =>
    itemFromPreparedCaches({
      name,
      position: index + 1,
      currency: settings.alertCurrency,
      destinationCountry: settings.shippingCountry,
      marketRange
    })
  );

  return {
    userId,
    mode,
    planTier,
    visibleCount,
    currency: settings.alertCurrency,
    destinationCountry: settings.shippingCountry,
    marketRange,
    stateUpdatedAt: state.updatedAt,
    activeChaseCount: activeChases.length,
    items,
    marketReadyCount: items.filter((item) => item.market.status === 'READY').length,
    imageReadyCount: items.filter((item) => !!item.imageUrl).length
  };
}