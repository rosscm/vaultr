import { describe, expect, it } from 'vitest';
import { displayEffectiveSourceMode } from '../plan.js';
import { activePlanTier, formatActivePlanAccess } from '../../services/plans.js';

describe('displayEffectiveSourceMode', () => {
  it('shows eBay as the current source for Free users with trusted shop preferences stored', () => {
    expect(displayEffectiveSourceMode('EBAY_SHOPIFY', 'FREE')).toBe('eBay');
    expect(displayEffectiveSourceMode('SHOPIFY', 'FREE')).toBe('eBay');
  });

  it('shows trusted shop sources for active Pro users', () => {
    expect(displayEffectiveSourceMode('EBAY_SHOPIFY', 'PRO')).toBe('eBay + Trusted Shops');
    expect(displayEffectiveSourceMode('SHOPIFY', 'PRO')).toBe('Trusted Shops Only');
  });

  it('shows eBay as the current source when Pro access is paused', () => {
    const activeTier = activePlanTier({ tier: 'PRO', status: 'PAST_DUE' });

    expect(activeTier).toBe('FREE');
    expect(displayEffectiveSourceMode('EBAY_SHOPIFY', activeTier)).toBe('eBay');
  });
});

describe('formatActivePlanAccess', () => {
  it('shows active Pro access for active Pro users', () => {
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'ACTIVE' })).toBe('PRO');
  });

  it('shows Free access when Pro is past due or canceled', () => {
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'PAST_DUE' })).toBe('FREE (PRO PAST_DUE; Pro paused)');
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'CANCELED' })).toBe('FREE (PRO CANCELED; Pro paused)');
  });
});