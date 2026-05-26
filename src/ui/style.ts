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

export function displayGrade(value: string | undefined | null): string {
  if (!value) return OUTPUT_STYLE.any;
  return value === 'UNGRADED' ? 'Ungraded' : value;
}

export function displayCondition(value: string | undefined | null): string {
  if (!value) return OUTPUT_STYLE.any;
  if (value === 'NM') return 'NM or better';
  if (value === 'NM,LP') return 'LP or better';
  if (value === 'NM,LP,MP') return 'MP or better';
  if (value === 'NM,LP,MP,HP') return 'HP or better';
  if (value === 'DMG') return 'Damaged only';
  return value;
}

export function orNone(value: string | undefined | null): string {
  return value ?? OUTPUT_STYLE.none;
}
