import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';
import {
  createChaseForUser,
  listChases,
  listCompletedChases,
  listUserTasteMemoryChases,
  removeAllChases,
  setUserPlan
} from '../chase-store.js';
import {
  __chaseCardCatalogTestHooks,
  clearChaseCardAutocompleteCache
} from '../chase-card-catalog.js';
import {
  addUserChase,
  getVaultChases,
  resolveUserChaseRemoval,
  updateUserChase
} from '../chase-service.js';
import { PLAN_LIMITS } from '../plans.js';
import { db } from '../db.js';
import { matchChaseToListing } from '../matcher.js';

const testUserIds = new Set<string>();

function userId(label: string): string {
  const id = `svc-chase-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(id);
  return id;
}

function cleanupUser(id: string): void {
  removeAllChases(id);
  db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(id);
}

afterEach(() => {
  clearChaseCardAutocompleteCache();
  for (const id of testUserIds) cleanupUser(id);
  testUserIds.clear();
});

describe('chase service', () => {
  it('adds, normalizes, lists, and rejects duplicate chases for an internal Vaultr user id', () => {
    const id = userId('add');
    const first = addUserChase({ userId: id, cardName: '  Mew   RC24  ', maxPrice: 120 });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.chase.cardName).toBe('Mew RC24');
    expect(first.chase.maxPrice).toBe(120);
    expect(first.isFirstChase).toBe(true);
    expect(getVaultChases(id).chases.map((view) => view.chase.cardName)).toEqual(['Mew RC24']);

    const duplicate = addUserChase({ userId: id, cardName: 'Mew RC24' });
    expect(duplicate).toMatchObject({ ok: false, code: 'DUPLICATE_CHASE' });
  });

  it('rejects malformed add input before persistence', () => {
    const cases: Array<{ patch: Record<string, unknown>; field: string; code?: string }> = [
      { patch: { cardName: '' }, field: 'cardName' },
      { patch: { cardName: 'ab' }, field: 'cardName' },
      { patch: { cardName: 'x'.repeat(101) }, field: 'cardName' },
      { patch: { maxPrice: 0 }, field: 'maxPrice' },
      { patch: { maxPrice: -1 }, field: 'maxPrice' },
      { patch: { maxPrice: Number.NaN }, field: 'maxPrice' },
      { patch: { maxPrice: Number.POSITIVE_INFINITY }, field: 'maxPrice' },
      { patch: { gradingType: 'NOPE' }, field: 'gradingType' },
      { patch: { gradeValue: 'PSA_10' }, field: 'gradeValue' },
      { patch: { condition: 'BANANAS' }, field: 'condition' },
      { patch: { listingType: 'BEST_OFFER' }, field: 'listingType' },
      { patch: { priority: 'URGENT' }, field: 'priority' },
      { patch: { targetNote: 'n'.repeat(121) }, field: 'targetNote' },
      { patch: { targetNote: { text: 'bad' } }, field: 'targetNote' },
      { patch: { customExclusions: 'x'.repeat(241) }, field: 'customExclusions' },
      { patch: { customExclusions: ['proxy', { nested: true }] }, field: 'customExclusions' },
      { patch: { guildId: 12345 }, field: 'guildId' }
    ];

    for (const testCase of cases) {
      const id = userId(`bad-add-${testCase.field}`);
      const result = addUserChase({ userId: id, cardName: 'Mew RC24', ...testCase.patch } as any);
      expect(result).toMatchObject({ ok: false, code: testCase.code ?? 'INVALID_INPUT', field: testCase.field });
      expect(listChases(id)).toHaveLength(0);
    }

    const tooManyUser = userId('bad-add-too-many');
    const tooMany = addUserChase({
      userId: tooManyUser,
      cardName: 'Mew RC24',
      customExclusions: Array.from({ length: 16 }, (_, index) => `term-${index}`)
    } as any);
    expect(tooMany).toMatchObject({ ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' });
    expect(listChases(tooManyUser)).toHaveLength(0);
  });

  it('accepts valid untyped add input after service validation', () => {
    const id = userId('valid-runtime-add');
    setUserPlan(id, 'PRO');
    const result = addUserChase({
      userId: id,
      guildId: 'guild-1',
      cardName: '  Gardevoir ex 233/091  ',
      maxPrice: 100.5,
      gradingType: 'PSA',
      gradeValue: '10',
      condition: 'NM_OR_BETTER',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'clean copy',
      customExclusions: ['proxy', 'played']
    } as any);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chase).toMatchObject({
      guildId: 'guild-1',
      cardName: 'Gardevoir ex 233/091',
      maxPrice: 100.5,
      grade: 'PSA 10',
      condition: 'NM',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'clean copy',
      negativeKeywords: ['played']
    });
  });

  it('enforces Free and Pro chase limits through the shared service', () => {
    const freeUser = userId('free-limit');
    for (let index = 0; index < PLAN_LIMITS.FREE.maxActiveChases; index += 1) {
      expect(addUserChase({ userId: freeUser, cardName: `Free Card ${index}` }).ok).toBe(true);
    }
    const completedCandidate = listChases(freeUser)[0];
    expect(completedCandidate).toBeTruthy();
    if (completedCandidate) {
      expect(resolveUserChaseRemoval({ userId: freeUser, chaseId: completedCandidate.id, outcome: 'COMPLETED' })).toMatchObject({ ok: true });
      expect(addUserChase({ userId: freeUser, cardName: 'Replacement Active Card' }).ok).toBe(true);
    }
    expect(addUserChase({ userId: freeUser, cardName: 'One Too Many' })).toMatchObject({
      ok: false,
      code: 'VAULT_LIMIT_REACHED',
      maxChases: PLAN_LIMITS.FREE.maxActiveChases
    });

    const proUser = userId('pro-limit');
    setUserPlan(proUser, 'PRO');
    for (let index = 0; index < PLAN_LIMITS.FREE.maxActiveChases + 1; index += 1) {
      expect(addUserChase({ userId: proUser, cardName: `Pro Card ${index}` }).ok).toBe(true);
    }
    expect(getVaultChases(proUser).plan.maxActiveChases).toBe(PLAN_LIMITS.PRO.maxActiveChases);
  });

  it('applies grade and Pro-only controls only when entitled', () => {
    const freeUser = userId('free-controls');
    const free = addUserChase({
      userId: freeUser,
      cardName: 'Umbreon VMAX TG23',
      gradingType: 'RAW',
      gradeValue: '10',
      condition: 'NM_OR_BETTER',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'mint copy',
      customExclusions: 'played, proxy'
    });
    expect(free).toMatchObject({
      ok: false,
      code: 'INVALID_GRADE_PREFERENCE'
    });

    const blocked = addUserChase({
      userId: freeUser,
      cardName: 'Umbreon VMAX TG23',
      gradingType: 'RAW',
      condition: 'NM_OR_BETTER',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'mint copy',
      customExclusions: 'played, proxy'
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.blockedControls).toEqual(['condition', 'listing type', 'priority', 'note', 'custom exclusions']);
    expect(blocked.chase).toMatchObject({ grade: 'UNGRADED', listingType: 'ANY', priority: 'NORMAL' });
    expect(blocked.chase.condition).toBeUndefined();
    expect(blocked.chase.targetNote).toBeUndefined();
    expect(blocked.chase.negativeKeywords).toBeUndefined();

    const proUser = userId('pro-controls');
    setUserPlan(proUser, 'PRO');
    const pro = addUserChase({
      userId: proUser,
      cardName: 'Gardevoir ex 233/091',
      condition: 'NM_OR_BETTER',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'clean raw copy',
      customExclusions: 'played, proxy'
    });
    expect(pro.ok).toBe(true);
    if (!pro.ok) return;
    expect(pro.chase).toMatchObject({
      condition: 'NM',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL',
      targetNote: 'clean raw copy',
      negativeKeywords: ['played']
    });
  });

  it('persists only trusted exact-printing chase images and survives cache expiry', () => {
    const id = userId('image');
    __chaseCardCatalogTestHooks.cachePreview('Mew RC24', {
      imageUrl: 'https://images.pokemontcg.io/rc/24_hires.png',
      imageIdentity: 'Mew RC24',
      imageSourceName: 'Pokemon TCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'rc-24'
    });
    const added = addUserChase({ userId: id, cardName: 'Mew RC24' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    clearChaseCardAutocompleteCache();
    expect(listChases(id)[0]).toMatchObject({
      cardImageUrl: 'https://images.pokemontcg.io/rc/24_hires.png',
      cardImageIdentity: 'Mew RC24',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: 'rc-24'
    });

    const mismatchUser = userId('bad-image');
    __chaseCardCatalogTestHooks.cachePreview('Pichu Expedition 22/165', {
      imageUrl: 'https://example.test/mew.png',
      imageIdentity: 'Mew RC24',
      imageSourceName: 'Pokemon TCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'rc-24'
    });
    const mismatch = addUserChase({ userId: mismatchUser, cardName: 'Pichu Expedition 22/165' });
    expect(mismatch.ok).toBe(true);
    if (!mismatch.ok) return;
    expect(mismatch.chase.cardImageUrl).toBeUndefined();
  });

  it('preserves unresolved freeform chase text without inferring catalog semantics', () => {
    const id = userId('freeform-display');

    const freeform = addUserChase({ userId: id, cardName: '  mew   corocoro  ' });

    expect(freeform.ok).toBe(true);
    if (!freeform.ok) return;
    expect(freeform.chase.cardName).toBe('mew corocoro');
    expect(freeform.chase.queryName).toBe('mew corocoro');
    expect(freeform.chase.cardImageUrl).toBeUndefined();

    __chaseCardCatalogTestHooks.cachePreview('Mew RC24', {
      imageUrl: 'https://images.pokemontcg.io/rc/24_hires.png',
      imageIdentity: 'Mew RC24',
      imageSourceName: 'Pokemon TCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'rc-24'
    });
    const trusted = addUserChase({ userId: id, cardName: 'Mew RC24' });

    expect(trusted.ok).toBe(true);
    if (!trusted.ok) return;
    expect(trusted.chase.cardName).toBe('Mew RC24');
    expect(trusted.chase.cardImageUrl).toBe('https://images.pokemontcg.io/rc/24_hires.png');
  });

  it('updates owned chases, rejects cross-user and duplicate edits, and clears stale image metadata on rename', () => {
    const id = userId('edit');
    const otherId = userId('edit-other');
    __chaseCardCatalogTestHooks.cachePreview('Mew RC24', {
      imageUrl: 'https://images.pokemontcg.io/rc/24_hires.png',
      imageIdentity: 'Mew RC24',
      imageSourceName: 'Pokemon TCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'rc-24'
    });
    const first = addUserChase({ userId: id, cardName: 'Mew RC24' });
    const second = addUserChase({ userId: id, cardName: 'Pichu Expedition 22/165' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(updateUserChase({ userId: otherId, chaseId: first.chase.id, changes: { maxPrice: 50 } })).toMatchObject({
      ok: false,
      code: 'CHASE_NOT_FOUND'
    });
    expect(updateUserChase({ userId: id, chaseId: second.chase.id, changes: { cardName: 'Mew RC24' } })).toMatchObject({
      ok: false,
      code: 'DUPLICATE_CHASE'
    });

    const renamed = updateUserChase({
      userId: id,
      chaseId: first.chase.id,
      changes: { cardName: 'Mew CoroCoro Promo 151', maxPrice: 250 }
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.chase.cardName).toBe('Mew CoroCoro Promo 151');
    expect(renamed.chase.maxPrice).toBe(250);
    expect(renamed.chase.cardImageUrl).toBeUndefined();
    expect(renamed.chase.queryName).toContain('Mew');
    expect(renamed.chase.queryName).not.toContain('RC24');
  });

  it('rejects malformed edit input without mutating the chase', () => {
    const id = userId('bad-edit');
    setUserPlan(id, 'PRO');
    const added = addUserChase({
      userId: id,
      cardName: 'Pichu Expedition 22/165',
      maxPrice: 80,
      condition: 'NM_OR_BETTER',
      priority: 'HIGH'
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const cases: Array<{ changes: Record<string, unknown>; field: string }> = [
      { changes: { cardName: '  ' }, field: 'cardName' },
      { changes: { cardName: 'ab' }, field: 'cardName' },
      { changes: { maxPrice: 0 }, field: 'maxPrice' },
      { changes: { maxPrice: Number.NEGATIVE_INFINITY }, field: 'maxPrice' },
      { changes: { gradingType: 'BAD' }, field: 'gradingType' },
      { changes: { gradeValue: 'PSA_10' }, field: 'gradeValue' },
      { changes: { condition: 'BANANAS' }, field: 'condition' },
      { changes: { listingType: 'MARKETPLACE' }, field: 'listingType' },
      { changes: { priority: 'MUST_HAVE' }, field: 'priority' },
      { changes: { targetNote: 'n'.repeat(121) }, field: 'targetNote' },
      { changes: { targetNote: { text: 'bad' } }, field: 'targetNote' },
      { changes: { customExclusions: ['proxy', 123] }, field: 'customExclusions' }
    ];

    for (const testCase of cases) {
      const result = updateUserChase({ userId: id, chaseId: added.chase.id, changes: testCase.changes as any });
      expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT', field: testCase.field });
      expect(listChases(id)[0]).toMatchObject({
        cardName: 'Pichu Expedition 22/165',
        maxPrice: 80,
        condition: 'NM',
        priority: 'HIGH'
      });
    }

    const tooMany = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: { customExclusions: Array.from({ length: 16 }, (_, index) => `term-${index}`) as any }
    });
    expect(tooMany).toMatchObject({ ok: false, code: 'TOO_MANY_CUSTOM_EXCLUSIONS' });
  });

  it('does not normalize invalid condition input into DMG', () => {
    const id = userId('condition-bananas');
    setUserPlan(id, 'PRO');
    const added = addUserChase({ userId: id, cardName: 'Mew RC24' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const result = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: { condition: 'BANANAS' as any }
    });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT', field: 'condition' });
    expect(listChases(id)[0].condition).toBeUndefined();
  });

  it('edits Pro controls, clears text extras with none, and rejects excessive custom exclusions', () => {
    const id = userId('edit-pro');
    setUserPlan(id, 'PRO');
    const added = addUserChase({ userId: id, cardName: 'Gardevoir ex 233/091' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const updated = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: {
        condition: 'LP_OR_BETTER',
        listingType: 'AUCTION',
        priority: 'HIGH',
        targetNote: 'binder copy',
        customExclusions: 'slab, proxy'
      }
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.chase).toMatchObject({
      condition: 'NM,LP',
      listingType: 'AUCTION',
      priority: 'HIGH',
      targetNote: 'binder copy',
      negativeKeywords: ['slab']
    });

    const cleared = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: { targetNote: 'none', customExclusions: 'none' }
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.chase.targetNote).toBeUndefined();
    expect(cleared.chase.negativeKeywords).toBeUndefined();

    const tooMany = Array.from({ length: 16 }, (_, index) => `term-${index}`).join(',');
    expect(updateUserChase({ userId: id, chaseId: added.chase.id, changes: { customExclusions: tooMany } })).toMatchObject({
      ok: false,
      code: 'TOO_MANY_CUSTOM_EXCLUSIONS'
    });
  });

  it('preserves edit clear semantics for null max price and none text extras', () => {
    const id = userId('edit-clears');
    setUserPlan(id, 'PRO');
    const added = addUserChase({
      userId: id,
      cardName: 'Gardevoir ex 233/091',
      maxPrice: 150,
      targetNote: 'binder',
      customExclusions: 'proxy'
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const result = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: { maxPrice: null, targetNote: 'none', customExclusions: 'none' }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chase.maxPrice).toBeUndefined();
    expect(result.chase.targetNote).toBeUndefined();
    expect(result.chase.negativeKeywords).toBeUndefined();
    expect(matchChaseToListing(result.chase, {
      source: 'EBAY',
      listingId: 'default-blocked-after-clear',
      title: 'Gardevoir ex 233/091 proxy',
      price: 100,
      currency: 'USD',
      url: 'https://example.test/default-blocked-after-clear',
      region: 'US'
    }).isMatch).toBe(false);
  });

  it('keeps Free edit controls blocked unless a normal field also changes', () => {
    const id = userId('edit-free');
    const added = addUserChase({ userId: id, cardName: 'Pichu Expedition 22/165' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(updateUserChase({ userId: id, chaseId: added.chase.id, changes: { priority: 'GRAIL' } })).toMatchObject({
      ok: false,
      code: 'NO_APPLICABLE_CHANGES',
      blockedControls: ['priority']
    });

    const mixed = updateUserChase({
      userId: id,
      chaseId: added.chase.id,
      changes: { maxPrice: 80, priority: 'GRAIL' }
    });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.chase.maxPrice).toBe(80);
    expect(mixed.chase.priority).toBe('NORMAL');
    expect(mixed.blockedControls).toEqual(['priority']);
  });

  it('records only completed removals as positive completed-chase history', () => {
    const id = userId('remove');
    const completed = addUserChase({ userId: id, cardName: 'Mew RC24' });
    const notInterested = addUserChase({ userId: id, cardName: 'Pichu Expedition 22/165' });
    const mistake = addUserChase({ userId: id, cardName: 'Zapdos Expedition 48' });
    expect(completed.ok && notInterested.ok && mistake.ok).toBe(true);
    if (!completed.ok || !notInterested.ok || !mistake.ok) return;

    expect(resolveUserChaseRemoval({ userId: id, chaseId: completed.chase.id, outcome: 'COMPLETED' })).toMatchObject({ ok: true });
    expect(resolveUserChaseRemoval({ userId: id, chaseId: notInterested.chase.id, outcome: 'NO_LONGER_INTERESTED' })).toMatchObject({ ok: true });
    expect(resolveUserChaseRemoval({ userId: id, chaseId: mistake.chase.id, outcome: 'ADDED_BY_MISTAKE' })).toMatchObject({ ok: true });

    expect(listChases(id)).toHaveLength(0);
    expect(listCompletedChases(id).map((chase) => chase.cardName)).toEqual(['Mew RC24']);
    expect(listUserTasteMemoryChases(id).map((chase) => chase.cardName)).toContain('Mew RC24');
    expect(listUserTasteMemoryChases(id).map((chase) => chase.cardName)).not.toContain('Pichu Expedition 22/165');
    expect(listUserTasteMemoryChases(id).map((chase) => chase.cardName)).not.toContain('Zapdos Expedition 48');
    expect(getVaultChases(id).completedChases.map((chase) => chase.cardName)).toEqual(['Mew RC24']);
  });

  it('marks plan-overflow chases as paused without losing list visibility', () => {
    const id = userId('paused-list');
    setUserPlan(id, 'PRO');
    for (let index = 0; index < PLAN_LIMITS.FREE.maxActiveChases + 1; index += 1) {
      expect(addUserChase({ userId: id, cardName: `Saved Card ${index}` }).ok).toBe(true);
    }
    setUserPlan(id, 'FREE');

    const vault = getVaultChases(id);
    expect(vault.chases).toHaveLength(PLAN_LIMITS.FREE.maxActiveChases + 1);
    expect(vault.plan).toMatchObject({
      tier: 'FREE',
      activeCount: PLAN_LIMITS.FREE.maxActiveChases,
      pausedCount: 1
    });
    expect(vault.chases.filter((view) => view.monitoringState === 'PAUSED_PLAN_LIMIT')).toHaveLength(1);
  });

  it('low-level atomic create distinguishes newly created, duplicate, and limit outcomes', () => {
    const id = userId('atomic-create');
    const first = createChaseForUser({ userId: id, cardName: 'Mew RC24' }, { maxChases: 2 });
    expect(first.status).toBe('CREATED');
    const duplicate = createChaseForUser({ userId: id, cardName: 'Mew RC24' }, { maxChases: 2 });
    expect(duplicate.status).toBe('DUPLICATE');
    expect(duplicate.status === 'DUPLICATE' ? duplicate.chase.id : undefined).toBe(first.status === 'CREATED' ? first.chase.id : undefined);
    const second = createChaseForUser({ userId: id, cardName: 'Pichu Expedition 22/165' }, { maxChases: 2 });
    expect(second.status).toBe('CREATED');
    const limited = createChaseForUser({ userId: id, cardName: 'Gardevoir ex 233/091' }, { maxChases: 2 });
    expect(limited).toMatchObject({ status: 'LIMIT_REACHED', previousCount: 2 });
    expect(listChases(id).map((chase) => chase.cardName)).toEqual(['Mew RC24', 'Pichu Expedition 22/165']);
  });

  it('contains no Discord UI dependency in the shared service layer', () => {
    const source = readFileSync(new URL('../chase-service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/discord\.js|MessageFlags|ActionRowBuilder|ButtonBuilder|EmbedBuilder/);
  });
});
