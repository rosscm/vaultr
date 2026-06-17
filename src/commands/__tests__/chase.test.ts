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

    expect(chaseOption?.autocomplete).toBe(true);
    expect(chaseOption?.required).toBe(true);
    expect(entryOption).toBeUndefined();
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
      tune_out_terms: 'digital, jumbo'
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

  it('stores Pro tune-out terms as chase-specific extras', async () => {
    const userId = testUserId('pro-tune-out-add');
    setUserPlan(userId, 'PRO');

    await chase.execute(mockInteraction(userId, 'add', {
      card: 'Umbreon 217/187 Japanese',
      max_price: 550,
      tune_out_terms: 'korean, chinese'
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
      tune_out_terms: 'creased'
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

  it('lists default blocked terms once while showing chase-specific tune-outs inline', () => {
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
    expect(text).toContain('Tune Out: korean');
    expect(text).not.toContain('Blocked:');
  });

  it('undoes Discovery feedback and removes More Like taste memory', () => {
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

  it('switching Discovery feedback to Not For Me removes prior More Like taste memory', () => {
    const userId = testUserId('discovery-feedback-switch');
    const cardName = 'Gardevoir ex Paldean Fates 233';

    recordDiscoveryFeedback({ userId, cardName, lane: 'Collector Compass', feedback: 'MORE_LIKE_THIS', maxPrice: 900 });
    recordDiscoveryFeedback({ userId, cardName, lane: 'Collector Compass', feedback: 'NOT_FOR_ME', maxPrice: 900 });

    expect(listRecentUserDiscoveryFeedback(userId, 'MORE_LIKE_THIS')).toEqual([]);
    expect(listRecentUserDiscoveryFeedback(userId, 'NOT_FOR_ME').map((item) => item.suggestionName)).toEqual([cardName]);
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).not.toContain(cardName);
  });
});