export function formatAgeSince(iso: string | undefined): string {
  if (!iso) return 'n/a';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'n/a';
  const deltaSeconds = Math.floor((Date.now() - then) / 1000);
  const isFuture = deltaSeconds < 0;
  const seconds = Math.abs(deltaSeconds);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const suffix = isFuture ? '' : ' ago';
  const prefix = isFuture ? 'in ' : '';
  if (minutes < 60) return `${prefix}${minutes}m${suffix}`;
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${Math.floor(hours / 24)}d${suffix}`;
}

export function formatLocalDateTime(iso: string | undefined): string {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatTimeWithAge(iso: string | undefined): string {
  if (!iso) return 'n/a';
  return `${formatAgeSince(iso)} • ${formatLocalDateTime(iso)}`;
}
