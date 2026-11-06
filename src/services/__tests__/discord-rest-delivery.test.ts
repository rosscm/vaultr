import { describe, expect, it, vi } from 'vitest';
import { discordAlertMessage, sendDiscordDirectMessage } from '../discord-rest-delivery.js';
import type { AlertEvent } from '../../types.js';

function event(): AlertEvent {
  return {
    id: 'alert-1', userId: 'user-1', chaseId: 'chase-1', listingId: 'listing-1', source: 'EBAY', status: 'MATCHED',
    chaseName: 'Mew ex 205/165', listingTitle: 'Mew ex 205/165 near mint', listingPrice: 80, listingCurrency: 'CAD',
    listingUrl: 'https://market.example/listing-1', matchScore: 92,
    details: { match: { explanation: 'Matched the exact card name and number.' } },
    createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z'
  };
}

describe('Discord REST alert delivery', () => {
  it('uses link-only actions that return collectors to the web Inbox', () => {
    const message = discordAlertMessage(event(), 'https://keepseek.example') as { components: Array<{ components: Array<{ label: string; url: string }> }> };
    expect(message.components[0]?.components.map((button) => button.label)).toEqual(['View listing', 'Open Inbox']);
    expect(message.components[0]?.components[1]?.url).toContain('/app#alerts?chaseId=chase-1');
    expect(JSON.stringify(message)).not.toContain('custom_id');
  });

  it('creates a DM channel and sends through Discord REST', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'dm-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'message-1' }) });
    await expect(sendDiscordDirectMessage({ token: 'token', discordUserId: 'discord-1', event: event(), webBaseUrl: 'https://keepseek.example', fetchImpl })).resolves.toEqual({ messageId: 'message-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
