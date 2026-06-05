import { describe, expect, it } from 'vitest';
import { alerts } from '../alerts.js';

describe('alerts command', () => {
  it('keeps recent fixed to the default sighting count', () => {
    const recent = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'recent') as any;

    expect(recent?.options ?? []).toEqual([]);
  });
});