import { describe, expect, it } from 'vitest';
import { alerts } from '../alerts.js';

describe('alerts command', () => {
  it('exposes ship-to postal region on settings', () => {
    const settings = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'settings') as any;

    expect(settings?.options?.map((option: any) => option.name)).toContain('shipping_postal_code');
  });

  it('keeps recent fixed to the default sighting count', () => {
    const recent = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'recent') as any;

    expect(recent?.options ?? []).toEqual([]);
  });
});