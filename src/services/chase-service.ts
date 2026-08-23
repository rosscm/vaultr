import type { Chase } from '../types.js';
import {
  addChase,
  countUserChases,
  getUserPlan,
  listChases,
  resolveChaseRemoval,
  updateChase
} from './chase-store.js';
import {
  getCachedChaseCardPreview,
  normalizeChaseCardName,
  type CachedChaseCardPreview
} from './chase-card-catalog.js';
import { getEntitlementsForTier } from './entitlements.js';
import { activePlanChases, activePlanLimits, activePlanTier, PLAN_LIMITS } from './plans.js';
import {
  buildGradePreference,
  gradeSelectionWarning,
  inferGradingTypeFromGrade,
  normalizeConditionChoice,
  type ConditionChoice,
  type GradeValue,
  type GradingType
} from './chase-options.js';
import type { VaultrUserId } from './accounts.js';

export type ChaseAdvancedControl = 'condition' | 'listing type' | 'priority' | 'note' | 'custom exclusions';
export type ChaseRemovalOutcome = 'COMPLETED' | 'NO_LONGER_INTERESTED' | 'ADDED_BY_MISTAKE';
export type ChaseListingTypeInput = 'ANY' | 'AUCTION' | 'BUY_IT_NOW';
export type ChasePriorityInput = 'GRAIL' | 'HIGH' | 'NORMAL';
export type ChaseServiceErrorCode =
  | 'CHASE_NOT_FOUND'
  | 'VAULT_LIMIT_REACHED'
  | 'DUPLICATE_CHASE'
  | 'INVALID_GRADE_PREFERENCE'
  | 'TOO_MANY_CUSTOM_EXCLUSIONS'
  | 'NO_CHANGES_REQUESTED'
  | 'NO_APPLICABLE_CHANGES';

export type ChaseServiceError = {
  ok: false;
  code: ChaseServiceErrorCode;
  message?: string;
  blockedControls?: ChaseAdvancedControl[];
  duplicateChase?: Chase;
  maxChases?: number;
  activeTier?: 'FREE' | 'PRO';
};

export type ChaseMonitoringState = 'ACTIVE' | 'PAUSED_PLAN_LIMIT';

export type VaultChaseView = {
  chase: Chase;
  monitoringState: ChaseMonitoringState;
};

export type VaultChasesResult = {
  chases: VaultChaseView[];
  plan: {
    tier: 'FREE' | 'PRO';
    maxActiveChases: number;
    activeCount: number;
    pausedCount: number;
  };
};

export type AddUserChaseInput = {
  userId: VaultrUserId;
  guildId?: string;
  cardName: string;
  maxPrice?: number;
  gradingType?: GradingType | null;
  gradeValue?: GradeValue | null;
  condition?: ConditionChoice | null;
  listingType?: ChaseListingTypeInput | null;
  priority?: ChasePriorityInput | null;
  targetNote?: string;
  customExclusions?: string | string[] | null;
};

export type AddUserChaseResult =
  | {
      ok: true;
      chase: Chase;
      blockedControls: ChaseAdvancedControl[];
      previousChaseCount: number;
      isFirstChase: boolean;
      activeTier: 'FREE' | 'PRO';
    }
  | ChaseServiceError;

export type UpdateUserChaseChanges = {
  cardName?: string;
  maxPrice?: number | null;
  gradingType?: GradingType | null;
  gradeValue?: GradeValue | null;
  condition?: ConditionChoice | null;
  listingType?: ChaseListingTypeInput | null;
  priority?: ChasePriorityInput | null;
  targetNote?: string | null;
  customExclusions?: string | string[] | null;
};

export type UpdateUserChaseResult =
  | {
      ok: true;
      chase: Chase;
      previousChase: Chase;
      blockedControls: ChaseAdvancedControl[];
      activeTier: 'FREE' | 'PRO';
    }
  | ChaseServiceError;

export type RemoveUserChaseResult =
  | { ok: true; removed: true; chase: Chase; outcome: ChaseRemovalOutcome }
  | ChaseServiceError;

const MAX_CUSTOM_EXCLUSIONS = 15;

function parseCustomExclusions(value: string | string[] | null | undefined, options: { noneClears?: boolean } = {}): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return options.noneClears ? null : undefined;
  const terms = Array.isArray(value)
    ? value.map((term) => term.trim()).filter(Boolean)
    : value.split(',').map((term) => term.trim()).filter(Boolean);
  if (options.noneClears && !Array.isArray(value) && /^none$/i.test(value.trim())) return null;
  return terms.length > 0 ? terms : options.noneClears ? null : undefined;
}

function requestedAddAdvancedControls(input: AddUserChaseInput): ChaseAdvancedControl[] {
  const customExclusions = parseCustomExclusions(input.customExclusions);
  return [
    input.condition !== undefined && input.condition !== null && input.condition !== 'ANY' ? 'condition' : undefined,
    input.listingType !== undefined && input.listingType !== null && input.listingType !== 'ANY' ? 'listing type' : undefined,
    input.priority !== undefined && input.priority !== null && input.priority !== 'NORMAL' ? 'priority' : undefined,
    input.targetNote !== undefined ? 'note' : undefined,
    customExclusions && customExclusions.length > 0 ? 'custom exclusions' : undefined
  ].filter((value): value is ChaseAdvancedControl => Boolean(value));
}

function requestedEditAdvancedControls(changes: UpdateUserChaseChanges): ChaseAdvancedControl[] {
  return [
    changes.condition !== undefined && changes.condition !== null && changes.condition !== 'ANY' ? 'condition' : undefined,
    changes.listingType !== undefined && changes.listingType !== null && changes.listingType !== 'ANY' ? 'listing type' : undefined,
    changes.priority !== undefined && changes.priority !== null && changes.priority !== 'NORMAL' ? 'priority' : undefined,
    changes.targetNote !== undefined ? 'note' : undefined,
    changes.customExclusions !== undefined ? 'custom exclusions' : undefined
  ].filter((value): value is ChaseAdvancedControl => Boolean(value));
}

function trustedChasePreviewForPersistence(cardName: string, normalizedCardName: string): CachedChaseCardPreview | undefined {
  const preview =
    getCachedChaseCardPreview(cardName) ??
    getCachedChaseCardPreview(normalizedCardName);
  if (!preview?.imageUrl) return undefined;
  if (preview.imageSourceKind !== 'CARD_REFERENCE') return undefined;
  if ((preview.imageIdentity ?? '').trim().length === 0) return undefined;
  if (normalizeChaseCardName(preview.imageIdentity!) !== normalizedCardName) return undefined;
  return preview;
}

function duplicateForName(chases: Chase[], normalizedCardName: string, exceptChaseId?: string): Chase | undefined {
  return chases.find((chase) =>
    chase.id !== exceptChaseId &&
    normalizeChaseCardName(chase.cardName).toLowerCase() === normalizedCardName.toLowerCase()
  );
}

function invalidGradeResult(message: string): ChaseServiceError {
  return { ok: false, code: 'INVALID_GRADE_PREFERENCE', message };
}

export function getVaultChases(userId: VaultrUserId): VaultChasesResult {
  const chases = listChases(userId);
  const plan = getUserPlan(userId);
  const limits = activePlanLimits(plan);
  const activeIds = new Set(activePlanChases(chases, plan).map((chase) => chase.id));
  const activeTier = activePlanTier(plan);
  const views = chases.map((chase) => ({
    chase,
    monitoringState: activeIds.has(chase.id) ? 'ACTIVE' as const : 'PAUSED_PLAN_LIMIT' as const
  }));
  return {
    chases: views,
    plan: {
      tier: activeTier,
      maxActiveChases: limits.maxActiveChases,
      activeCount: activeIds.size,
      pausedCount: views.filter((view) => view.monitoringState === 'PAUSED_PLAN_LIMIT').length
    }
  };
}

export function addUserChase(input: AddUserChaseInput): AddUserChaseResult {
  const plan = getUserPlan(input.userId);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const previousChaseCount = countUserChases(input.userId);
  const maxChases = PLAN_LIMITS[activeTier].maxActiveChases;
  if (previousChaseCount >= maxChases) {
    return { ok: false, code: 'VAULT_LIMIT_REACHED', maxChases, activeTier };
  }

  const normalizedCardName = normalizeChaseCardName(input.cardName);
  const existingDuplicate = duplicateForName(listChases(input.userId), normalizedCardName);
  if (existingDuplicate) return { ok: false, code: 'DUPLICATE_CHASE', duplicateChase: existingDuplicate };

  const gradeWarning = gradeSelectionWarning(input.gradingType ?? null, input.gradeValue ?? null);
  if (gradeWarning) return invalidGradeResult(gradeWarning);
  const grade = buildGradePreference(input.gradingType ?? null, input.gradeValue ?? null) ?? undefined;
  const blockedControls = entitlements.advancedFiltering ? [] : requestedAddAdvancedControls(input);
  const canUseAdvanced = entitlements.advancedFiltering;
  const customExclusions = canUseAdvanced ? parseCustomExclusions(input.customExclusions) : undefined;
  if (customExclusions && customExclusions.length > MAX_CUSTOM_EXCLUSIONS) {
    return { ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' };
  }

  const trustedPreview = trustedChasePreviewForPersistence(input.cardName, normalizedCardName);
  const chase = addChase({
    userId: input.userId,
    guildId: input.guildId,
    cardName: normalizedCardName,
    cardImageUrl: trustedPreview?.imageUrl,
    cardImageIdentity: trustedPreview?.imageIdentity,
    cardImageSourceName: trustedPreview?.imageSourceName,
    cardImageSourceKind: trustedPreview?.imageSourceKind,
    cardImageSourceCardId: trustedPreview?.imageSourceCardId,
    priority: canUseAdvanced ? input.priority ?? 'NORMAL' : 'NORMAL',
    targetNote: canUseAdvanced ? input.targetNote : undefined,
    maxPrice: input.maxPrice,
    grade,
    condition: canUseAdvanced ? normalizeConditionChoice(input.condition ?? null) ?? undefined : undefined,
    listingType: canUseAdvanced ? input.listingType ?? 'ANY' : 'ANY',
    negativeKeywords: customExclusions && customExclusions.length > 0 ? customExclusions : undefined
  });

  return {
    ok: true,
    chase,
    blockedControls,
    previousChaseCount,
    isFirstChase: previousChaseCount === 0,
    activeTier
  };
}

export function updateUserChase(input: { userId: VaultrUserId; chaseId: string; changes: UpdateUserChaseChanges }): UpdateUserChaseResult {
  const chases = listChases(input.userId);
  const current = chases.find((chase) => chase.id === input.chaseId);
  if (!current) return { ok: false, code: 'CHASE_NOT_FOUND' };
  const changes = input.changes;
  const hasRequestedChange = Object.values(changes).some((value) => value !== undefined);
  if (!hasRequestedChange) return { ok: false, code: 'NO_CHANGES_REQUESTED' };

  const effectiveGradingType = changes.gradingType ?? (changes.gradeValue !== undefined && changes.gradeValue !== null ? inferGradingTypeFromGrade(current.grade) ?? null : null);
  const gradeWarning = gradeSelectionWarning(effectiveGradingType, changes.gradeValue ?? null);
  if (gradeWarning) return invalidGradeResult(gradeWarning);
  const grade = buildGradePreference(effectiveGradingType, changes.gradeValue ?? null);

  const plan = getUserPlan(input.userId);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const blockedControls = entitlements.advancedFiltering ? [] : requestedEditAdvancedControls(changes);
  const canUseAdvanced = entitlements.advancedFiltering;
  const negativeKeywords = canUseAdvanced ? parseCustomExclusions(changes.customExclusions, { noneClears: true }) : undefined;
  if (negativeKeywords && negativeKeywords.length > MAX_CUSTOM_EXCLUSIONS) {
    return { ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' };
  }

  const cardName = changes.cardName !== undefined ? changes.cardName.trim().replace(/\s+/g, ' ') : undefined;
  const normalizedCardName = cardName ? normalizeChaseCardName(cardName) : undefined;
  if (cardName) {
    const duplicate = duplicateForName(chases, normalizedCardName!, current.id);
    if (duplicate) return { ok: false, code: 'DUPLICATE_CHASE', duplicateChase: duplicate };
  }

  if (
    cardName === undefined &&
    changes.maxPrice === undefined &&
    grade === undefined &&
    (!canUseAdvanced || (
      changes.condition === undefined &&
      changes.listingType === undefined &&
      changes.priority === undefined &&
      changes.targetNote === undefined &&
      changes.customExclusions === undefined
    ))
  ) {
    return blockedControls.length > 0
      ? { ok: false, code: 'NO_APPLICABLE_CHANGES', blockedControls }
      : { ok: false, code: 'NO_CHANGES_REQUESTED' };
  }

  const trustedPreview = cardName && normalizedCardName ? trustedChasePreviewForPersistence(changes.cardName ?? cardName, normalizedCardName) : undefined;
  const cardImagePatch = cardName
    ? {
        cardImageUrl: trustedPreview?.imageUrl ?? null,
        cardImageIdentity: trustedPreview?.imageIdentity ?? null,
        cardImageSourceName: trustedPreview?.imageSourceName ?? null,
        cardImageSourceKind: trustedPreview?.imageSourceKind ?? null,
        cardImageSourceCardId: trustedPreview?.imageSourceCardId ?? null
      }
    : {};
  const updated = updateChase(input.userId, current.id, {
    cardName,
    ...cardImagePatch,
    priority: canUseAdvanced ? changes.priority ?? undefined : undefined,
    targetNote: canUseAdvanced
      ? changes.targetNote === null ? null : changes.targetNote === undefined ? undefined : /^none$/i.test(changes.targetNote.trim()) ? null : changes.targetNote
      : undefined,
    maxPrice: changes.maxPrice,
    grade,
    condition: canUseAdvanced ? normalizeConditionChoice(changes.condition ?? null) : undefined,
    listingType: canUseAdvanced ? changes.listingType ?? undefined : undefined,
    negativeKeywords
  });

  if (!updated) return { ok: false, code: 'CHASE_NOT_FOUND' };
  return { ok: true, chase: updated, previousChase: current, blockedControls, activeTier };
}

export function resolveUserChaseRemoval(input: { userId: VaultrUserId; chaseId: string; outcome: ChaseRemovalOutcome }): RemoveUserChaseResult {
  const result = resolveChaseRemoval(input.userId, input.chaseId, input.outcome);
  if (!result.removed || !result.chase) return { ok: false, code: 'CHASE_NOT_FOUND' };
  return { ok: true, removed: true, chase: result.chase, outcome: input.outcome };
}
