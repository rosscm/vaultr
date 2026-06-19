import { describe, expect, it } from 'vitest';
import { hasPromoLeaningDiscoveryProfile, selectDiscoverySuggestions, selectDiscoverySuggestionsForFocuses } from '../discovery-catalog.js';
import type { Chase } from '../../types.js';

function chase(overrides: Partial<Chase> = {}): Chase {
  return {
    id: 'c1',
    userId: 'u1',
    cardName: 'Pikachu promo cards',
    createdAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  };
}

function expectDistinctLanes(selection: ReturnType<typeof selectDiscoverySuggestions>): void {
  const lanes = selection.suggestions.map((suggestion) => suggestion.lane);
  expect(new Set(lanes).size).toBe(lanes.length);
}

describe('selectDiscoverySuggestions', () => {
  it('uses active chases as signals without surfacing the current chase card', () => {
    const selection = selectDiscoverySuggestions(null, [chase({ cardName: 'Squirtle 007/018 Japanese promo' })], 4);
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Japanese promo Pokemon cards');
    expect(names).toContain('Japanese Pokemon cards');
    expect(names).toContain('Pokemon special release cards');
    expect(names.some((name) => name.startsWith('Squirtle'))).toBe(false);
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'Japanese promo Pokemon cards')?.requiredEvidenceTokens).toEqual(['japanese', 'promo']);
    expect(selection.suggestions.every((suggestion) => suggestion.evidenceSearchTerm && suggestion.requiredEvidenceTokens?.length)).toBe(true);
    expect(names).not.toContain("Totodile 18/25 McDonald's 25th Anniversary Promo");
    expectDistinctLanes(selection);
  });

  it('turns active chase cards into shared profile traits, not repeated card or one-off code searches', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Mew LP MP it RC24', priority: 'GRAIL' }),
        chase({ id: 'c2', cardName: 'Pikachu Toys R Us 26/83', priority: 'GRAIL' }),
        chase({ id: 'c3', cardName: 'Moltres Zapdos Articuno SM210', priority: 'GRAIL' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Pokemon promo cards');
    expect(names).toContain('Pokemon special release cards');
    expect(names).toContain('Pokemon collector cards');
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'Pokemon promo cards')?.sourceTasteTokens).toEqual(
      expect.arrayContaining(['promo', 'special'])
    );
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'Pokemon promo cards')?.sourceTasteTokens).not.toEqual(
      expect.arrayContaining(['mew', 'pikachu', 'zapdos'])
    );
    expect(names).not.toContain('RC era Pokemon cards');
    expect(names).not.toContain('retail promo Pokemon cards');
    expect(names).not.toContain('SM era Pokemon cards');
    expect(names).not.toContain('Mew RC24 trading card');
    expect(names).not.toContain('Pikachu Toys Us 26/83 trading card');
    expect(names).not.toContain('Moltres Zapdos Articuno SM210 trading card');
  });

  it('infers Japanese collector signals from Japanese promo numbering without literal Japanese text', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Mario Pikachu XY-P 294', priority: 'GRAIL' }),
        chase({ id: 'c2', cardName: 'Munch Psyduck 286/SM-P', priority: 'GRAIL' }),
        chase({ id: 'c3', cardName: 'Kanazawa Pikachu 144/S-P', priority: 'GRAIL' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Japanese promo Pokemon cards');
    expect(names).toContain('Japanese Pokemon cards');
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'Japanese promo Pokemon cards')?.sourceTasteTokens).toEqual(
      expect.arrayContaining(['japanese', 'promo', 'special'])
    );
    expect(names.some((name) => name.startsWith('Mario Pikachu'))).toBe(false);
  });

  it('does not let weak /018 taste profile memory fabricate e-reader or small-set support', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Corocoro Shining Mew', priority: 'GRAIL' }),
        chase({ id: 'taste:squirtle', cardName: 'Squirtle 007/018', tasteWeight: 0.35, tasteSource: 'REMOVED_CHASE' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);
    const sourceTasteTokens = selection.suggestions.flatMap((suggestion) => suggestion.sourceTasteTokens ?? []);

    expect(names[0]).toBe('vintage Pokemon cards');
    expect(names.some((name) => name.startsWith('Corocoro Shining Mew'))).toBe(false);
    expect(names.some((name) => name.startsWith('Squirtle'))).toBe(true);
    expect(names).not.toContain('Mew Southern Islands Promo');
    expect(sourceTasteTokens).not.toContain('e-reader');
    expect(sourceTasteTokens).not.toContain('small set');
  });

  it('uses saved focuses only as lightweight text signals', () => {
    const selection = selectDiscoverySuggestionsForFocuses(['e reader', 'vending'], [], 3);
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Reader trading card');
    expect(names).toContain('Vending special release cards');
    expect(names).not.toContain('Houndoom Aquapolis H11/H32');
    expectDistinctLanes(selection);
  });

  it('promotes card-format and era traits into the taste profile', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Houndoom Aquapolis H11/H32 e-reader', priority: 'HIGH' }),
        chase({ cardName: 'Mewtwo & Mew-GX SM191 Tag Team promo', priority: 'HIGH' }),
        chase({ cardName: 'Gardevoir ex full art 087/063', priority: 'NORMAL' })
      ],
      12
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('e-reader Pokemon cards');
    expect(names).toContain('Tag Team Pokemon cards');
    expect(names).toContain('Pokemon full art cards');
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'e-reader Pokemon cards')?.sourceTasteTokens).toEqual(expect.arrayContaining(['e-reader', 'vintage']));
  });

  it('avoids recently seen suggestions and can cool down their threads', () => {
    const first = selectDiscoverySuggestions(null, [chase({ cardName: 'Gengar vintage Japanese cards' })], 3);
    const excluded = first.suggestions[0];
    const cooled = selectDiscoverySuggestions(null, [chase({ cardName: 'Gengar vintage Japanese cards' })], 3, {
      excludedNames: [excluded.name],
      excludeLanesForExcludedNames: true
    });

    expect(cooled.suggestions.map((suggestion) => suggestion.name)).not.toContain(excluded.name);
    expect(cooled.suggestions.map((suggestion) => suggestion.lane)).not.toContain(excluded.lane);
    expectDistinctLanes(cooled);
  });

  it('blends remembered card and ambient paths in one profile stream', () => {
    const chases = [chase({ cardName: 'Mew RC24', priority: 'HIGH', tasteSource: 'GOOD_ALERT' })];
    const selection = selectDiscoverySuggestions(null, chases, 8);
    const sourceBacked = selection.suggestions.find((suggestion) => suggestion.lane === 'source-backed matches');

    expect(sourceBacked?.name).toBe('Mew RC24 trading card');
    expect(selection.suggestions.length).toBeGreaterThan(1);
  });

  it('infers promo and special-release leaning from repeated generic signals', () => {
    const chases = [
      chase({ cardName: 'Pikachu Toys R Us 26/83 promo', grade: 'UNGRADED' }),
      chase({ id: 'c2', cardName: 'Moltres Zapdos Articuno SM210', grade: 'UNGRADED' }),
      chase({ id: 'c3', cardName: 'Corocoro Shining Mew', grade: 'UNGRADED' })
    ];
    const selection = selectDiscoverySuggestions(null, chases, 6);

    expect(hasPromoLeaningDiscoveryProfile(chases)).toBe(true);
    expect(selection.suggestions.some((suggestion) => suggestion.lane === 'Promo Trail')).toBe(true);
    expect(selection.suggestions.some((suggestion) => suggestion.lane === 'Vintage Era Trail')).toBe(true);
    expect(selection.suggestions.some((suggestion) => suggestion.name.startsWith('Squirtle'))).toBe(false);
    expect(selection.suggestions.map((suggestion) => suggestion.name)).not.toContain('Pikachu 012 Nintendo Black Star Promo');
    expectDistinctLanes(selection);
  });

  it('does not infer e-reader, Japanese, or small-set traits from /018 text alone', () => {
    const selection = selectDiscoverySuggestions(null, [chase({ cardName: 'Squirtle 007/018', priority: 'GRAIL' })], 8);
    const names = selection.suggestions.map((suggestion) => suggestion.name);
    const sourceTasteTokens = selection.suggestions.flatMap((suggestion) => suggestion.sourceTasteTokens ?? []);

    expect(names).not.toContain('e-reader Pokemon cards');
    expect(names).not.toContain('Japanese Pokemon cards');
    expect(names).not.toContain('Pokemon special release cards');
    expect(sourceTasteTokens).not.toContain('e-reader');
    expect(sourceTasteTokens).not.toContain('small set');
    expect(sourceTasteTokens).not.toContain('japanese');
  });

  it('falls back to broad source-backed starter threads without chases', () => {
    const selection = selectDiscoverySuggestions(null, [], 3);

    expect(selection.suggestions).toHaveLength(3);
    expect(selection.suggestions.every((suggestion) => suggestion.evidenceSearchTerm && suggestion.requiredEvidenceTokens?.length)).toBe(true);
    expect(selection.suggestions.map((suggestion) => suggestion.name)).not.toContain('Pikachu 012 Nintendo Black Star Promo');
    expectDistinctLanes(selection);
  });
});
