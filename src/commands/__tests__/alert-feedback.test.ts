import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAlertFeedback, inferAlertTuningSuggestion } from '../alert-feedback.js';
import {
  addChase,
  claimAlertFingerprintForSending,
  claimAlertForSending,
  getChase,
  markAlertSentWithDetails,
  recordAlertFeedback,
  releaseAlertFingerprintSendClaim,
  releaseIncompleteAlertSendClaim,
  removeAllChases,
  setUserPlan
} from '../../services/chase-store.js';
import { makeAlertFeedbackToken } from '../../services/alert-feedback-token.js';
import { db } from '../../services/db.js';

const testUserIds = new Set<string>();

function testUserId(label: string): string {
  const userId = `test-feedback-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(userId);
  return userId;
}

function recordSentAlert(userId: string, chaseId: string, listingId: string, listingTitle: string): string {
  markAlertSentWithDetails(chaseId, userId, listingId, 'EBAY', {
    listingTitle,
    listingPrice: 100,
    listingCurrency: 'USD',
    listingUrl: `https://example.com/${listingId}`,
    matchScore: 80
  });
  return makeAlertFeedbackToken(chaseId, listingId);
}

function selectReasonInteraction(userId: string, chaseId: string, feedbackToken: string, reason = 'WRONG_CARD') {
  const update = vi.fn(async (_payload: unknown) => undefined);
  return {
    user: { id: userId },
    customId: `alert-feedback-reason:${chaseId}:${feedbackToken}`,
    values: [reason],
    isStringSelectMenu: () => true,
    isButton: () => false,
    update
  };
}

function applyTuningInteraction(userId: string, chaseId: string, feedbackToken: string) {
  const update = vi.fn(async (_payload: unknown) => undefined);
  return {
    user: { id: userId },
    customId: `alert-tuning-apply:${chaseId}:${feedbackToken}`,
    isStringSelectMenu: () => false,
    isButton: () => true,
    update
  };
}

afterEach(() => {
  for (const userId of testUserIds) {
    removeAllChases(userId);
    db.prepare('DELETE FROM alert_feedback WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_fingerprint_claims WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sent_alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM ignored_listing_fingerprints WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  }
  testUserIds.clear();
});

describe('alert feedback tuning', () => {
  it('infers chase tuning only after repeated title patterns', () => {
    expect(
      inferAlertTuningSuggestion([
        { listingTitle: 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM' }
      ])
    ).toBeNull();

    expect(
      inferAlertTuningSuggestion([
        { listingTitle: 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM' },
        { listingTitle: 'Umbreon ex SAR 217/187 Terastal Festival Korean Pokemon Card' }
      ])
    ).toMatchObject({ label: 'Korean variants', terms: ['korean'], count: 2 });
  });

  it('offers Pro users a feedback-powered chase rule and applies it', async () => {
    const userId = testUserId('pro-apply');
    setUserPlan(userId, 'PRO');
    const chase = addChase({ userId, cardName: 'Umbreon 217/187', negativeKeywords: ['proxy'] });
    const firstToken = recordSentAlert(userId, chase.id, 'v1|korean-one|0', 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM');
    recordAlertFeedback(userId, chase.id, 'v1|korean-one|0', 'TUNE_OUT', 'WRONG_CARD');
    const secondToken = recordSentAlert(userId, chase.id, 'v1|korean-two|0', 'Umbreon ex SAR 217/187 Terastal Festival Korean Pokemon Card');

    const reasonInteraction = selectReasonInteraction(userId, chase.id, secondToken);
    await handleAlertFeedback(reasonInteraction);

    expect(reasonInteraction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Vaultr noticed 2 recent tune-outs for Korean variants'),
      components: expect.any(Array)
    }));
    const reasonUpdate = reasonInteraction.update.mock.calls[0]?.[0] as { components?: unknown[] } | undefined;
    expect(reasonUpdate?.components).toHaveLength(1);

    const applyInteraction = applyTuningInteraction(userId, chase.id, firstToken);
    await handleAlertFeedback(applyInteraction);

    expect(applyInteraction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Applied. Vaultr will now exclude Korean variants')
    }));
    expect(getChase(userId, chase.id)?.negativeKeywords).toEqual(['proxy', 'korean']);
  });

  it('shows Free users the learned pattern without applying persistent chase tuning', async () => {
    const userId = testUserId('free-pattern');
    setUserPlan(userId, 'FREE');
    const chase = addChase({ userId, cardName: 'Umbreon 217/187', negativeKeywords: ['proxy'] });
    recordSentAlert(userId, chase.id, 'v1|korean-one|0', 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM');
    recordAlertFeedback(userId, chase.id, 'v1|korean-one|0', 'TUNE_OUT', 'WRONG_CARD');
    const secondToken = recordSentAlert(userId, chase.id, 'v1|korean-two|0', 'Umbreon ex SAR 217/187 Terastal Festival Korean Pokemon Card');

    const reasonInteraction = selectReasonInteraction(userId, chase.id, secondToken);
    await handleAlertFeedback(reasonInteraction);

    expect(reasonInteraction.update).toHaveBeenCalledWith({
      content: expect.stringContaining('Pro can turn that into an automatic chase rule.'),
      components: []
    });
    expect(getChase(userId, chase.id)?.negativeKeywords).toEqual(['proxy']);
  });

  it('claims an alert before send so concurrent senders skip the same listing', () => {
    const userId = testUserId('claim');
    const chase = addChase({ userId, cardName: 'Mew RC24/RC25' });

    expect(claimAlertForSending(chase.id, userId, 'v1|claim|0', 'EBAY')).toBe(true);
    expect(claimAlertForSending(chase.id, userId, 'v1|claim|0', 'EBAY')).toBe(false);

    releaseIncompleteAlertSendClaim(chase.id, 'v1|claim|0', 'EBAY');
    expect(claimAlertForSending(chase.id, userId, 'v1|claim|0', 'EBAY')).toBe(true);
  });

  it('claims an alert fingerprint so sibling listing ids do not send duplicate DMs', () => {
    const userId = testUserId('fingerprint-claim');
    const chase = addChase({ userId, cardName: 'Umbreon 217/187' });
    const fingerprint = 'umbreon sar 217/187 pokemon card sv8af terastal festival';

    expect(claimAlertFingerprintForSending(userId, chase.id, fingerprint, 'v1|168356809748|467862061788', 'EBAY')).toBe(true);
    expect(claimAlertFingerprintForSending(userId, chase.id, fingerprint, 'v1|168356809748|0', 'EBAY')).toBe(false);

    releaseAlertFingerprintSendClaim(userId, chase.id, fingerprint, 'v1|168356809748|467862061788', 'EBAY');
    expect(claimAlertFingerprintForSending(userId, chase.id, fingerprint, 'v1|168356809748|0', 'EBAY')).toBe(true);
  });
});