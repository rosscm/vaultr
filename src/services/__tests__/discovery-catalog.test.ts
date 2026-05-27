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
  it('surfaces niche Pikachu promo cards from a Pikachu promo focus', () => {
    const selection = selectDiscoverySuggestions('pikachu promo', [], 3);

    expect(selection.lane).toBe('quiet character promos');
    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Pikachu 012 Nintendo Black Star Promo');
  });

  it('uses active chase text when no focus is supplied', () => {
    const selection = selectDiscoverySuggestions(null, [chase({ cardName: 'Gengar vintage Japanese cards' })], 3);

    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Gengar Web Series');
  });

  it('falls back to curated starter cards without focus or chases', () => {
    const selection = selectDiscoverySuggestions(null, [], 3);

    expect(selection.suggestions).toHaveLength(3);
    expect(selection.suggestions.map((suggestion) => suggestion.name)).toContain('Pikachu 012 Nintendo Black Star Promo');
  });
});
