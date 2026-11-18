import { describe, expect, it, vi } from 'vitest';
import { DiscordRestDeliveryError, sendDiscordTextDirectMessage } from '../discord-rest-delivery.js';

describe('Discord REST alert delivery', () => {
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

  it('retains bounded Discord API diagnostics for permanent failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ message: 'Cannot send messages to this user', code: 50007, recipient_id: 'sensitive' })
    });
    const error = await sendDiscordTextDirectMessage({ token: 'token', discordUserId: 'owner-1', content: 'Alert', fetchImpl }).catch((caught) => caught);
    expect(error).toMatchObject({ statusCode: 403, discordCode: 50007, retryable: false });
    expect(error.message).toBe('Discord DM channel request failed (403, Discord code 50007)');
    expect(error.message).not.toContain('recipient_id');
    expect(error.message).not.toContain('Cannot send messages');
  });
});
