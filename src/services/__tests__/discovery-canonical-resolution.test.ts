import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoveryCanonicalLookupKey,
  resolveWeeklyDiscoveryCanonicalReferences,
  type CanonicalLookupEvidenceMap
} from '../discovery-canonical-resolution.js';
import type { DiscoveryCandidate } from '../../commands/discover.js';

function candidate(name: string, evidenceSearchTerm = `${name} Pokemon card`): DiscoveryCandidate {
  return {
    suggestion: {
      name,
      lane: 'Promo Trail',
      laneWhy: 'test lane',
      why: 'test why',
      nearby: [],
      evidenceSearchTerm
    },
    image: {
      name,
      url: 'https://i.ebayimg.com/images/g/test/s-l1600.jpg',
      sourceName: 'eBay listing image',
      sourceKind: 'MARKET_LISTING'
    },
    typicalRawAskingTotal: 100,
    marketSampleSize: 4,
    displayCurrency: 'CAD'
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveWeeklyDiscoveryCanonicalReferences', () => {
  it('repairs marketplace-shaped live reserve titles into trusted canonical provider records', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected URL: ${url}`);
      if (url.includes('SM241')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'smp-SM241',
              name: 'Umbreon & Darkrai-GX',
              number: 'SM241',
              set: { id: 'smp', name: 'SM Black Star Promos' },
              images: { large: 'https://images.pokemontcg.io/smp/SM241_hires.png' }
            }]
          })
        } as Response;
      }
      if (url.includes('Team+Rocket') || url.includes('Team%20Rocket')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'base5-20',
              name: 'Dark Blastoise',
              number: '20',
              set: { id: 'base5', name: 'Team Rocket' },
              images: { large: 'https://images.pokemontcg.io/base5/20_hires.png' }
            }]
          })
        } as Response;
      }
      if (url.includes('Secret+Wonders') || url.includes('Secret%20Wonders')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'dp3-131',
              name: 'Gardevoir LV.X',
              number: '131',
              set: { id: 'dp3', name: 'Secret Wonders' },
              images: { large: 'https://images.pokemontcg.io/dp3/131_hires.png' }
            }]
          })
        } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }));

    const result = await resolveWeeklyDiscoveryCanonicalReferences([
      candidate(
        '2020 Pokemon TCG SUN & MOON Promo Umbreon and Darkrai GX SM241',
        '2020 Pokemon TCG SUN & MOON Promo Umbreon and Darkrai GX SM241 Pokemon card'
      ),
      candidate('Dark Blastoise Team Rocket 20'),
      candidate('Gardevoir LV.X Secret Wonders 131')
    ]);

    expect(result.candidates.map((entry) => entry.suggestion.referenceSourceCardId)).toEqual([
      'smp-SM241',
      'base5-20',
      'dp3-131'
    ]);
    expect(result.candidates.map((entry) => entry.image?.sourceKind)).toEqual([
      'CARD_REFERENCE',
      'CARD_REFERENCE',
      'CARD_REFERENCE'
    ]);
    expect(result.candidates[0]?.suggestion.name).toBe('Umbreon & Darkrai-GX SM Black Star Promos SM241');
    expect(result.evidence[discoveryCanonicalLookupKey(result.candidates[0]!.suggestion)]?.outcome).toBe('RESOLVED');
  });

  it('repairs the live W29 Umbreon and Darkrai marketplace title into the trusted promo record', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (!url.includes('api.pokemontcg.io')) throw new Error(`Unexpected URL: ${url}`);
      if (url.includes('SM241')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'smp-SM241',
              name: 'Umbreon & Darkrai-GX',
              number: 'SM241',
              set: { id: 'smp', name: 'SM Black Star Promos' },
              images: { large: 'https://images.pokemontcg.io/smp/SM241_hires.png' }
            }]
          })
        } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }));

    const result = await resolveWeeklyDiscoveryCanonicalReferences([
      candidate(
        '2016 Umbreon & Darkrai GX - Promo SM Promos SMP Darkness Holo SM241 LP',
        '2016 Umbreon & Darkrai GX - Promo SM Promos SMP Darkness Holo SM241 LP Pokemon card'
      )
    ]);

    expect(result.candidates[0]?.suggestion.referenceSourceCardId).toBe('smp-SM241');
    expect(result.candidates[0]?.suggestion.name).toBe('Umbreon & Darkrai-GX SM Black Star Promos SM241');
    expect(result.candidates[0]?.image?.sourceKind).toBe('CARD_REFERENCE');
  });

  it('uses replay evidence without making network calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch should not be called in replay mode');
    }));

    const unresolved = candidate('Dark Blastoise Team Rocket 20');
    const replayEvidence: CanonicalLookupEvidenceMap = {
      'ENGLISH|dark blastoise|team rocket|20|': {
        lookupKey: 'ENGLISH|dark blastoise|team rocket|20|',
        normalizedIdentity: { name: 'Dark Blastoise', set: 'Team Rocket', number: '20', language: 'ENGLISH' },
        queryVariants: ['name:"Dark Blastoise" number:20 set.name:"Team Rocket"'],
        provider: 'Pokemon TCG',
        providerResults: [{
          provider: 'Pokemon TCG',
          sourceCardId: 'base5-20',
          canonicalCardId: 'base5-20',
          canonicalName: 'Dark Blastoise',
          setId: 'base5',
          setName: 'Team Rocket',
          cardNumber: '20',
          language: 'ENGLISH',
          imageUrl: 'https://images.pokemontcg.io/base5/20_hires.png'
        }],
        acceptedSourceCardId: 'base5-20',
        outcome: 'RESOLVED'
      }
    };

    const result = await resolveWeeklyDiscoveryCanonicalReferences([unresolved], { replayEvidence });

    expect(result.candidates[0]?.suggestion.referenceSourceCardId).toBe('base5-20');
    expect(result.candidates[0]?.image?.sourceKind).toBe('CARD_REFERENCE');
  });

  it('prefers a valid direct source-card-id bind over broader ambiguous search matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/sm1-154')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              id: 'sm1-154',
              name: 'Umbreon-GX',
              number: '154',
              set: { id: 'sm1', name: 'Sun & Moon' },
              images: { large: 'https://images.pokemontcg.io/sm1/154_hires.png' }
            }
          })
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'sm1-154',
              name: 'Umbreon-GX',
              number: '154',
              set: { id: 'sm1', name: 'Sun & Moon' },
              images: { large: 'https://images.pokemontcg.io/sm1/154_hires.png' }
            },
            {
              id: 'smp-SM36',
              name: 'Umbreon-GX',
              number: 'SM36',
              set: { id: 'smp', name: 'SM Black Star Promos' },
              images: { large: 'https://images.pokemontcg.io/smp/SM36_hires.png' }
            }
          ]
        })
      } as Response;
    }));

    const seeded = {
      ...candidate('Umbreon-GX Sun & Moon 154'),
      suggestion: {
        ...candidate('Umbreon-GX Sun & Moon 154').suggestion,
        referenceSourceCardId: 'sm1-154'
      },
      image: {
        ...candidate('Umbreon-GX Sun & Moon 154').image!,
        sourceCardId: 'sm1-154'
      }
    };

    const result = await resolveWeeklyDiscoveryCanonicalReferences([seeded]);

    expect(result.candidates[0]?.suggestion.referenceSourceCardId).toBe('sm1-154');
    expect(result.candidates[0]?.image?.url).toBe('https://images.pokemontcg.io/sm1/154_hires.png');
    expect(result.evidence[discoveryCanonicalLookupKey(seeded.suggestion)]?.outcome).toBe('RESOLVED');
  });

  it('rejects ambiguous exact lookups and preserves marketplace provenance when unresolved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'lo-1',
            name: 'Mew VMAX',
            number: 'TG30',
            set: { id: 'swsh11tg', name: 'Lost Origin Trainer Gallery' },
            images: { large: 'https://images.pokemontcg.io/swsh11tg/TG30_hires.png' }
          },
          {
            id: 'lo-2',
            name: 'Mew VMAX',
            number: 'TG30',
            set: { id: 'swsh11tg', name: 'Lost Origin Trainer Gallery' },
            images: { large: 'https://images.pokemontcg.io/swsh11tg/TG30_alt_hires.png' }
          }
        ]
      })
    }) as Response));

    const unresolved = candidate('Mew VMAX Lost Origin TG30');
    const result = await resolveWeeklyDiscoveryCanonicalReferences([unresolved]);
    const lookupKey = discoveryCanonicalLookupKey(unresolved.suggestion);

    expect(result.evidence[lookupKey]?.outcome).toBe('AMBIGUOUS');
    expect(result.candidates[0]?.suggestion.referenceSourceCardId).toBeUndefined();
    expect(result.candidates[0]?.image?.sourceKind).toBe('MARKET_LISTING');
  });

  it('rejects set and number mismatches instead of binding the wrong canonical record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{
          id: 'wrong-1',
          name: 'Dark Blastoise',
          number: '3',
          set: { id: 'trr', name: 'Team Rocket Returns' },
          images: { large: 'https://images.pokemontcg.io/trr/3_hires.png' }
        }]
      })
    }) as Response));

    const result = await resolveWeeklyDiscoveryCanonicalReferences([candidate('Dark Blastoise Team Rocket 20')]);
    const evidence = result.evidence['ENGLISH|dark blastoise|team rocket|20|'];

    expect(evidence?.outcome).toBe('PRINTING_MISMATCH');
    expect(evidence?.providerResults[0]?.rejectionReason).toContain('card-number mismatch');
    expect(evidence?.providerResults[0]?.rejectionReason).toContain('set mismatch');
    expect(result.candidates[0]?.suggestion.referenceSourceCardId).toBeUndefined();
  });
});
