import { describe, expect, it, vi } from 'vitest';
import { alertsSettings } from '../alerts-settings.js';
import { addChase, getUserAlertSettings, listChases, listUserTasteMemoryChases, recordDiscoveryFeedback, removeAllChases, resetUserAlertSettings, setUserAlertSettings, setUserPlan } from '../../services/chase-store.js';

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
  it('converts stored chase and taste max prices when alert currency changes', () => {
    const userId = `settings-currency-${Date.now()}`;
    resetUserAlertSettings(userId);
    removeAllChases(userId);
    setUserAlertSettings(userId, { alertCurrency: 'CAD' });
    addChase({ userId, cardName: 'Legendary Birds Stained Glass Promo', priority: 'GRAIL', maxPrice: 200 });
    addChase({ userId, cardName: 'Mew XY Black Star Promos XY192', priority: 'NORMAL', maxPrice: 127 });
    recordDiscoveryFeedback({ userId, cardName: 'Mew Southern Islands Promo', lane: 'mythical display cards', feedback: 'MORE_LIKE_THIS', maxPrice: 137 });

    setUserAlertSettings(userId, { alertCurrency: 'USD' });

    const chases = listChases(userId);
    expect(getUserAlertSettings(userId).alertCurrency).toBe('USD');
    expect(chases.find((chase) => chase.cardName === 'Legendary Birds Stained Glass Promo')?.maxPrice).toBe(150);
    expect(chases.find((chase) => chase.cardName === 'Mew XY Black Star Promos XY192')?.maxPrice).toBe(90);
    expect(listUserTasteMemoryChases(userId)[0]?.maxPrice).toBeCloseTo(100, 2);
    removeAllChases(userId);
    resetUserAlertSettings(userId);
  });

  it('accepts Canadian postal codes only with CA ship-to country', async () => {
    const userId = `settings-ca-${Date.now()}`;
    resetUserAlertSettings(userId);
    const interaction = mockInteraction(userId, { shipping_country: 'CA', shipping_postal_code: 'M5V 2T6' });

    await alertsSettings.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(getUserAlertSettings(userId).shippingCountry).toBe('CA');
    expect(getUserAlertSettings(userId).shippingPostalCode).toBe('M5V');
  });

  it('clears a stored postal region with the word off', async () => {
    const userId = `settings-postal-off-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserAlertSettings(userId, { shippingCountry: 'CA', shippingPostalCode: 'M5V' });
    const interaction = mockInteraction(userId, { shipping_postal_code: 'off' });

    await alertsSettings.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(getUserAlertSettings(userId).shippingCountry).toBe('CA');
    expect(getUserAlertSettings(userId).shippingPostalCode).toBeUndefined();
  });

  it('rejects clear as a postal region removal alias', async () => {
    const userId = `settings-postal-clear-reject-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserAlertSettings(userId, { shippingCountry: 'CA', shippingPostalCode: 'M5V' });
    const interaction = mockInteraction(userId, { shipping_postal_code: 'clear' });

    await alertsSettings.execute(interaction);

    expect(interaction.reply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.title).toContain('Invalid Postal Code');
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

  it('frames trusted shops source controls as Pro controls inside the Full Vault for Free users', async () => {
    const userId = `settings-shop-source-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'FREE');
    const interaction = mockInteraction(userId, { source: 'SHOPIFY' });

    await alertsSettings.execute(interaction);

    const embed = interaction.reply.mock.calls[0]?.[0]?.embeds?.[0];
    const text = [embed?.data?.title, embed?.data?.description].join('\n');
    expect(text).toContain('trusted shops are a Pro control inside the Full Vault');
    expect(text).toContain('More room for grails, faster checks, trusted shops, precision controls, and the full Weekly Shelf');
    expect(text).toContain('`/upgrade` opens the Full Vault');
  });
});