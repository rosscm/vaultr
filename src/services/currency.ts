const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

function parseRate(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// Default rates are intentionally conservative fallbacks and can be overridden via env.
function usdRates(): Record<SupportedCurrency, number> {
  return {
    USD: 1,
    CAD: parseRate(process.env.FX_USD_CAD, 1.37),
    EUR: parseRate(process.env.FX_USD_EUR, 0.92),
    GBP: parseRate(process.env.FX_USD_GBP, 0.79),
    JPY: parseRate(process.env.FX_USD_JPY, 155)
  };
}

export function normalizeSupportedCurrency(value: string | undefined): SupportedCurrency {
  const next = value?.toUpperCase();
  if (next && (SUPPORTED_CURRENCIES as readonly string[]).includes(next)) {
    return next as SupportedCurrency;
  }
  return 'USD';
}

export function convertCurrencyAmount(amount: number, from: string, to: SupportedCurrency): number {
  if (!Number.isFinite(amount)) return amount;
  const fromCurrency = normalizeSupportedCurrency(from);
  if (fromCurrency === to) return amount;

  const rates = usdRates();
  const amountInUsd = amount / rates[fromCurrency];
  const converted = amountInUsd * rates[to];
  return Math.round(converted * 100) / 100;
}
