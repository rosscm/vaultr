const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'] as const;
const DEFAULT_REFRESH_MS = 60 * 60 * 1000;
const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_FETCH_TIMEOUT_MS = 8000;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

type CurrencyState = {
  rates: Record<SupportedCurrency, number>;
  source: 'fallback' | 'dynamic';
  fetchedAt: Date | null;
  lastError: string | null;
  refreshTimer: NodeJS.Timeout | null;
};

function parseRate(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function envFallbackRates(): Record<SupportedCurrency, number> {
  return {
    USD: 1,
    CAD: parseRate(process.env.FX_USD_CAD, 1.37),
    EUR: parseRate(process.env.FX_USD_EUR, 0.92),
    GBP: parseRate(process.env.FX_USD_GBP, 0.79),
    JPY: parseRate(process.env.FX_USD_JPY, 155)
  };
}

const currencyState: CurrencyState = {
  rates: envFallbackRates(),
  source: 'fallback',
  fetchedAt: null,
  lastError: null,
  refreshTimer: null
};

export function normalizeSupportedCurrency(value: string | undefined): SupportedCurrency {
  const next = value?.toUpperCase();
  if (next && (SUPPORTED_CURRENCIES as readonly string[]).includes(next)) {
    return next as SupportedCurrency;
  }
  return 'USD';
}

function tryBuildDynamicRates(data: unknown): Record<SupportedCurrency, number> | null {
  if (!data || typeof data !== 'object') return null;
  const rates = (data as { rates?: Record<string, number> }).rates;
  if (!rates || typeof rates !== 'object') return null;

  const next: Partial<Record<SupportedCurrency, number>> = { USD: 1 };
  for (const currency of SUPPORTED_CURRENCIES) {
    if (currency === 'USD') continue;
    const n = Number(rates[currency]);
    if (!Number.isFinite(n) || n <= 0) return null;
    next[currency] = n;
  }

  return next as Record<SupportedCurrency, number>;
}

async function refreshRatesOnce(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FX_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(FX_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`FX API returned ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const dynamicRates = tryBuildDynamicRates(payload);
  if (!dynamicRates) {
    throw new Error('FX API payload missing required currency rates');
  }

  currencyState.rates = dynamicRates;
  currencyState.source = 'dynamic';
  currencyState.fetchedAt = new Date();
  currencyState.lastError = null;
}

function refreshIntervalMs(): number {
  const raw = Number(process.env.FX_REFRESH_MINUTES ?? '60');
  if (!Number.isFinite(raw) || raw < 5) return DEFAULT_REFRESH_MS;
  return Math.floor(raw * 60 * 1000);
}

export async function initializeCurrencyRates(): Promise<void> {
  try {
    await refreshRatesOnce();
    console.log(`[FX] rates loaded from API (${FX_API_URL})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    currencyState.source = 'fallback';
    currencyState.lastError = message;
    console.warn(`[FX] using fallback rates (${message})`);
  }

  if (!currencyState.refreshTimer) {
    currencyState.refreshTimer = setInterval(async () => {
      try {
        await refreshRatesOnce();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        currencyState.lastError = message;
        console.warn(`[FX] refresh failed, keeping existing rates (${message})`);
      }
    }, refreshIntervalMs());
  }
}

export function getCurrencyStatus(): {
  source: 'fallback' | 'dynamic';
  fetchedAt: Date | null;
  lastError: string | null;
} {
  return {
    source: currencyState.source,
    fetchedAt: currencyState.fetchedAt,
    lastError: currencyState.lastError
  };
}

export function convertCurrencyAmount(amount: number, from: string, to: SupportedCurrency): number {
  if (!Number.isFinite(amount)) return amount;
  const fromCurrency = normalizeSupportedCurrency(from);
  if (fromCurrency === to) return amount;

  const rates = currencyState.rates;
  const amountInUsd = amount / rates[fromCurrency];
  const converted = amountInUsd * rates[to];
  return Math.round(converted * 100) / 100;
}

export function roundConvertedMaxPrice(amount: number): number {
  if (!Number.isFinite(amount)) return amount;
  if (amount < 10) return Math.max(1, Math.round(amount));
  return Math.max(10, Math.round(amount / 10) * 10);
}
