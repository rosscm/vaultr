import { describe, expect, it } from 'vitest';
import { isTrustedEbayContentFresh, suppressStaleEbayMarket } from '../ebay-content-exposure.js';

describe('eBay content exposure', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');

  it('trusts only proven retrieval timestamps within the six-hour boundary', () => {
    expect(isTrustedEbayContentFresh('2026-11-18T06:00:00.000Z', now)).toBe(true);
    expect(isTrustedEbayContentFresh('2026-11-18T05:59:59.999Z', now)).toBe(false);
    expect(isTrustedEbayContentFresh(undefined, now)).toBe(false);
    expect(isTrustedEbayContentFresh('not-a-date', now)).toBe(false);
    expect(isTrustedEbayContentFresh('2026-11-18T12:00:01.000Z', now)).toBe(false);
  });

  it('removes stale prepared market snapshots without leaking nested listings', () => {
    const stale = suppressStaleEbayMarket({
      status: 'READY', currency: 'CAD', askingTotal: 45, soldTotal: 40,
      listing: { id: 'v1|stale|0', title: 'Stored title', url: 'https://www.ebay.ca/itm/stale' },
      fetchedAt: '2026-11-18T05:59:59.999Z'
    }, now);
    expect(stale).toEqual({ status: 'MISSING', currency: 'CAD', contentSuppressed: true });
  });

  it('preserves a freshly retrieved market snapshot', () => {
    const fresh = { status: 'READY', currency: 'CAD', askingTotal: 45, fetchedAt: '2026-11-18T11:00:00.000Z' };
    expect(suppressStaleEbayMarket(fresh, now)).toBe(fresh);
  });
});
