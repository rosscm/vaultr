import type { PlanTier } from '../types.js';

export type PlanEntitlements = {
  maxActiveChases: number;
  pollIntervalSeconds: number;
  advancedAlertControls: boolean;
  advancedFiltering: boolean;
  discoverCadence: 'limited' | 'full';
};

export const ENTITLEMENTS_BY_TIER: Record<PlanTier, PlanEntitlements> = {
  FREE: {
    maxActiveChases: 3,
    pollIntervalSeconds: 180,
    advancedAlertControls: false,
    advancedFiltering: false,
    discoverCadence: 'limited'
  },
  PRO: {
    maxActiveChases: 50,
    pollIntervalSeconds: 30,
    advancedAlertControls: true,
    advancedFiltering: true,
    discoverCadence: 'full'
  }
};

export function getEntitlementsForTier(tier: PlanTier): PlanEntitlements {
  return ENTITLEMENTS_BY_TIER[tier];
}

