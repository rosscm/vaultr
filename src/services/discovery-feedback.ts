import {
  getUserDiscoveryFeedback,
  recordDiscoveryFeedback,
  undoDiscoveryFeedback,
  type UserDiscoveryFeedback
} from './chase-store.js';
import { getScheduledDiscoveryDrop } from './scheduled-discovery-drops.js';

export type DiscoveryFeedbackAction = UserDiscoveryFeedback | 'UNDO';

export type DiscoveryFeedbackResult =
  | { ok: true; feedback: ReturnType<typeof getUserDiscoveryFeedback> }
  | { ok: false; code: 'INVALID_ACTION' | 'RECOMMENDATION_NOT_FOUND' | 'STALE_FEEDBACK' };

export function applyResolvedDiscoveryFeedback(input: {
  userId: string;
  cardName: string;
  lane: string;
  action: UserDiscoveryFeedback;
  maxPrice?: number;
}) {
  return recordDiscoveryFeedback({
    userId: input.userId,
    cardName: input.cardName,
    lane: input.lane,
    feedback: input.action,
    maxPrice: input.maxPrice
  });
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

  const feedback = applyResolvedDiscoveryFeedback({
    userId: input.userId,
    cardName: item.suggestion.name,
    lane: item.suggestion.lane,
    action: input.action,
    maxPrice: item.market.askingTotal ?? item.market.soldTotal
  });
  return { ok: true, feedback };
}
