import { getUserPlan, listChases, listUserTasteMemoryChases, listUsersWithChases } from './chase-store.js';
import { activePlanTier } from './plans.js';
import type { Chase } from '../types.js';

export const WEEKLY_DISCOVERY_MIN_UNIQUE_SIGNAL_COUNT = 5;

export type WeeklyDiscoveryEligibility = {
  eligible: boolean;
  minimumSignalCount: number;
  uniqueSignalCount: number;
  signalsNeeded: number;
  activeChaseCount: number;
  tasteMemoryCount: number;
  duplicateSignalCount: number;
  reason: 'ELIGIBLE' | 'INSUFFICIENT_SIGNAL';
};

type ChaseWithOptionalIdentity = Chase & {
  canonicalCardId?: string;
  sourceProvider?: string;
  sourceName?: string;
  sourceCardId?: string;
  setName?: string;
  cardNumber?: string;
  language?: string;
};

function normalizeIdentityPart(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectorSignalKey(chase: Chase): string {
  const candidate = chase as ChaseWithOptionalIdentity;
  const canonicalCardId = normalizeIdentityPart(candidate.canonicalCardId);
  if (canonicalCardId) return `canonical:${canonicalCardId}`;

  const sourceProvider = normalizeIdentityPart(candidate.sourceProvider ?? candidate.sourceName);
  const sourceCardId = normalizeIdentityPart(candidate.sourceCardId);
  if (sourceProvider && sourceCardId) return `provider:${sourceProvider}:${sourceCardId}`;

  const setName = normalizeIdentityPart(candidate.setName);
  const cardNumber = normalizeIdentityPart(candidate.cardNumber);
  const language = normalizeIdentityPart(candidate.language);
  const printedName = normalizeIdentityPart(candidate.queryName ?? candidate.cardName);
  if (printedName && (setName || cardNumber || language)) {
    return `printing:${printedName}:${setName}:${cardNumber}:${language}`;
  }

  return `name:${printedName}`;
}

export function evaluateWeeklyDiscoveryEligibility(
  activeChases: Chase[],
  tasteMemoryChases: Chase[] = [],
  minimumSignalCount = WEEKLY_DISCOVERY_MIN_UNIQUE_SIGNAL_COUNT
): WeeklyDiscoveryEligibility {
  const signalKeys = new Set<string>();
  for (const chase of [...activeChases, ...tasteMemoryChases]) {
    const key = collectorSignalKey(chase);
    if (key !== 'name:') signalKeys.add(key);
  }

  const uniqueSignalCount = signalKeys.size;
  const signalsNeeded = Math.max(0, minimumSignalCount - uniqueSignalCount);
  return {
    eligible: signalsNeeded === 0,
    minimumSignalCount,
    uniqueSignalCount,
    signalsNeeded,
    activeChaseCount: activeChases.length,
    tasteMemoryCount: tasteMemoryChases.length,
    duplicateSignalCount: Math.max(0, activeChases.length + tasteMemoryChases.length - uniqueSignalCount),
    reason: signalsNeeded === 0 ? 'ELIGIBLE' : 'INSUFFICIENT_SIGNAL'
  };
}

export function weeklyDiscoveryEligibilityForUser(userId: string): WeeklyDiscoveryEligibility {
  return evaluateWeeklyDiscoveryEligibility(
    listChases(userId),
    listUserTasteMemoryChases(userId, WEEKLY_DISCOVERY_MIN_UNIQUE_SIGNAL_COUNT * 2)
  );
}

export function listProUsersEligibleForWeeklyDiscovery(): string[] {
  return listUsersWithChases().filter((userId) =>
    activePlanTier(getUserPlan(userId)) === 'PRO' && weeklyDiscoveryEligibilityForUser(userId).eligible
  );
}

export function countProUsersIneligibleForWeeklyDiscovery(): number {
  return listUsersWithChases().filter((userId) =>
    activePlanTier(getUserPlan(userId)) === 'PRO' && !weeklyDiscoveryEligibilityForUser(userId).eligible
  ).length;
}
