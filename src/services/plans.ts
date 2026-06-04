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

type PlanChaseLike = {
  priority?: 'GRAIL' | 'HIGH' | 'NORMAL';
  createdAt: string;
};

function planChasePriorityRank(chase: PlanChaseLike): number {
  if (chase.priority === 'GRAIL') return 1;
  if (chase.priority === 'HIGH') return 2;
  return 3;
}

export function orderPlanChases<T extends PlanChaseLike>(chases: T[]): T[] {
  return [...chases].sort((a, b) => {
    const priorityDelta = planChasePriorityRank(a) - planChasePriorityRank(b);
    if (priorityDelta !== 0) return priorityDelta;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function activePlanChases<T extends PlanChaseLike>(chases: T[], plan: Pick<UserPlan, 'tier' | 'status'>): T[] {
  return orderPlanChases(chases).slice(0, activePlanLimits(plan).maxActiveChases);
}

export function pausedPlanChases<T extends PlanChaseLike>(chases: T[], plan: Pick<UserPlan, 'tier' | 'status'>): T[] {
  return orderPlanChases(chases).slice(activePlanLimits(plan).maxActiveChases);
}

export function formatActivePlanAccess(plan: Pick<UserPlan, 'tier' | 'status'>): string {
  const activeTier = activePlanTier(plan);
  if (plan.tier === activeTier) return activeTier;
  return `${activeTier} (${plan.tier} ${plan.status}; Pro paused)`;
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
