import type { PlanTier } from '../types.js';

export const PLAN_LIMITS: Record<PlanTier, { maxActiveChases: number; pollIntervalSeconds: number }> = {
  FREE: {
    maxActiveChases: 3,
    pollIntervalSeconds: 180
  },
  PRO: {
    maxActiveChases: 50,
    pollIntervalSeconds: 30
  }
};

export function normalizePlanTier(input: string | null | undefined): PlanTier {
  if (input?.toUpperCase() === 'PRO') return 'PRO';
  return 'FREE';
}
