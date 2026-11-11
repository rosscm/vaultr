import { describe, expect, it, vi } from 'vitest';
import { DiscordRestDeliveryError, discordAlertMessage, sendDiscordDirectMessage, sendDiscordTextDirectMessage } from '../discord-rest-delivery.js';
import type { AlertEvent } from '../../types.js';

function event(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'alert-1', userId: 'user-1', chaseId: 'chase-1', listingId: 'listing-1', source: 'EBAY', status: 'MATCHED',
    chaseName: 'Mew ex 205/165', listingTitle: 'Mew ex 205/165 near mint', listingPrice: 80, listingCurrency: 'CAD',
    listingUrl: 'https://market.example/listing-1', matchScore: 92,
    details: { match: { explanation: 'Matched the exact card name and number.' } },
    createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z',
    ...overrides
  };
}

describe('Discord REST alert delivery', () => {
  it.each([
    ['NORMAL', 'Casual Watchlist cards'],
    ['HIGH', 'High-priority Watchlist cards'],
    ['GRAIL', 'Grail Watchlist cards'],
    [undefined, 'one of your Watchlist cards']
  ] as const)('uses concise %s priority copy and one exact Inbox action', (priority, expectedCopy) => {
    const message = discordAlertMessage(event({ chasePriority: priority }), 'https://keepseek.example') as {
      embeds: Array<{ title: string; description: string }>;
      components: Array<{ components: Array<{ label: string; url: string }> }>;
    };
    expect(message.embeds[0]).toMatchObject({ title: 'A new match for your Watchlist!' });
    expect(message.embeds[0]?.description).toContain(expectedCopy);
    expect(message.components[0]?.components.map((button) => button.label)).toEqual(['Open KeepSeek Inbox']);
    expect(message.components[0]?.components[0]?.url).toContain('/app#alerts?chaseId=chase-1&alertId=alert-1');
    expect(JSON.stringify(message)).not.toMatch(/Mew ex|80\.00|92\/100|View listing|market\.example|custom_id/);
  });

  it('creates a DM channel and sends through Discord REST', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'dm-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'message-1' }) });
    await expect(sendDiscordDirectMessage({ token: 'token', discordUserId: 'discord-1', event: event(), webBaseUrl: 'https://keepseek.example', fetchImpl })).resolves.toEqual({ messageId: 'message-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends operator notifications through REST without Gateway payloads', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'dm-ops' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'message-ops' }) });
    await expect(sendDiscordTextDirectMessage({ token: 'token', discordUserId: 'owner-1', content: 'KeepSeek recovered', fetchImpl })).resolves.toEqual({ messageId: 'message-ops' });
    expect(JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string)).toEqual({ content: 'KeepSeek recovered' });
  });

  it('classifies Discord rate limits as retryable with the supplied delay', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? '12.5' : null },
      json: async () => ({})
    });
    const error = await sendDiscordTextDirectMessage({ token: 'token', discordUserId: 'owner-1', content: 'Alert', fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DiscordRestDeliveryError);
    expect(error).toMatchObject({ statusCode: 429, retryAfterMs: 12_500, retryable: true });
  });
});
