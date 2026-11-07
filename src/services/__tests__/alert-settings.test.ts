import { afterEach, describe, expect, it } from 'vitest';
import {
  alertSettingsResponse,
  updateAlertSettings
} from '../alert-settings.js';
import {
  getUserAlertSettings,
  resetUserAlertSettings,
  setUserAlertSettings,
  setUserPlan,
  upsertAlertEvent
} from '../chase-store.js';
import { createUser, linkIdentity } from '../accounts.js';
import { db } from '../db.js';
import { getUserNotificationSettings } from '../notification-settings.js';
import { getDiscoveryBudgetPolicy } from '../discovery-budget.js';

const users = new Set<string>();

function user(label: string): string {
  const userId = `alert-settings-${label}-${Date.now()}-${users.size}`;
  users.add(userId);
  resetUserAlertSettings(userId);
  return userId;
}

afterEach(() => {
  for (const userId of users) {
    resetUserAlertSettings(userId);
    db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_notification_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_discovery_budget_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_identities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
  users.clear();
});

describe('shared alert settings', () => {
  it('defaults Discord card delivery off and requires a linked identity before opt-in', () => {
    const account = createUser({ displayName: 'Discord Collector' });
    const userId = account.id;
    users.add(userId);
    resetUserAlertSettings(userId);
    expect(alertSettingsResponse(userId)).toMatchObject({
      settings: { discordCardAlertsEnabled: false },
      access: { discordLinked: false }
    });
    expect(updateAlertSettings(userId, { discordCardAlertsEnabled: true })).toMatchObject({ ok: false, field: 'discordCardAlertsEnabled' });

    linkIdentity({ userId: account.id, provider: 'DISCORD', providerUserId: `discord-${userId}` });
    expect(updateAlertSettings(userId, { discordCardAlertsEnabled: true }).ok).toBe(true);
    expect(getUserNotificationSettings(userId)).toMatchObject({ discordCardAlertsEnabled: true, discordLinked: true });
  });

  it('reports hourly volume from persisted Inbox events rather than Discord deliveries', () => {
    const account = createUser({ displayName: 'Inbox Volume Collector' });
    const userId = account.id;
    users.add(userId);
    setUserAlertSettings(userId, { maxAlertsPerHour: 3 });
    for (let index = 0; index < 3; index += 1) {
      upsertAlertEvent({
        userId,
        chaseId: `volume-chase-${index}`,
        listingId: `volume-listing-${index}`,
        source: 'EBAY',
        now: new Date(Date.now() - index * 1000).toISOString()
      });
    }

    expect(alertSettingsResponse(userId)).toMatchObject({
      status: { alertVolumeReached: true, recentAlertCount: 3 }
    });
  });
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

  it('defaults Discovery Budget to Any price with unknown prices allowed', () => {
    const account = createUser({ displayName: 'Discovery Budget Default' });
    users.add(account.id);

    const response = alertSettingsResponse(account.id);
    expect(response).toMatchObject({
      settings: {
        discoveryBudget: {
          mode: 'ANY',
          includeUnknownPrices: true,
          dreamCardsEnabled: false
        }
      }
    });
    expect(response.options.discoveryBudgetPresets.map((option) => option.maximumCad)).toEqual([50, 150, 300, 500, 1000, 2000]);
  });

  it('persists Free presets and protects Plus-only custom ranges and dream cards', () => {
    const account = createUser({ displayName: 'Discovery Budget Access' });
    users.add(account.id);
    setUserPlan(account.id, 'FREE');

    expect(updateAlertSettings(account.id, {
      discoveryBudget: {
        mode: 'PRESET',
        presetMaxCad: 300,
        includeUnknownPrices: false,
        dreamCardsEnabled: false
      }
    }).ok).toBe(true);
    expect(getDiscoveryBudgetPolicy(account.id)).toMatchObject({
      mode: 'PRESET',
      maximumCad: 300,
      includeUnknownPrices: false,
      dreamCardsEnabled: false
    });
    expect(updateAlertSettings(account.id, {
      discoveryBudget: {
        mode: 'CUSTOM',
        customMinimum: 100,
        customMaximum: 500,
        includeUnknownPrices: true,
        dreamCardsEnabled: true
      }
    })).toMatchObject({ ok: false, code: 'PRO_REQUIRED', field: 'discoveryBudget.mode' });
    expect(updateAlertSettings(account.id, {
      discoveryBudget: {
        mode: 'PRESET',
        presetMaxCad: 300,
        includeUnknownPrices: true,
        dreamCardsEnabled: true
      }
    })).toMatchObject({ ok: false, code: 'PRO_REQUIRED', field: 'discoveryBudget.dreamCardsEnabled' });
  });

  it('stores custom Plus ranges canonically in CAD across currency changes', () => {
    const account = createUser({ displayName: 'Discovery Budget Currency' });
    users.add(account.id);
    setUserPlan(account.id, 'PRO');
    setUserAlertSettings(account.id, { alertCurrency: 'USD' });

    expect(updateAlertSettings(account.id, {
      discoveryBudget: {
        mode: 'CUSTOM',
        customMinimum: 100,
        customMaximum: 500,
        includeUnknownPrices: true,
        dreamCardsEnabled: true
      }
    }).ok).toBe(true);
    const canonical = getDiscoveryBudgetPolicy(account.id);
    expect(canonical.minimumCad).toBeGreaterThan(100);
    expect(canonical.maximumCad).toBeGreaterThan(canonical.minimumCad ?? 0);

    expect(updateAlertSettings(account.id, { alertCurrency: 'EUR' }).ok).toBe(true);
    expect(getDiscoveryBudgetPolicy(account.id)).toMatchObject({
      minimumCad: canonical.minimumCad,
      maximumCad: canonical.maximumCad,
      dreamCardsEnabled: true
    });
    expect(alertSettingsResponse(account.id).settings.discoveryBudget).toMatchObject({ mode: 'CUSTOM', currency: 'EUR' });
  });

  it('rejects contradictory custom ranges without changing the saved policy', () => {
    const account = createUser({ displayName: 'Discovery Budget Validation' });
    users.add(account.id);
    setUserPlan(account.id, 'PRO');

    expect(updateAlertSettings(account.id, {
      discoveryBudget: {
        mode: 'CUSTOM',
        customMinimum: 500,
        customMaximum: 100,
        includeUnknownPrices: true,
        dreamCardsEnabled: false
      }
    })).toMatchObject({ ok: false, field: 'discoveryBudget.customMaximum' });
    expect(getDiscoveryBudgetPolicy(account.id)).toMatchObject({ mode: 'ANY', includeUnknownPrices: true });
  });
});
