export const OUTPUT_STYLE = {
  any: 'Any',
  none: 'None',
  on: 'On',
  off: 'Off',
  yes: 'Yes',
  no: 'No'
} as const;

export function orAny(value: string | undefined | null): string {
  return value ?? OUTPUT_STYLE.any;
}

export function normalizeGradePreference(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();
  if (normalized === 'ungraded' || normalized === 'raw') return 'UNGRADED';
  return trimmed;
}

export function displayGrade(value: string | undefined | null): string {
  if (!value) return OUTPUT_STYLE.any;
  return value === 'UNGRADED' ? 'Ungraded' : value;
}

export function orNone(value: string | undefined | null): string {
  return value ?? OUTPUT_STYLE.none;
}
