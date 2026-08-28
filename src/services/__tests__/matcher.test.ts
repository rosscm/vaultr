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

  it('matches ungraded preference against raw listings labeled with condition markers', () => {
    const chase = baseChase({ cardName: 'Gardevoir ex Paldean Fates 233', grade: 'UNGRADED', maxPrice: 400, listingType: 'BUY_IT_NOW' });
    const listing = baseListing({
      title: 'Gardevoir ex Paldean Fates 233/091 Special Illustration Rare Holo - NM',
      price: 271.15,
      currency: 'CAD',
      condition: undefined,
      listingType: 'BUY_IT_NOW'
    });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('ungraded_match');
    expect(result.reasons).toContain('price_within_max');
  });

  it('matches ungraded preference when the listing condition carries the raw marker', () => {
    const chase = baseChase({ grade: 'UNGRADED' });
    const listing = baseListing({ title: 'Squirtle Base Set Pokemon Card', condition: 'Near Mint' });
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

  it('uses queryName for token matching when available, ignoring editorial noise in cardName', () => {
    // Without queryName, 'Promo' and '151' dilute token overlap against a clean listing title
    const withoutQuery = baseChase({ cardName: 'Mew CoroCoro Promo 151' });
    const withQuery = baseChase({ cardName: 'Mew CoroCoro Promo 151', queryName: 'CoroCoro Shining Mew' });
    const listing = baseListing({ title: 'CoroCoro Shining Mew Pokemon Card NM' });

    const withoutResult = matchChaseToListing(withoutQuery, listing);
    const withResult = matchChaseToListing(withQuery, listing);

    expect(withoutResult.isMatch).toBe(false); // 'promo' and '151' not in listing → below threshold
    expect(withResult.isMatch).toBe(true);     // clean 3-token set → 1.0 overlap
    expect(withResult.score).toBeGreaterThanOrEqual(50);
    expect(withResult.reasons).toContain('card_name_match_tokens');
  });

  it('blocks the reported custom CoroCoro listing before alert scoring', () => {
    const chase = baseChase({ cardName: 'Mew CoroCoro Promo 151', queryName: 'CoroCoro Shining Mew', maxPrice: 500 });
    const listing = baseListing({
      title: 'Shining Mew Corocoro Promotional Cards Holo (Japanese)(art by me)',
      sellerFeedbackPercent: 100,
      sellerFeedbackScore: 5000,
      price: 80
    });

    const result = matchChaseToListing(chase, listing);

    expect(result).toEqual({
      isMatch: false,
      score: 0,
      reasons: ['custom_or_unofficial_item_block']
    });
  });

  it('blocks custom-art variants after punctuation and whitespace normalization', () => {
    const chase = baseChase({ cardName: 'Mew CoroCoro Promo 151', queryName: 'CoroCoro Shining Mew' });
    const titles = [
      'CoroCoro Shining Mew ART-BY-ME',
      'CoroCoro Shining Mew my artwork',
      'CoroCoro Shining Mew custom card',
      'CoroCoro Shining Mew hand-painted',
      'CoroCoro Shining Mew artist altered',
      'CoroCoro Shining Mew I drew this'
    ];

    for (const title of titles) {
      expect(matchChaseToListing(chase, baseListing({ title }))).toEqual({
        isMatch: false,
        score: 0,
        reasons: ['custom_or_unofficial_item_block']
      });
    }
  });

  it('blocks proxy and replica listings', () => {
    const chase = baseChase({ cardName: 'Umbreon VMAX 215/203 Evolving Skies' });
    const proxy = matchChaseToListing(chase, baseListing({ title: 'Umbreon VMAX 215/203 Evolving Skies proxy' }));
    const replica = matchChaseToListing(chase, baseListing({ title: 'Umbreon VMAX 215/203 Evolving Skies replica' }));

    expect(proxy.reasons).toEqual(['custom_or_unofficial_item_block']);
    expect(replica.reasons).toEqual(['custom_or_unofficial_item_block']);
  });

  it('keeps default exclusions active when a chase also has custom exclusions', () => {
    const chase = baseChase({ cardName: 'Mew XY Black Star Promos XY110', negativeKeywords: ['korean'] });

    expect(matchChaseToListing(chase, baseListing({ title: 'Mew XY110 Korean Pokemon Card' })).reasons).toEqual(['negative_keyword_block']);
    expect(matchChaseToListing(chase, baseListing({ title: 'Mew XY110 proxy Pokemon Card' })).reasons).toEqual(['custom_or_unofficial_item_block']);
    expect(matchChaseToListing(chase, baseListing({ title: 'Mew XY110 Pokemon Card reprint' })).reasons).toEqual(['default_exclusion_block', 'default_exclusion:reprint']);
    expect(matchChaseToListing(chase, baseListing({ title: 'Mew Pokemon Mythical Collection Promo XY110 Online Code' })).reasons).toEqual(['default_exclusion_block', 'default_exclusion:code card']);
  });

  it('keeps legitimate Art Rare, SAR, Alternate Art, and Full Art listings eligible', () => {
    const chase = baseChase({ cardName: 'Gardevoir ex 233/091', queryName: 'Gardevoir ex 233/091' });
    const titles = [
      'Gardevoir ex 233/091 Special Art Rare Pokemon Card',
      'Gardevoir ex 233/091 Art Rare Pokemon Card',
      'Gardevoir ex 233/091 Alternate Art Pokemon Card',
      'Gardevoir ex 233/091 Full Art Pokemon Card',
      'Gardevoir ex 233/091 SAR Pokemon Card'
    ];

    for (const title of titles) {
      const result = matchChaseToListing(chase, baseListing({ title }));
      expect(result.isMatch).toBe(true);
      expect(result.reasons).not.toContain('custom_or_unofficial_item_block');
    }
  });

  it('does not let seller trust, price, or card-name overlap override a hard custom-item exclusion', () => {
    const chase = baseChase({
      cardName: 'Umbreon VMAX 215/203 Evolving Skies',
      maxPrice: 500,
      grade: 'PSA 10'
    });
    const listing = baseListing({
      title: 'Umbreon VMAX 215/203 Evolving Skies PSA 10 fan made',
      price: 50,
      sellerFeedbackPercent: 100,
      sellerFeedbackScore: 10000
    });

    const result = matchChaseToListing(chase, listing);

    expect(result).toEqual({
      isMatch: false,
      score: 0,
      reasons: ['custom_or_unofficial_item_block']
    });
  });

  it('relaxes token overlap threshold when card number already confirms identity', () => {
    // Listing title lacks "Toys R Us" so without relaxation the overlap (2/4) is below 0.7
    const chase = baseChase({ cardName: 'Pikachu 26/83 Toys R Us promo', queryName: 'Pikachu 26/83 Toys R Us' });
    const listing = baseListing({ title: 'Pokemon Pikachu 26/83 Promo Card NM' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('card_number_match');
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('scores perfect token overlap at 50 — same floor as exact name match', () => {
    const chase = baseChase({ cardName: 'Mew CoroCoro Promo 151', queryName: 'CoroCoro Shining Mew' });
    const listing = baseListing({ title: 'CoroCoro Shining Mew Pokemon Card NM' });
    const result = matchChaseToListing(chase, listing);

    // All 3 core tokens present → overlap = 1.0 → score should be exactly 50 (no card number bonus here)
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(50);
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
    const examples: Array<{ cardName: string; title: string; term?: string; reasons: string[] }> = [
      {
        cardName: 'Corocoro Shining Mew',
        title: '**SIGNED** Pokederp Meow (HOLO) - CoroCoro Shining Mew Fan Art Derpy Card',
        reasons: ['custom_or_unofficial_item_block']
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'POKEMON TCG EXTENDED ART ACRYLIC CASE CARD MOLTRES & ZAPDOS & ARTICUNO SM210 L28',
        term: 'extended art',
        reasons: ['default_exclusion_block', 'default_exclusion:extended art']
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'Moltres, Zapdos & Articuno GX Promo SM210 Pokemon Card TCG Novelty Keychain',
        term: 'novelty',
        reasons: ['default_exclusion_block', 'default_exclusion:novelty']
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'Pokemon Moltres Zapdos Articuno GX SM210 Hidden Fate Promo Extended Artwork Case',
        term: 'extended art',
        reasons: ['default_exclusion_block', 'default_exclusion:extended art']
      },
      {
        cardName: 'Mega Gardevoir EX SAR 087/063 Mega Symphonia',
        title: 'Mega Gardevoir EX SAR 087/063 Mega Symphonia Magnetic Extended Art Case',
        term: 'extended art',
        reasons: ['default_exclusion_block', 'default_exclusion:extended art']
      },
      {
        cardName: 'Mew RC24/RC25',
        title: 'Pokémon TCG Mew EX RC24/RC25 Legendary Treasures Novelty Keychain ',
        term: 'novelty',
        reasons: ['default_exclusion_block', 'default_exclusion:novelty']
      },
      {
        cardName: 'Gardevoir ex 233/091',
        title: 'Gardevoir Ex 233/091 Paldean Fates Credit Card Sticker',
        term: 'sticker',
        reasons: ['default_exclusion_block', 'default_exclusion:sticker']
      },
      {
        cardName: 'Gardevoir ex 233/091',
        title: 'Gardevoir ex #233/091 Paldean Fates Extended Art Case No card',
        term: 'extended art',
        reasons: ['default_exclusion_block', 'default_exclusion:extended art']
      },
      {
        cardName: 'Gardevoir ex 233/091',
        title: 'Gardevoir ex 233/091 Pokemon Extended Art Frame 5x7 Paldean Fates',
        term: 'extended art',
        reasons: ['default_exclusion_block', 'default_exclusion:extended art']
      },
      {
        cardName: 'Moltres Zapdos Articuno SM210',
        title: 'Pokemon Moltres Zapdos Articuno GX SM210 Tag Team Stained Display Case',
        term: 'display accessory',
        reasons: ['default_exclusion_block', 'default_exclusion:display accessory']
      },
      {
        cardName: 'Umbreon EX 217/187',
        title: '9x Umbreon EX 217/187 Near Mint PSA',
        term: 'multi-card lot',
        reasons: ['default_exclusion_block', 'default_exclusion:multi-card lot']
      },
      {
        cardName: 'Pikachu 26/83',
        title: 'Lot of 5 Pikachu 26/83 Promo NM',
        term: 'multi-card lot',
        reasons: ['default_exclusion_block', 'default_exclusion:multi-card lot']
      },
      {
        cardName: 'Mew',
        title: 'Pokemon Mew Card Lot',
        term: 'multi-card lot',
        reasons: ['default_exclusion_block', 'default_exclusion:multi-card lot']
      },
      {
        cardName: 'Mew',
        title: 'Lot Mew Pokemon Cards',
        term: 'multi-card lot',
        reasons: ['default_exclusion_block', 'default_exclusion:multi-card lot']
      },
      {
        cardName: 'Mew',
        title: '5x Mew Pokemon Cards',
        term: 'multi-card lot',
        reasons: ['default_exclusion_block', 'default_exclusion:multi-card lot']
      },
      {
        cardName: 'Mew XY Black Star Promos XY110',
        title: 'Mew Pokemon Mythical Collection Promo XY110 Online Code',
        term: 'code card',
        reasons: ['default_exclusion_block', 'default_exclusion:code card']
      },
      {
        cardName: 'Mew XY Black Star Promos XY110',
        title: 'Mew XY110 PTCGL code card',
        term: 'code card',
        reasons: ['default_exclusion_block', 'default_exclusion:code card']
      },
      {
        cardName: 'Mew XY Black Star Promos XY110',
        title: 'Mew XY110 digital redemption code',
        term: 'code card',
        reasons: ['default_exclusion_block', 'default_exclusion:code card']
      }
    ];

    for (const example of examples) {
      const chase = baseChase({ cardName: example.cardName, negativeKeywords: [] });
      const listing = baseListing({ title: example.title });
      const result = matchChaseToListing(chase, listing);

      expect(result.isMatch).toBe(false);
      expect(result.reasons).toEqual(example.reasons);
    }
  });

  it('blocks accessory listings when the exclusion term only appears in metadata details', () => {
    const chase = baseChase({ cardName: 'CoroCoro Shining Mew', negativeKeywords: [] });
    const listing = baseListing({
      title: 'CoroCoro Shining Mew Pokemon Card NM',
      detailsText: 'Type Display Case Brand Vault Acrylic'
    });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['default_exclusion_block', 'default_exclusion:display accessory']);
  });

  it('rejects number-matching listings when the actual card subject is different', () => {
    const chase = baseChase({ cardName: 'Squirtle Japanese Promo 007/018', queryName: 'Squirtle Japanese 007/018', negativeKeywords: [] });
    const listing = baseListing({
      title: 'Zekrom Japanese Promo 007/018 Pokemon Card NM',
      condition: 'Near Mint'
    });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(false);
    expect(result.reasons).toEqual(['card_subject_miss']);
  });

  it('keeps low-risk suspicious terms as risk signals instead of hard failing when not blocked', () => {
    const chase = baseChase({ negativeKeywords: [] });
    const listing = baseListing({ title: 'Squirtle PSA 10 small collection lot' });
    const result = matchChaseToListing(chase, listing);

    expect(result.isMatch).toBe(true);
    expect(result.reasons).toContain('suspicious_title_penalty');
    expect(result.reasons.some((reason) => reason.startsWith('suspicious_terms:'))).toBe(true);
  });

  it('keeps normal physical listings eligible when no exclusion phrase is present', () => {
    const chase = baseChase({ cardName: 'Mew XY Black Star Promos XY110', queryName: 'Mew XY110' });
    const result = matchChaseToListing(chase, baseListing({ title: 'Mew XY110 Mythical Collection Promo Pokemon Card NM' }));

    expect(result.isMatch).toBe(true);
    expect(result.reasons).not.toContain('default_exclusion_block');
    expect(result.reasons).not.toContain('custom_or_unofficial_item_block');
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
