import { afterEach, describe, expect, it, vi } from 'vitest';
import { chase } from '../chase.js';
import { handleChaseAddAutocomplete } from '../chase-add.js';
import { handleChaseEditAutocomplete } from '../chase-edit.js';
import { buildChaseListEmbed } from '../chase-list.js';
import { __chaseRemoveTestHooks, handleChaseRemoveButtons } from '../chase-remove.js';
import {
  __chaseStoreTestHooks,
  addChase,
  getDiscoveryGlobalCollectorGrammarSummary,
  getDiscoveryLearnedSignalSummary,
  listChases,
  listRecentUserDiscoveryFeedback,
  listUserTasteMemoryChases,
  recordDiscoveryTrainingExamples,
  recordDiscoveryFeedback,
  removeAllChases,
  setUserPlan,
  undoDiscoveryFeedback
} from '../../services/chase-store.js';
import {
  __chaseCardCatalogTestHooks,
  autocompleteChaseCards,
  clearChaseCardAutocompleteCache,
  resolveTrustedChaseCardReference
} from '../../services/chase-card-catalog.js';
import { db } from '../../services/db.js';
import { evaluateWeeklyDiscoveryEligibility } from '../../services/weekly-discovery-eligibility.js';

const testUserIds = new Set<string>();
const originalFetch = globalThis.fetch;

function testUserId(label: string): string {
  const userId = `test-chase-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(userId);
  return userId;
}

function mockInteraction(userId: string, subcommand: string, values: Record<string, string | number | null | undefined>) {
  const reply = vi.fn(async (_payload?: any) => undefined);
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

function mockButtonInteraction(userId: string, customId: string) {
  const reply = vi.fn(async (_payload?: any) => undefined);
  const update = vi.fn(async (_payload?: any) => undefined);
  return {
    user: { id: userId },
    customId,
    isButton: () => true,
    reply,
    update
  };
}

function mockAutocompleteInteraction(userId: string, subcommand: string, focusedName: string, focusedValue: string) {
  const respond = vi.fn(async (_choices?: any) => undefined);
  return {
    user: { id: userId },
    commandName: 'chase',
    isAutocomplete: () => true,
    options: {
      getSubcommand: () => subcommand,
      getFocused: () => ({ name: focusedName, value: focusedValue })
    },
    respond
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearChaseCardAutocompleteCache();
  __chaseRemoveTestHooks.clearPending();
  __chaseRemoveTestHooks.setNow(null);
  for (const userId of testUserIds) {
    removeAllChases(userId);
    db.prepare('DELETE FROM user_discovery_feedback WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM discovery_training_examples WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  }
  testUserIds.clear();
});

describe('chase command', () => {
  it('offers source-backed autocomplete for new chase card names', () => {
    const add = chase.data
      .toJSON()
      .options?.find((option: any) => option.name === 'add') as any;
    const options = add.options ?? [];
    const cardOption = options.find((option: any) => option.name === 'card');

    expect(cardOption?.autocomplete).toBe(true);
    expect(cardOption?.required).toBe(true);
  });

  it('returns card catalog autocomplete choices for chase add', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' }, images: { large: 'https://images.pokemontcg.io/sv4pt5/232_hires.png' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const interaction = mockAutocompleteInteraction('user-1', 'add', 'card', 'mew ex');

    await handleChaseAddAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Mew ex — Paldean Fates #232', value: 'Mew ex Paldean Fates 232' }
    ]);
  });

  it('returns card catalog autocomplete choices for chase edit card', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' }, images: { large: 'https://images.pokemontcg.io/sv4pt5/232_hires.png' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const interaction = mockAutocompleteInteraction('user-1', 'edit', 'card', 'mew ex');

    await handleChaseEditAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Mew ex — Paldean Fates #232', value: 'Mew ex Paldean Fates 232' }
    ]);
  });

  it('shows a source image after adding a selected autocomplete card', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' }, images: { large: 'https://images.pokemontcg.io/sv4pt5/232_hires.png' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    await autocompleteChaseCards('mew ex', 10);
    const userId = testUserId('add-selected-autocomplete-image');
    setUserPlan(userId, 'FREE');

    const interaction = mockInteraction(userId, 'add', {
      card: 'Mew ex Paldean Fates 232'
    });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe('https://images.pokemontcg.io/sv4pt5/232_hires.png');
    expect(listChases(userId)[0]).toMatchObject({
      cardImageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      cardImageIdentity: 'Mew ex Paldean Fates 232',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceName: 'POKEMONTCG',
      cardImageSourceCardId: 'sv4pt5-232'
    });
  });

  it('omits the confirmation image when no trusted image is cached', async () => {
    const userId = testUserId('add-no-image-confirmation');
    setUserPlan(userId, 'FREE');
    const interaction = mockInteraction(userId, 'add', {
      card: 'Obscure Custom Collector Card 001'
    });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(payload.embeds[0].toJSON().title).toBe('✅ Chase Added');
    expect(listChases(userId)[0]?.cardImageUrl).toBeUndefined();
  });

  it('preserves the exact resolved printing image through chase-name normalization', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          image: 'https://assets.tcgdex.net/ja/SV/SV9a/087',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('localId=087') || url.includes('name=%E3%82%B5%E3%83%BC%E3%83%8A%E3%82%A4%E3%83%88')) {
        return new Response(JSON.stringify([
          { id: 'SV9a-087', localId: '087', name: 'サーナイト', image: 'https://assets.tcgdex.net/ja/SV/SV9a/087' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    await autocompleteChaseCards('Gardevoir 087/063', 10);
    const userId = testUserId('add-exact-printing-image');
    setUserPlan(userId, 'FREE');

    const interaction = mockInteraction(userId, 'add', {
      card: 'Gardevoir Japanese 087/063'
    });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe('https://assets.tcgdex.net/ja/SV/SV9a/087/high.png');
    expect(payload.embeds[0].toJSON().description).toContain('**Card:** Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063');
    expect(listChases(userId)[0]).toMatchObject({
      cardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      cardImageUrl: 'https://assets.tcgdex.net/ja/SV/SV9a/087/high.png',
      cardImageIdentity: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceName: 'TCGDEX',
      cardImageSourceCardId: 'SV9a-087'
    });
  });

  it('persists trusted chase image metadata after cache clear', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    await autocompleteChaseCards('mew ex', 10);
    const userId = testUserId('persisted-image-after-cache-clear');
    setUserPlan(userId, 'FREE');

    const interaction = mockInteraction(userId, 'add', {
      card: 'Mew ex Paldean Fates 232'
    });

    await chase.execute(interaction);
    clearChaseCardAutocompleteCache();

    expect(listChases(userId)[0]).toMatchObject({
      cardImageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      cardImageIdentity: 'Mew ex Paldean Fates 232',
      cardImageSourceKind: 'CARD_REFERENCE'
    });
  });

  it('rejects mismatched cached image identity during chase persistence', async () => {
    const userId = testUserId('reject-mismatched-image-identity');
    setUserPlan(userId, 'FREE');
    __chaseCardCatalogTestHooks.cachePreview('Mew ex Paldean Fates 232', {
      imageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      imageIdentity: 'Different Card Name 999',
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'sv4pt5-232'
    });

    const interaction = mockInteraction(userId, 'add', {
      card: 'Mew ex Paldean Fates 232'
    });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(listChases(userId)[0]).toMatchObject({
      cardName: 'Mew ex Paldean Fates 232',
      cardImageUrl: undefined,
      cardImageIdentity: undefined,
      cardImageSourceKind: undefined
    });
  });

  it('rolls back chase add when persistence fails', async () => {
    const userId = testUserId('rollback-chase-add-failure');
    __chaseStoreTestHooks.failNextAddChase();

    expect(() => addChase({
      userId,
      cardName: 'Mew ex Paldean Fates 232',
      cardImageUrl: 'https://images.pokemontcg.io/sv4pt5/232_hires.png',
      cardImageIdentity: 'Mew ex Paldean Fates 232',
      cardImageSourceName: 'POKEMONTCG',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: 'sv4pt5-232'
    })).toThrow('Simulated chase add failure');

    expect(listChases(userId)).toEqual([]);
  });

  it('keeps existing chase rows valid when image fields are null', () => {
    const userId = testUserId('legacy-null-image-row');
    db.prepare(`
      INSERT INTO chases (
        id, user_id, guild_id, card_name, card_image_url, card_image_identity, card_image_source_name, card_image_source_kind, card_image_source_card_id,
        query_name, priority, target_note, max_price, grade, condition, listing_type, negative_keywords, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-chase-row',
      userId,
      null,
      'Legacy Card 001',
      null,
      null,
      null,
      null,
      null,
      'Legacy Card 001',
      'NORMAL',
      null,
      null,
      null,
      null,
      'ANY',
      null,
      new Date().toISOString()
    );

    expect(listChases(userId)[0]).toMatchObject({
      cardName: 'Legacy Card 001',
      cardImageUrl: undefined,
      cardImageIdentity: undefined,
      cardImageSourceKind: undefined
    });
  });

  it('uses the same Chase Added confirmation format for autocomplete and manual add paths', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' }, images: { large: 'https://images.pokemontcg.io/sv4pt5/232_hires.png' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    await autocompleteChaseCards('mew ex', 10);
    const autocompleteUserId = testUserId('add-format-autocomplete');
    const manualUserId = testUserId('add-format-manual');
    setUserPlan(autocompleteUserId, 'FREE');
    setUserPlan(manualUserId, 'FREE');

    const autocompleteInteraction = mockInteraction(autocompleteUserId, 'add', {
      card: 'Mew ex Paldean Fates 232'
    });
    const manualInteraction = mockInteraction(manualUserId, 'add', {
      card: 'Plain Broad Card'
    });

    await chase.execute(autocompleteInteraction);
    await chase.execute(manualInteraction);

    const autocompleteEmbed = autocompleteInteraction.reply.mock.calls[0]![0].embeds[0].toJSON();
    const manualEmbed = manualInteraction.reply.mock.calls[0]![0].embeds[0].toJSON();

    expect(autocompleteEmbed.title).toBe('✅ Chase Added');
    expect(manualEmbed.title).toBe('✅ Chase Added');
    expect(autocompleteEmbed.description).toContain('Nice pick! Vaultr is on it');
    expect(manualEmbed.description).toContain('Nice pick! Vaultr is on it');
    expect(autocompleteEmbed.description).toContain('**Next:** Use `/chase list` to review active chases');
    expect(manualEmbed.description).toContain('**Next:** Use `/chase list` to review active chases');
    expect(listChases(autocompleteUserId)[0]?.cardImageUrl).toBe('https://images.pokemontcg.io/sv4pt5/232_hires.png');
    expect(listChases(manualUserId)[0]?.cardImageUrl).toBeUndefined();
  });

  it('keeps broad English card autocomplete on the fast Pokemon source path', async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'basep-1', name: 'Pikachu', number: '1', set: { name: 'Wizards Black Star Promos' } },
            { id: 'mcd19-6', name: 'Pikachu', number: '6', set: { name: "McDonald's Collection 2019" } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected source call: ${url}`);
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — Wizards Black Star Promos #1', value: 'Pikachu Wizards Black Star Promos 1' },
      { name: "Pikachu — McDonald's Collection 2019 #6", value: "Pikachu McDonald's Collection 2019 6" }
    ]);
    expect(requestedUrls.some((url) => url.includes('api.pokemontcg.io'))).toBe(true);
  });

  it('does not treat Mewtwo as a Mew autocomplete match', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } },
            { id: 'basep-3', name: 'Mewtwo', number: '3', set: { name: 'Wizards Black Star Promos' } },
            { id: 'pop5-3', name: 'Mew δ', number: '3', set: { name: 'POP Series 5' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew', 25);

    expect(choices).toEqual([
      { name: 'Mew — Southern Islands #1', value: 'Mew Southern Islands 1' },
      { name: 'Mew δ — POP Series 5 #3', value: 'Mew δ POP Series 5 3' }
    ]);
  });

  it('searches Pokemon set and promo context for queries like Pikachu XY', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('set.name:xy')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'xy1-42', name: 'Pikachu', number: '42', set: { name: 'XY' } },
            { id: 'xyp-XY89', name: 'Pikachu', number: 'XY89', set: { name: 'XY Black Star Promos' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (q.includes('number:xy')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'xyp-XY95', name: 'Pikachu', number: 'XY95', set: { name: 'XY Black Star Promos' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu XY', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — XY #42', value: 'Pikachu XY 42' },
      { name: 'Pikachu — XY Black Star Promos #XY89', value: 'Pikachu XY Black Star Promos XY89' },
      { name: 'Pikachu — XY Black Star Promos #XY95', value: 'Pikachu XY Black Star Promos XY95' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* set.name:xy*');
    expect(requestedQueries).toContain('name:pikachu* set.series:xy');
    expect(requestedQueries).toContain('name:pikachu* number:xy*');
  });

  it('searches and filters Pokemon alphanumeric card-number prefixes like Mew RC', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('number:rc')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'g1-RC2', name: 'Mew', number: 'RC2', set: { name: 'Generations Radiant Collection' } },
            { id: 'g1-RC24', name: 'Mew', number: 'RC24', set: { name: 'Generations Radiant Collection' } },
            { id: 'g1-RC29', name: 'Mewtwo', number: 'RC29', set: { name: 'Generations Radiant Collection' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew RC', 25);

    expect(choices).toEqual([
      { name: 'Mew — Generations Radiant Collection #RC2', value: 'Mew Generations Radiant Collection RC2' },
      { name: 'Mew — Generations Radiant Collection #RC24', value: 'Mew Generations Radiant Collection RC24' }
    ]);
    expect(requestedQueries).toContain('name:mew* number:rc*');
  });

  it('prioritizes series token matches (e.g. XY) for queries like "mew xy"', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      // Return a mixed set: a general Mew and several XY Mew variants
      return new Response(JSON.stringify({
        data: [
          { id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } },
          { id: 'xy-110', name: 'Mew', number: 'XY110', set: { name: 'XY Black Star Promos' } },
          { id: 'xy-126', name: 'Mew-EX', number: 'XY126', set: { name: 'XY Black Star Promos' } },
          { id: 'xy-192', name: 'Mew', number: 'XY192', set: { name: 'XY Black Star Promos' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('mew xy', 10);
    expect(choices.length).toBeGreaterThan(0);
    // Ensure choices that mention 'xy' appear before generic ones
    const firstNonXY = choices.findIndex((c) => !/\bxy\b/i.test(c.value.toLowerCase()));
    const firstXY = choices.findIndex((c) => /\bxy\b/i.test(c.value.toLowerCase()));
    expect(firstXY).toBeGreaterThanOrEqual(0);
    if (firstNonXY !== -1) expect(firstXY).toBeLessThan(firstNonXY);
  });

  it('surfaces the exact series-number when provided (e.g. "mew xy192")', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'xy-110', name: 'Mew', number: 'XY110', set: { name: 'XY Black Star Promos' } },
          { id: 'xy-192', name: 'Mew', number: 'XY192', set: { name: 'XY Black Star Promos' } },
          { id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('mew xy192', 10);
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0].value.toLowerCase()).toContain('xy192');
  });

  it('does not let an earlier plain series token hide a later numbered promo token', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'bwp-BW98', name: 'Mew', number: 'BW98', set: { name: 'BW Black Star Promos' } },
          { id: 'xyp-XY192', name: 'Mew', number: 'XY192', set: { name: 'XY Black Star Promos' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew XY Black Star Promos XY192', 10);

    expect(choices).toEqual([
      { name: 'Mew — Black Star Promos #XY192', value: 'Mew Black Star Promos XY192' }
    ]);
    expect(choices.some((choice) => choice.value.includes('BW98'))).toBe(false);
  });

  it('honors exact prefixed and bare PokemonTCG card numbers after broad fallback queries', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'bw11-RC2', name: 'Mew-EX', number: 'RC2', set: { name: 'Legendary Treasures' } },
          { id: 'bw11-RC24', name: 'Mew-EX', number: 'RC24', set: { name: 'Legendary Treasures' } },
          { id: 'smp-SM36', name: 'Umbreon-GX', number: 'SM36', set: { name: 'SM Black Star Promos' } },
          { id: 'smp-SM210', name: 'Moltres & Zapdos & Articuno-GX', number: 'SM210', set: { name: 'SM Black Star Promos' } },
          { id: 'swsh10-39', name: 'Origin Forme Palkia V', number: '39', set: { name: 'Astral Radiance', printedTotal: 189 } },
          { id: 'swsh10-167', name: 'Origin Forme Palkia V', number: '167', set: { name: 'Astral Radiance', printedTotal: 189 } },
          { id: 'xy11-79', name: 'M Gardevoir-EX', number: '79', set: { name: 'Steam Siege', printedTotal: 114 } },
          { id: 'm1l-178', name: 'Mega Gardevoir ex', number: '178', set: { name: 'Mega Evolution', printedTotal: 132 } },
          { id: 'xy11-178', name: 'Mega Gardevoir ex', number: '178', set: { name: 'Steam Siege', printedTotal: 114 } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('Mew-EX Legendary Treasures RC24', 10)).toEqual([
      { name: 'Mew-EX — Legendary Treasures #RC24', value: 'Mew-EX Legendary Treasures RC24' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('Moltres Zapdos Articuno SM210', 10)).toEqual([
      { name: 'Moltres & Zapdos & Articuno-GX — SM Black Star Promos #SM210', value: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('Origin Forme Palkia V Astral Radiance 167', 10)).toEqual([
      { name: 'Origin Forme Palkia V — Astral Radiance #167', value: 'Origin Forme Palkia V Astral Radiance 167' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('Mega Gardevoir ex Mega Evolution 178', 10)).toEqual([
      { name: 'Mega Gardevoir ex — Mega Evolution #178', value: 'Mega Gardevoir ex Mega Evolution 178' }
    ]);
  });

  it('filters Pokemon alphanumeric card-number prefixes as they are typed', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      requestedQueries.push(new URL(url).searchParams.get('q') ?? '');
      return new Response(JSON.stringify({
        data: [
          { id: 'g1-RC2', name: 'Mew', number: 'RC2', set: { name: 'Generations Radiant Collection' } },
          { id: 'g1-RC24', name: 'Mew', number: 'RC24', set: { name: 'Generations Radiant Collection' } },
          { id: 'xy10-29', name: 'Mew', number: '29', set: { name: 'Fates Collide' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew RC2', 25);

    expect(choices).toEqual([
      { name: 'Mew — Generations Radiant Collection #RC2', value: 'Mew Generations Radiant Collection RC2' },
      { name: 'Mew — Generations Radiant Collection #RC24', value: 'Mew Generations Radiant Collection RC24' }
    ]);
    expect(requestedQueries).toContain('name:mew* number:rc2*');
  });

  it('resolves English special-release promo aliases while preserving collector wording', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('number:26') && q.includes('set.name:generations')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'g1-26', name: 'Pikachu', number: '26', set: { name: 'Generations', printedTotal: 83 } },
            { id: 'basep-26', name: 'Pikachu', number: '26', set: { name: 'Wizards Black Star Promos', printedTotal: 53 } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu 26/83 Toys R Us promo', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — Toys R Us Promo #26/83', value: 'Pikachu Toys R Us Promo 26/83' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* number:26 set.name:generations*');
  });

  it('supports CoroCoro promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'coro-1', name: 'Mew', number: '1', set: { name: 'CoroCoro Promo' } },
            { id: 'coro-2', name: 'Mew', number: '2', set: { name: 'CoroCoro Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('CoroCoro Shining Mew', 10);

    expect(choices).toEqual([
      { name: 'Mew — CoroCoro Promo #1', value: 'Mew CoroCoro Promo 1' },
      { name: 'Mew — CoroCoro Promo #2', value: 'Mew CoroCoro Promo 2' }
    ]);
    expect(requestedQueries).toContain('name:mew* rarity:Promo');
  });

  it('does not invent generic CoroCoro choices when source results are missing without a card number', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('corocoro mew', 10)).toEqual([]);
  });

  it('falls back for specific numberless CoroCoro release subtypes', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('mew corocoro jumbo', 10)).toEqual([
      { name: 'Mew CoroCoro Jumbo Promo', value: 'Mew CoroCoro Jumbo Promo' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('corocoro magazine pikachu', 10)).toEqual([
      { name: 'Pikachu CoroCoro Magazine Promo', value: 'Pikachu CoroCoro Magazine Promo' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('pikachu corocoro manga', 10)).toEqual([
      { name: 'Pikachu CoroCoro Manga Promo', value: 'Pikachu CoroCoro Manga Promo' }
    ]);
  });

  it('supports CoroCoro Jumbo promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'coro-j1', name: 'Pikachu', number: 'J1', set: { name: 'CoroCoro Jumbo Promo' } },
            { id: 'coro-j2', name: 'Pikachu', number: 'J2', set: { name: 'CoroCoro Jumbo Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards("Pikachu's Summer vacation Corocoro JUMBO", 10);

    expect(choices).toEqual([
      { name: 'Pikachu — CoroCoro Jumbo Promo #J1', value: 'Pikachu CoroCoro Jumbo Promo J1' },
      { name: 'Pikachu — CoroCoro Jumbo Promo #J2', value: 'Pikachu CoroCoro Jumbo Promo J2' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports CoroCoro Promotional Cards subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'coro-p1', name: 'Pikachu', number: '1', set: { name: 'CoroCoro Promo' } },
            { id: 'coro-p2', name: 'Pikachu', number: '2', set: { name: 'CoroCoro Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu CoroCoro Promotional Cards', 10);

    expect(choices).toEqual([
      { name: 'Pikachu — CoroCoro Promo #1', value: 'Pikachu CoroCoro Promo 1' },
      { name: 'Pikachu — CoroCoro Promo #2', value: 'Pikachu CoroCoro Promo 2' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports CoroCoro Magazine promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'coro-m1', name: 'Pikachu', number: 'M1', set: { name: 'CoroCoro Magazine Promo' } },
            { id: 'coro-m2', name: 'Pikachu', number: 'M2', set: { name: 'CoroCoro Magazine Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu CoroCoro Magazine Promo', 10);

    expect(choices).toEqual([
      { name: 'Pikachu — CoroCoro Magazine Promo #M1', value: 'Pikachu CoroCoro Magazine Promo M1' },
      { name: 'Pikachu — CoroCoro Magazine Promo #M2', value: 'Pikachu CoroCoro Magazine Promo M2' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports CoroCoro Manga promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'coro-m1', name: 'Pikachu', number: 'M1', set: { name: 'CoroCoro Manga Promo' } },
            { id: 'coro-m2', name: 'Pikachu', number: 'M2', set: { name: 'CoroCoro Manga Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu CoroCoro Manga Promo', 10);

    expect(choices).toEqual([
      { name: 'Pikachu — CoroCoro Manga Promo #M1', value: 'Pikachu CoroCoro Manga Promo M1' },
      { name: 'Pikachu — CoroCoro Manga Promo #M2', value: 'Pikachu CoroCoro Manga Promo M2' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports McDonald\'s promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'mcd-1', name: 'Pikachu', number: '1', set: { name: "McDonald's Promo" } },
            { id: 'mcd-2', name: 'Pikachu', number: '2', set: { name: "McDonald's Promo" } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards("Pikachu McDonald's promo", 10);

    expect(choices).toEqual([
      { name: "Pikachu — McDonald's Promo #1", value: "Pikachu McDonald's Promo 1" },
      { name: "Pikachu — McDonald's Promo #2", value: "Pikachu McDonald's Promo 2" }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports Pokemon Center promo subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('rarity:Promo')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'pct-1', name: 'Pikachu', number: '1', set: { name: 'Pokemon Center Promo' } },
            { id: 'pct-2', name: 'Pikachu', number: '2', set: { name: 'Pokemon Center Promo' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu Pokemon Center promo', 10);

    expect(choices).toEqual([
      { name: 'Pikachu — Pokemon Center Promo #1', value: 'Pikachu Pokemon Center Promo 1' },
      { name: 'Pikachu — Pokemon Center Promo #2', value: 'Pikachu Pokemon Center Promo 2' }
    ]);
    expect(requestedQueries).toContain('name:pikachu* rarity:Promo');
  });

  it('supports Black Star Promos subject searches without a card number', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      const lowerQ = q.toLowerCase();
      if (lowerQ.includes('set.name:black star promos*')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'bsp-1', name: 'Pikachu', number: '1', set: { name: 'XY Black Star Promos' } },
            { id: 'bsp-2', name: 'Pikachu', number: '2', set: { name: 'XY Black Star Promos' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu Black Star Promos', 10);

    expect(choices).toEqual([
      { name: 'Pikachu — Black Star Promos #1', value: 'Pikachu Black Star Promos 1' },
      { name: 'Pikachu — Black Star Promos #2', value: 'Pikachu Black Star Promos 2' }
    ]);
    expect(requestedQueries.some((q) => q.toLowerCase().includes('name:pikachu* set.name:black star promos*'))).toBe(true);
  });

  it('preserves English printed totals so slash-number filtering can match', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes('number:26')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'basep-26', name: 'Pikachu', number: '26', set: { name: 'Wizards Black Star Promos', printedTotal: 53 } },
            { id: 'g1-26', name: 'Pikachu', number: '26', set: { name: 'Generations', printedTotal: 83 } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu 26/83', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — Generations #26/83', value: 'Pikachu Generations 26/83' }
    ]);
  });

  it('finds English special-release promo aliases before the card number is complete', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes('set.name:generations')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'g1-26', name: 'Pikachu', number: '26', set: { name: 'Generations', printedTotal: 83 } },
            { id: 'g1-RC29', name: 'Pikachu', number: 'RC29', set: { name: 'Generations', printedTotal: 83 } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu Toys R Us', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — Toys R Us Promo #26/83', value: 'Pikachu Toys R Us Promo 26/83' },
      { name: 'Pikachu — Toys R Us Promo #RC29', value: 'Pikachu Toys R Us Promo RC29' }
    ]);
  });

  it('treats arbitrary trailing words as Pokemon set context', async () => {
    const requestedQueries: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected source call: ${url}`);
      const q = new URL(url).searchParams.get('q') ?? '';
      requestedQueries.push(q);
      if (q.includes('set.name:paldean') && q.includes('set.name:fates')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew Paldean Fates', 25);

    expect(choices).toEqual([
      { name: 'Mew ex — Paldean Fates #232', value: 'Mew ex Paldean Fates 232' }
    ]);
    expect(requestedQueries.length).toBeLessThanOrEqual(8);
    expect(requestedQueries).toContain('name:mew* set.name:paldean* set.name:fates*');
  });

  it('keeps Pokemon autocomplete results when one query variant fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes('set.name:xy')) throw new Error('slow source variant');
      if (q.includes('set.series:xy')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'xy1-42', name: 'Pikachu', number: '42', set: { name: 'XY' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Pikachu XY', 25);

    expect(choices).toEqual([
      { name: 'Pikachu — XY #42', value: 'Pikachu XY 42' }
    ]);
  });

  it('narrows Japanese autocomplete choices by slash-total card numbers', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/S12a-052')) {
        return new Response(JSON.stringify({
          id: 'S12a-052',
          localId: '052',
          name: 'ミュウ',
          image: 'https://assets.tcgdex.net/ja/S/S12a/052',
          set: { id: 'S12a', cardCount: { official: 172 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4M-052')) {
        return new Response(JSON.stringify({
          id: 'SV4M-052',
          localId: '052',
          name: 'エテボース',
          set: { id: 'SV4M', cardCount: { official: 66 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'S12a-052', localId: '052', name: 'ミュウ' },
        { id: 'SV4M-052', localId: '052', name: 'エテボース' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 052/172', 10);

    expect(choices).toEqual([
      { name: 'Mew Japanese 052/172', value: 'Mew Japanese 052/172' }
    ]);
  });

  it('resolves trusted card references by structured identity instead of display equality', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'bwp-BW98', name: 'Mew', number: 'BW98', set: { name: 'BW Black Star Promos' } },
          { id: 'xyp-XY192', name: 'Mew', number: 'XY192', set: { name: 'XY Black Star Promos' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolution = await resolveTrustedChaseCardReference('Mew XY Black Star Promos XY192');

    expect(resolution).toMatchObject({
      status: 'RESOLVED',
      requestedCardName: 'Mew XY Black Star Promos XY192',
      resolvedCardName: 'Mew Black Star Promos XY192',
      preview: {
        imageUrl: 'https://images.pokemontcg.io/xyp/XY192_hires.png',
        imageIdentity: 'Mew Black Star Promos XY192',
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'xyp-XY192'
      }
    });
  });

  it('does not resolve trusted references from fallback-only autocomplete choices', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io') && !url.includes('api.tcgdex.net')) throw new Error(`Unexpected source call: ${url}`);
      return new Response(url.includes('api.pokemontcg.io') ? JSON.stringify({ data: [] }) : JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('Mew CoroCoro Jumbo Promo', 10)).toEqual([
      { name: 'Mew CoroCoro Jumbo Promo', value: 'Mew CoroCoro Jumbo Promo' }
    ]);
    expect(await resolveTrustedChaseCardReference('Mew CoroCoro Jumbo Promo')).toMatchObject({
      status: 'FALLBACK_ONLY'
    });
  });

  it('keeps wrong-number and wrong-set trusted reference candidates unresolved', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'swsh10-39', name: 'Origin Forme Palkia V', number: '39', set: { name: 'Astral Radiance', printedTotal: 189 } },
          { id: 'swsh11-167', name: 'Origin Forme Palkia V', number: '167', set: { name: 'Lost Origin', printedTotal: 196 } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await resolveTrustedChaseCardReference('Origin Forme Palkia V Astral Radiance 167')).toMatchObject({
      status: 'NO_MATCH'
    });
  });

  it('reports ambiguous trusted reference candidates instead of choosing one', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({
        data: [
          { id: 'promo-a-1', name: 'Mew', number: '1', set: { name: 'CoroCoro Promo' } },
          { id: 'promo-b-1', name: 'Mew', number: '1', set: { name: 'CoroCoro Promo' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await resolveTrustedChaseCardReference('Mew CoroCoro Promo 1')).toMatchObject({
      status: 'AMBIGUOUS',
      candidateCount: 2
    });
  });

  it('keeps bare English subject autocomplete broad instead of jumping to Japanese aliases', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } },
            { id: 'pop4-4', name: 'Mew', number: '4', set: { name: 'POP Series 4' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected Japanese source call for bare subject: ${url}`);
    }) as any;

    const choices = await autocompleteChaseCards('Mew', 25);

    expect(choices).toEqual([
      { name: 'Mew — Southern Islands #1', value: 'Mew Southern Islands 1' },
      { name: 'Mew — POP Series 4 #4', value: 'Mew POP Series 4 4' }
    ]);
  });

  it('uses TCGdex English to resolve modern promo name-and-number searches without exact suffix spelling', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'xy-XY96', name: 'Umbreon-EX', number: 'XY96', set: { name: 'XY Black Star Promos' } },
            { id: 'sm-SM36', name: 'Umbreon-GX', number: 'SM36', set: { name: 'SM Black Star Promos' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/svp-176')) {
        return new Response(JSON.stringify({
          id: 'svp-176',
          localId: '176',
          name: 'Umbreon ex',
          image: 'https://assets.tcgdex.net/en/sv/svp/176',
          set: { id: 'svp', name: 'Scarlet & Violet Black Star Promos', cardCount: { official: 200 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/xy-96')) {
        return new Response(JSON.stringify({
          id: 'xy-96',
          localId: '96',
          name: 'Umbreon-EX',
          image: 'https://assets.tcgdex.net/en/xy/xyp/096',
          set: { id: 'xyp', name: 'XY Black Star Promos', cardCount: { official: 211 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('api.tcgdex.net/v2/en/cards')) {
        if (url.includes('localId=176') || url.includes('localId=SVP176') || url.includes('name=umbreon')) {
          return new Response(JSON.stringify([
            { id: 'xy-96', localId: '96', name: 'Umbreon-EX', image: 'https://assets.tcgdex.net/en/xy/xyp/096' },
            { id: 'svp-176', localId: '176', name: 'Umbreon ex', image: 'https://assets.tcgdex.net/en/sv/svp/176' }
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('umbreon 176', 25);

    expect(choices[0]).toEqual({
      name: 'Umbreon ex — Scarlet & Violet Black Star Promos #176',
      value: 'Umbreon ex Scarlet & Violet Black Star Promos 176'
    });
    expect(choices.some((choice) => /XY96|SM36/.test(choice.value))).toBe(false);
    expect(__chaseCardCatalogTestHooks.cachedPreview('Umbreon ex Scarlet & Violet Black Star Promos 176')).toMatchObject({
      imageUrl: 'https://assets.tcgdex.net/en/sv/svp/176/high.png',
      imageIdentity: 'Umbreon ex Scarlet & Violet Black Star Promos 176',
      imageSourceName: 'TCGDEX_EN',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'svp-176'
    });

    clearChaseCardAutocompleteCache();
    expect((await autocompleteChaseCards('umbreon ex 176', 25))[0]?.value).toBe('Umbreon ex Scarlet & Violet Black Star Promos 176');

    clearChaseCardAutocompleteCache();
    expect((await autocompleteChaseCards('umbreon svp176', 25))[0]?.value).toBe('Umbreon ex Scarlet & Violet Black Star Promos 176');
  });

  it('returns intentional Japanese subject-backed choices when Japanese is specified', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-347')) {
        return new Response(JSON.stringify({
          id: 'SV4a-347',
          localId: '347',
          name: 'ミュウex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%83%9F%E3%83%A5%E3%82%A6')) {
        return new Response(JSON.stringify([
          { id: 'SV4a-347', localId: '347', name: 'ミュウex' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew Japanese', 25);

    expect(choices).toEqual([
      { name: 'Mew Japanese 347/190', value: 'Mew Japanese 347/190' }
    ]);
  });

  it('collapses Japanese catalog variants into one collector-friendly slash-number choice', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/M1S-087')) {
        return new Response(JSON.stringify({
          id: 'M1S-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'M1S', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/M1L-087')) {
        return new Response(JSON.stringify({
          id: 'M1L-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'M1L', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV9a-087', localId: '087', name: 'サーナイト' },
        { id: 'M1S-087', localId: '087', name: 'サーナイト' },
        { id: 'M1L-087', localId: '087', name: 'サーナイト' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Gardevoir 087/063', 10);

    expect(choices).toEqual([
      { name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' }
    ]);
  });

  it('prioritizes Japanese local-number autocomplete over broad English name matches', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: Array.from({ length: 25 }, (_, index) => ({
            id: `en-${index + 1}`,
            name: 'Gardevoir',
            number: String(index + 1),
            set: { name: `English Set ${index + 1}` }
          }))
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV9a-087', localId: '087', name: 'サーナイト' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Gardevoir 087', 25);

    expect(choices[0]).toEqual({ name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' });
  });

  it('uses known refinement when resolving a trusted Japanese slash-number legacy chase', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV8a-217')) {
        return new Response(JSON.stringify({
          id: 'SV8a-217',
          localId: '217',
          name: 'ブラッキーex',
          image: 'https://assets.tcgdex.net/ja/SV/SV8a/217',
          set: { id: 'SV8a', cardCount: { official: 187 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('localId=217') || url.includes('name=%E3%83%96%E3%83%A9%E3%83%83%E3%82%AD%E3%83%BC')) {
        return new Response(JSON.stringify([
          { id: 'SV8a-217', localId: '217', name: 'ブラッキーex', image: 'https://assets.tcgdex.net/ja/SV/SV8a/217' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const autocompleteChoices = await autocompleteChaseCards('Umbreon Japanese 217/187', 25);
    clearChaseCardAutocompleteCache();
    const resolution = await resolveTrustedChaseCardReference('Umbreon Japanese 217/187');

    expect(autocompleteChoices).toEqual([
      { name: 'Umbreon Japanese 217/187', value: 'Umbreon Japanese 217/187' }
    ]);
    expect(resolution).toMatchObject({
      status: 'RESOLVED',
      requestedCardName: 'Umbreon Japanese 217/187',
      resolvedCardName: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      preview: {
        imageUrl: 'https://assets.tcgdex.net/ja/SV/SV8a/217/high.png',
        imageIdentity: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
        imageSourceName: 'TCGDEX',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'SV8a-217'
      }
    });
  });

  it('resolves trusted Japanese references when collector descriptors precede the subject', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/M1S-087')) {
        return new Response(JSON.stringify({
          id: 'M1S-087',
          localId: '087',
          name: 'メガサーナイトex',
          image: 'https://assets.tcgdex.net/ja/M1/M1S/087',
          set: { id: 'M1S', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%82%B5%E3%83%BC%E3%83%8A%E3%82%A4%E3%83%88') || url.includes('localId=087')) {
        return new Response(JSON.stringify([
          { id: 'M1S-087', localId: '087', name: 'メガサーナイトex', image: 'https://assets.tcgdex.net/ja/M1/M1S/087' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const resolution = await resolveTrustedChaseCardReference('Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063');

    expect(resolution).toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      preview: {
        imageUrl: 'https://static.dextcg.com/cards/jpn_m1s/87.png',
        imageSourceName: 'DEXTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'jpn_m1s-87'
      }
    });
  });

  it('uses exact trusted source identities when providers are transiently unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as any;

    await expect(resolveTrustedChaseCardReference('Mew-EX Legendary Treasures RC24')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Mew-EX Legendary Treasures RC24',
      preview: {
        imageUrl: 'https://images.pokemontcg.io/bw11/RC24_hires.png',
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'bw11-RC24'
      }
    });

    await expect(resolveTrustedChaseCardReference('Mew CoroCoro Promo 151')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Mew CoroCoro Promo 151',
      preview: {
        imageUrl: 'https://static.dextcg.com/cards/jpn_unp/124.png',
        imageSourceName: 'DEXTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'jpn_unp-124'
      }
    });

    await expect(resolveTrustedChaseCardReference('Squirtle Japanese Promo 007/018')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: "Squirtle Japanese McDonald's Pokémon-e Minimum Pack 007/018",
      preview: {
        imageUrl: 'https://static.dextcg.com/cards/jpn_mcdemp/7.png',
        imageSourceName: 'DEXTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'jpn_mcdemp-7'
      }
    });

    await expect(resolveTrustedChaseCardReference('Gardevoir ex Paldean Fates 233')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Gardevoir ex Paldean Fates 233',
      preview: {
        imageUrl: 'https://images.pokemontcg.io/sv4pt5/233_hires.png',
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'sv4pt5-233'
      }
    });

    await expect(resolveTrustedChaseCardReference('Pikachu XY Black Star Promos XY95')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Pikachu Black Star Promos XY95',
      preview: {
        imageUrl: 'https://images.pokemontcg.io/xyp/XY95_hires.png',
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'xyp-XY95'
      }
    });

    await expect(resolveTrustedChaseCardReference('Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Moltres & Zapdos & Articuno-GX SM Black Star Promos SM210',
      preview: {
        imageUrl: 'https://images.pokemontcg.io/smp/SM210_hires.png',
        imageSourceName: 'POKEMONTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'smp-SM210'
      }
    });

    await expect(resolveTrustedChaseCardReference('Umbreon Japanese 217/187')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Umbreon ex SAR Terastal Festival Japanese 217/187',
      preview: {
        imageUrl: 'https://assets.tcgdex.net/ja/SV/SV8a/217/high.png',
        imageSourceName: 'TCGDEX',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'SV8a-217'
      }
    });

    await expect(resolveTrustedChaseCardReference('Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063',
      preview: {
        imageUrl: 'https://static.dextcg.com/cards/jpn_m1s/87.png',
        imageSourceName: 'DEXTCG',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'jpn_m1s-87'
      }
    });

    await expect(resolveTrustedChaseCardReference('Mew Japanese 347/190')).resolves.toMatchObject({
      status: 'RESOLVED',
      resolvedCardName: 'Mew ex SAR Shiny Treasure Japanese 347/190',
      preview: {
        imageUrl: 'https://assets.tcgdex.net/ja/SV/SV4a/347/high.png',
        imageSourceName: 'TCGDEX',
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: 'SV4a-347'
      }
    });
  });

  it('matches Japanese autocomplete when card number is typed before the subject without a space', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%82%B5%E3%83%BC%E3%83%8A%E3%82%A4%E3%83%88') || url.includes('localId=087')) {
        return new Response(JSON.stringify([
          { id: 'SV9a-087', localId: '087', name: 'サーナイト' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('087gardevoir', 25);

    expect(choices).toEqual([
      { name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' }
    ]);
  });

  it('matches Japanese autocomplete while known English subjects are partially typed', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%82%B5%E3%83%BC%E3%83%8A%E3%82%A4%E3%83%88') || url.includes('localId=087')) {
        return new Response(JSON.stringify([
          { id: 'SV9a-087', localId: '087', name: 'サーナイト' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('087 gard', 25)).toEqual([
      { name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('gard 087', 25)).toEqual([
      { name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' }
    ]);
  });

  it('falls back to collector wording for source-missing Japanese promo slash numbers', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV2a-007')) {
        return new Response(JSON.stringify({
          id: 'SV2a-007',
          localId: '007',
          name: 'ゼニガメ',
          set: { id: 'SV2a', cardCount: { official: 165 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%82%BC%E3%83%8B%E3%82%AC%E3%83%A1') || url.includes('localId=007')) {
        return new Response(JSON.stringify([
          { id: 'SV2a-007', localId: '007', name: 'ゼニガメ' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('squirtle 007/018', 25)).toEqual([
      { name: 'Squirtle Japanese Promo 007/018', value: 'Squirtle Japanese Promo 007/018' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('007/018 squirtle', 25)).toEqual([
      { name: 'Squirtle Japanese Promo 007/018', value: 'Squirtle Japanese Promo 007/018' }
    ]);
  });

  it('uses Japanese promo fallback across expanded known subjects', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('bulbasaur 001/018', 25)).toEqual([
      { name: 'Bulbasaur Japanese Promo 001/018', value: 'Bulbasaur Japanese Promo 001/018' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('charmander 004/018', 25)).toEqual([
      { name: 'Charmander Japanese Promo 004/018', value: 'Charmander Japanese Promo 004/018' }
    ]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('wartortle 008/018', 25)).toEqual([
      { name: 'Wartortle Japanese Promo 008/018', value: 'Wartortle Japanese Promo 008/018' }
    ]);
  });

  it('does not guess ambiguous partial Japanese promo subjects', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('char 004/018', 25)).toEqual([]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('charma 004/018', 25)).toEqual([
      { name: 'Charmander Japanese Promo 004/018', value: 'Charmander Japanese Promo 004/018' }
    ]);
  });

  it('does not use Japanese promo fallback for broad or impossible collector numbers', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    expect(await autocompleteChaseCards('squirtle 007', 25)).toEqual([]);

    clearChaseCardAutocompleteCache();

    expect(await autocompleteChaseCards('squirtle 247/018', 25)).toEqual([]);
  });

  it('filters autocomplete to the requested full collector number when provided', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'en-1', name: 'Gardevoir', number: '1', set: { name: 'Broad English Set' } },
            { id: 'en-245', name: 'Gardevoir ex', number: '245', set: { name: 'Scarlet & Violet' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-087')) {
        return new Response(JSON.stringify({
          id: 'SV9a-087',
          localId: '087',
          name: 'サーナイト',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV9a-088')) {
        return new Response(JSON.stringify({
          id: 'SV9a-088',
          localId: '088',
          name: 'サーナイトex',
          set: { id: 'SV9a', cardCount: { official: 63 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV9a-087', localId: '087', name: 'サーナイト' },
        { id: 'SV9a-088', localId: '088', name: 'サーナイトex' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Gardevoir 087/063', 25);

    expect(choices).toEqual([
      { name: 'Gardevoir Japanese 087/063', value: 'Gardevoir Japanese 087/063' }
    ]);
  });

  it('matches Japanese autocomplete while the slash total is still partially typed', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-347')) {
        return new Response(JSON.stringify({
          id: 'SV4a-347',
          localId: '347',
          name: 'ミュウ',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-348')) {
        return new Response(JSON.stringify({
          id: 'SV4a-348',
          localId: '348',
          name: 'ミュウex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV4a-347', localId: '347', name: 'ミュウ' },
        { id: 'SV4a-348', localId: '348', name: 'ミュウex' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 347/19', 25);

    expect(choices).toEqual([
      { name: 'Mew Japanese 347/190', value: 'Mew Japanese 347/190' }
    ]);
  });

  it('filters autocomplete to a standalone requested card number when provided', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'en-1', name: 'Mew', number: '1', set: { name: 'Broad English Set' } },
            { id: 'en-37', name: 'Mew', number: '37', set: { name: 'Another English Set' } }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-347')) {
        return new Response(JSON.stringify({
          id: 'SV4a-347',
          localId: '347',
          name: 'ミュウ',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-348')) {
        return new Response(JSON.stringify({
          id: 'SV4a-348',
          localId: '348',
          name: 'ミュウex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV4a-347', localId: '347', name: 'ミュウ' },
        { id: 'SV4a-348', localId: '348', name: 'ミュウex' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 347', 25);

    expect(choices).toEqual([
      { name: 'Mew Japanese 347/190', value: 'Mew Japanese 347/190' }
    ]);
  });

  it('matches Japanese autocomplete while a standalone card number is partially typed', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-347')) {
        return new Response(JSON.stringify({
          id: 'SV4a-347',
          localId: '347',
          name: 'ミュウex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const earlierLocalIdMatch = /localId=34([0-6])/.exec(url);
      if (earlierLocalIdMatch) {
        const localId = `34${earlierLocalIdMatch[1]}`;
        return new Response(JSON.stringify([
          { id: `SV4a-${localId}`, localId, name: 'パモ' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('localId=347')) {
        return new Response(JSON.stringify([
          { id: 'SV4a-347', localId: '347', name: 'ミュウex' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 34', 25);

    expect(choices).toEqual([
      { name: 'Mew Japanese 347/190', value: 'Mew Japanese 347/190' }
    ]);
  });

  it('filters Japanese subject-backed choices by one-digit local-number prefix', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-347')) {
        return new Response(JSON.stringify({
          id: 'SV4a-347',
          localId: '347',
          name: 'ミュウex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/S12a-052')) {
        return new Response(JSON.stringify({
          id: 'S12a-052',
          localId: '052',
          name: 'ミュウ',
          set: { id: 'S12a', cardCount: { official: 172 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=%E3%83%9F%E3%83%A5%E3%82%A6')) {
        return new Response(JSON.stringify([
          { id: 'S12a-052', localId: '052', name: 'ミュウ' },
          { id: 'SV4a-347', localId: '347', name: 'ミュウex' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 3', 25);

    expect(choices).toEqual([
      { name: 'Mew Japanese 347/190', value: 'Mew Japanese 347/190' }
    ]);
  });

  it('shows helper text instead of treating bare card numbers as autocomplete', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected source call for bare card number: ${String(input)}`);
    }) as any;

    const choices = await autocompleteChaseCards('34', 25);

    expect(choices).toEqual([
      { name: 'Keep typing: add the card name with this number', value: '34' }
    ]);
  });

  it('does not invent Japanese card names from local-number-only matches', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.pokemontcg.io')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('name=')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/SV4a-247')) {
        return new Response(JSON.stringify({
          id: 'SV4a-247',
          localId: '247',
          name: 'リザードンex',
          set: { id: 'SV4a', cardCount: { official: 190 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/S12a-247')) {
        return new Response(JSON.stringify({
          id: 'S12a-247',
          localId: '247',
          name: 'ピカチュウ',
          set: { id: 'S12a', cardCount: { official: 172 } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([
        { id: 'SV4a-247', localId: '247', name: 'リザードンex' },
        { id: 'S12a-247', localId: '247', name: 'ピカチュウ' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const choices = await autocompleteChaseCards('Mew 247', 25);

    expect(choices).toEqual([]);
  });

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
    const payload = interaction.reply.mock.calls[0]![0] as any;
    expect(payload.embeds[0].toJSON().description).toContain('Plenty of detail here');
    expect(payload.embeds[0].toJSON().description).toContain('tighten the filters with price, grade, condition, or exclusions');
  });

  it('warns broad chase adds that alerts may be noisy', async () => {
    const userId = testUserId('broad-add');
    setUserPlan(userId, 'FREE');

    const interaction = mockInteraction(userId, 'add', {
      card: 'Charizard'
    });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const text = payload.embeds[0].toJSON().description;
    expect(text).toContain('This chase is wide open right now');
    expect(text).toContain('add a set, card number, max price, grade, or a few exclusions if results get noisy');
    expect(text).toContain('Tip: start broad if you want, then tighten it once you see the kinds of listings that show up.');
  });

  it('does not add the same chase twice from repeated submissions', async () => {
    const userId = testUserId('duplicate-add');
    setUserPlan(userId, 'PRO');

    await chase.execute(mockInteraction(userId, 'add', { card: 'Umbreon 217/187 Japanese', max_price: 550 }));
    const duplicateInteraction = mockInteraction(userId, 'add', { card: '  umbreon   217/187 japanese  ', max_price: 550 });
    await chase.execute(duplicateInteraction);

    expect(listChases(userId).map((item) => item.cardName)).toEqual(['Umbreon ex SAR Terastal Festival Japanese 217/187']);
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

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    await handleChaseRemoveButtons(mockButtonInteraction(userId, buttonId));

    const remaining = listChases(userId);
    expect(remaining.map((item) => item.id)).toEqual([keep.id]);
    expect(interaction.reply).toHaveBeenCalledOnce();
  });

  it('removes a chase as completed only after confirmation', async () => {
    const userId = testUserId('remove-completed-memory');
    const remove = addChase({
      userId,
      cardName: 'Meowth 18/53',
      maxPrice: 50,
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    expect(listChases(userId).map((item) => item.id)).toEqual([remove.id]);
    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);
    expect(listChases(userId)).toEqual([]);
    expect(listUserTasteMemoryChases(userId).map((item) => `${item.cardName}:${item.tasteSource}`)).toEqual(['Meowth 18/53:BOUGHT_OR_SEEN']);
    expect(evaluateWeeklyDiscoveryEligibility([], listUserTasteMemoryChases(userId), 1).uniqueSignalCount).toBe(1);
    expect(button.update.mock.calls[0]![0].embeds[0].data.title).toBe('✅ Chase Completed');
  });

  it('removes a chase as no longer interested without marking it completed', async () => {
    const userId = testUserId('remove-negative-memory');
    const remove = addChase({
      userId,
      cardName: 'Pikachu Pokemon Rumble 7',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[1].data.custom_id as string;
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);

    expect(listChases(userId)).toEqual([]);
    expect(listUserTasteMemoryChases(userId).map((item) => `${item.cardName}:${item.tasteSource}`)).toEqual(['Pikachu Pokemon Rumble 7:REMOVED_CHASE']);
    expect(evaluateWeeklyDiscoveryEligibility([], listUserTasteMemoryChases(userId), 1).uniqueSignalCount).toBe(0);
    expect(button.update.mock.calls[0]![0].embeds[0].data.description).toContain('It was not marked as completed.');
  });

  it('removes a chase added by mistake without changing collector profile', async () => {
    const userId = testUserId('remove-mistake-memory');
    const remove = addChase({
      userId,
      cardName: 'Random Bulk Card',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[2].data.custom_id as string;
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);
    expect(listChases(userId)).toEqual([]);
    expect(listUserTasteMemoryChases(userId)).toEqual([]);
    expect(button.update.mock.calls[0]![0].embeds[0].data.description).toContain('without changing your collector profile');
  });

  it('cancels chase removal without changing database state', async () => {
    const userId = testUserId('remove-cancel');
    const remove = addChase({
      userId,
      cardName: 'Mew RC24',
      priority: 'HIGH',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[3].data.custom_id as string;
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);

    expect(listChases(userId).map((item) => item.id)).toEqual([remove.id]);
    expect(listUserTasteMemoryChases(userId)).toEqual([]);
    expect(button.update.mock.calls[0]![0].embeds[0].data.title).toBe('Removal Cancelled');
  });

  it('rejects unauthorized button users', async () => {
    const userId = testUserId('remove-unauthorized-owner');
    const otherUserId = testUserId('remove-unauthorized-other');
    const remove = addChase({
      userId,
      cardName: 'Umbreon GX SM36',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    const button = mockButtonInteraction(otherUserId, buttonId);
    await handleChaseRemoveButtons(button);

    expect(listChases(userId).map((item) => item.id)).toEqual([remove.id]);
    expect(button.reply.mock.calls[0]![0].content).toBe('Only the original requester can use these buttons');
  });

  it('makes no change after interaction expiry', async () => {
    const userId = testUserId('remove-expired');
    const remove = addChase({
      userId,
      cardName: 'Gardevoir ex 233/091',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    __chaseRemoveTestHooks.setNow(() => Date.now() + 16 * 60 * 1000);
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);

    expect(listChases(userId).map((item) => item.id)).toEqual([remove.id]);
    expect(listUserTasteMemoryChases(userId)).toEqual([]);
    expect(button.update.mock.calls[0]![0].embeds[0].data.title).toBe('⛔ Removal Expired');
  });

  it('treats duplicate button submission as idempotent', async () => {
    const userId = testUserId('remove-duplicate');
    const remove = addChase({
      userId,
      cardName: 'Pichu Expedition 22/165',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    const first = mockButtonInteraction(userId, buttonId);
    const second = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(first);
    await handleChaseRemoveButtons(second);

    expect(listChases(userId)).toEqual([]);
    expect(listUserTasteMemoryChases(userId).map((item) => `${item.cardName}:${item.tasteSource}`)).toEqual(['Pichu Expedition 22/165:BOUGHT_OR_SEEN']);
    expect(second.update.mock.calls[0]![0].embeds[0].data.title).toBe('✅ Chase Completed');
  });

  it('does not leave partial state when chase removal persistence fails', async () => {
    const userId = testUserId('remove-failure');
    const remove = addChase({
      userId,
      cardName: 'Mewtwo LV.X 144/146',
      priority: 'NORMAL',
      listingType: 'ANY'
    });
    const interaction = mockInteraction(userId, 'remove', { chase: remove.id });

    await chase.execute(interaction);

    const payload = interaction.reply.mock.calls[0]![0] as any;
    const buttonId = payload.components[0].components[0].data.custom_id as string;
    __chaseStoreTestHooks.failNextResolvedRemoval();
    const button = mockButtonInteraction(userId, buttonId);
    await handleChaseRemoveButtons(button);

    expect(listChases(userId).map((item) => item.id)).toEqual([remove.id]);
    expect(listUserTasteMemoryChases(userId)).toEqual([]);
    expect(button.update.mock.calls[0]![0].embeds[0].data.title).toBe('⛔ Remove Failed');
  });

  it('only completed contributes to completed chase history', async () => {
    const userId = testUserId('remove-history-split');
    const completed = addChase({ userId, cardName: 'Meowth 18/53', priority: 'NORMAL', listingType: 'ANY' });
    const uninterested = addChase({ userId, cardName: 'Zapdos Aquapolis 44', priority: 'NORMAL', listingType: 'ANY' });
    const mistake = addChase({ userId, cardName: 'Random Vintage Lot', priority: 'NORMAL', listingType: 'ANY' });

    const completedInteraction = mockInteraction(userId, 'remove', { chase: completed.id });
    await chase.execute(completedInteraction);
    const completedPayload = completedInteraction.reply.mock.calls[0]![0] as any;
    await handleChaseRemoveButtons(mockButtonInteraction(userId, completedPayload.components[0].components[0].data.custom_id as string));

    const uninterestedInteraction = mockInteraction(userId, 'remove', { chase: uninterested.id });
    await chase.execute(uninterestedInteraction);
    const uninterestedPayload = uninterestedInteraction.reply.mock.calls[0]![0] as any;
    await handleChaseRemoveButtons(mockButtonInteraction(userId, uninterestedPayload.components[0].components[1].data.custom_id as string));

    const mistakeInteraction = mockInteraction(userId, 'remove', { chase: mistake.id });
    await chase.execute(mistakeInteraction);
    const mistakePayload = mistakeInteraction.reply.mock.calls[0]![0] as any;
    await handleChaseRemoveButtons(mockButtonInteraction(userId, mistakePayload.components[0].components[2].data.custom_id as string));

    expect(listUserTasteMemoryChases(userId).map((item) => `${item.cardName}:${item.tasteSource}`)).toEqual([
      'Meowth 18/53:BOUGHT_OR_SEEN',
      'Zapdos Aquapolis 44:REMOVED_CHASE'
    ]);
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

  it('gives useful first-chase guidance when the Vault is empty', () => {
    const userId = testUserId('empty-list');

    const payload = buildChaseListEmbed(userId, 0);
    const data = payload.embeds[0].toJSON();

    expect(data.title).toBe('📭 No Active Chases');
    expect(data.description).toContain('Add one specific card to start shaping your Vault.');
    expect(data.description).toContain('Open `/chase add`, start typing your card, and pick the match if it looks right.');
    expect(data.description).toContain('If it does not show up, you can still enter it yourself.');
    expect(data.description).toContain('Quiet days are normal. Vaultr only sends alerts when a listing clears your match settings.');
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

  it('labels shown Discovery training examples from feedback and clears labels on undo', () => {
    const userId = testUserId('discovery-training-outcome');
    const cardName = 'Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese';

    recordDiscoveryTrainingExamples([
      {
        userId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: cardName,
        lane: 'Japanese Collector Trail',
        position: 2,
        rankerVersion: 'collector-v1',
        features: { japaneseSignal: true, exactNicheIdentity: true },
        scores: { collectorRank: 449 }
      }
    ]);

    recordDiscoveryFeedback({ userId, cardName, lane: 'Japanese Collector Trail', feedback: 'MORE_LIKE_THIS', maxPrice: 500 });
    expect(db.prepare('SELECT outcome FROM discovery_training_examples WHERE user_id = ? AND suggestion_name = ?').get(userId, cardName)).toMatchObject({ outcome: 'MORE_LIKE_THIS' });

    undoDiscoveryFeedback({ userId, cardName });
    expect(db.prepare('SELECT outcome FROM discovery_training_examples WHERE user_id = ? AND suggestion_name = ?').get(userId, cardName)).toMatchObject({ outcome: null });
  });

  it('summarizes labeled Discovery traces into bounded learned feature weights', () => {
    const userId = testUserId('discovery-learned-summary');
    recordDiscoveryTrainingExamples([
      {
        userId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'Liked Japanese Promo 1',
        lane: 'Japanese Collector Trail',
        position: 1,
        rankerVersion: 'collector-v1',
        features: { japaneseSignal: true, promoSignal: true, ordinaryFormatPenalty: false, collectorTerms: ['japanese', 'promo', 'trainer gallery'], collectorTraits: { region: ['japanese'], releaseShape: ['promo'], artShape: ['trainer gallery'] } },
        scores: { collectorRank: 300 }
      },
      {
        userId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'Liked Japanese Promo 2',
        lane: 'Japanese Collector Trail',
        position: 2,
        rankerVersion: 'collector-v1',
        features: { japaneseSignal: true, promoSignal: true, ordinaryFormatPenalty: false, collectorTerms: ['japanese', 'promo', 'trainer gallery'], collectorTraits: { region: ['japanese'], releaseShape: ['promo'], artShape: ['trainer gallery'] } },
        scores: { collectorRank: 280 }
      },
      {
        userId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'Rejected Format Card',
        lane: 'Format Trail',
        position: 3,
        rankerVersion: 'collector-v1',
        features: { japaneseSignal: false, promoSignal: false, ordinaryFormatPenalty: true, collectorTerms: ['vmax'], collectorTraits: { format: ['vmax'] } },
        scores: { collectorRank: 80 }
      },
      {
        userId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'Rejected Format Card 2',
        lane: 'Format Trail',
        position: 4,
        rankerVersion: 'collector-v1',
        features: { japaneseSignal: false, promoSignal: false, ordinaryFormatPenalty: true, collectorTerms: ['vmax'], collectorTraits: { format: ['vmax'] } },
        scores: { collectorRank: 70 }
      }
    ]);
    recordDiscoveryFeedback({ userId, cardName: 'Liked Japanese Promo 1', lane: 'Japanese Collector Trail', feedback: 'MORE_LIKE_THIS' });
    recordDiscoveryFeedback({ userId, cardName: 'Liked Japanese Promo 2', lane: 'Japanese Collector Trail', feedback: 'MORE_LIKE_THIS' });
    recordDiscoveryFeedback({ userId, cardName: 'Rejected Format Card', lane: 'Format Trail', feedback: 'NOT_FOR_ME' });
    recordDiscoveryFeedback({ userId, cardName: 'Rejected Format Card 2', lane: 'Format Trail', feedback: 'NOT_FOR_ME' });

    const summary = getDiscoveryLearnedSignalSummary(userId);

    expect(summary).toMatchObject({ exampleCount: 4, likedCount: 2, rejectedCount: 2 });
    expect(summary.featureWeights.japaneseSignal).toBeGreaterThan(0);
    expect(summary.featureWeights.promoSignal).toBeGreaterThan(0);
    expect(summary.featureWeights.ordinaryFormatPenalty).toBeLessThan(0);
    expect(summary.termWeights.japanese).toBeGreaterThan(0);
    expect(summary.termWeights['trainer gallery']).toBeGreaterThan(0);
    expect(summary.termWeights.vmax).toBeLessThan(0);
    expect(summary.termEdgeWeights['japanese|promo']).toBeGreaterThan(0);
    expect(summary.termEdgeWeights['promo|trainer gallery']).toBeGreaterThan(0);
    expect(summary.typedTraitEdgeWeights['region:japanese|releaseShape:promo']).toBeGreaterThan(0);
    expect(summary.typedTraitEdgeWeights['artShape:trainer gallery|releaseShape:promo']).toBeGreaterThan(0);
  });

  it('summarizes global collector grammar only after multiple users support a typed edge', () => {
    const firstUserId = testUserId('global-grammar-first');
    const secondUserId = testUserId('global-grammar-second');
    recordDiscoveryTrainingExamples([
      {
        userId: firstUserId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'First Global Japanese Promo',
        lane: 'Japanese Collector Trail',
        position: 1,
        rankerVersion: 'collector-v1',
        features: { collectorTraits: { subject: ['mew'], region: ['japanese'], releaseShape: ['promo'] } },
        scores: { collectorRank: 300 }
      },
      {
        userId: secondUserId,
        surface: 'WEEKLY_DISCOVERY_SHELF',
        periodKey: '2026-W26',
        suggestionName: 'Second Global Japanese Promo',
        lane: 'Japanese Collector Trail',
        position: 1,
        rankerVersion: 'collector-v1',
        features: { collectorTraits: { subject: ['pikachu'], region: ['japanese'], releaseShape: ['promo'] } },
        scores: { collectorRank: 290 }
      }
    ]);
    recordDiscoveryFeedback({ userId: firstUserId, cardName: 'First Global Japanese Promo', lane: 'Japanese Collector Trail', feedback: 'MORE_LIKE_THIS' });
    recordDiscoveryFeedback({ userId: secondUserId, cardName: 'Second Global Japanese Promo', lane: 'Japanese Collector Trail', feedback: 'MORE_LIKE_THIS' });

    const summary = getDiscoveryGlobalCollectorGrammarSummary({ limit: 20, minDistinctUsers: 2, minExamples: 2 });

    expect(summary.typedTraitEdgeWeights['region:japanese|releaseShape:promo']).toBeGreaterThan(0);
    expect(Object.keys(summary.typedTraitEdgeWeights).some((edge) => edge.includes('subject:'))).toBe(false);
  });
});
