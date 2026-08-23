import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';
import {
  listChases,
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

const testUserIds = new Set<string>();

function userId(label: string): string {
  const id = `svc-chase-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(id);
  return id;
}

function cleanupUser(id: string): void {
  removeAllChases(id);
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

  it('enforces Free and Pro chase limits through the shared service', () => {
    const freeUser = userId('free-limit');
    for (let index = 0; index < PLAN_LIMITS.FREE.maxActiveChases; index += 1) {
      expect(addUserChase({ userId: freeUser, cardName: `Free Card ${index}` }).ok).toBe(true);
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
      negativeKeywords: ['played', 'proxy']
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
      negativeKeywords: ['slab', 'proxy']
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
    expect(listUserTasteMemoryChases(id).map((chase) => chase.cardName)).toContain('Mew RC24');
    expect(listUserTasteMemoryChases(id).map((chase) => chase.cardName)).not.toContain('Zapdos Expedition 48');
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

  it('contains no Discord UI dependency in the shared service layer', () => {
    const source = readFileSync(new URL('../chase-service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/discord\.js|MessageFlags|ActionRowBuilder|ButtonBuilder|EmbedBuilder/);
  });
});
