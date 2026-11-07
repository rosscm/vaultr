import { convertCurrencyAmount, normalizeSupportedCurrency, roundConvertedMaxPrice } from './currency.js';
import { db } from './db.js';

export const DISCOVERY_BUDGET_PRESET_MAX_CAD = [50, 150, 300, 500, 1000, 2000] as const;

export type DiscoveryBudgetMode = 'ANY' | 'PRESET' | 'CUSTOM';

export type DiscoveryBudgetPolicy = {
  mode: DiscoveryBudgetMode;
  minimumCad?: number;
  maximumCad?: number;
  includeUnknownPrices: boolean;
  dreamCardsEnabled: boolean;
};

type DiscoveryBudgetRow = {
  mode: string;
  preset_max_cad: number | null;
  custom_min_cad: number | null;
  custom_max_cad: number | null;
  include_unknown_prices: number;
  dream_cards_enabled: number;
  updated_at: string;
};

export type DiscoveryBudgetPatch = {
  mode: DiscoveryBudgetMode;
  amountCurrency?: string;
  presetMaxCad?: number | null;
  customMinimum?: number | null;
  customMaximum?: number | null;
  includeUnknownPrices: boolean;
  dreamCardsEnabled?: boolean;
};

export type DiscoveryBudgetValidationError = { field: string; message: string; proRequired?: boolean };

const DEFAULT_POLICY: DiscoveryBudgetPolicy = {
  mode: 'ANY',
  includeUnknownPrices: true,
  dreamCardsEnabled: false
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optionalAmount(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return finiteNonNegative(value) ? value : undefined;
}

export function getDiscoveryBudgetPolicy(userId: string): DiscoveryBudgetPolicy & { updatedAt?: string } {
  const row = db.prepare(`
    SELECT mode, preset_max_cad, custom_min_cad, custom_max_cad,
           include_unknown_prices, dream_cards_enabled, updated_at
    FROM user_discovery_budget_settings WHERE user_id = ?
  `).get(userId) as DiscoveryBudgetRow | undefined;
  if (!row) return { ...DEFAULT_POLICY };
  if (row.mode === 'PRESET' && row.preset_max_cad !== null) {
    return {
      mode: 'PRESET',
      maximumCad: row.preset_max_cad,
      includeUnknownPrices: row.include_unknown_prices === 1,
      dreamCardsEnabled: row.dream_cards_enabled === 1,
      updatedAt: row.updated_at
    };
  }
  if (row.mode === 'CUSTOM') {
    return {
      mode: 'CUSTOM',
      minimumCad: row.custom_min_cad ?? undefined,
      maximumCad: row.custom_max_cad ?? undefined,
      includeUnknownPrices: row.include_unknown_prices === 1,
      dreamCardsEnabled: row.custom_max_cad !== null && row.dream_cards_enabled === 1,
      updatedAt: row.updated_at
    };
  }
  return { ...DEFAULT_POLICY, includeUnknownPrices: row.include_unknown_prices === 1, updatedAt: row.updated_at };
}

export function effectiveDiscoveryBudgetPolicy(policy: DiscoveryBudgetPolicy, activeTier: 'FREE' | 'PRO'): DiscoveryBudgetPolicy {
  if (activeTier === 'PRO') return policy;
  if (policy.mode === 'CUSTOM') return { ...DEFAULT_POLICY };
  return { ...policy, dreamCardsEnabled: false };
}

export function discoveryBudgetResponse(userId: string, currencyValue: string, activeTier: 'FREE' | 'PRO') {
  const currency = normalizeSupportedCurrency(currencyValue);
  const policy = getDiscoveryBudgetPolicy(userId);
  const effective = effectiveDiscoveryBudgetPolicy(policy, activeTier);
  const toLocal = (value: number | undefined) => value === undefined ? null : convertCurrencyAmount(value, 'CAD', currency);
  return {
    mode: policy.mode,
    presetMaxCad: policy.mode === 'PRESET' ? policy.maximumCad ?? null : null,
    customMinimum: policy.mode === 'CUSTOM' ? toLocal(policy.minimumCad) : null,
    customMaximum: policy.mode === 'CUSTOM' ? toLocal(policy.maximumCad) : null,
    includeUnknownPrices: policy.includeUnknownPrices,
    dreamCardsEnabled: policy.dreamCardsEnabled,
    effectiveMode: effective.mode,
    effectiveDreamCardsEnabled: effective.dreamCardsEnabled,
    currency,
    updatedAt: policy.updatedAt ?? null
  };
}

export function discoveryBudgetPresetOptions(currencyValue: string) {
  const currency = normalizeSupportedCurrency(currencyValue);
  return DISCOVERY_BUDGET_PRESET_MAX_CAD.map((maximumCad) => ({
    maximumCad,
    localAmount: roundConvertedMaxPrice(convertCurrencyAmount(maximumCad, 'CAD', currency)),
    currency
  }));
}

export function validateDiscoveryBudgetPatch(
  value: unknown,
  currencyValue: string,
  activeTier: 'FREE' | 'PRO'
): { policy: DiscoveryBudgetPolicy } | { error: DiscoveryBudgetValidationError } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: { field: 'discoveryBudget', message: 'Choose a valid Discovery Budget.' } };
  }
  const patch = value as Partial<DiscoveryBudgetPatch>;
  const allowed = new Set(['mode', 'amountCurrency', 'presetMaxCad', 'customMinimum', 'customMaximum', 'includeUnknownPrices', 'dreamCardsEnabled']);
  const unknown = Object.keys(patch).find((key) => !allowed.has(key));
  if (unknown) return { error: { field: `discoveryBudget.${unknown}`, message: 'Unsupported Discovery Budget field.' } };
  if (patch.mode !== 'ANY' && patch.mode !== 'PRESET' && patch.mode !== 'CUSTOM') {
    return { error: { field: 'discoveryBudget.mode', message: 'Choose Any price, a preset, or a custom range.' } };
  }
  if (typeof patch.includeUnknownPrices !== 'boolean') {
    return { error: { field: 'discoveryBudget.includeUnknownPrices', message: 'Choose whether to include cards without reliable prices.' } };
  }
  if (patch.mode === 'ANY') {
    if (patch.dreamCardsEnabled === true) {
      return { error: { field: 'discoveryBudget.dreamCardsEnabled', message: 'Choose a maximum price before allowing dream cards.' } };
    }
    return { policy: { mode: 'ANY', includeUnknownPrices: patch.includeUnknownPrices, dreamCardsEnabled: false } };
  }
  if (patch.mode === 'PRESET') {
    if (!finiteNonNegative(patch.presetMaxCad) || !(DISCOVERY_BUDGET_PRESET_MAX_CAD as readonly number[]).includes(patch.presetMaxCad)) {
      return { error: { field: 'discoveryBudget.presetMaxCad', message: 'Choose a supported preferred card price.' } };
    }
    if (patch.dreamCardsEnabled === true && activeTier !== 'PRO') {
      return { error: { field: 'discoveryBudget.dreamCardsEnabled', message: 'Dream-card exceptions require KeepSeek Plus.', proRequired: true } };
    }
    return {
      policy: {
        mode: 'PRESET',
        maximumCad: patch.presetMaxCad,
        includeUnknownPrices: patch.includeUnknownPrices,
        dreamCardsEnabled: patch.dreamCardsEnabled === true
      }
    };
  }
  if (activeTier !== 'PRO') {
    return { error: { field: 'discoveryBudget.mode', message: 'Custom Discovery Budget ranges require KeepSeek Plus.', proRequired: true } };
  }
  const minimum = optionalAmount(patch.customMinimum);
  const maximum = optionalAmount(patch.customMaximum);
  if (minimum === undefined) return { error: { field: 'discoveryBudget.customMinimum', message: 'Enter a valid minimum amount or leave it blank.' } };
  if (maximum === undefined) return { error: { field: 'discoveryBudget.customMaximum', message: 'Enter a valid maximum amount or leave it blank.' } };
  if (minimum === null && maximum === null) {
    return { error: { field: 'discoveryBudget.customMaximum', message: 'Enter at least one custom range amount.' } };
  }
  if (minimum !== null && maximum !== null && minimum > maximum) {
    return { error: { field: 'discoveryBudget.customMaximum', message: 'Maximum price must be at least the minimum price.' } };
  }
  if (patch.dreamCardsEnabled === true && maximum === null) {
    return { error: { field: 'discoveryBudget.dreamCardsEnabled', message: 'Set a maximum price before allowing dream cards.' } };
  }
  const rawAmountCurrency = patch.amountCurrency ?? currencyValue;
  const currency = normalizeSupportedCurrency(rawAmountCurrency);
  if (typeof rawAmountCurrency !== 'string' || rawAmountCurrency.trim().toUpperCase() !== currency) {
    return { error: { field: 'discoveryBudget.amountCurrency', message: 'Choose a supported currency for the custom range.' } };
  }
  return {
    policy: {
      mode: 'CUSTOM',
      minimumCad: minimum === null ? undefined : convertCurrencyAmount(minimum, currency, 'CAD'),
      maximumCad: maximum === null ? undefined : convertCurrencyAmount(maximum, currency, 'CAD'),
      includeUnknownPrices: patch.includeUnknownPrices,
      dreamCardsEnabled: patch.dreamCardsEnabled === true && maximum !== null
    }
  };
}

export function setDiscoveryBudgetPolicy(userId: string, policy: DiscoveryBudgetPolicy, now = new Date()): void {
  db.prepare(`
    INSERT INTO user_discovery_budget_settings (
      user_id, mode, preset_max_cad, custom_min_cad, custom_max_cad,
      include_unknown_prices, dream_cards_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = excluded.mode,
      preset_max_cad = excluded.preset_max_cad,
      custom_min_cad = excluded.custom_min_cad,
      custom_max_cad = excluded.custom_max_cad,
      include_unknown_prices = excluded.include_unknown_prices,
      dream_cards_enabled = excluded.dream_cards_enabled,
      updated_at = excluded.updated_at
  `).run(
    userId,
    policy.mode,
    policy.mode === 'PRESET' ? policy.maximumCad ?? null : null,
    policy.mode === 'CUSTOM' ? policy.minimumCad ?? null : null,
    policy.mode === 'CUSTOM' ? policy.maximumCad ?? null : null,
    policy.includeUnknownPrices ? 1 : 0,
    policy.mode !== 'ANY' && policy.maximumCad !== undefined && policy.dreamCardsEnabled ? 1 : 0,
    now.toISOString()
  );
}
