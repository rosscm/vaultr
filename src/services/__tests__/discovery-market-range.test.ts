import { describe, expect, it } from 'vitest';
import { centralDiscoveryMarketRange } from '../discovery-market-range.js';

describe('Display Case market ranges', () => {
  it('uses the central half of accepted samples after removing strong outliers', () => {
    expect(centralDiscoveryMarketRange([70, 80, 90, 100, 110, 900])).toEqual({ low: 80, high: 100 });
  });

  it('requires four comparable accepted samples', () => {
    expect(centralDiscoveryMarketRange([70, 80, 90])).toBeUndefined();
    expect(centralDiscoveryMarketRange([70, 80, Number.NaN, -1])).toBeUndefined();
  });
});
