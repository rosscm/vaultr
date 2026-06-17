import { describe, expect, it } from 'vitest';
import { buildPlanViewPayload, displayEffectiveSourceMode } from '../plan.js';
import { resetUserAlertSettings, setUserPlan } from '../../services/chase-store.js';
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

describe('buildPlanViewPayload', () => {
  it('frames Free access as a starter Vault instead of a billing panel', () => {
    const userId = `plan-free-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'FREE');

    const payload = buildPlanViewPayload(userId);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(text).toContain('Free Vault is live');
    expect(text).toContain('**Access:** Free');
    expect(text).toContain('**Active Chases:** 3');
    expect(text).toContain('**Watch Cadence:** every 30 minutes');
    expect(text).toContain('Weekly Discovery previews shaped by your active chases');
    expect(text).toContain('**Watching:** eBay');
    expect(text).toContain('Full Vault\nMore room for grails, faster checks, trusted shops, precision controls, and the full Weekly Shelf');
    expect(text).toContain('`/upgrade` opens the Full Vault');
    expect(text).not.toContain('**Pro Adds:**');
    expect(text).not.toContain('Pro Unlocks');
    expect(text).not.toContain('Free access is active');
  });
});