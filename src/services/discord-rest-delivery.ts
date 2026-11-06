import type { AlertEvent } from '../types.js';

type DiscordRestResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type DiscordRestFetch = (url: string, init: RequestInit) => Promise<DiscordRestResponse>;

export class DiscordRestDeliveryError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

function discordHeaders(token: string): Record<string, string> {
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
}

function retryAfterMs(response: DiscordRestResponse): number | undefined {
  const header = Number(response.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? Math.ceil(header * 1000) : undefined;
}

function money(value: number | undefined, currency: string | undefined): string {
  return value === undefined ? 'Unknown' : `${currency ?? ''} ${value.toFixed(2)}`.trim();
}

export function discordAlertMessage(event: AlertEvent, webBaseUrl: string): Record<string, unknown> {
  const details = event.details;
  const fields = [
    { name: 'Watchlist card', value: event.chaseName ?? 'Saved card', inline: false },
    { name: 'Price', value: money(event.listingPrice, event.listingCurrency), inline: true },
    { name: 'Confidence', value: event.matchScore === undefined ? 'Unknown' : `${event.matchScore}/100`, inline: true }
  ];
  if (details?.match?.explanation) fields.push({ name: 'Why it matched', value: details.match.explanation.slice(0, 1024), inline: false });
  const inboxUrl = new URL('/app', webBaseUrl);
  inboxUrl.hash = `alerts?chaseId=${encodeURIComponent(event.chaseId)}&chaseName=${encodeURIComponent(event.chaseName ?? '')}`;
  return {
    embeds: [{
      title: event.listingTitle?.slice(0, 256) ?? 'New Watchlist match',
      color: 0xff7ac6,
      fields,
      timestamp: event.updatedAt,
      footer: { text: 'KeepSeek • Optional Discord alert' }
    }],
    components: [{
      type: 1,
      components: [
        ...(event.listingUrl ? [{ type: 2, style: 5, label: 'View listing', url: event.listingUrl }] : []),
        { type: 2, style: 5, label: 'Open Inbox', url: inboxUrl.toString() }
      ]
    }]
  };
}

export async function sendDiscordDirectMessage(input: {
  token: string;
  discordUserId: string;
  event: AlertEvent;
  webBaseUrl: string;
  fetchImpl?: DiscordRestFetch;
}): Promise<{ messageId: string }> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as DiscordRestFetch);
  const channelResponse = await fetchImpl('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: discordHeaders(input.token),
    body: JSON.stringify({ recipient_id: input.discordUserId })
  });
  if (!channelResponse.ok) throw new DiscordRestDeliveryError(`Discord DM channel request failed (${channelResponse.status})`, retryAfterMs(channelResponse));
  const channel = await channelResponse.json() as { id?: unknown };
  if (typeof channel.id !== 'string') throw new DiscordRestDeliveryError('Discord DM channel response had no channel ID');

  const messageResponse = await fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(channel.id)}/messages`, {
    method: 'POST',
    headers: discordHeaders(input.token),
    body: JSON.stringify(discordAlertMessage(input.event, input.webBaseUrl))
  });
  if (!messageResponse.ok) throw new DiscordRestDeliveryError(`Discord DM send failed (${messageResponse.status})`, retryAfterMs(messageResponse));
  const message = await messageResponse.json() as { id?: unknown };
  if (typeof message.id !== 'string') throw new DiscordRestDeliveryError('Discord DM response had no message ID');
  return { messageId: message.id };
}
