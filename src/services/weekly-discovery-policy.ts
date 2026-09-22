export type WeeklyDiscoveryMarketPolicy = {
  shelfSize: number;
  minMarketResolved: number;
  maxMarketIncomplete: number;
};

type WeeklyDiscoveryMarketPolicyEnv = Partial<Record<
  'WEEKLY_DISCOVERY_MIN_MARKET_RESOLVED' | 'WEEKLY_DISCOVERY_MAX_MARKET_INCOMPLETE',
  string | undefined
>>;

const WEEKLY_DISCOVERY_SHELF_SIZE = 20;

function positiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function weeklyDiscoveryMarketPolicy(env: WeeklyDiscoveryMarketPolicyEnv = process.env): WeeklyDiscoveryMarketPolicy {
  const minMarketResolved = positiveInteger(env.WEEKLY_DISCOVERY_MIN_MARKET_RESOLVED, 15, 0, WEEKLY_DISCOVERY_SHELF_SIZE);
  const maxMarketIncomplete = positiveInteger(env.WEEKLY_DISCOVERY_MAX_MARKET_INCOMPLETE, 5, 0, WEEKLY_DISCOVERY_SHELF_SIZE);
  return {
    shelfSize: WEEKLY_DISCOVERY_SHELF_SIZE,
    minMarketResolved,
    maxMarketIncomplete
  };
}

export const WEEKLY_DISCOVERY_MARKET_POLICY = weeklyDiscoveryMarketPolicy();
