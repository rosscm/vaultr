import type { Chase } from '../types.js';
import {
  createChaseForUser,
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
  CONDITION_CHOICES,
  GRADE_VALUE_CHOICES,
  gradeSelectionWarning,
  GRADING_TYPE_CHOICES,
  inferGradingTypeFromGrade,
  LISTING_TYPE_CHOICES,
  normalizeConditionChoice,
  PRIORITY_CHOICES,
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
  | 'INVALID_INPUT'
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
  field?: ChaseInputField;
  message?: string;
  blockedControls?: ChaseAdvancedControl[];
  duplicateChase?: Chase;
  maxChases?: number;
  activeTier?: 'FREE' | 'PRO';
};

export type ChaseInputField =
  | 'userId'
  | 'guildId'
  | 'cardName'
  | 'maxPrice'
  | 'gradingType'
  | 'gradeValue'
  | 'condition'
  | 'listingType'
  | 'priority'
  | 'targetNote'
  | 'customExclusions';

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
const MAX_CARD_NAME_LENGTH = 100;
const MIN_CARD_NAME_LENGTH = 3;
const MAX_TARGET_NOTE_LENGTH = 120;
const MAX_CUSTOM_EXCLUSIONS_INPUT_LENGTH = 240;

type ValidationResult<T> = { ok: true; value: T } | ChaseServiceError;

function invalidInput(field: ChaseInputField, message: string): ChaseServiceError {
  return { ok: false, code: 'INVALID_INPUT', field, message };
}

function isOneOf<T extends string>(value: unknown, choices: readonly { value: T }[]): value is T {
  return typeof value === 'string' && choices.some((choice) => choice.value === value);
}

function validateGuildId(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return typeof value === 'string'
    ? { ok: true, value }
    : invalidInput('guildId', 'guildId must be a string');
}

function validateCardName(value: unknown, options: { normalizeAlias: boolean }): ValidationResult<{ displayName: string; normalizedName: string }> {
  if (typeof value !== 'string') return invalidInput('cardName', 'cardName must be a string');
  const displayName = value.trim().replace(/\s+/g, ' ');
  if (displayName.length < MIN_CARD_NAME_LENGTH) return invalidInput('cardName', `cardName must be at least ${MIN_CARD_NAME_LENGTH} characters`);
  if (displayName.length > MAX_CARD_NAME_LENGTH) return invalidInput('cardName', `cardName must be ${MAX_CARD_NAME_LENGTH} characters or fewer`);
  const normalizedName = normalizeChaseCardName(displayName);
  if (normalizedName.length > MAX_CARD_NAME_LENGTH) return invalidInput('cardName', `cardName must be ${MAX_CARD_NAME_LENGTH} characters or fewer after normalization`);
  return { ok: true, value: { displayName: options.normalizeAlias ? normalizedName : displayName, normalizedName } };
}

function validateMaxPrice(value: unknown, options: { allowNullClear?: boolean } = {}): ValidationResult<number | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null && options.allowNullClear) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalidInput('maxPrice', 'maxPrice must be a finite number');
  if (value < 0.01) return invalidInput('maxPrice', 'maxPrice must be at least 0.01');
  return { ok: true, value };
}

function validateGradingType(value: unknown): ValidationResult<GradingType | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  return isOneOf(value, GRADING_TYPE_CHOICES)
    ? { ok: true, value }
    : invalidInput('gradingType', 'gradingType is not supported');
}

function validateGradeValue(value: unknown): ValidationResult<GradeValue | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  return isOneOf(value, GRADE_VALUE_CHOICES)
    ? { ok: true, value }
    : invalidInput('gradeValue', 'gradeValue is not supported');
}

function validateCondition(value: unknown): ValidationResult<ConditionChoice | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  return isOneOf(value, CONDITION_CHOICES)
    ? { ok: true, value }
    : invalidInput('condition', 'condition is not supported');
}

function validateListingType(value: unknown): ValidationResult<ChaseListingTypeInput | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  return isOneOf(value, LISTING_TYPE_CHOICES)
    ? { ok: true, value }
    : invalidInput('listingType', 'listingType is not supported');
}

function validatePriority(value: unknown): ValidationResult<ChasePriorityInput | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  return isOneOf(value, PRIORITY_CHOICES)
    ? { ok: true, value }
    : invalidInput('priority', 'priority is not supported');
}

function validateTargetNote(value: unknown, options: { allowNullClear?: boolean } = {}): ValidationResult<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null && options.allowNullClear) return { ok: true, value: null };
  if (typeof value !== 'string') return invalidInput('targetNote', 'targetNote must be a string');
  if (value.length > MAX_TARGET_NOTE_LENGTH) return invalidInput('targetNote', `targetNote must be ${MAX_TARGET_NOTE_LENGTH} characters or fewer`);
  return { ok: true, value };
}

function validateCustomExclusionsInput(value: unknown): ValidationResult<string | string[] | null | undefined> {
  if (value === undefined || value === null) return { ok: true, value: value as null | undefined };
  if (typeof value === 'string') {
    if (value.length > MAX_CUSTOM_EXCLUSIONS_INPUT_LENGTH) {
      return invalidInput('customExclusions', `customExclusions must be ${MAX_CUSTOM_EXCLUSIONS_INPUT_LENGTH} characters or fewer`);
    }
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === 'string')) {
      return invalidInput('customExclusions', 'customExclusions array entries must be strings');
    }
    return { ok: true, value };
  }
  return invalidInput('customExclusions', 'customExclusions must be a string or array of strings');
}

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
  const guildId = validateGuildId(input.guildId);
  if (!guildId.ok) return guildId;
  const cardName = validateCardName(input.cardName, { normalizeAlias: false });
  if (!cardName.ok) return cardName;
  const maxPrice = validateMaxPrice(input.maxPrice);
  if (!maxPrice.ok) return maxPrice;
  const gradingType = validateGradingType(input.gradingType);
  if (!gradingType.ok) return gradingType;
  const gradeValue = validateGradeValue(input.gradeValue);
  if (!gradeValue.ok) return gradeValue;
  const condition = validateCondition(input.condition);
  if (!condition.ok) return condition;
  const listingType = validateListingType(input.listingType);
  if (!listingType.ok) return listingType;
  const priority = validatePriority(input.priority);
  if (!priority.ok) return priority;
  const targetNote = validateTargetNote(input.targetNote);
  if (!targetNote.ok) return targetNote;
  const customExclusionsInput = validateCustomExclusionsInput(input.customExclusions);
  if (!customExclusionsInput.ok) return customExclusionsInput;

  const plan = getUserPlan(input.userId);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const maxChases = PLAN_LIMITS[activeTier].maxActiveChases;

  const normalizedCardName = cardName.value.normalizedName;
  const existingDuplicate = duplicateForName(listChases(input.userId), normalizedCardName);
  if (existingDuplicate) return { ok: false, code: 'DUPLICATE_CHASE', duplicateChase: existingDuplicate };

  const gradeWarning = gradeSelectionWarning(gradingType.value ?? null, gradeValue.value ?? null);
  if (gradeWarning) return invalidGradeResult(gradeWarning);
  const grade = buildGradePreference(gradingType.value ?? null, gradeValue.value ?? null) ?? undefined;
  const blockedControls = entitlements.advancedFiltering ? [] : requestedAddAdvancedControls(input);
  const canUseAdvanced = entitlements.advancedFiltering;
  const parsedCustomExclusions = parseCustomExclusions(customExclusionsInput.value);
  if (parsedCustomExclusions && parsedCustomExclusions.length > MAX_CUSTOM_EXCLUSIONS) {
    return { ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' };
  }
  const customExclusions = canUseAdvanced ? parsedCustomExclusions : undefined;

  const trustedPreview = trustedChasePreviewForPersistence(cardName.value.displayName, normalizedCardName);
  const persistedCardName = trustedPreview?.imageIdentity ?? cardName.value.displayName;
  const createResult = createChaseForUser({
    userId: input.userId,
    guildId: guildId.value,
    cardName: persistedCardName,
    cardImageUrl: trustedPreview?.imageUrl,
    cardImageIdentity: trustedPreview?.imageIdentity,
    cardImageSourceName: trustedPreview?.imageSourceName,
    cardImageSourceKind: trustedPreview?.imageSourceKind,
    cardImageSourceCardId: trustedPreview?.imageSourceCardId,
    priority: canUseAdvanced ? priority.value ?? 'NORMAL' : 'NORMAL',
    targetNote: canUseAdvanced ? targetNote.value ?? undefined : undefined,
    maxPrice: maxPrice.value ?? undefined,
    grade,
    condition: canUseAdvanced ? normalizeConditionChoice(condition.value ?? null) ?? undefined : undefined,
    listingType: canUseAdvanced ? listingType.value ?? 'ANY' : 'ANY',
    negativeKeywords: customExclusions && customExclusions.length > 0 ? customExclusions : undefined
  }, { maxChases });
  if (createResult.status === 'LIMIT_REACHED') return { ok: false, code: 'VAULT_LIMIT_REACHED', maxChases, activeTier };
  if (createResult.status === 'DUPLICATE') return { ok: false, code: 'DUPLICATE_CHASE', duplicateChase: createResult.chase };

  return {
    ok: true,
    chase: createResult.chase,
    blockedControls,
    previousChaseCount: createResult.previousCount,
    isFirstChase: createResult.previousCount === 0,
    activeTier
  };
}

export function updateUserChase(input: { userId: VaultrUserId; chaseId: string; changes: UpdateUserChaseChanges }): UpdateUserChaseResult {
  if (!input.changes || typeof input.changes !== 'object') {
    return invalidInput('cardName', 'changes must be an object');
  }
  const chases = listChases(input.userId);
  const current = chases.find((chase) => chase.id === input.chaseId);
  if (!current) return { ok: false, code: 'CHASE_NOT_FOUND' };
  const changes = input.changes;
  const hasRequestedChange = Object.values(changes).some((value) => value !== undefined);
  if (!hasRequestedChange) return { ok: false, code: 'NO_CHANGES_REQUESTED' };

  const cardNameValidation = changes.cardName !== undefined ? validateCardName(changes.cardName, { normalizeAlias: false }) : undefined;
  if (cardNameValidation && !cardNameValidation.ok) return cardNameValidation;
  const maxPrice = validateMaxPrice(changes.maxPrice, { allowNullClear: true });
  if (!maxPrice.ok) return maxPrice;
  const gradingType = validateGradingType(changes.gradingType);
  if (!gradingType.ok) return gradingType;
  const gradeValue = validateGradeValue(changes.gradeValue);
  if (!gradeValue.ok) return gradeValue;
  const condition = validateCondition(changes.condition);
  if (!condition.ok) return condition;
  const listingType = validateListingType(changes.listingType);
  if (!listingType.ok) return listingType;
  const priority = validatePriority(changes.priority);
  if (!priority.ok) return priority;
  const targetNote = validateTargetNote(changes.targetNote, { allowNullClear: true });
  if (!targetNote.ok) return targetNote;
  const customExclusionsInput = validateCustomExclusionsInput(changes.customExclusions);
  if (!customExclusionsInput.ok) return customExclusionsInput;

  const effectiveGradingType = gradingType.value ?? (gradeValue.value !== undefined && gradeValue.value !== null ? inferGradingTypeFromGrade(current.grade) ?? null : null);
  const gradeWarning = gradeSelectionWarning(effectiveGradingType, gradeValue.value ?? null);
  if (gradeWarning) return invalidGradeResult(gradeWarning);
  const grade = buildGradePreference(effectiveGradingType, gradeValue.value ?? null);

  const plan = getUserPlan(input.userId);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const blockedControls = entitlements.advancedFiltering ? [] : requestedEditAdvancedControls(changes);
  const canUseAdvanced = entitlements.advancedFiltering;
  const parsedNegativeKeywords = parseCustomExclusions(customExclusionsInput.value, { noneClears: true });
  if (parsedNegativeKeywords && parsedNegativeKeywords.length > MAX_CUSTOM_EXCLUSIONS) {
    return { ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' };
  }
  const negativeKeywords = canUseAdvanced ? parsedNegativeKeywords : undefined;

  const cardName = cardNameValidation?.ok ? cardNameValidation.value.displayName : undefined;
  const normalizedCardName = cardNameValidation?.ok ? cardNameValidation.value.normalizedName : undefined;
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
    priority: canUseAdvanced ? priority.value ?? undefined : undefined,
    targetNote: canUseAdvanced
      ? targetNote.value === null ? null : targetNote.value === undefined ? undefined : /^none$/i.test(targetNote.value.trim()) ? null : targetNote.value
      : undefined,
    maxPrice: maxPrice.value,
    grade,
    condition: canUseAdvanced ? normalizeConditionChoice(condition.value ?? null) : undefined,
    listingType: canUseAdvanced ? listingType.value ?? undefined : undefined,
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
