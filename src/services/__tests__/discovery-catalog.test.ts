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

describe('selectDiscoverySuggestions', () => {
  function expectDistinctLanes(selection: ReturnType<typeof selectDiscoverySuggestions>): void {
    const lanes = selection.suggestions.map((suggestion) => suggestion.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
  }

  it('surfaces niche Pikachu promo cards from a Pikachu promo focus', () => {
    const selection = selectDiscoverySuggestions('pikachu promo', [], 3);
    const pikachu012 = selection.suggestions.find((suggestion) => suggestion.name === 'Pikachu 012 Nintendo Black Star Promo');

    expect(selection.lane).toBe('quiet character promos');
    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Pikachu 012 Nintendo Black Star Promo');
    expect(pikachu012?.lane).toBe('quiet character promos');
    expect(pikachu012?.laneWhy).toContain('character-led promos');
    expect(pikachu012?.nearby).toContain('Pikachu XY95 Black Star Promo');
    expectDistinctLanes(selection);
  });

  it('uses active chase text when no focus is supplied', () => {
    const selection = selectDiscoverySuggestions(null, [chase({ cardName: 'Gengar vintage Japanese cards' })], 3);
    const gengar = selection.suggestions.find((suggestion) => suggestion.name === 'Gengar Web Series');

    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Gengar Web Series');
    expect(gengar?.lane).toBe('Japanese-only oddities');
    expect(gengar?.nearby).toContain('Mewtwo Vending Series');
    expectDistinctLanes(selection);
  });

  it('blends multiple saved focuses instead of letting one focus dominate', () => {
    const selection = selectDiscoverySuggestionsForFocuses(['e reader', 'vending'], [], 3);
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Houndoom Aquapolis H11/H32');
    expect(names).toContain('Mewtwo Vending Series');
    expectDistinctLanes(selection);
  });

  it('uses saved focuses as a light steer once active chases provide stronger taste', () => {
    const selection = selectDiscoverySuggestionsForFocuses(
      ['e reader', 'vending'],
      [
        chase({ cardName: 'Squirtle 007/018', priority: 'NORMAL' }),
        chase({ id: 'c2', cardName: 'Corocoro Shining Mew', priority: 'GRAIL' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names[0]).toBe('Houndoom Aquapolis H11/H32');
    expect(names.slice(1, 4)).toEqual(['Mew Southern Islands Promo', 'Ancient Mew Promo', 'Mew GG10 Crown Zenith']);
    expect(names.indexOf('Mewtwo Vending Series')).toBeGreaterThan(names.indexOf("Totodile 18/25 McDonald's 25th Anniversary Promo"));
    expectDistinctLanes(selection);
  });

  it('avoids recently seen suggestions before falling back to repeats', () => {
    const selection = selectDiscoverySuggestionsForFocuses(['e reader', 'vending'], [], 3, {
      excludedNames: ['Houndoom Aquapolis H11/H32', 'Mewtwo Vending Series']
    });
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).not.toContain('Houndoom Aquapolis H11/H32');
    expect(names).not.toContain('Mewtwo Vending Series');
    expect(names).toContain('Ninetales Expedition H19/H32');
    expectDistinctLanes(selection);
  });

  it('can cool down recently seen lanes for live discovery variety', () => {
    const selection = selectDiscoverySuggestionsForFocuses(
      ['e reader', 'vending'],
      [
        chase({ cardName: 'Squirtle 007/018', priority: 'NORMAL' }),
        chase({ id: 'c2', cardName: 'Corocoro Shining Mew', priority: 'GRAIL' })
      ],
      8,
      {
        excludedNames: ['Mewtwo Vending Series', 'Articuno Fossil Holo'],
        excludeLanesForExcludedNames: true
      }
    );
    const lanes = selection.suggestions.map((suggestion) => suggestion.lane);

    expect(selection.suggestions.map((suggestion) => suggestion.name)).not.toContain('Mewtwo Vending Series');
    expect(lanes).not.toContain('Japanese-only oddities');
    expect(lanes).not.toContain('legendary birds');
    expectDistinctLanes(selection);
  });

  it('prioritizes specific chase branches before broader inferred promo lanes', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Corocoro Shining Mew' }),
        chase({ id: 'c2', cardName: 'Squirtle 007/018' }),
        chase({ id: 'c3', cardName: 'Moltres Zapdos Articuno SM210' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Mew Southern Islands Promo');
    expect(names).toContain('Totodile 18/25 McDonald\'s 25th Anniversary Promo');
    expect(names).toContain('Articuno Fossil Holo');
    expect(selection.suggestions.find((suggestion) => suggestion.name === 'Totodile 18/25 McDonald\'s 25th Anniversary Promo')?.evidenceSearchTerm).toBe(
      'Totodile 18/25 McDonalds Pokemon'
    );
    expect(names).not.toContain('Monkey.D.Luffy ST01-001 Leader');
    expectDistinctLanes(selection);
  });

  it('lets high-priority chase taste outrank lower-priority profile noise', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Squirtle 007/018', priority: 'NORMAL' }),
        chase({ id: 'c2', cardName: 'Corocoro Shining Mew', priority: 'GRAIL' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names.slice(0, 3)).toEqual(['Mew Southern Islands Promo', 'Ancient Mew Promo', 'Mew GG10 Crown Zenith']);
    expect(names.indexOf('Mew Southern Islands Promo')).toBeLessThan(names.indexOf("Totodile 18/25 McDonald's 25th Anniversary Promo"));
    expect(names.indexOf('Pikachu 012 Nintendo Black Star Promo')).toBeGreaterThan(names.indexOf('Mewtwo Vending Series'));
    expectDistinctLanes(selection);
  });

  it('keeps interacted historical chases in the taste profile after they leave active chases', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Squirtle 007/018', priority: 'NORMAL' }),
        chase({ id: 'taste:mew', cardName: 'Corocoro Shining Mew', tasteWeight: 0.8, tasteSource: 'GOOD_ALERT' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names.slice(0, 3)).toEqual(['Mew Southern Islands Promo', "Totodile 18/25 McDonald's 25th Anniversary Promo", 'Ancient Mew Promo']);
    expect(names).toContain('Mew GG10 Crown Zenith');
    expectDistinctLanes(selection);
  });

  it('keeps active grail intent stronger than weak removed-chase memory', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Squirtle 007/018', priority: 'GRAIL' }),
        chase({ id: 'taste:mew', cardName: 'Corocoro Shining Mew', tasteWeight: 0.35, tasteSource: 'REMOVED_CHASE' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names.slice(0, 3)).toEqual([
      'Wartortle 171/165 Pokemon 151 Illustration Rare',
      "Totodile 18/25 McDonald's 25th Anniversary Promo",
      'Squirtle 170/165 Pokemon 151 Illustration Rare'
    ]);
    expect(names.indexOf('Mew Southern Islands Promo')).toBeGreaterThan(names.indexOf('Squirtle 170/165 Pokemon 151 Illustration Rare'));
    expectDistinctLanes(selection);
  });

  it('amplifies repeated named-character taste without overfitting to generic promo text', () => {
    const selection = selectDiscoverySuggestions(
      null,
      [
        chase({ cardName: 'Corocoro Shining Mew', priority: 'HIGH' }),
        chase({ id: 'c2', cardName: 'Mew RC24', priority: 'HIGH' }),
        chase({ id: 'c3', cardName: 'Mew 347/190', priority: 'NORMAL' })
      ],
      8
    );
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names.slice(0, 4)).toEqual(['Mew Southern Islands Promo', 'Ancient Mew Promo', 'Mew GG10 Crown Zenith', 'Mewtwo Vending Series']);
    expect(names.indexOf('Pikachu 012 Nintendo Black Star Promo')).toBeGreaterThan(names.indexOf('Mewtwo Vending Series'));
    expect(names).not.toContain('Monkey.D.Luffy ST01-001 Leader');
    expectDistinctLanes(selection);
  });

  it('infers promo and special-release profile signals without literal promo text', () => {
    const chases = [
      chase({ cardName: 'Squirtle 007/018', grade: 'UNGRADED' }),
      chase({ id: 'c2', cardName: 'Moltres Zapdos Articuno SM210', grade: 'UNGRADED' }),
      chase({ id: 'c3', cardName: 'Corocoro Shining Mew', grade: 'UNGRADED' }),
      chase({ id: 'c4', cardName: 'Mew RC24', grade: 'UNGRADED' }),
      chase({ id: 'c5', cardName: 'Mew 347/190', grade: 'UNGRADED' }),
      chase({ id: 'c6', cardName: 'Mew ex 053' })
    ];
    const selection = selectDiscoverySuggestions(null, chases, 16);
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(hasPromoLeaningDiscoveryProfile(chases)).toBe(true);
    expect(names).toContain('Pikachu 012 Nintendo Black Star Promo');
    expect(names).toContain('Mewtwo Vending Series');
    expect(names).toContain('Articuno 148/147 Supreme Victors Secret Rare');
    expect(names).toContain('Mew Southern Islands Promo');
    expect(names).toContain('Totodile 18/25 McDonald\'s 25th Anniversary Promo');
    expectDistinctLanes(selection);
  });

  it('surfaces One Piece lanes from Luffy chase text', () => {
    const selection = selectDiscoverySuggestions(null, [chase({ cardName: 'Luffy ST21-014 promo' })], 3);
    const names = selection.suggestions.map((suggestion) => suggestion.name);

    expect(names).toContain('Monkey.D.Luffy ST01-001 Leader');
    expect(names.some((name) => name.includes('Luffy'))).toBe(true);
    expectDistinctLanes(selection);
  });

  it('falls back to curated starter cards without focus or chases', () => {
    const selection = selectDiscoverySuggestions(null, [], 3);

    expect(selection.suggestions).toHaveLength(3);
    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Pikachu 012 Nintendo Black Star Promo');
    expect(selection.suggestions.every((suggestion) => suggestion.lane && suggestion.laneWhy && suggestion.nearby.length > 0)).toBe(true);
    expectDistinctLanes(selection);
  });
});
