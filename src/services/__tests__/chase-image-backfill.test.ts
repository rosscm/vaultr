import { afterEach, describe, expect, it } from 'vitest';
import { addChase, backfillChaseCardImage, listChases, removeAllChases } from '../chase-store.js';
import { backfillMissingChaseImages } from '../chase-image-backfill.js';
import type { CachedChaseCardPreview, ChaseCardAutocompleteChoice } from '../chase-card-catalog.js';

const testUserIds = new Set<string>();

function userId(label: string): string {
  const id = `image-backfill-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(id);
  return id;
}

function cleanupUser(id: string): void {
  removeAllChases(id);
}

function choice(value: string): ChaseCardAutocompleteChoice {
  return { name: value, value };
}

function trustedPreview(identity = 'Mew RC24'): CachedChaseCardPreview {
  return {
    imageUrl: 'https://images.example/mew-rc24.png',
    imageIdentity: identity,
    imageSourceName: 'POKEMONTCG',
    imageSourceKind: 'CARD_REFERENCE',
    imageSourceCardId: 'xy-rc24'
  };
}

function noMatchResolution(cardName: string) {
  return {
    status: 'NO_MATCH' as const,
    requestedCardName: cardName,
    normalizedCardName: cardName
  };
}

function resolvedReference(requestedCardName: string, resolvedCardName = requestedCardName, identity = resolvedCardName) {
  return {
    status: 'RESOLVED' as const,
    requestedCardName,
    resolvedCardName,
    preview: {
      imageUrl: 'https://images.example/resolved.png',
      imageIdentity: identity,
      imageSourceName: 'POKEMONTCG',
      imageSourceKind: 'CARD_REFERENCE' as const,
      imageSourceCardId: 'xyp-XY192'
    }
  };
}

afterEach(() => {
  for (const id of testUserIds) cleanupUser(id);
  testUserIds.clear();
});

describe('chase image backfill', () => {
  it('dry-runs exact normalized matches without mutating rows', async () => {
    const id = userId('dry-run');
    addChase({ userId: id, cardName: 'Mew RC24', maxPrice: 90, priority: 'HIGH', targetNote: 'clean', negativeKeywords: ['proxy'] });

    const summary = await backfillMissingChaseImages({
      userId: id,
      dependencies: {
        resolve: async (cardName) => noMatchResolution(cardName),
        autocomplete: async () => [choice('Mew RC24')],
        preview: () => trustedPreview()
      }
    });

    expect(summary).toMatchObject({ examined: 1, exactTrustedMatches: 1, wouldUpdate: 1, updated: 0 });
    const chase = listChases(id)[0]!;
    expect(chase.cardImageUrl).toBeUndefined();
    expect(chase).toMatchObject({ cardName: 'Mew RC24', maxPrice: 90, priority: 'HIGH', targetNote: 'clean', negativeKeywords: ['proxy'] });
  });

  it('applies exact trusted CARD_REFERENCE metadata and is idempotent', async () => {
    const id = userId('apply');
    const chase = addChase({ userId: id, cardName: '  Mew   RC24  ', listingType: 'BUY_IT_NOW' });

    const dependencies = {
      resolve: async (cardName: string) => noMatchResolution(cardName),
      autocomplete: async () => [choice('Mew RC24')],
      preview: () => trustedPreview('Mew RC24')
    };
    const first = await backfillMissingChaseImages({ userId: id, apply: true, dependencies });
    const second = await backfillMissingChaseImages({ userId: id, apply: true, dependencies });

    expect(first).toMatchObject({ examined: 1, exactTrustedMatches: 1, updated: 1 });
    expect(second).toMatchObject({ examined: 0, updated: 0 });
    expect(listChases(id)[0]).toMatchObject({
      id: chase.id,
      cardName: '  Mew   RC24  ',
      listingType: 'BUY_IT_NOW',
      cardImageUrl: 'https://images.example/mew-rc24.png',
      cardImageIdentity: 'Mew RC24',
      cardImageSourceName: 'POKEMONTCG',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceCardId: 'xy-rc24'
    });
  });

  it('does not overwrite an existing chase image', () => {
    const id = userId('overwrite');
    const chase = addChase({
      userId: id,
      cardName: 'Mew RC24',
      cardImageUrl: 'https://images.example/original.png',
      cardImageIdentity: 'Mew RC24',
      cardImageSourceKind: 'CARD_REFERENCE'
    });

    const updated = backfillChaseCardImage({
      userId: id,
      chaseId: chase.id,
      imageUrl: 'https://images.example/new.png',
      imageIdentity: 'Mew RC24',
      imageSourceKind: 'CARD_REFERENCE'
    });

    expect(updated).toBe(false);
    expect(listChases(id)[0]?.cardImageUrl).toBe('https://images.example/original.png');
  });

  it('skips fuzzy and ambiguous autocomplete matches', async () => {
    const fuzzyUser = userId('fuzzy');
    addChase({ userId: fuzzyUser, cardName: 'Mew RC24' });
    const fuzzy = await backfillMissingChaseImages({
      userId: fuzzyUser,
      dependencies: {
        resolve: async (cardName) => noMatchResolution(cardName),
        autocomplete: async () => [choice('Mew Legendary Treasures RC24')],
        preview: () => trustedPreview()
      }
    });
    expect(fuzzy).toMatchObject({ skippedNoMatch: 1, wouldUpdate: 0 });

    const ambiguousUser = userId('ambiguous');
    addChase({ userId: ambiguousUser, cardName: 'Mew RC24' });
    const ambiguous = await backfillMissingChaseImages({
      userId: ambiguousUser,
      dependencies: {
        resolve: async (cardName) => noMatchResolution(cardName),
        autocomplete: async () => [choice('Mew RC24'), choice('Mew RC24')],
        preview: () => trustedPreview()
      }
    });
    expect(ambiguous).toMatchObject({ skippedAmbiguous: 1, wouldUpdate: 0 });
  });

  it('skips no-image, marketplace, and mismatched preview identities', async () => {
    for (const [label, preview, expected] of [
      ['no-image', { imageIdentity: 'Mew RC24', imageSourceKind: 'CARD_REFERENCE' }, 'skippedNoTrustedImage'],
      ['marketplace', { ...trustedPreview(), imageSourceKind: 'MARKET_LISTING' }, 'skippedNoTrustedImage'],
      ['mismatch', trustedPreview('Pichu Expedition 22/165'), 'skippedNoTrustedImage']
    ] as const) {
      const id = userId(label);
      addChase({ userId: id, cardName: 'Mew RC24' });
      const summary = await backfillMissingChaseImages({
        userId: id,
        dependencies: {
          resolve: async (cardName) => noMatchResolution(cardName),
          autocomplete: async () => [choice('Mew RC24')],
          preview: () => preview
        }
      });
      expect(summary[expected]).toBe(1);
      expect(listChases(id)[0]?.cardImageUrl).toBeUndefined();
    }
  });

  it('rejects non-CARD_REFERENCE store helper input', () => {
    const id = userId('store-reject');
    const chase = addChase({ userId: id, cardName: 'Mew RC24' });
    expect(() => backfillChaseCardImage({
      userId: id,
      chaseId: chase.id,
      imageUrl: 'https://seller.example/mew.jpg',
      imageIdentity: 'Mew RC24',
      imageSourceKind: 'MARKET_LISTING'
    })).toThrow(/CARD_REFERENCE/);
  });

  it('uses trusted resolver results to backfill images without exact display-string equality', async () => {
    const id = userId('resolver');
    addChase({ userId: id, cardName: 'Mew XY Black Star Promos XY192' });

    const summary = await backfillMissingChaseImages({
      userId: id,
      apply: true,
      dependencies: {
        resolve: async () => resolvedReference('Mew XY Black Star Promos XY192', 'Mew Black Star Promos XY192'),
        autocomplete: async () => {
          throw new Error('legacy autocomplete should not run after resolver success');
        },
        preview: () => undefined
      }
    });

    expect(summary).toMatchObject({ examined: 1, exactTrustedMatches: 1, updated: 1 });
    expect(summary.items[0]).toMatchObject({
      status: 'UPDATED',
      resolvedCardName: 'Mew Black Star Promos XY192'
    });
    expect(listChases(id)[0]).toMatchObject({
      cardName: 'Mew XY Black Star Promos XY192',
      cardImageUrl: 'https://images.example/resolved.png',
      cardImageIdentity: 'Mew Black Star Promos XY192',
      cardImageSourceKind: 'CARD_REFERENCE',
      cardImageSourceName: 'POKEMONTCG',
      cardImageSourceCardId: 'xyp-XY192'
    });
  });

  it('reports fallback-only trusted resolver outcomes and leaves rows untouched', async () => {
    const id = userId('fallback-only');
    addChase({ userId: id, cardName: 'Mew CoroCoro Promo 151' });

    const summary = await backfillMissingChaseImages({
      userId: id,
      dependencies: {
        resolve: async (cardName) => ({
          status: 'FALLBACK_ONLY' as const,
          requestedCardName: cardName,
          normalizedCardName: cardName
        }),
        autocomplete: async () => {
          throw new Error('legacy autocomplete should not run after explicit fallback-only result');
        },
        preview: () => undefined
      }
    });

    expect(summary).toMatchObject({ examined: 1, skippedFallbackOnly: 1, wouldUpdate: 0 });
    expect(listChases(id)[0]?.cardImageUrl).toBeUndefined();
  });
});
