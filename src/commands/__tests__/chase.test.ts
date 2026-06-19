import { afterEach, describe, expect, it, vi } from 'vitest';
import { chase } from '../chase.js';
import { buildChaseListEmbed } from '../chase-list.js';
import {
  addChase,
  listChases,
  listRecentUserDiscoveryFeedback,
  listUserTasteMemoryChases,
  recordDiscoveryFeedback,
  removeAllChases,
  setUserPlan,
  undoDiscoveryFeedback
} from '../../services/chase-store.js';
import { db } from '../../services/db.js';

const testUserIds = new Set<string>();

function testUserId(label: string): string {
  const userId = `test-chase-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(userId);
  return userId;
}

function mockInteraction(userId: string, subcommand: string, values: Record<string, string | number | null | undefined>) {
  const reply = vi.fn(async () => undefined);
  return {
    user: { id: userId },
    guildId: null,
    member: null,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => {
        const value = values[name];
        return typeof value === 'string' ? value : null;
      },
      getNumber: (name: string) => {
        const value = values[name];
        return typeof value === 'number' ? value : null;
      }
    },
    reply
  };
}

afterEach(() => {
  for (const userId of testUserIds) {
    removeAllChases(userId);
    db.prepare('DELETE FROM user_discovery_feedback WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  }
  testUserIds.clear();
});

describe('chase command', () => {
  it('requires edit to pick a chase by autocomplete', () => {
    const edit = chase.data
      .toJSON()
      .options?.find((option: any) => option.name === 'edit') as any;
    const options = edit.options ?? [];
    const chaseOption = options.find((option: any) => option.name === 'chase');
    const entryOption = options.find((option: any) => option.name === 'entry');
    const customExclusionsOption = options.find((option: any) => option.name === 'custom_exclusions');
    const targetNoteOption = options.find((option: any) => option.name === 'target_note');
    const tuneOutOption = options.find((option: any) => option.name === 'tune_out_terms');
    const addTuneOutOption = options.find((option: any) => option.name === 'add_tune_out_terms');

    expect(chaseOption?.autocomplete).toBe(true);
    expect(chaseOption?.required).toBe(true);
    expect(options.map((option: any) => option.name)).toEqual([
      'chase',
      'card',
      'max_price',
      'grading_type',
      'grade_value',
      'condition',
      'listing_type',
      'custom_exclusions',
      'priority',
      'target_note'
    ]);
    expect(entryOption).toBeUndefined();
    expect(customExclusionsOption?.description).toContain('Custom exclusions');
    expect(customExclusionsOption?.description).toContain("Custom exclusions; type the word 'none' to remove saved terms");
    expect(customExclusionsOption?.description).not.toContain('default: None');
    expect(targetNoteOption?.description).toContain("New note; type the word 'none'");
    expect(targetNoteOption?.description).not.toContain('default: None');
    expect(tuneOutOption).toBeUndefined();
    expect(addTuneOutOption).toBeUndefined();
  });

  it('requires remove to pick a chase by autocomplete', () => {
    const remove = chase.data
      .toJSON()
      .options?.find((option: any) => option.name === 'remove') as any;
    const options = remove.options ?? [];
    const chaseOption = options.find((option: any) => option.name === 'chase');

    expect(options.map((option: any) => option.name)).toEqual(['chase']);
    expect(chaseOption?.autocomplete).toBe(true);
    expect(chaseOption?.required).toBe(true);
  });

  it('shows defaults in chase add helper text', () => {
    const add = chase.data
      .toJSON()
      .options?.find((option: any) => option.name === 'add') as any;
    const options = new Map((add.options ?? []).map((option: any) => [option.name, option.description]));

    expect(options.get('max_price')).toContain('default: Any');
    expect(options.get('grading_type')).toContain('default: Any');
    expect(options.get('grade_value')).toContain('default: Any');
    expect(options.get('condition')).toContain('default: Any');
    expect(options.get('listing_type')).toContain('default: Any');
    expect(options.get('listing_type')).toContain('Auction');
    expect(options.get('custom_exclusions')).toContain('default: None');
    expect(options.get('priority')).toContain('default: Casual');
    expect(options.get('target_note')).toContain('default: None');
    for (const name of ['condition', 'listing_type', 'custom_exclusions', 'priority', 'target_note']) {
      expect(options.get(name)).toContain('[PRO]');
    }
  });

  it('keeps chase edit options in the same order as chase add options', () => {
    const command = chase.data.toJSON();
    const add = command.options?.find((option: any) => option.name === 'add') as any;
    const edit = command.options?.find((option: any) => option.name === 'edit') as any;

    const addOptionNames = (add.options ?? []).map((option: any) => option.name);
    const editOptionNames = (edit.options ?? []).map((option: any) => option.name).filter((name: string) => name !== 'chase');

    expect(editOptionNames).toEqual(addOptionNames);
  });

  it('saves Free add submissions while ignoring Pro-only modifiers', async () => {
    const userId = testUserId('free-add');
    setUserPlan(userId, 'FREE');

    const interaction = mockInteraction(userId, 'add', {
      card: 'Umbreon VMAX 215/203',
      max_price: 250,
      grading_type: 'PSA',
      grade_value: '10',
      condition: 'NM_OR_BETTER',
      listing_type: 'AUCTION',
      priority: 'GRAIL',
      target_note: 'Moonbreon grail',
      custom_exclusions: 'digital, jumbo'
    });

    await chase.execute(interaction);

    const saved = listChases(userId)[0];
    expect(saved.cardName).toBe('Umbreon VMAX 215/203');
    expect(saved.maxPrice).toBe(250);
    expect(saved.grade).toBe('PSA 10');
    expect(saved.condition).toBeUndefined();
    expect(saved.listingType).toBe('ANY');
    expect(saved.priority).toBe('NORMAL');
    expect(saved.targetNote).toBeUndefined();
    expect(saved.negativeKeywords).toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('does not add the same chase twice from repeated submissions', async () => {
    const userId = testUserId('duplicate-add');
    setUserPlan(userId, 'PRO');

    await chase.execute(mockInteraction(userId, 'add', { card: 'Umbreon 217/187 Japanese', max_price: 550 }));
    const duplicateInteraction = mockInteraction(userId, 'add', { card: '  umbreon   217/187 japanese  ', max_price: 550 });
    await chase.execute(duplicateInteraction);

    expect(listChases(userId).map((item) => item.cardName)).toEqual(['Umbreon 217/187 Japanese']);
    expect(duplicateInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('Already In Vault') }) })])
    }));
  });

  it('stores Pro custom exclusions as chase-specific extras', async () => {
    const userId = testUserId('pro-tune-out-add');
    setUserPlan(userId, 'PRO');

    await chase.execute(mockInteraction(userId, 'add', {
      card: 'Umbreon 217/187 Japanese',
      max_price: 550,
      custom_exclusions: 'korean, chinese'
    }));

    const saved = listChases(userId)[0];
    expect(saved.negativeKeywords).toEqual(['korean', 'chinese']);
  });

  it('keeps store-level chase creation idempotent for bot retries', () => {
    const userId = testUserId('store-duplicate-add');

    const first = addChase({ userId, cardName: 'Umbreon 217/187 Japanese', maxPrice: 550 });
    const second = addChase({ userId, cardName: 'Umbreon 217/187 Japanese', maxPrice: 550 });

    expect(second.id).toBe(first.id);
    expect(listChases(userId).map((item) => item.cardName)).toEqual(['Umbreon 217/187 Japanese']);
  });

  it('applies Free edit fields while ignoring Pro-only modifiers', async () => {
    const userId = testUserId('free-edit');
    setUserPlan(userId, 'FREE');
    const original = addChase({
      userId,
      cardName: 'Pikachu Promo',
      priority: 'NORMAL',
      listingType: 'ANY'
    });

    const interaction = mockInteraction(userId, 'edit', {
      chase: original.id,
      card: 'Pikachu Black Star Promo 1',
      max_price: 75,
      grading_type: 'PSA',
      grade_value: '9',
      condition: 'LP_OR_BETTER',
      listing_type: 'BUY_IT_NOW',
      priority: 'HIGH',
      target_note: 'Binder copy',
      custom_exclusions: 'creased'
    });

    await chase.execute(interaction);

    const updated = listChases(userId)[0];
    expect(updated.cardName).toBe('Pikachu Black Star Promo 1');
    expect(updated.maxPrice).toBe(75);
    expect(updated.grade).toBe('PSA 9');
    expect(updated.condition).toBeUndefined();
    expect(updated.listingType).toBe('ANY');
    expect(updated.priority).toBe('NORMAL');
    expect(updated.targetNote).toBeUndefined();
    expect(updated.negativeKeywords).toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('edits a chase when Discord submits a typed list number instead of picker id', async () => {
    const userId = testUserId('edit-number-fallback');
    setUserPlan(userId, 'FREE');
    addChase({ userId, cardName: 'Pikachu Skyridge 84', priority: 'GRAIL', listingType: 'ANY' });
    const target = addChase({ userId, cardName: 'Mew XY Black Star Promos XY192', priority: 'NORMAL', listingType: 'ANY', maxPrice: 130 });

    const interaction = mockInteraction(userId, 'edit', {
      chase: '2',
      max_price: 140
    });

    await chase.execute(interaction);

    const updated = listChases(userId).find((item) => item.id === target.id);
    expect(updated?.cardName).toBe('Mew XY Black Star Promos XY192');
    expect(updated?.maxPrice).toBe(140);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('clears Pro edit text extras with the default word none', async () => {
    const userId = testUserId('pro-edit-none-clear');
    setUserPlan(userId, 'PRO');
    const original = addChase({
      userId,
      cardName: 'Umbreon VMAX 215/203',
      targetNote: 'Moonbreon grail',
      negativeKeywords: ['digital', 'jumbo']
    });

    const interaction = mockInteraction(userId, 'edit', {
      chase: original.id,
      target_note: 'none',
      custom_exclusions: 'none'
    });

    await chase.execute(interaction);

    const updated = listChases(userId)[0];
    expect(updated.targetNote).toBeUndefined();
    expect(updated.negativeKeywords).toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('does not treat clear as a Pro edit removal alias', async () => {
    const userId = testUserId('pro-edit-clear-literal');
    setUserPlan(userId, 'PRO');
    const original = addChase({
      userId,
      cardName: 'Umbreon VMAX 215/203',
      targetNote: 'Moonbreon grail',
      negativeKeywords: ['digital', 'jumbo']
    });

    const interaction = mockInteraction(userId, 'edit', {
      chase: original.id,
      target_note: 'clear',
      custom_exclusions: 'clear'
    });

    await chase.execute(interaction);

    const updated = listChases(userId)[0];
    expect(updated.targetNote).toBe('clear');
    expect(updated.negativeKeywords).toEqual(['clear']);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('edits a chase when Discord submits the visible picker label', async () => {
    const userId = testUserId('edit-label-fallback');
    setUserPlan(userId, 'FREE');
    addChase({ userId, cardName: 'Pikachu Skyridge 84', priority: 'GRAIL', listingType: 'ANY' });
    const target = addChase({ userId, cardName: 'Mew XY Black Star Promos XY192', priority: 'NORMAL', listingType: 'ANY', maxPrice: 130 });

    const interaction = mockInteraction(userId, 'edit', {
      chase: '#2 Mew XY Black Star Promos XY192 — Max 130',
      max_price: 140
    });

    await chase.execute(interaction);

    const updated = listChases(userId).find((item) => item.id === target.id);
    expect(updated?.maxPrice).toBe(140);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('removes a chase by selected autocomplete value', async () => {
    const userId = testUserId('remove-picker');
    const keep = addChase({
      userId,
      cardName: 'Pikachu Skyridge 84',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const remove = addChase({
      userId,
      cardName: 'Mew RC24',
      priority: 'HIGH',
      listingType: 'ANY'
    });

    const interaction = mockInteraction(userId, 'remove', {
      chase: remove.id
    });

    await chase.execute(interaction);

    const remaining = listChases(userId);
    expect(remaining.map((item) => item.id)).toEqual([keep.id]);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('lists default exclusions once while showing chase-specific custom exclusions inline', () => {
    const userId = testUserId('list-default-exclusions');
    setUserPlan(userId, 'PRO');
    addChase({
      userId,
      cardName: 'Umbreon 217/187',
      maxPrice: 550,
      grade: 'UNGRADED',
      priority: 'GRAIL',
      listingType: 'BUY_IT_NOW',
      negativeKeywords: ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica', 'fan art', 'novelty', 'keychain', 'extended art', 'acrylic case', 'magnetic case']
    });
    addChase({
      userId,
      cardName: 'Pikachu 26/83 Toys R Us promo',
      priority: 'HIGH',
      negativeKeywords: ['proxy', 'custom', 'korean']
    });

    const payload = buildChaseListEmbed(userId, 0);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(data.description).toContain('**Default Exclusions**');
    expect(data.description).toContain('**#01  Umbreon 217/187**\n↳ Max: 550 USD | Grade: Ungraded | Condition: Any | Listing: Buy Now');
    expect(data.description).toContain('Listing: Buy Now');
    expect(data.description).not.toContain('BUY_IT_NOW');
    expect(data.description).toContain('**Next Actions**\n✏️ Refine with `/chase edit`');
    expect(data.description).toContain('**Default Exclusions**\nproxy, custom, reprint, lot, orica, replica, fan art, novelty, keychain, extended art, acrylic case, magnetic case\n\n---\n**Next Actions**');
    expect(text.match(/proxy, custom/g)).toHaveLength(1);
    expect(text).toContain('Custom Exclusions: korean');
    expect(text).not.toContain('Blocked:');
  });

  it('keeps paused chase rows compact without active alert filters', () => {
    const userId = testUserId('list-paused-compact');
    setUserPlan(userId, 'FREE');
    for (let index = 1; index <= 4; index += 1) {
      addChase({ userId, cardName: `Paused Test Card ${index}`, priority: index === 4 ? 'NORMAL' : 'HIGH', maxPrice: 100 + index, grade: 'UNGRADED', listingType: 'BUY_IT_NOW', negativeKeywords: ['korean'] });
    }

    const payload = buildChaseListEmbed(userId, 0);
    const data = payload.embeds[0].toJSON();
    const pausedSection = data.description?.split('**⏸️ Paused (Full Vault)**')[1]?.split('\n\n---')[0] ?? '';

    expect(pausedSection).toContain('Priority: Casual | Max: 104 USD');
    expect(pausedSection).not.toContain('Grade:');
    expect(pausedSection).not.toContain('Condition:');
    expect(pausedSection).not.toContain('Listing:');
    expect(pausedSection).not.toContain('Status: Paused until Full Vault');
    expect(pausedSection).not.toContain('Custom Exclusions:');
  });

  it('undoes Discovery feedback and removes More Like taste profile memory', () => {
    const userId = testUserId('discovery-feedback-undo');
    const cardName = 'Mew ex Paldean Fates 232';

    recordDiscoveryFeedback({ userId, cardName, lane: 'Collector Compass', feedback: 'MORE_LIKE_THIS', maxPrice: 1200 });
    expect(listRecentUserDiscoveryFeedback(userId, 'MORE_LIKE_THIS').map((item) => item.suggestionName)).toEqual([cardName]);
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).toContain(cardName);

    const undone = undoDiscoveryFeedback({ userId, cardName });

    expect(undone?.feedback).toBe('MORE_LIKE_THIS');
    expect(listRecentUserDiscoveryFeedback(userId, 'MORE_LIKE_THIS')).toEqual([]);
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).not.toContain(cardName);
  });

  it('switching Discovery feedback to Not For Me removes prior More Like taste profile memory', () => {
    const userId = testUserId('discovery-feedback-switch');
    const cardName = 'Gardevoir ex Paldean Fates 233';

    recordDiscoveryFeedback({ userId, cardName, lane: 'Collector Compass', feedback: 'MORE_LIKE_THIS', maxPrice: 900 });
    recordDiscoveryFeedback({ userId, cardName, lane: 'Collector Compass', feedback: 'NOT_FOR_ME', maxPrice: 900 });

    expect(listRecentUserDiscoveryFeedback(userId, 'MORE_LIKE_THIS')).toEqual([]);
    expect(listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME').map((item) => item.suggestionName)).toEqual([cardName]);
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).not.toContain(cardName);
  });
});