import type { PlanTier } from '../types.js';

export type PlanEntitlements = {
  maxActiveChases: number;
  pollIntervalSeconds: number;
  advancedAlertControls: boolean;
  advancedFiltering: boolean;
  discoveryDepth: 'limited' | 'full';
  storefrontMonitoring: boolean;
};

export const ENTITLEMENTS_BY_TIER: Record<PlanTier, PlanEntitlements> = {
  FREE: {
    maxActiveChases: 3,
    pollIntervalSeconds: 1800,
    advancedAlertControls: false,
    advancedFiltering: false,
    discoveryDepth: 'limited',
    storefrontMonitoring: false
  },
  PRO: {
    maxActiveChases: 50,
    pollIntervalSeconds: 900,
    advancedAlertControls: true,
    advancedFiltering: true,
    discoveryDepth: 'full',
    storefrontMonitoring: true
  }
};

export function getEntitlementsForTier(tier: PlanTier): PlanEntitlements {
  return ENTITLEMENTS_BY_TIER[tier];
}

