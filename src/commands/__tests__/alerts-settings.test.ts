import { describe, expect, it, vi } from 'vitest';
import { alertsSettings } from '../alerts-settings.js';
import { getUserAlertSettings, resetUserAlertSettings } from '../../services/chase-store.js';

function mockInteraction(userId: string, strings: Record<string, string | null>) {
  const reply = vi.fn(async (_payload: any) => undefined);
  return {
    user: { id: userId },
    options: {
      getInteger: vi.fn(() => null),
      getString: vi.fn((name: string) => strings[name] ?? null)
    },
    reply
  };
}

describe('alerts-settings shipping postal validation', () => {
  it('accepts Canadian postal codes only with CA ship-to country', async () => {
    const userId = `settings-ca-${Date.now()}`;
    resetUserAlertSettings(userId);
    const interaction = mockInteraction(userId, { shipping_country: 'CA', shipping_postal_code: 'M5V 2T6' });

    await alertsSettings.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(getUserAlertSettings(userId).shippingCountry).toBe('CA');
    expect(getUserAlertSettings(userId).shippingPostalCode).toBe('M5V');
  });

  it('rejects US ZIP input for CA ship-to country', async () => {
    const userId = `settings-ca-reject-${Date.now()}`;
    resetUserAlertSettings(userId);
    const interaction = mockInteraction(userId, { shipping_country: 'CA', shipping_postal_code: '90210' });

    await alertsSettings.execute(interaction);

    const settings = getUserAlertSettings(userId);
    expect(interaction.reply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.title).toContain('Invalid Postal Code');
    expect(settings.shippingCountry).toBeUndefined();
    expect(settings.shippingPostalCode).toBeUndefined();
  });

  it('rejects Canadian postal input for US ship-to country', async () => {
    const userId = `settings-us-reject-${Date.now()}`;
    resetUserAlertSettings(userId);
    const interaction = mockInteraction(userId, { shipping_country: 'US', shipping_postal_code: 'M5V' });

    await alertsSettings.execute(interaction);

    const settings = getUserAlertSettings(userId);
    expect(interaction.reply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.title).toContain('Invalid Postal Code');
    expect(settings.shippingCountry).toBeUndefined();
    expect(settings.shippingPostalCode).toBeUndefined();
  });

  it('rejects postal input for unsupported ship-to countries', async () => {
    const userId = `settings-gb-reject-${Date.now()}`;
    resetUserAlertSettings(userId);
    const interaction = mockInteraction(userId, { shipping_country: 'GB', shipping_postal_code: 'SW1A 1AA' });

    await alertsSettings.execute(interaction);

    const settings = getUserAlertSettings(userId);
    expect(interaction.reply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.title).toContain('Invalid Postal Code');
    expect(settings.shippingCountry).toBeUndefined();
    expect(settings.shippingPostalCode).toBeUndefined();
  });
});