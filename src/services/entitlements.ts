import type { PlanTier } from '../types.js';

export type PlanEntitlements = {
  maxActiveChases: number;
  pollIntervalSeconds: number;
  advancedFiltering: boolean;
  discoveryDepth: 'limited' | 'full';
  discoveryVisibleCards: number;
  storefrontMonitoring: boolean;
};

export const ENTITLEMENTS_BY_TIER: Record<PlanTier, PlanEntitlements> = {
  FREE: {
    maxActiveChases: 3,
    pollIntervalSeconds: 1800,
    advancedFiltering: false,
    discoveryDepth: 'limited',
    discoveryVisibleCards: 3,
    storefrontMonitoring: false
  },
  PRO: {
    maxActiveChases: 50,
    pollIntervalSeconds: 900,
    advancedFiltering: true,
    discoveryDepth: 'full',
    discoveryVisibleCards: 7,
    storefrontMonitoring: true
  }
};

export function getEntitlementsForTier(tier: PlanTier): PlanEntitlements {
  return ENTITLEMENTS_BY_TIER[tier];
}

