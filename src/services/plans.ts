import type { PlanTier } from '../types.js';
import { getEntitlementsForTier } from './entitlements.js';

export const PLAN_LIMITS: Record<PlanTier, { maxActiveChases: number; pollIntervalSeconds: number }> = {
  FREE: {
    maxActiveChases: getEntitlementsForTier('FREE').maxActiveChases,
    pollIntervalSeconds: getEntitlementsForTier('FREE').pollIntervalSeconds
  },
  PRO: {
    maxActiveChases: getEntitlementsForTier('PRO').maxActiveChases,
    pollIntervalSeconds: getEntitlementsForTier('PRO').pollIntervalSeconds
  }
};

export function normalizePlanTier(input: string | null | undefined): PlanTier {
  if (input?.toUpperCase() === 'PRO') return 'PRO';
  return 'FREE';
}
