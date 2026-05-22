import { describe, expect, it } from 'vitest';
import { matchChaseToListing } from '../matcher.js';
import type { Chase, Listing } from '../../types.js';

function baseChase(overrides: Partial<Chase> = {}): Chase {
  return {
    id: 'c1',
    userId: 'u1',
    cardName: 'Squirtle',
    createdAt: '2026-05-13T00:00:00.000Z',
    ...overrides
  };
}

function baseListing(overrides: Partial<Listing> = {}): Listing {
  return {
    source: 'EBAY',
    listingId: 'l1',
    title: 'Squirtle PSA 10 Base Set',
    price: 100,
    currency: 'USD',
    url: 'https://example.com/listing',
    region: 'US',
    condition: 'Near Mint',
    ...overrides
  };
}

describe('matchChaseToListing', () => {
  it('matches when card name and constraints pass', () => {
    const chase = baseChase({ maxPrice: 120, grade: 'PSA 10' });
    const listing = baseListing();
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('card_name_match'))).toBe(true);
    expect(result.reasons).toContain('grade_match');
    expect(result.reasons).toContain('price_within_max');
  });

  it('fails when listing is above max price', () => {
    const chase = baseChase({ maxPrice: 90 });
    const listing = baseListing({ price: 100 });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['price_over_max']);
  });

  it('fails when grade does not match', () => {
    const chase = baseChase({ grade: 'PSA 9' });
    const listing = baseListing({ title: 'Squirtle PSA 10 Base Set' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['grade_miss']);
  });

  it('fails when condition does not match', () => {
    const chase = baseChase({ condition: 'LP' });
    const listing = baseListing({ condition: 'Near Mint' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['condition_miss']);
  });

  it('fails when token overlap is too low for non-exact title', () => {
    const chase = baseChase({ cardName: 'Umbreon VMAX 215/203 Evolving Skies' });
    const listing = baseListing({ title: 'Umbreon GX Hidden Fates PSA 10' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['card_name_miss']);
  });

  it('fails when chase has a card number and listing has a conflicting card number', () => {
    const chase = baseChase({ cardName: 'Umbreon VMAX 215/203 Evolving Skies' });
    const listing = baseListing({ title: 'Umbreon VMAX 214/203 Evolving Skies Alt Art' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['card_number_miss']);
  });

  it('boosts when card number matches', () => {
    const chase = baseChase({ cardName: 'Bulbasaur #55' });
    const listing = baseListing({ title: 'Bulbasaur #55 Reverse Holo PSA 10' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('card_number_match');
  });

  it('matches when one of several requested conditions matches', () => {
    const chase = baseChase({ condition: 'LP,NM' });
    const listing = baseListing({ condition: 'Near Mint' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('condition_match');
  });

  it('fails when listing type does not match', () => {
    const chase = baseChase({ listingType: 'AUCTION' });
    const listing = baseListing({ listingType: 'BUY_IT_NOW' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['listing_type_miss']);
  });

  it('keeps suspicious terms as risk signals instead of hard failing when not blocked', () => {
    const chase = baseChase({ negativeKeywords: [] });
    const listing = baseListing({ title: 'Squirtle PSA 10 custom art card' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('suspicious_title_penalty');
    expect(result.reasons.some((reason) => reason.startsWith('suspicious_terms:'))).toBe(true);
  });
});
