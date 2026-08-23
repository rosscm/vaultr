import { describe, expect, it, vi } from 'vitest';
import { enqueueAlertEventDelivery } from '../services/chase-store.js';
import { db } from '../services/db.js';
import {
  createWebSession,
  getWebSessionByTokenHash,
  hashWebSessionToken,
  resolveWebSession
} from '../services/web-sessions.js';
import { decodeAlertCursor, handleWebRequest, type WebConfig } from '../web.js';

const config: WebConfig = {
  discordClientId: 'discord-client-id',
  discordClientSecret: 'discord-client-secret',
  baseUrl: 'http://127.0.0.1:8790',
  postLoginRedirectPath: '/app'
};

function clearUser(userId: string): void {
  db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
}

function cookieValue(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  const raw = headers?.['Set-Cookie'];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = values.find((value) => value.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

function sessionCookie(token: string): string {
  return `vaultr_session=${encodeURIComponent(token)}`;
}

function seedAlert(userId: string, index: number, overrides: Partial<Parameters<typeof enqueueAlertEventDelivery>[0]> = {}) {
  return enqueueAlertEventDelivery({
    userId,
    chaseId: `chase-${index}`,
    listingId: `listing-${index}`,
    source: 'EBAY',
    channel: 'DISCORD_DM',
    chaseName: `Mew ${index}`,
    chasePriority: 'NORMAL',
    listingTitle: `Mew listing ${index}`,
    listingPrice: 40 + index,
    listingCurrency: 'CAD',
    priceDelta: index,
    listingUrl: `https://example.test/listing-${index}`,
    matchScore: 90,
    listingPostedAt: `2026-08-20T10:0${index}:00.000Z`,
    alertLatencySeconds: index,
    payload: { internalOnly: true },
    now: `2026-08-20T12:0${index}:00.000Z`,
    ...overrides
  });
}

describe('web sessions', () => {
  it('stores session tokens hashed, not raw, and resolves the Discord user ID', () => {
    const userId = 'web-session-user';
    clearUser(userId);

    const { token, session } = createWebSession(
      { userId, discordUsername: 'collector' },
      { now: new Date('2026-08-20T12:00:00.000Z'), token: 'raw-session-token' }
    );

    expect(token).toBe('raw-session-token');
    expect(session.tokenHash).toBe(hashWebSessionToken('raw-session-token'));
    expect(getWebSessionByTokenHash('raw-session-token')).toBeNull();
    expect(getWebSessionByTokenHash(hashWebSessionToken('raw-session-token'))?.userId).toBe(userId);
    expect(resolveWebSession(token, new Date('2026-08-20T12:05:00.000Z'))?.userId).toBe(userId);

    clearUser(userId);
  });

  it('rejects expired sessions and removes them when encountered', () => {
    const userId = 'web-expired-session-user';
    clearUser(userId);
    const { token } = createWebSession(
      { userId },
      { now: new Date('2026-08-20T12:00:00.000Z'), ttlDays: 1, token: 'expired-token' }
    );

    expect(resolveWebSession(token, new Date('2026-08-22T12:00:00.000Z'))).toBeNull();
    expect(getWebSessionByTokenHash(hashWebSessionToken(token))).toBeNull();

    clearUser(userId);
  });

  it('does not update last_seen_at inside the throttle window', () => {
    const userId = 'web-throttled-session-user';
    clearUser(userId);
    const { token } = createWebSession(
      { userId },
      { now: new Date('2026-08-20T12:00:00.000Z'), token: 'throttle-token' }
    );

    expect(resolveWebSession(token, new Date('2026-08-20T12:05:00.000Z'))?.lastSeenAt).toBe('2026-08-20T12:00:00.000Z');
    expect(getWebSessionByTokenHash(hashWebSessionToken(token))?.lastSeenAt).toBe('2026-08-20T12:00:00.000Z');

    clearUser(userId);
  });

  it('updates last_seen_at after the throttle interval', () => {
    const userId = 'web-throttled-session-late-user';
    clearUser(userId);
    const { token } = createWebSession(
      { userId },
      { now: new Date('2026-08-20T12:00:00.000Z'), token: 'throttle-late-token' }
    );

    expect(resolveWebSession(token, new Date('2026-08-20T12:31:00.000Z'))?.lastSeenAt).toBe('2026-08-20T12:31:00.000Z');
    expect(getWebSessionByTokenHash(hashWebSessionToken(token))?.lastSeenAt).toBe('2026-08-20T12:31:00.000Z');

    clearUser(userId);
  });
});

describe('web app static routes', () => {
  it('redirects root to the app shell', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/' }, { config });
    expect(response.status).toBe(302);
    expect(response.headers?.Location).toBe('/app');
  });

  it('serves the app shell and assets with explicit content types', async () => {
    const appResponse = await handleWebRequest({ method: 'GET', url: '/app' }, { config });
    const cssResponse = await handleWebRequest({ method: 'GET', url: '/app.css' }, { config });
    const jsResponse = await handleWebRequest({ method: 'GET', url: '/app.js' }, { config });

    expect(appResponse.status).toBe(200);
    expect(appResponse.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
    expect(appResponse.headers?.['Cache-Control']).toBe('no-cache');
    expect(appResponse.body).toContain('Vaultr App');
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers?.['Content-Type']).toBe('text/css; charset=utf-8');
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers?.['Content-Type']).toBe('text/javascript; charset=utf-8');
  });

  it('returns 404 for unknown or traversal-style static paths', async () => {
    const missing = await handleWebRequest({ method: 'GET', url: '/missing-app.js' }, { config });
    const traversal = await handleWebRequest({ method: 'GET', url: '/app/../README.md' }, { config });

    expect(missing.status).toBe(404);
    expect(traversal.status).toBe(404);
  });
});

describe('web auth routes', () => {
  it('creates OAuth state and redirects to Discord identify authorization', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/auth/discord' }, { config });

    expect(response.status).toBe(302);
    const location = new URL(String(response.headers?.Location));
    expect(location.origin + location.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(location.searchParams.get('scope')).toBe('identify');
    expect(location.searchParams.get('client_id')).toBe(config.discordClientId);
    expect(location.searchParams.get('redirect_uri')).toBe(`${config.baseUrl}/auth/discord/callback`);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(cookieValue(response.headers, 'vaultr_oauth_state')).toBe(location.searchParams.get('state'));
  });

  it('rejects missing and mismatched OAuth state', async () => {
    const missing = await handleWebRequest({ method: 'GET', url: '/auth/discord/callback?code=abc' }, { config });
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body ?? '{}')).toEqual({ error: 'invalid_state' });

    const mismatched = await handleWebRequest(
      { method: 'GET', url: '/auth/discord/callback?code=abc&state=one', headers: { cookie: 'vaultr_oauth_state=two' } },
      { config }
    );
    expect(mismatched.status).toBe(400);
    expect(JSON.parse(mismatched.body ?? '{}')).toEqual({ error: 'invalid_state' });
  });

  it('creates a session from a successful mocked Discord callback', async () => {
    const userId = 'web-oauth-user';
    clearUser(userId);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'discord-access-token', token_type: 'Bearer' }), { status: 200 });
      }
      if (value.includes('/users/@me')) {
        return new Response(
          JSON.stringify({ id: userId, username: 'collector', global_name: 'Collector', avatar: 'avatar-hash' }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const response = await handleWebRequest(
      {
        method: 'GET',
        url: '/auth/discord/callback?code=abc&state=state-1',
        headers: { cookie: 'vaultr_oauth_state=state-1' }
      },
      { config, fetchImpl, now: () => new Date('2026-08-20T12:00:00.000Z') }
    );

    const token = cookieValue(response.headers, 'vaultr_session');
    expect(response.status).toBe(302);
    expect(response.headers?.Location).toBe('/app');
    expect(token).toBeTruthy();
    expect(getWebSessionByTokenHash(hashWebSessionToken(decodeURIComponent(token!)))?.userId).toBe(userId);

    const me = await handleWebRequest({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie(decodeURIComponent(token!)) } }, { config });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body ?? '{}').user).toMatchObject({ id: userId, username: 'collector', globalName: 'Collector' });

    clearUser(userId);
  });

  it('does not create a session when Discord token or profile fetch fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 502 })) as typeof fetch;
    const response = await handleWebRequest(
      {
        method: 'GET',
        url: '/auth/discord/callback?code=abc&state=state-1',
        headers: { cookie: 'vaultr_oauth_state=state-1' }
      },
      { config, fetchImpl }
    );

    expect(response.status).toBe(502);
    expect(cookieValue(response.headers, 'vaultr_session')).toBeUndefined();
  });

  it('returns unauthorized for missing sessions and revokes active sessions on logout', async () => {
    const userId = 'web-logout-user';
    clearUser(userId);
    const { token } = createWebSession({ userId }, { token: 'logout-token' });

    const missing = await handleWebRequest({ method: 'GET', url: '/api/me' }, { config });
    expect(missing.status).toBe(401);

    const logout = await handleWebRequest({ method: 'POST', url: '/auth/logout', headers: { cookie: sessionCookie(token) } }, { config });
    expect(logout.status).toBe(200);
    expect(resolveWebSession(token)).toBeNull();

    const secondLogout = await handleWebRequest({ method: 'POST', url: '/auth/logout' }, { config });
    expect(secondLogout.status).toBe(200);

    clearUser(userId);
  });
});

describe('authenticated alert API', () => {
  it('requires authentication for alert history', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/api/alerts' }, { config });
    expect(response.status).toBe(401);
  });

  it('returns only the authenticated user alerts and excludes payload data', async () => {
    const userId = 'web-alert-user';
    const otherUserId = 'web-alert-other';
    clearUser(userId);
    clearUser(otherUserId);
    seedAlert(userId, 1, { listingImageUrl: 'https://example.test/alert-image.jpg' });
    seedAlert(otherUserId, 2);
    const { token } = createWebSession({ userId }, { token: 'alert-user-token' });

    const response = await handleWebRequest({ method: 'GET', url: '/api/alerts', headers: { cookie: sessionCookie(token) } }, { config });
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      chaseName: 'Mew 1',
      listingTitle: 'Mew listing 1',
      imageUrl: 'https://example.test/alert-image.jpg'
    });
    expect(body.items[0]).not.toHaveProperty('payload');
    expect(body.nextCursor).toBeNull();

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('maps priority, source, chaseId, limit, and cursor query parameters', async () => {
    const userId = 'web-alert-filter-user';
    clearUser(userId);
    seedAlert(userId, 1, { chaseId: 'target-chase', chasePriority: 'HIGH', source: 'SHOPIFY' });
    seedAlert(userId, 2, { chaseId: 'other-chase', chasePriority: 'NORMAL', source: 'EBAY' });
    seedAlert(userId, 3, { chaseId: 'target-chase', chasePriority: 'HIGH', source: 'SHOPIFY' });
    const { token } = createWebSession({ userId }, { token: 'filter-token' });

    const first = await handleWebRequest(
      {
        method: 'GET',
        url: '/api/alerts?priority=HIGH&source=SHOPIFY&chaseId=target-chase&limit=1',
        headers: { cookie: sessionCookie(token) }
      },
      { config }
    );
    const firstBody = JSON.parse(first.body ?? '{}');
    expect(first.status).toBe(200);
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toBeTruthy();
    expect(decodeAlertCursor(firstBody.nextCursor)).toMatchObject({
      createdAt: firstBody.items[0].createdAt,
      id: firstBody.items[0].id
    });

    const second = await handleWebRequest(
      {
        method: 'GET',
        url: `/api/alerts?priority=HIGH&source=SHOPIFY&chaseId=target-chase&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
        headers: { cookie: sessionCookie(token) }
      },
      { config }
    );
    expect(JSON.parse(second.body ?? '{}').items).toHaveLength(1);

    clearUser(userId);
  });

  it('returns 400 for invalid alert query values', async () => {
    const userId = 'web-alert-invalid-user';
    clearUser(userId);
    const { token } = createWebSession({ userId }, { token: 'invalid-query-token' });

    const invalidLimit = await handleWebRequest({ method: 'GET', url: '/api/alerts?limit=nope', headers: { cookie: sessionCookie(token) } }, { config });
    const invalidCursor = await handleWebRequest({ method: 'GET', url: '/api/alerts?cursor=nope', headers: { cookie: sessionCookie(token) } }, { config });
    const invalidPriority = await handleWebRequest({ method: 'GET', url: '/api/alerts?priority=LOW', headers: { cookie: sessionCookie(token) } }, { config });
    const invalidSource = await handleWebRequest({ method: 'GET', url: '/api/alerts?source=MOCK', headers: { cookie: sessionCookie(token) } }, { config });

    expect(JSON.parse(invalidLimit.body ?? '{}')).toEqual({ error: 'invalid_limit' });
    expect(JSON.parse(invalidCursor.body ?? '{}')).toEqual({ error: 'invalid_cursor' });
    expect(JSON.parse(invalidPriority.body ?? '{}')).toEqual({ error: 'invalid_priority' });
    expect(JSON.parse(invalidSource.body ?? '{}')).toEqual({ error: 'invalid_source' });

    clearUser(userId);
  });

  it('returns owned alert details and 404 for another user alert ID', async () => {
    const userId = 'web-alert-detail-user';
    const otherUserId = 'web-alert-detail-other';
    clearUser(userId);
    clearUser(otherUserId);
    const owned = seedAlert(userId, 1);
    const other = seedAlert(otherUserId, 2);
    const { token } = createWebSession({ userId }, { token: 'detail-token' });

    const ownedResponse = await handleWebRequest({ method: 'GET', url: `/api/alerts/${owned.alertId}`, headers: { cookie: sessionCookie(token) } }, { config });
    expect(ownedResponse.status).toBe(200);
    expect(JSON.parse(ownedResponse.body ?? '{}').item).toMatchObject({ id: owned.alertId, listingTitle: 'Mew listing 1' });
    expect(JSON.parse(ownedResponse.body ?? '{}').item).not.toHaveProperty('payload');

    const otherResponse = await handleWebRequest({ method: 'GET', url: `/api/alerts/${other.alertId}`, headers: { cookie: sessionCookie(token) } }, { config });
    expect(otherResponse.status).toBe(404);
    expect(JSON.parse(otherResponse.body ?? '{}')).toEqual({ error: 'not_found' });

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('returns a clean 400 for malformed percent-encoded alert IDs', async () => {
    const userId = 'web-alert-malformed-user';
    clearUser(userId);
    const { token } = createWebSession({ userId }, { token: 'malformed-token' });

    const response = await handleWebRequest({ method: 'GET', url: '/api/alerts/%E0%A4%A', headers: { cookie: sessionCookie(token) } }, { config });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body ?? '{}')).toEqual({ error: 'invalid_alert_id' });

    clearUser(userId);
  });
});
