import { createHash } from 'node:crypto';

type CheckResultLike = {
  name: string;
  details: string;
};

type AlertStateLike = {
  lastFailureFingerprint?: string;
  lastAlertedAt?: string;
};

function normalizeGenericDetails(details: string): string {
  return details
    .replace(/\/[^\s)]+/g, '<path>')
    .replace(/\b\d+(?:\.\d+)?h old\b/g, '<age>')
    .replace(/\b\d+\s+bytes\b/g, '<bytes>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<iso>')
    .replace(/\b\d+\b/g, '<n>');
}

function normalizeFailureDetails(failure: CheckResultLike): string {
  if (failure.name === 'chase-freshness') return 'stale-active-chases';
  if (failure.name.startsWith('service:')) return failure.details.trim().toLowerCase();
  return normalizeGenericDetails(failure.details.trim().toLowerCase());
}

export function failureFingerprint(failures: CheckResultLike[]): string {
  const payload = failures
    .map((failure) => ({
      name: failure.name,
      normalizedDetails: normalizeFailureDetails(failure)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function shouldSuppressDuplicateAlert(
  state: AlertStateLike,
  fingerprint: string,
  nowMs: number,
  repeatCooldownMinutes: number
): boolean {
  if (state.lastFailureFingerprint !== fingerprint) return false;
  if (repeatCooldownMinutes <= 0) return true;
  const lastAlertedAtMs = state.lastAlertedAt ? new Date(state.lastAlertedAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastAlertedAtMs)) return false;
  return nowMs - lastAlertedAtMs < repeatCooldownMinutes * 60 * 1000;
}

