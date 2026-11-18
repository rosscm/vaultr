type DiscordRestResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type DiscordRestFetch = (url: string, init: RequestInit) => Promise<DiscordRestResponse>;

export class DiscordRestDeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
    readonly retryable = statusCode === 429 || statusCode === 408 || (statusCode !== undefined && statusCode >= 500),
    readonly discordCode?: number
  ) {
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

async function discordFailure(response: DiscordRestResponse, operation: string): Promise<DiscordRestDeliveryError> {
  const body = await response.json().catch(() => null) as { code?: unknown } | null;
  const discordCode = typeof body?.code === 'number' && Number.isFinite(body.code) ? body.code : undefined;
  const suffix = discordCode === undefined ? '' : `, Discord code ${discordCode}`;
  return new DiscordRestDeliveryError(
    `${operation} (${response.status}${suffix})`,
    response.status,
    retryAfterMs(response),
    undefined,
    discordCode
  );
}

async function createDiscordDmChannel(input: {
  token: string;
  discordUserId: string;
  fetchImpl: DiscordRestFetch;
}): Promise<string> {
  const response = await input.fetchImpl('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: discordHeaders(input.token),
    body: JSON.stringify({ recipient_id: input.discordUserId })
  });
  if (!response.ok) {
    throw await discordFailure(response, 'Discord DM channel request failed');
  }
  const channel = await response.json() as { id?: unknown };
  if (typeof channel.id !== 'string') throw new DiscordRestDeliveryError('Discord DM channel response had no channel ID');
  return channel.id;
}

async function sendDiscordDmPayload(input: {
  token: string;
  discordUserId: string;
  payload: Record<string, unknown>;
  fetchImpl: DiscordRestFetch;
}): Promise<{ messageId: string }> {
  const channelId = await createDiscordDmChannel(input);
  const response = await input.fetchImpl(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: 'POST',
    headers: discordHeaders(input.token),
    body: JSON.stringify(input.payload)
  });
  if (!response.ok) {
    throw await discordFailure(response, 'Discord DM send failed');
  }
  const message = await response.json() as { id?: unknown };
  if (typeof message.id !== 'string') throw new DiscordRestDeliveryError('Discord DM response had no message ID');
  return { messageId: message.id };
}

export async function sendDiscordTextDirectMessage(input: {
  token: string;
  discordUserId: string;
  content: string;
  fetchImpl?: DiscordRestFetch;
}): Promise<{ messageId: string }> {
  return sendDiscordDmPayload({
    token: input.token,
    discordUserId: input.discordUserId,
    payload: { content: input.content.slice(0, 2000) },
    fetchImpl: input.fetchImpl ?? (fetch as unknown as DiscordRestFetch)
  });
}
