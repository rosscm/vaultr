import type { ListingSourceModePreference, UserAlertSettings } from '../types.js';
import { getUserAlertSettings, getUserPlan, setUserAlertSettings } from './chase-store.js';
import { activePlanTier } from './plans.js';

export type AlertVolume = 'QUIET' | 'BALANCED' | 'MORE';

export const ALERT_VOLUME_OPTIONS = [
  { value: 'QUIET', label: 'Quiet', maxAlertsPerHour: 3 },
  { value: 'BALANCED', label: 'Balanced', maxAlertsPerHour: 10 },
  { value: 'MORE', label: 'More', maxAlertsPerHour: 25 }
] as const;

export const ALERT_CURRENCY_OPTIONS = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'] as const;

export const ALERT_SHIPPING_COUNTRY_OPTIONS = [
  { label: 'Off', value: 'OFF' },
  { label: 'United States (USD)', value: 'US' },
  { label: 'Canada (CAD)', value: 'CA' },
  { label: 'United Kingdom (GBP)', value: 'GB' },
  { label: 'Japan (JPY)', value: 'JP' },
  { label: 'Germany (EUR)', value: 'DE' },
  { label: 'France (EUR)', value: 'FR' },
  { label: 'Italy (EUR)', value: 'IT' },
  { label: 'Spain (EUR)', value: 'ES' },
  { label: 'Netherlands (EUR)', value: 'NL' },
  { label: 'Australia', value: 'AU' }
] as const;

export const ALERT_SOURCE_OPTIONS = [
  { label: 'eBay', value: 'EBAY', requiresPro: false },
  { label: 'eBay + Trusted Shops', value: 'EBAY_SHOPIFY', requiresPro: true },
  { label: 'Trusted Shops Only', value: 'SHOPIFY', requiresPro: true }
] as const;

const ALLOWED_PATCH_FIELDS = new Set([
  'minScore',
  'alertVolume',
  'alertCurrency',
  'shippingCountry',
  'shippingPostalCode',
  'listingSourceMode'
]);

export type AlertSettingsError = {
  ok: false;
  code: 'INVALID_SETTINGS' | 'CURRENCY_READ_ONLY' | 'PRO_REQUIRED' | 'NO_CHANGES_REQUESTED';
  field?: string;
  message: string;
};

export type AlertSettingsUpdateResult =
  | { ok: true; settings: UserAlertSettings }
  | AlertSettingsError;

export function maxAlertsForVolume(value: AlertVolume): number {
  return ALERT_VOLUME_OPTIONS.find((option) => option.value === value)?.maxAlertsPerHour ?? 10;
}

export function alertVolumeForMax(maxAlertsPerHour: number): AlertVolume {
  if (maxAlertsPerHour <= 5) return 'QUIET';
  if (maxAlertsPerHour >= 20) return 'MORE';
  return 'BALANCED';
}

export function displayAlertVolume(maxAlertsPerHour: number): string {
  const option = ALERT_VOLUME_OPTIONS.find((item) => item.value === alertVolumeForMax(maxAlertsPerHour));
  return `${option?.label ?? 'Balanced'} (${maxAlertsPerHour}/hr)`;
}

export function isStorefrontSourceMode(value: unknown): value is 'EBAY_SHOPIFY' | 'SHOPIFY' {
  return value === 'EBAY_SHOPIFY' || value === 'SHOPIFY';
}

export function effectiveAlertSourceMode(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): ListingSourceModePreference {
  return activeTier === 'FREE' && isStorefrontSourceMode(value) ? 'EBAY' : value;
}

export function normalizeShippingCountry(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OFF' || normalized === '') return null;
  return ALERT_SHIPPING_COUNTRY_OPTIONS.some((option) => option.value === normalized && option.value !== 'OFF')
    ? normalized
    : undefined;
}

export function normalizeShippingPostalCode(value: unknown, shippingCountry?: string): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (normalized === 'OFF' || normalized === '') return null;
  if (shippingCountry === 'CA') {
    const compact = normalized.replace(/[\s-]+/g, '');
    return /^([A-Z]\d[A-Z])(?:\d[A-Z]\d)?$/.exec(compact)?.[1];
  }
  if (shippingCountry === 'US') return /^(\d{5})(?:[- ]?\d{4})?$/.exec(normalized)?.[1];
  return undefined;
}

export function alertSettingsResponse(userId: string) {
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const tier = activePlanTier(plan);
  return {
    settings: {
      minScore: settings.minScore,
      alertVolume: alertVolumeForMax(settings.maxAlertsPerHour),
      maxAlertsPerHour: settings.maxAlertsPerHour,
      alertCurrency: settings.alertCurrency,
      shippingCountry: settings.shippingCountry ?? null,
      shippingPostalCode: settings.shippingPostalCode ?? null,
      listingSourceMode: settings.listingSourceMode,
      effectiveListingSourceMode: effectiveAlertSourceMode(settings.listingSourceMode, tier),
      updatedAt: settings.updatedAt
    },
    access: {
      tier,
      planStatus: plan.status,
      trustedShops: tier === 'PRO'
    },
    options: {
      confidence: { min: 0, max: 100 },
      volumes: ALERT_VOLUME_OPTIONS,
      shippingCountries: ALERT_SHIPPING_COUNTRY_OPTIONS,
      sources: ALERT_SOURCE_OPTIONS
    }
  };
}

export function updateAlertSettings(
  userId: string,
  patch: Record<string, unknown>,
  options: { allowCurrency?: boolean } = {}
): AlertSettingsUpdateResult {
  const unknownField = Object.keys(patch).find((field) => !ALLOWED_PATCH_FIELDS.has(field));
  if (unknownField) return { ok: false, code: 'INVALID_SETTINGS', field: unknownField, message: 'Unsupported settings field.' };
  if (Object.keys(patch).length === 0) return { ok: false, code: 'NO_CHANGES_REQUESTED', message: 'No settings changes were submitted.' };
  if ('alertCurrency' in patch && options.allowCurrency !== true) {
    return { ok: false, code: 'CURRENCY_READ_ONLY', field: 'alertCurrency', message: "Currency changes aren't available here yet." };
  }

  const current = getUserAlertSettings(userId);
  const next: Parameters<typeof setUserAlertSettings>[1] = {};

  if ('minScore' in patch) {
    if (typeof patch.minScore !== 'number' || !Number.isInteger(patch.minScore) || patch.minScore < 0 || patch.minScore > 100) {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'minScore', message: 'Match confidence must be a whole number from 0 to 100.' };
    }
    next.minScore = patch.minScore;
  }

  if ('alertVolume' in patch) {
    if (patch.alertVolume !== 'QUIET' && patch.alertVolume !== 'BALANCED' && patch.alertVolume !== 'MORE') {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'alertVolume', message: 'Choose Quiet, Balanced, or More.' };
    }
    next.maxAlertsPerHour = maxAlertsForVolume(patch.alertVolume);
  }

  if ('alertCurrency' in patch) {
    if (typeof patch.alertCurrency !== 'string' || !(ALERT_CURRENCY_OPTIONS as readonly string[]).includes(patch.alertCurrency)) {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'alertCurrency', message: 'Choose a supported currency.' };
    }
    next.alertCurrency = patch.alertCurrency as UserAlertSettings['alertCurrency'];
  }

  if ('listingSourceMode' in patch) {
    const source = patch.listingSourceMode;
    if (source !== 'EBAY' && source !== 'EBAY_SHOPIFY' && source !== 'SHOPIFY') {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'listingSourceMode', message: 'Choose a supported listing source.' };
    }
    if (isStorefrontSourceMode(source) && activePlanTier(getUserPlan(userId)) !== 'PRO') {
      return { ok: false, code: 'PRO_REQUIRED', field: 'listingSourceMode', message: 'Trusted Shops require Full Vault.' };
    }
    next.listingSourceMode = source;
  }

  let effectiveCountry = current.shippingCountry;
  if ('shippingCountry' in patch) {
    const country = normalizeShippingCountry(patch.shippingCountry);
    if (country === undefined) {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'shippingCountry', message: 'Choose a supported ship-to country or Off.' };
    }
    next.shippingCountry = country;
    effectiveCountry = country ?? undefined;
    if (!effectiveCountry || (effectiveCountry !== 'CA' && effectiveCountry !== 'US')) next.shippingPostalCode = null;
  }

  if ('shippingPostalCode' in patch) {
    const postalCode = normalizeShippingPostalCode(patch.shippingPostalCode, effectiveCountry);
    if (postalCode === undefined) {
      return { ok: false, code: 'INVALID_SETTINGS', field: 'shippingPostalCode', message: 'Enter a Canadian FSA or US ZIP that matches the ship-to country, or leave it blank.' };
    }
    next.shippingPostalCode = postalCode;
  } else if ('shippingCountry' in patch && effectiveCountry && effectiveCountry !== current.shippingCountry) {
    const retainedPostal = normalizeShippingPostalCode(current.shippingPostalCode ?? null, effectiveCountry);
    next.shippingPostalCode = retainedPostal && retainedPostal !== null ? retainedPostal : null;
  }

  return { ok: true, settings: setUserAlertSettings(userId, next) };
}
