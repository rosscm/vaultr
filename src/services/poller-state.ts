type PollerState = {
  sourceMode: string;
  pollIntervalSeconds: number;
  lastRunAt?: string;
  lastRunCompletedAt?: string;
  lastRunDurationMs?: number;
  lastRunMatchesSent: number;
  totalMatchesSent: number;
  consecutiveFailures: number;
  skippedOverlappingRuns: number;
  sourceCallsLastMinute: number;
  rateLimitSkips: number;
  suppressedByMinScore: number;
  suppressedByChaseCooldown: number;
  suppressedByFingerprint: number;
  backoffUntil?: string;
  lastSourceSuccessAt?: string;
  isRunning: boolean;
  lastError?: string;
};

const state: PollerState = {
  sourceMode: 'EBAY',
  pollIntervalSeconds: 180,
  lastRunMatchesSent: 0,
  totalMatchesSent: 0,
  consecutiveFailures: 0,
  skippedOverlappingRuns: 0,
  sourceCallsLastMinute: 0,
  rateLimitSkips: 0,
  suppressedByMinScore: 0,
  suppressedByChaseCooldown: 0,
  suppressedByFingerprint: 0,
  isRunning: false
};

export function initializePollerState(sourceMode: string, pollIntervalSeconds: number): void {
  state.sourceMode = sourceMode;
  state.pollIntervalSeconds = pollIntervalSeconds;
}

export function markPollerRunStart(): void {
  state.lastRunAt = new Date().toISOString();
  state.lastRunMatchesSent = 0;
  state.lastError = undefined;
  state.isRunning = true;
}

export function markPollerMatchSent(): void {
  state.lastRunMatchesSent += 1;
  state.totalMatchesSent += 1;
}

export function markPollerRunSuccess(durationMs: number): void {
  state.lastRunCompletedAt = new Date().toISOString();
  state.lastRunDurationMs = durationMs;
  state.consecutiveFailures = 0;
  state.isRunning = false;
}

export function markPollerError(error: unknown): void {
  state.lastError = error instanceof Error ? error.message : String(error);
  state.consecutiveFailures += 1;
  state.isRunning = false;
}

export function markPollerOverlapSkip(): void {
  state.skippedOverlappingRuns += 1;
}

export function setSourceCallsLastMinute(value: number): void {
  state.sourceCallsLastMinute = value;
}

export function markRateLimitSkip(): void {
  state.rateLimitSkips += 1;
}

export function markMinScoreSuppression(): void {
  state.suppressedByMinScore += 1;
}

export function markChaseCooldownSuppression(): void {
  state.suppressedByChaseCooldown += 1;
}

export function markFingerprintSuppression(): void {
  state.suppressedByFingerprint += 1;
}

export function setBackoffUntil(date: Date | null): void {
  state.backoffUntil = date ? date.toISOString() : undefined;
}

export function markSourceSuccessNow(): void {
  state.lastSourceSuccessAt = new Date().toISOString();
}

export function getPollerState(): PollerState {
  return { ...state };
}
