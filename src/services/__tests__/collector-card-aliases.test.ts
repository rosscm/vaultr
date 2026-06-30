import { describe, expect, it } from 'vitest';
import {
  JAPANESE_SUBJECT_ALIASES,
  KNOWN_CHASE_CARD_REFINEMENTS,
  POKEMON_RELEASE_ALIASES,
  knownChaseCardRefinement,
  normalizeChaseCardName
} from '../collector-card-aliases.js';

describe('collector card aliases', () => {
  it('normalizes collector release wording for saved chase names', () => {
    expect(normalizeChaseCardName('pikachu toys r us 26/83')).toBe('pikachu Toys R Us Promo 26/83');
    expect(normalizeChaseCardName('mew corocoro jumbo')).toBe('mew CoroCoro Jumbo Promo');
    expect(normalizeChaseCardName('charmander mcdonalds holo')).toBe("charmander McDonald's Promo holo");
    expect(normalizeChaseCardName('squirtle pokemon center promo')).toBe('squirtle Pokemon Center Promo');
  });

  it('normalizes known Japanese shorthand into full source-backed identities', () => {
    expect(normalizeChaseCardName('Gardevoir Japanese 087/063')).toBe('Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063');
    expect(normalizeChaseCardName('Umbreon EX 217/187')).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
    expect(normalizeChaseCardName('Umbreon 217/187 Japanese')).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
  });

  it('keeps known card refinements paired with marketplace keywords', () => {
    const gardevoir = knownChaseCardRefinement('Gardevoir Japanese 087/063');
    const umbreon = knownChaseCardRefinement('Umbreon EX 217/187');

    expect(gardevoir?.cardName).toBe('Mega Gardevoir ex SAR Mega Symphonia Japanese 087/063');
    expect(gardevoir?.ebayKeywords).toBe('Mega Gardevoir ex 087/063 M1S Japanese');
    expect(umbreon?.cardName).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
    expect(umbreon?.ebayKeywords).toBe('Umbreon ex SAR Terastal Festival Japanese 217/187');
  });

  it('keeps known refinement card names unique', () => {
    const cardNames = KNOWN_CHASE_CARD_REFINEMENTS.map((refinement) => refinement.cardName);

    expect(new Set(cardNames).size).toBe(cardNames.length);
  });

  it('keeps release alias labels unique so autocomplete dedupe remains stable', () => {
    const labels = POKEMON_RELEASE_ALIASES.map(({ alias }) => alias.label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps Japanese subject aliases keyed by lowercase searchable names', () => {
    for (const [subject, aliases] of Object.entries(JAPANESE_SUBJECT_ALIASES)) {
      expect(subject).toMatch(/^[a-z0-9]+$/);
      expect(aliases.length).toBeGreaterThan(0);
    }
  });
});