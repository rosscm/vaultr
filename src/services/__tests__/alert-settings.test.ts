import { afterEach, describe, expect, it } from 'vitest';
import {
  alertSettingsResponse,
  updateAlertSettings
} from '../alert-settings.js';
import {
  getUserAlertSettings,
  resetUserAlertSettings,
  setUserAlertSettings,
  setUserPlan
} from '../chase-store.js';

const users = new Set<string>();

function user(label: string): string {
  const userId = `alert-settings-${label}-${Date.now()}-${users.size}`;
  users.add(userId);
  resetUserAlertSettings(userId);
  return userId;
}

afterEach(() => {
  for (const userId of users) resetUserAlertSettings(userId);
  users.clear();
});

describe('shared alert settings', () => {
  it('normalizes the supported matching, volume, and shipping values', () => {
    const userId = user('normalize');

    const result = updateAlertSettings(userId, {
      minScore: 78,
      alertVolume: 'QUIET',
      shippingCountry: 'ca',
      shippingPostalCode: ' m5v 2t6 '
    });

    expect(result.ok).toBe(true);
    expect(getUserAlertSettings(userId)).toMatchObject({
      minScore: 78,
      maxAlertsPerHour: 3,
      shippingCountry: 'CA',
      shippingPostalCode: 'M5V'
    });
  });

  it('rejects malformed values without partially persisting the patch', () => {
    const userId = user('atomic-validation');

    const result = updateAlertSettings(userId, {
      minScore: 82,
      shippingCountry: 'CA',
      shippingPostalCode: '90210'
    });

    expect(result).toMatchObject({ ok: false, field: 'shippingPostalCode' });
    expect(getUserAlertSettings(userId)).toMatchObject({ minScore: 60, maxAlertsPerHour: 10 });
    expect(getUserAlertSettings(userId).shippingCountry).toBeUndefined();
  });

  it('retains an inactive Pro source preference during an unrelated Free-plan save', () => {
    const userId = user('retained-source');
    setUserPlan(userId, 'PRO');
    expect(updateAlertSettings(userId, { listingSourceMode: 'EBAY_SHOPIFY' }).ok).toBe(true);
    setUserPlan(userId, 'FREE');

    expect(updateAlertSettings(userId, { minScore: 72 }).ok).toBe(true);

    expect(getUserAlertSettings(userId).listingSourceMode).toBe('EBAY_SHOPIFY');
    expect(alertSettingsResponse(userId)).toMatchObject({
      settings: {
        listingSourceMode: 'EBAY_SHOPIFY',
        effectiveListingSourceMode: 'EBAY'
      },
      access: { tier: 'FREE', trustedShops: false }
    });
  });

  it('enforces source entitlement and validates supported currency updates', () => {
    const userId = user('restricted');
    setUserPlan(userId, 'FREE');

    expect(updateAlertSettings(userId, { listingSourceMode: 'SHOPIFY' })).toMatchObject({
      ok: false,
      code: 'PRO_REQUIRED',
      field: 'listingSourceMode'
    });
    expect(updateAlertSettings(userId, { alertCurrency: 'CAD' }).ok).toBe(true);
    expect(updateAlertSettings(userId, { alertCurrency: 'AUD' })).toMatchObject({
      ok: false,
      code: 'INVALID_SETTINGS',
      field: 'alertCurrency'
    });
    expect(getUserAlertSettings(userId)).toMatchObject({ alertCurrency: 'CAD', listingSourceMode: 'EBAY' });
  });

  it('clears postal data when the destination no longer supports a postal region', () => {
    const userId = user('postal-clear');
    setUserAlertSettings(userId, { shippingCountry: 'CA', shippingPostalCode: 'M5V' });

    expect(updateAlertSettings(userId, { shippingCountry: 'GB' }).ok).toBe(true);

    expect(getUserAlertSettings(userId).shippingCountry).toBe('GB');
    expect(getUserAlertSettings(userId).shippingPostalCode).toBeUndefined();
  });
});
