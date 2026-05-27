import { describe, expect, it } from 'vitest';
import { selectDiscoverySuggestions } from '../discovery-catalog.js';
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

  it('falls back to curated starter cards without focus or chases', () => {
    const selection = selectDiscoverySuggestions(null, [], 3);

    expect(selection.suggestions).toHaveLength(3);
    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Pikachu 012 Nintendo Black Star Promo');
    expect(selection.suggestions.every((suggestion) => suggestion.lane && suggestion.laneWhy && suggestion.nearby.length > 0)).toBe(true);
    expectDistinctLanes(selection);
  });
});
