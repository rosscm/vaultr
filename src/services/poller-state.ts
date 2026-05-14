type PollerState = {
  sourceMode: string;
  pollIntervalSeconds: number;
  lastRunAt?: string;
  lastRunMatchesSent: number;
  totalMatchesSent: number;
  lastError?: string;
};

const state: PollerState = {
  sourceMode: 'EBAY',
  pollIntervalSeconds: 180,
  lastRunMatchesSent: 0,
  totalMatchesSent: 0
};

export function initializePollerState(sourceMode: string, pollIntervalSeconds: number): void {
  state.sourceMode = sourceMode;
  state.pollIntervalSeconds = pollIntervalSeconds;
}

export function markPollerRunStart(): void {
  state.lastRunAt = new Date().toISOString();
  state.lastRunMatchesSent = 0;
  state.lastError = undefined;
}

export function markPollerMatchSent(): void {
  state.lastRunMatchesSent += 1;
  state.totalMatchesSent += 1;
}

export function markPollerError(error: unknown): void {
  state.lastError = error instanceof Error ? error.message : String(error);
}

export function getPollerState(): PollerState {
  return { ...state };
}
