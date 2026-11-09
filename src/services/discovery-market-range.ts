export type DiscoveryMarketRange = {
  low: number;
  high: number;
};

const MIN_RANGE_SAMPLES = 4;

function quantile(sorted: number[], percentile: number): number {
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

export function centralDiscoveryMarketRange(values: number[]): DiscoveryMarketRange | undefined {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (sorted.length < MIN_RANGE_SAMPLES) return undefined;

  const median = quantile(sorted, 0.5);
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((left, right) => left - right);
  const medianDeviation = quantile(deviations, 0.5);
  const comparable = medianDeviation > 0
    ? sorted.filter((value) => Math.abs(value - median) <= medianDeviation * 3)
    : sorted;
  if (comparable.length < MIN_RANGE_SAMPLES) return undefined;

  return {
    low: quantile(comparable, 0.25),
    high: quantile(comparable, 0.75)
  };
}
