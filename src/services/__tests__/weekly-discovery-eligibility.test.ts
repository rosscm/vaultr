import { afterEach, describe, expect, it } from 'vitest';
import { addChase, removeAllChases, resolveChaseRemoval, setUserPlan } from '../chase-store.js';
import { db } from '../db.js';
import {
  evaluateWeeklyDiscoveryEligibility,
  listProUsersEligibleForWeeklyDiscovery,
  weeklyDiscoveryExplicitPreferenceEligibilityForUser,
  weeklyDiscoveryEligibilityForUser
} from '../weekly-discovery-eligibility.js';
import type { Chase } from '../../types.js';
import { createUser } from '../accounts.js';

const userIds: string[] = [];

afterEach(() => {
  for (const userId of userIds.splice(0)) {
    removeAllChases(userId);
    db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
  }
});

function chase(name: string, fields: Partial<Chase> = {}): Chase {
  return {
    id: `test-${name}`,
    userId: 'test-user',
    cardName: name,
    priority: 'NORMAL',
    createdAt: '2026-07-20T00:00:00.000Z',
    ...fields
  };
}

describe('weekly discovery eligibility', () => {
  it('requires five unique collector signals', () => {
    const four = evaluateWeeklyDiscoveryEligibility([
      chase('Mew RC24'),
      chase('Gardevoir ex Paldean Fates 233'),
      chase('Umbreon VMAX Evolving Skies 215'),
      chase('Squirtle 151 170')
    ]);

    expect(four.eligible).toBe(false);
    expect(four.uniqueSignalCount).toBe(4);
    expect(four.signalsNeeded).toBe(1);

    const five = evaluateWeeklyDiscoveryEligibility([
      chase('Mew RC24'),
      chase('Gardevoir ex Paldean Fates 233'),
      chase('Umbreon VMAX Evolving Skies 215'),
      chase('Squirtle 151 170'),
      chase('Dark Blastoise Team Rocket 20')
    ]);

    expect(five.eligible).toBe(true);
    expect(five.uniqueSignalCount).toBe(5);
    expect(five.signalsNeeded).toBe(0);
  });

  it('counts overlapping active and taste-memory signals once', () => {
    const result = evaluateWeeklyDiscoveryEligibility(
      [chase('Mew RC24'), chase('Gardevoir ex Paldean Fates 233'), chase('Squirtle 151 170')],
      [chase('Mew RC24'), chase('Umbreon VMAX Evolving Skies 215')]
    );

    expect(result.uniqueSignalCount).toBe(4);
    expect(result.duplicateSignalCount).toBe(1);
    expect(result.eligible).toBe(false);
  });

  it('does not count removed chase memory toward weekly discovery eligibility', () => {
    const result = evaluateWeeklyDiscoveryEligibility(
      [chase('Mew RC24'), chase('Gardevoir ex Paldean Fates 233'), chase('Squirtle 151 170'), chase('Dark Blastoise Team Rocket 20')],
      [chase('Zapdos Aquapolis H32', { tasteSource: 'REMOVED_CHASE' })]
    );

    expect(result.uniqueSignalCount).toBe(4);
    expect(result.tasteMemoryCount).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it('keeps different canonical printings distinct', () => {
    const result = evaluateWeeklyDiscoveryEligibility([
      chase('Umbreon VMAX Evolving Skies 215', { canonicalCardId: 'swsh7-215' } as Partial<Chase>),
      chase('Umbreon VMAX Brilliant Stars TG23', { canonicalCardId: 'swsh9tg-TG23' } as Partial<Chase>),
      chase('Mew RC24'),
      chase('Gardevoir ex Paldean Fates 233'),
      chase('Squirtle 151 170')
    ]);

    expect(result.uniqueSignalCount).toBe(5);
    expect(result.eligible).toBe(true);
  });

  it('lists only eligible Pro users for automatic weekly discovery', () => {
    const thinUserId = `weekly-eligibility-thin-${Date.now()}`;
    const eligibleUserId = `weekly-eligibility-ready-${Date.now()}`;
    userIds.push(thinUserId, eligibleUserId);
    setUserPlan(thinUserId, 'PRO');
    setUserPlan(eligibleUserId, 'PRO');

    addChase({ userId: thinUserId, cardName: 'Mew RC24', priority: 'NORMAL' });
    addChase({ userId: thinUserId, cardName: 'Gardevoir ex Paldean Fates 233', priority: 'NORMAL' });

    for (let index = 1; index <= 5; index += 1) {
      addChase({ userId: eligibleUserId, cardName: `Eligible Signal ${index}`, priority: 'NORMAL' });
    }

    expect(weeklyDiscoveryEligibilityForUser(thinUserId).eligible).toBe(false);
    expect(listProUsersEligibleForWeeklyDiscovery()).toContain(eligibleUserId);
    expect(listProUsersEligibleForWeeklyDiscovery()).not.toContain(thinUserId);
  });

  it('does not use saved explicit preferences for readiness while the feature is disabled', () => {
    const userId = createUser({ displayName: 'Hidden preference eligibility' }).id;
    userIds.push(userId);
    setUserPlan(userId, 'PRO');
    const now = '2026-10-27T00:00:00.000Z';
    db.prepare(`INSERT INTO user_collector_subject_preferences (user_id, subject_key, subject_label, created_at, updated_at) VALUES (?, 'mew', 'Mew', ?, ?)`).run(userId, now, now);
    const originalFlag = process.env.VAULTR_TASTE_ONBOARDING_ENABLED;
    delete process.env.VAULTR_TASTE_ONBOARDING_ENABLED;
    try {
      expect(weeklyDiscoveryExplicitPreferenceEligibilityForUser(userId)).toBe(false);
      expect(listProUsersEligibleForWeeklyDiscovery()).not.toContain(userId);
      expect(db.prepare('SELECT subject_label FROM user_collector_subject_preferences WHERE user_id = ?').get(userId)).toEqual({ subject_label: 'Mew' });
    } finally {
      db.prepare('DELETE FROM user_collector_subject_preferences WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      if (originalFlag === undefined) delete process.env.VAULTR_TASTE_ONBOARDING_ENABLED;
      else process.env.VAULTR_TASTE_ONBOARDING_ENABLED = originalFlag;
    }
  });

  it('includes eligible Plus collectors whose positive signals are all Pickups', () => {
    const userId = `weekly-eligibility-pickups-${Date.now()}`;
    userIds.push(userId);
    setUserPlan(userId, 'PRO');

    for (let index = 1; index <= 5; index += 1) {
      const saved = addChase({ userId, cardName: `Pickup Signal ${index}`, priority: 'NORMAL' });
      expect(resolveChaseRemoval(userId, saved.id, 'COMPLETED').removed).toBe(true);
    }

    expect(weeklyDiscoveryEligibilityForUser(userId)).toMatchObject({ eligible: true, activeChaseCount: 0, uniqueSignalCount: 5 });
    expect(listProUsersEligibleForWeeklyDiscovery()).toContain(userId);

    setUserPlan(userId, 'PRO', 'CANCELED');
    expect(listProUsersEligibleForWeeklyDiscovery()).not.toContain(userId);
    setUserPlan(userId, 'FREE');
    expect(listProUsersEligibleForWeeklyDiscovery()).not.toContain(userId);
  });
});
