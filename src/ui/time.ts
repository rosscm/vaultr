export function formatAgeSince(iso: string | undefined): string {
  if (!iso) return 'n/a';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'n/a';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
