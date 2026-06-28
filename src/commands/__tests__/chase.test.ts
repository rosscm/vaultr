import { afterEach, describe, expect, it, vi } from 'vitest';
import { chase } from '../chase.js';
import { handleChaseAddAutocomplete } from '../chase-add.js';
import { buildChaseListEmbed } from '../chase-list.js';
import {
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
import { clearChaseCardAutocompleteCache } from '../../services/chase-card-catalog.js';
import { autocompleteChaseCards } from '../../services/chase-card-catalog.js';
import { db } from '../../services/db.js';

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearChaseCardAutocompleteCache();
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
    const respond = vi.fn(async (_choices?: any) => undefined);
    const interaction = {
      isAutocomplete: () => true,
      commandName: 'chase',
      options: {
        getSubcommand: () => 'add',
        getFocused: () => ({ name: 'card', value: 'mew ex' })
      },
      respond
    };

    await handleChaseAddAutocomplete(interaction);

    expect(respond).toHaveBeenCalledWith([
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
    expect(text).toContain('This one is broad, so it may cast a wider net');
    expect(text).toContain('Add a set, card number, language, or variant to sharpen it');
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

  it('gives useful first-chase guidance when the Vault is empty', () => {
    const userId = testUserId('empty-list');

    const payload = buildChaseListEmbed(userId, 0);
    const data = payload.embeds[0].toJSON();

    expect(data.title).toBe('📭 No Active Chases');
    expect(data.description).toContain('Add one specific card to start shaping your Vault.');
    expect(data.description).toContain('`Umbreon 217/187 Japanese`');
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