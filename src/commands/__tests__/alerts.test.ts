import { afterEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../alerts.js';
import { countUserAlertsSince, removeAllChases } from '../../services/chase-store.js';
import * as ebayService from '../../services/ebay.js';
import * as shopifyService from '../../services/shopify.js';

const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockAlertsTestInteraction(userId: string, send: (payload: any) => Promise<unknown>) {
  const reply = vi.fn(async (_payload?: any) => undefined);
  return {
    user: { id: userId, send },
    options: {
      getSubcommand: () => 'test'
    },
    reply
  };
}

describe('alerts command', () => {
  it('exposes ship-to postal region on settings', () => {
    const settings = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'settings') as any;

    expect(settings?.options?.map((option: any) => option.name)).toContain('shipping_postal_code');
  });

  it('keeps recent fixed to the default alert count', () => {
    const recent = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'recent') as any;

    expect(recent?.options ?? []).toEqual([]);
  });

  it('exposes user-facing watch status', () => {
    const status = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'status') as any;

    expect(status?.description).toBe('Check your Vault watch state');
    expect(status?.options ?? []).toEqual([]);
  });

  it('exposes a DM delivery test subcommand', () => {
    const test = alerts.data
      .toJSON()
      .options?.find((option: any) => option.name === 'test') as any;

    expect(test?.description).toBe('Send a DM delivery test');
    expect(test?.options ?? []).toEqual([]);
  });

  it('sends a test DM without touching listing sources or sent-alert state', async () => {
    const userId = `alerts-test-success-${Date.now()}`;
    const send = vi.fn(async (_payload?: any) => undefined);
    const interaction = mockAlertsTestInteraction(userId, send);
    const ebaySpy = vi.spyOn(ebayService, 'searchEbayListings');
    const shopifySpy = vi.spyOn(shopifyService, 'searchTrustedShopifyListings');

    removeAllChases(userId);
    await alerts.execute(interaction);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.embeds?.[0]?.toJSON?.().title).toBe('🧪 Vaultr DM Test');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: expect.any(Number),
      embeds: expect.arrayContaining([expect.objectContaining({
        data: expect.objectContaining({ title: '✅ DM Test Sent' })
      })])
    }));
    expect(ebaySpy).not.toHaveBeenCalled();
    expect(shopifySpy).not.toHaveBeenCalled();
    expect(countUserAlertsSince(userId, '2000-01-01T00:00:00.000Z')).toBe(0);
  });

  it('responds with an actionable message when DMs are blocked', async () => {
    const interaction = mockAlertsTestInteraction(
      `alerts-test-blocked-${Date.now()}`,
      vi.fn(async () => Promise.reject(new Error('Cannot send messages to this user')))
    );

    await alerts.execute(interaction);

    const payload = interaction.reply.mock.calls[0]?.[0];
    const data = payload.embeds[0].toJSON();
    expect(data.title).toContain('DM Test Failed');
    expect(data.description).toContain('Enable direct messages');
    expect(data.description).not.toContain('Cannot send messages to this user');
  });

  it('treats a stalled DM send as a user-facing delivery failure', async () => {
    vi.useFakeTimers();
    const interaction = mockAlertsTestInteraction(
      `alerts-test-timeout-${Date.now()}`,
      vi.fn(async () => new Promise(() => undefined))
    );

    const execution = alerts.execute(interaction);
    await vi.advanceTimersByTimeAsync(10_001);
    await execution;

    const payload = interaction.reply.mock.calls[0]?.[0];
    expect(payload.embeds[0].toJSON().title).toContain('DM Test Failed');
  });
});
