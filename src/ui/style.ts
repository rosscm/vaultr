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

export function orNone(value: string | undefined | null): string {
  return value ?? OUTPUT_STYLE.none;
}
