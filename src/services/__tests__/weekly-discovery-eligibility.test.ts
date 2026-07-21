import { afterEach, describe, expect, it } from 'vitest';
import { addChase, removeAllChases, setUserPlan } from '../chase-store.js';
import {
  evaluateWeeklyDiscoveryEligibility,
  listProUsersEligibleForWeeklyDiscovery,
  weeklyDiscoveryEligibilityForUser
} from '../weekly-discovery-eligibility.js';
import type { Chase } from '../../types.js';

const userIds: string[] = [];

afterEach(() => {
  for (const userId of userIds.splice(0)) removeAllChases(userId);
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
});
