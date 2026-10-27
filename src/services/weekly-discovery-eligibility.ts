import { getUserPlan, listAllUserTasteMemoryChases, listChases, listUsersWithDiscoverySignals } from './chase-store.js';
import { activePlanTier } from './plans.js';
import type { Chase } from '../types.js';
import { getCollectorPreferences } from './collector-preferences.js';
import { db } from './db.js';

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
  const eligibleTasteMemoryChases = tasteMemoryChases.filter((chase) => chase.tasteSource !== 'REMOVED_CHASE');
  const signalKeys = new Set<string>();
  for (const chase of [...activeChases, ...eligibleTasteMemoryChases]) {
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
    tasteMemoryCount: eligibleTasteMemoryChases.length,
    duplicateSignalCount: Math.max(0, activeChases.length + eligibleTasteMemoryChases.length - uniqueSignalCount),
    reason: signalsNeeded === 0 ? 'ELIGIBLE' : 'INSUFFICIENT_SIGNAL'
  };
}

export function weeklyDiscoveryEligibilityForUser(userId: string): WeeklyDiscoveryEligibility {
  return evaluateWeeklyDiscoveryEligibility(
    listChases(userId),
    listAllUserTasteMemoryChases(userId)
  );
}

export function weeklyDiscoveryExplicitPreferenceEligibilityForUser(userId: string): boolean {
  return getCollectorPreferences(userId).readiness.ready;
}

export function listProUsersEligibleForWeeklyDiscovery(): string[] {
  return usersWithAnyDiscoverySignals().filter((userId) =>
    activePlanTier(getUserPlan(userId)) === 'PRO' && (weeklyDiscoveryEligibilityForUser(userId).eligible || weeklyDiscoveryExplicitPreferenceEligibilityForUser(userId))
  );
}

export function countProUsersIneligibleForWeeklyDiscovery(): number {
  return usersWithAnyDiscoverySignals().filter((userId) =>
    activePlanTier(getUserPlan(userId)) === 'PRO' && !weeklyDiscoveryEligibilityForUser(userId).eligible && !weeklyDiscoveryExplicitPreferenceEligibilityForUser(userId)
  ).length;
}

function usersWithAnyDiscoverySignals(): string[] {
  const explicit = db.prepare(`
    SELECT user_id FROM user_collector_subject_preferences
    UNION
    SELECT user_id FROM user_collector_artwork_preferences
  `).all() as Array<{ user_id: string }>;
  return [...new Set([...listUsersWithDiscoverySignals(), ...explicit.map((row) => row.user_id)])].sort();
}
