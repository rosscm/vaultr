import type { PlanTier, UserPlan } from '../types.js';
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

export function activePlanTier(plan: Pick<UserPlan, 'tier' | 'status'>): PlanTier {
  return plan.tier === 'PRO' && plan.status === 'ACTIVE' ? 'PRO' : 'FREE';
}

export function activePlanLimits(plan: Pick<UserPlan, 'tier' | 'status'>): { maxActiveChases: number; pollIntervalSeconds: number } {
  return PLAN_LIMITS[activePlanTier(plan)];
}

export function getRuntimePollIntervalSeconds(): number {
  const value = Number(process.env.POLL_INTERVAL_SECONDS ?? '300');
  return Number.isFinite(value) ? Math.max(30, Math.floor(value)) : 300;
}

export function formatPollInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}
