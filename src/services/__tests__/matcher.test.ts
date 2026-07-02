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

  it('uses price plus shipping for max price when shipping is known', () => {
    const chase = baseChase({ maxPrice: 105 });
    const listing = baseListing({ price: 100, shippingCost: 10 });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['price_over_max']);
  });

  it('falls back to item price for max price when shipping is unknown', () => {
    const chase = baseChase({ maxPrice: 105 });
    const listing = baseListing({ price: 100, shippingCost: undefined });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('price_within_max');
  });

  it('fails when grade does not match', () => {
    const chase = baseChase({ grade: 'PSA 9' });
    const listing = baseListing({ title: 'Squirtle PSA 10 Base Set' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['grade_miss']);
  });

  it('matches ungraded preference against ungraded listings', () => {
    const chase = baseChase({ grade: 'UNGRADED' });
    const listing = baseListing({ title: 'Squirtle Base Set Raw Pokemon Card', condition: 'Ungraded' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('ungraded_match');
  });

  it('rejects slabbed listings for ungraded preference', () => {
    const chase = baseChase({ grade: 'raw' });
    const listing = baseListing({ title: 'Squirtle Base Set PSA 10 Pokemon Card', condition: 'Graded' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['ungraded_miss']);
  });

  it('rejects eBay graded-condition listings for ungraded preference even when the title omits grading terms', () => {
    const chase = baseChase({ cardName: 'Mew ex 053', grade: 'UNGRADED' });
    const listing = baseListing({
      title: 'Mew ex 053 Sv: Scarlet & Violet Promo Cards Holo',
      condition: 'Graded'
    });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['ungraded_miss']);
  });

  it('treats raw or ungraded chase text as an ungraded preference', () => {
    const chase = baseChase({ cardName: 'Mew ex 053 raw' });
    const listing = baseListing({
      title: 'Mew ex 053 Sv: Scarlet & Violet Promo Cards Holo',
      condition: 'Graded'
    });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['ungraded_miss']);
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

  it('blocks default non-card listing types even without chase-specific custom exclusions', () => {
    const examples: Array<{ cardName: string; title: string; term: string }> = [
      {
        cardName: 'Corocoro Shining Mew',
        title: '**SIGNED** Pokederp Meow (HOLO) - CoroCoro Shining Mew Fan Art Derpy Card',
        term: 'fan art'
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'POKEMON TCG EXTENDED ART ACRYLIC CASE CARD MOLTRES & ZAPDOS & ARTICUNO SM210 L28',
        term: 'extended art'
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'Moltres, Zapdos & Articuno GX Promo SM210 Pokemon Card TCG Novelty Keychain',
        term: 'novelty'
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'Pokemon Moltres Zapdos Articuno GX SM210 Hidden Fate Promo Extended Artwork Case',
        term: 'extended art'
      },
      {
        cardName: 'Mega Gardevoir EX SAR 087/063 Mega Symphonia',
        title: 'Mega Gardevoir EX SAR 087/063 Mega Symphonia Magnetic Extended Art Case',
        term: 'extended art'
      },
      {
        cardName: 'Mew RC24/RC25',
        title: 'Pokémon TCG Mew EX RC24/RC25 Legendary Treasures Novelty Keychain ',
        term: 'novelty'
      },
      {
        cardName: 'Umbreon EX 217/187',
        title: '9x Umbreon EX 217/187 Near Mint PSA',
        term: 'multi-card lot'
      },
      {
        cardName: 'Pikachu 26/83',
        title: 'Lot of 5 Pikachu 26/83 Promo NM',
        term: 'multi-card lot'
      }
    ];

    for (const example of examples) {
      const chase = baseChase({ cardName: example.cardName, negativeKeywords: [] });
      const listing = baseListing({ title: example.title });
      const result = matchChaseToListing(chase, listing);

      expect(result.isMatch).toBe(false);
      expect(result.reasons).toEqual(['default_exclusion_block', `default_exclusion:${example.term}`]);
    }
  });

  it('keeps low-risk suspicious terms as risk signals instead of hard failing when not blocked', () => {
    const chase = baseChase({ negativeKeywords: [] });
    const listing = baseListing({ title: 'Squirtle PSA 10 small collection lot' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('suspicious_title_penalty');
    expect(result.reasons.some((reason) => reason.startsWith('suspicious_terms:'))).toBe(true);
  });

  it('penalizes unrated sellers without blocking the match', () => {
    const chase = baseChase();
    const trustedListing = baseListing({ sellerFeedbackPercent: 100, sellerFeedbackScore: 250 });
    const unratedListing = baseListing({ sellerFeedbackPercent: 0, sellerFeedbackScore: 0 });

    const trustedResult = matchChaseToListing(chase, trustedListing);
    const unratedResult = matchChaseToListing(chase, unratedListing);

    expect(unratedResult.isMatch).toBe(true);
    expect(unratedResult.reasons).toContain('new_seller_penalty');
    expect(unratedResult.score).toBeLessThan(trustedResult.score);
    expect(unratedResult.score).toBeLessThan(60);
  });

  it('does not boost high percentage sellers with too little history', () => {
    const chase = baseChase();
    const listing = baseListing({ sellerFeedbackPercent: 100, sellerFeedbackScore: 8 });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('low_seller_feedback_count_penalty');
    expect(result.reasons).not.toContain('seller_quality_boost');
  });

  it('penalizes non-Japanese regional variants unless the chase asks for them', () => {
    const chase = baseChase({ cardName: 'Umbreon 217/187', grade: 'UNGRADED', maxPrice: 550 });
    const korean = baseListing({ title: 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM', price: 335, condition: 'Ungraded' });
    const japanese = baseListing({ title: 'Umbreon ex SAR 217/187 Terastal Festival sv8a Pokemon Card Japanese', price: 537, condition: 'Ungraded' });

    const koreanResult = matchChaseToListing(chase, korean);
    const japaneseResult = matchChaseToListing(chase, japanese);

    expect(koreanResult.isMatch).toBe(true);
    expect(koreanResult.reasons).toContain('language_variant_mismatch');
    expect(koreanResult.reasons).toContain('language_variants:korean');
    expect(japaneseResult.isMatch).toBe(true);
    expect(japaneseResult.reasons).not.toContain('language_variant_mismatch');
    expect(japaneseResult.score).toBeGreaterThan(koreanResult.score);
  });

  it('does not penalize a regional variant when the chase requests it', () => {
    const chase = baseChase({ cardName: 'Umbreon 217/187 Korean', grade: 'UNGRADED', maxPrice: 550 });
    const listing = baseListing({ title: 'Pokemon Card Umbreon ex SAR 217/187 sv8a Terastal Festival Korean NM', price: 335, condition: 'Ungraded' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).not.toContain('language_variant_mismatch');
  });
});
