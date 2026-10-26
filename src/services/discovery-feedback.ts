import {
  getUserDiscoveryFeedback,
  getUserPlan,
  recordDiscoveryFeedback,
  recordDiscoveryFeedbackWithTrainingExample,
  undoDiscoveryFeedback,
  type UserDiscoveryFeedback
} from './chase-store.js';
import { getScheduledDiscoveryDrop } from './scheduled-discovery-drops.js';
import { activePlanTier } from './plans.js';
import { discoveryLearningFeatures } from './discovery-learning-features.js';

export type DiscoveryFeedbackAction = UserDiscoveryFeedback | 'UNDO';

export type DiscoveryFeedbackResult =
  | { ok: true; feedback: ReturnType<typeof getUserDiscoveryFeedback> }
  | { ok: false; code: 'INVALID_ACTION' | 'RECOMMENDATION_NOT_FOUND' | 'STALE_FEEDBACK' | 'PLUS_REQUIRED' };

export function applyResolvedDiscoveryFeedback(input: {
  userId: string;
  cardName: string;
  lane: string;
  action: UserDiscoveryFeedback;
  maxPrice?: number;
}): DiscoveryFeedbackResult {
  if (activePlanTier(getUserPlan(input.userId)) !== 'PRO') return { ok: false, code: 'PLUS_REQUIRED' };
  const feedback = recordDiscoveryFeedback({
    userId: input.userId,
    cardName: input.cardName,
    lane: input.lane,
    feedback: input.action,
    maxPrice: input.maxPrice
  });
  return { ok: true, feedback };
}

function preparedFeedbackContext(input: {
  userId: string;
  periodKey: string;
  position: number;
  item: NonNullable<ReturnType<typeof getScheduledDiscoveryDrop>>['items'][number];
}) {
  const suggestion = input.item.suggestion;
  return {
    userId: input.userId,
    surface: 'WEB_DISPLAY_CASE',
    periodKey: input.periodKey,
    suggestionName: suggestion.name,
    lane: suggestion.lane,
    position: input.position,
    rankerVersion: 'prepared-display-case-v1',
    features: {
      ...discoveryLearningFeatures(suggestion),
      canonicalReference: suggestion.canonicalReference,
      generationStrategies: suggestion.generationStrategies ?? [],
      generationReasons: suggestion.generationReasons ?? [],
      discoveryRole: suggestion.discoveryRole,
      sourceTasteTokens: suggestion.sourceTasteTokens ?? [],
      strongestSignals: suggestion.rankExplanation?.strongestSignals ?? [],
      noveltyReason: suggestion.rankExplanation?.noveltyReason
    },
    scores: suggestion.rankExplanation?.scoreComponents ?? {}
  };
}

export function applyPreparedDiscoveryFeedback(input: {
  userId: string;
  periodKey: string;
  position: number;
  action: DiscoveryFeedbackAction;
  expectedVersion?: number;
}): DiscoveryFeedbackResult {
  if (!['MORE_LIKE_THIS', 'NOT_FOR_ME', 'UNDO'].includes(input.action)) return { ok: false, code: 'INVALID_ACTION' };
  const drop = getScheduledDiscoveryDrop(input.userId, 'WEEKLY_DISCOVERY', input.periodKey);
  const item = drop?.items.find((candidate) => candidate.position === input.position);
  if (!item) return { ok: false, code: 'RECOMMENDATION_NOT_FOUND' };

  if (input.action === 'UNDO') {
    const current = getUserDiscoveryFeedback(input.userId, item.suggestion.name);
    if (!current) return { ok: true, feedback: null };
    if (!Number.isInteger(input.expectedVersion) || current.version !== input.expectedVersion) {
      return { ok: false, code: 'STALE_FEEDBACK' };
    }
    const undone = undoDiscoveryFeedback({
      userId: input.userId,
      cardName: item.suggestion.name,
      expectedVersion: input.expectedVersion
    });
    if (!undone) return { ok: false, code: 'STALE_FEEDBACK' };
    return { ok: true, feedback: null };
  }

  if (activePlanTier(getUserPlan(input.userId)) !== 'PRO') return { ok: false, code: 'PLUS_REQUIRED' };

  const example = preparedFeedbackContext({
    userId: input.userId,
    periodKey: input.periodKey,
    position: input.position,
    item
  });

  const feedback = recordDiscoveryFeedbackWithTrainingExample({
    userId: input.userId,
    cardName: item.suggestion.name,
    lane: item.suggestion.lane,
    feedback: input.action,
    maxPrice: item.market.askingTotal ?? item.market.soldTotal,
    example
  });
  return { ok: true, feedback };
}
