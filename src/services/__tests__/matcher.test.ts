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
    const chase = baseChase({ maxPrice: 120, grade: 'PSA 10', region: 'US' });
    const listing = baseListing();
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('card_name_match');
    expect(result.reasons).toContain('grade_match');
    expect(result.reasons).toContain('price_within_max');
    expect(result.reasons).toContain('region_match');
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

  it('fails when region does not match', () => {
    const chase = baseChase({ region: 'CA' });
    const listing = baseListing({ region: 'US' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['region_miss']);
  });

  it('fails when condition does not match', () => {
    const chase = baseChase({ condition: 'LP' });
    const listing = baseListing({ condition: 'Near Mint' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['condition_miss']);
  });
});
