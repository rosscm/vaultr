import { describe, expect, it } from 'vitest';
import {
  discover,
  discoveryActionRows,
  discoveryEmbed,
  isUsableDiscoveryExample,
  looksLikeVisualDiscoveryListing,
  selectVisibleCandidates,
  type DiscoveryCandidate
} from '../discover.js';
import type { Listing } from '../../types.js';

function candidate(name: string, lane: string, selectionIndex: number, marketSampleSize?: number): DiscoveryCandidate {
  return {
    selectionIndex,
    suggestion: {
      name,
      lane,
      laneWhy: `${lane} because it matches the profile`,
      why: `try ${name}`,
      nearby: []
    },
    typicalRawAskingTotal: marketSampleSize === undefined ? undefined : 50,
    marketSampleSize
  };
}

function listing(overrides: Partial<Listing>): Listing {
  return {
    source: 'EBAY',
    listingId: 'listing-1',
    title: 'Mew Southern Islands 1999 Holo No.151 Japanese Pokemon',
    price: 45,
    currency: 'CAD',
    url: 'https://www.ebay.example/item/listing-1',
    imageUrl: 'https://i.ebayimg.example/mew.jpg',
    sellerFeedbackPercent: 99.8,
    sellerFeedbackScore: 1200,
    region: 'OTHER',
    condition: 'Ungraded',
    listingType: 'BUY_IT_NOW',
    ...overrides
  };
}

const southernIslandsSuggestion = {
  name: 'Mew Southern Islands Promo',
  lane: 'mythical display cards',
  laneWhy: 'soft mythical cards with strong binder presence',
  why: 'branches from a Mew chase',
  nearby: [],
  evidenceAliases: ['Mew Southern Islands', 'Mew No.151 Southern Island'],
  requiredEvidenceTokens: ['mew']
};

describe('selectVisibleCandidates', () => {
  it('falls back to taste-ranked candidates when market enrichment is thin', () => {
    const visible = selectVisibleCandidates(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
        candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Mew Southern Islands Promo',
      'Totodile McDonalds Promo',
      'Houndoom Aquapolis H11/H32'
    ]);
  });

  it('still prefers usable market examples before market-thin fallbacks', () => {
    const visible = selectVisibleCandidates(
      [
        candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        candidate('Totodile McDonalds Promo', 'starter promo side paths', 1, 2),
        candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
      ]
    );

    expect(visible.map((item) => item.suggestion.name)).toEqual([
      'Totodile McDonalds Promo',
      'Mew Southern Islands Promo',
      'Houndoom Aquapolis H11/H32'
    ]);
  });
});

describe('Discovery listing enrichment eligibility', () => {
  it('uses strong suggestion matches for market and image data even when titles omit generic card terms', () => {
    const matchedListing = listing({});

    expect(isUsableDiscoveryExample(southernIslandsSuggestion, matchedListing, undefined, 'CAD')).toBe(true);
    expect(looksLikeVisualDiscoveryListing(southernIslandsSuggestion, matchedListing)).toBe(true);
  });

  it('still rejects obvious non-card listings even when they contain the suggestion tokens', () => {
    const plushListing = listing({ title: 'Mew Southern Islands plush toy Pokemon', imageUrl: 'https://i.ebayimg.example/plush.jpg' });

    expect(isUsableDiscoveryExample(southernIslandsSuggestion, plushListing, undefined, 'CAD')).toBe(false);
    expect(looksLikeVisualDiscoveryListing(southernIslandsSuggestion, plushListing)).toBe(false);
  });
});

describe('discoveryEmbed', () => {
  it('hides market read for limited Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Resonates', 'Collection Thread', 'Image Source', 'Next Threads']);
  });

  it('shows market read for full Discovery', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', true).toJSON();

    expect(embed.fields?.map((field) => field.name)).toEqual(['Why It Resonates', 'Collection Thread', 'Image Source', 'Market Read', 'Next Threads']);
  });

  it('uses cooldown language for active eBay throttle states', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
        sourceStatus: 'RATE_LIMITED'
      },
      'CAD',
      true
    ).toJSON();

    const marketRead = embed.fields?.find((field) => field.name === 'Market Read')?.value;
    expect(marketRead).toContain('cooling down');
  });

  it('can number visible cards for feedback buttons', () => {
    const embed = discoveryEmbed(candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2), 'CAD', false, 2).toJSON();

    expect(embed.title).toContain('2.');
  });

  it('does not repeat next threads inside collection thread', () => {
    const embed = discoveryEmbed(
      {
        ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2),
        suggestion: {
          ...candidate('Mew Southern Islands Promo', 'mythical display cards', 0, 2).suggestion,
          why: 'branches from a Mew chase',
          nearby: ['Ancient Mew Promo', 'Mew Black Star Promo 040']
        }
      },
      'CAD',
      false
    ).toJSON();

    const collectionThread = embed.fields?.find((field) => field.name === 'Collection Thread')?.value;
    expect(collectionThread).toBe('branches from a Mew chase');
  });
});

describe('discoveryActionRows', () => {
  it('uses one compact select menu for mobile-friendly actions', () => {
    const rows = discoveryActionRows('user-1', [
      candidate('Mew Southern Islands Promo', 'mythical display cards', 0),
      candidate('Totodile McDonalds Promo', 'starter promo side paths', 1),
      candidate('Houndoom Aquapolis H11/H32', 'e-reader atmosphere', 2)
    ]);
    const json = rows[0]?.toJSON() as any;

    expect(rows).toHaveLength(1);
    expect(json.components).toHaveLength(1);
    expect(json.components[0].options).toHaveLength(9);
  });
});

describe('discover command', () => {
  it('uses collector-friendly mode names with stable internal values', () => {
    const options = discover.data.toJSON().options ?? [];
    const modeOption = options.find((option: any) => option.name === 'mode') as any;

    expect(modeOption.choices).toEqual([
      { name: 'Close Match', value: 'similar' },
      { name: 'Side Quest', value: 'adjacent' },
      { name: 'Deep Cut', value: 'wildcard' },
      { name: 'Smart Value', value: 'budget' }
    ]);
    expect(options.some((option: any) => option.name === 'focus')).toBe(false);
  });
});