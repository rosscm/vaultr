import { describe, expect, it, vi } from 'vitest';
import { addChase, enqueueAlertEventDelivery, listChases, listCompletedChases, listUserTasteMemoryChases, removeAllChases, setUserPlan } from '../services/chase-store.js';
import { getIdentity, getUserById } from '../services/accounts.js';
import { db } from '../services/db.js';
import {
  createWebSession,
  getWebSessionByTokenHash,
  hashWebSessionToken,
  resolveWebSession
} from '../services/web-sessions.js';
import { clearChaseCardAutocompleteCache } from '../services/chase-card-catalog.js';
import {
  deleteScheduledDiscoveryDrop,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop
} from '../services/scheduled-discovery-drops.js';
import { decodeAlertCursor, handleWebRequest, type WebConfig } from '../web.js';

const config: WebConfig = {
  discordClientId: 'discord-client-id',
  discordClientSecret: 'discord-client-secret',
  baseUrl: 'http://127.0.0.1:8790',
  postLoginRedirectPath: '/app'
};

function clearUser(userId: string): void {
  clearChaseCardAutocompleteCache();
  removeAllChases(userId);
  db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_scheduled_drop_items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_scheduled_drops WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_identities WHERE user_id = ? OR provider_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
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

function seedWeeklyShelf(userId: string, date = new Date('2026-08-31T13:00:00.000Z')) {
  const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date);
  const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  const drop = upsertScheduledDiscoveryDrop({
    userId,
    dropType: 'WEEKLY_DISCOVERY',
    periodKey,
    status: 'READY',
    title: 'Weekly Shelf',
    summary: 'A collector shelf tuned from your Vault and recent taste signals',
    currency: 'CAD',
    availableAt,
    expiresAt,
    items: [
      {
        position: 1,
        suggestion: {
          name: 'Mew CoroCoro Promo 151',
          lane: 'Japanese promos',
          laneWhy: 'Matches your Japanese promo interest',
          why: 'Connects to the Japanese promo cards already in your Vault',
          nearby: [],
          referenceSourceCardId: 'vaultr-promo-mew-corocoro-151',
          discoveryRole: 'CORE_MATCH',
          canonicalReference: {
            provider: 'VAULTR_PROMO',
            sourceCardId: 'vaultr-promo-mew-corocoro-151',
            canonicalCardId: 'vaultr-promo-mew-corocoro-151',
            canonicalName: 'Mew CoroCoro Promo 151',
            setName: 'CoroCoro Promo',
            cardNumber: '151',
            language: 'JAPANESE',
            imageUrl: 'https://example.test/mew-reference.png',
            imageSourceKind: 'CARD_REFERENCE'
          },
          rankExplanation: {
            recommendationStrength: 'DIRECT_PROFILE',
            anchors: ['internal-score-should-not-leak']
          } as any
        },
        imageUrl: 'https://example.test/mew-reference.png',
        imageSourceName: 'VAULTR_PROMO',
        imageSourceKind: 'CARD_REFERENCE',
        market: {
          status: 'READY',
          currency: 'CAD',
          askingTotal: 185,
          askingSampleSize: 4,
          updatedAt: '2026-08-30T12:00:00.000Z'
        }
      },
      {
        position: 2,
        suggestion: {
          name: 'Marketplace Image Card',
          lane: 'E-reader era',
          laneWhy: 'Matches your e-reader interest',
          why: 'feature tag score debug',
          nearby: [],
          discoveryRole: 'CONTROLLED_EXPLORATION'
        },
        imageUrl: 'https://i.ebayimg.test/listing.jpg',
        imageSourceName: 'eBay',
        imageSourceKind: 'MARKET_LISTING',
        market: { status: 'TIMEOUT', currency: 'CAD' }
      }
    ]
  }, '2026-08-30T12:00:00.000Z');
  return drop;
}

describe('web sessions', () => {
  it('stores session tokens hashed, not raw, and resolves the Vaultr account ID', () => {
    const userId = 'web-session-user';
    clearUser(userId);

    const { token, session } = createWebSession(
      { userId },
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
    expect(jsResponse.body).toContain('COMPLETED CHASES');
    expect(jsResponse.body).toContain('completedChasesSectionMarkup');
    expect(jsResponse.body).toContain("function pageFromHash(hash = window.location.hash)");
    expect(jsResponse.body).toContain("if (value === 'vault' || value === 'alerts' || value === 'shelf') return value;");
    expect(jsResponse.body).toContain("return 'alerts';");
    expect(jsResponse.body).toContain('window.location.hash = nextPage;');
    expect(jsResponse.body).toContain("window.addEventListener('hashchange'");
    expect(jsResponse.body).toContain('await loadActivePageData();');
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
    const discordUserId = 'web-oauth-discord-user';
    clearUser(discordUserId);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'discord-access-token', token_type: 'Bearer' }), { status: 200 });
      }
      if (value.includes('/users/@me')) {
        return new Response(
          JSON.stringify({ id: discordUserId, username: 'collector', global_name: 'Collector', avatar: 'avatar-hash' }),
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
    const session = getWebSessionByTokenHash(hashWebSessionToken(decodeURIComponent(token!)));
    expect(session?.userId).toMatch(/^usr_/);
    expect(session?.userId).not.toBe(discordUserId);
    expect(getIdentity('DISCORD', discordUserId)?.userId).toBe(session?.userId);
    expect(getUserById(session!.userId)).toMatchObject({
      displayName: 'Collector',
      avatarUrl: `https://cdn.discordapp.com/avatars/${discordUserId}/avatar-hash.png?size=80`
    });

    const me = await handleWebRequest({ method: 'GET', url: '/api/me', headers: { cookie: sessionCookie(decodeURIComponent(token!)) } }, { config });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body ?? '{}')).toMatchObject({
      user: {
        id: session?.userId,
        displayName: 'Collector',
        avatarUrl: `https://cdn.discordapp.com/avatars/${discordUserId}/avatar-hash.png?size=80`
      },
      identities: {
        discord: {
          connected: true,
          username: 'collector',
          displayName: 'Collector',
          avatarUrl: `https://cdn.discordapp.com/avatars/${discordUserId}/avatar-hash.png?size=80`
        }
      }
    });

    clearUser(discordUserId);
    if (session?.userId) clearUser(session.userId);
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

describe('authenticated Weekly Shelf API', () => {
  it('requires authentication for Weekly Shelf data', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/api/shelf' }, { config });
    expect(response.status).toBe(401);
  });

  it('returns the authenticated user prepared Weekly Shelf without internal ranking fields', async () => {
    const userId = 'web-shelf-user';
    const otherUserId = 'web-shelf-other';
    clearUser(userId);
    clearUser(otherUserId);
    seedWeeklyShelf(userId);
    seedWeeklyShelf(otherUserId);
    const { token } = createWebSession({ userId }, { token: 'shelf-user-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'READY',
      title: 'Weekly Shelf',
      itemCount: 2,
      marketReadyCount: 1,
      imageReadyCount: 1
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      position: 1,
      name: 'Mew CoroCoro Promo 151',
      imageUrl: 'https://example.test/mew-reference.png',
      setName: 'CoroCoro Promo',
      language: 'JAPANESE',
      roleLabel: 'Right up your alley',
      reason: 'Connects to the Japanese promo cards already in your Vault',
      market: { status: 'READY', currency: 'CAD', askingTotal: 185 }
    });
    expect(body.items[1].imageUrl).toBeUndefined();
    expect(body.items[1].reason).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('rankExplanation');
    expect(JSON.stringify(body)).not.toContain('CORE_MATCH');
    expect(JSON.stringify(body)).not.toContain('internal-score-should-not-leak');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('returns an upcoming Weekly Shelf state when no prepared shelf exists', async () => {
    const userId = 'web-shelf-empty-user';
    clearUser(userId);
    const { token } = createWebSession({ userId }, { token: 'shelf-empty-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      status: 'UPCOMING',
      title: 'Weekly Shelf',
      items: []
    });

    clearUser(userId);
  });

  it('does not expose another account shelf', async () => {
    const userId = 'web-shelf-isolated-user';
    const otherUserId = 'web-shelf-isolated-other';
    clearUser(userId);
    clearUser(otherUserId);
    seedWeeklyShelf(otherUserId);
    const { token } = createWebSession({ userId }, { token: 'shelf-isolated-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.status).toBe('UPCOMING');
    expect(JSON.stringify(body)).not.toContain('Mew CoroCoro Promo 151');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('keeps malformed optional shelf fields usable', async () => {
    const userId = 'web-shelf-malformed-user';
    clearUser(userId);
    const date = new Date('2026-08-31T13:00:00.000Z');
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date);
    const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
    upsertScheduledDiscoveryDrop({
      userId,
      dropType: 'WEEKLY_DISCOVERY',
      periodKey,
      status: 'PARTIAL',
      title: 'Weekly Shelf',
      currency: 'USD',
      availableAt,
      expiresAt,
      items: [
        {
          position: 1,
          suggestion: { name: 'Shelf Card', lane: 'Collector Compass', laneWhy: '', why: '', nearby: [] },
          market: { status: 'MISSING', currency: 'USD' }
        }
      ]
    }, '2026-08-30T12:00:00.000Z');
    const { token } = createWebSession({ userId }, { token: 'shelf-malformed-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => date }
    );
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.status).toBe('PARTIAL');
    expect(body.items[0]).toMatchObject({ name: 'Shelf Card', market: { status: 'MISSING', currency: 'USD' } });
    expect(body.items[0].imageUrl).toBeUndefined();
    expect(body.items[0].reason).toBeUndefined();

    deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey);
    clearUser(userId);
  });
});

describe('authenticated chase API', () => {
  function auth(userId: string, token: string) {
    clearUser(userId);
    createWebSession({ userId }, { token });
    return { cookie: sessionCookie(token) };
  }

  function json(body: unknown) {
    return {
      'content-type': 'application/json',
      body: JSON.stringify(body)
    };
  }

  it('requires authentication for every chase endpoint', async () => {
    const routes = [
      { method: 'GET', url: '/api/chases' },
      { method: 'POST', url: '/api/chases', ...json({ cardName: 'Mew RC24' }) },
      { method: 'PATCH', url: '/api/chases/chase-1', ...json({ maxPrice: 10 }) },
      { method: 'DELETE', url: '/api/chases/chase-1', ...json({ outcome: 'COMPLETED' }) },
      { method: 'GET', url: '/api/chases/autocomplete?q=mew' }
    ];

    for (const route of routes) {
      const response = await handleWebRequest(route, { config });
      expect(response.status).toBe(401);
      expect(JSON.parse(response.body ?? '{}')).toEqual({ error: 'unauthorized' });
    }
  });

  it('returns only the authenticated account chases with plan metadata, currency, options, and paused state', async () => {
    const userId = 'web-chases-list-user';
    const otherUserId = 'web-chases-list-other';
    const headers = auth(userId, 'chases-list-token');
    clearUser(otherUserId);
    setUserPlan(userId, 'PRO');
    for (let index = 0; index < 4; index += 1) addChase({ userId, cardName: `Saved Card ${index}`, priority: 'HIGH', maxPrice: 50 + index });
    addChase({ userId: otherUserId, cardName: 'Other User Card' });
    setUserPlan(userId, 'FREE');

    const response = await handleWebRequest({ method: 'GET', url: '/api/chases', headers }, { config });
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(4);
    expect(body.completedItems).toEqual([]);
    expect(body.items.map((item: any) => item.chase.cardName)).not.toContain('Other User Card');
    expect(body.items.some((item: any) => item.monitoringState === 'PAUSED_PLAN_LIMIT')).toBe(true);
    expect(body.plan).toMatchObject({ tier: 'FREE', maxActiveChases: 3, activeCount: 3, pausedCount: 1 });
    expect(body.currency).toBe('USD');
    expect(body.options.gradingTypes.some((option: any) => option.value === 'PSA')).toBe(true);
    expect(body.items[0].chase).not.toHaveProperty('guildId');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('hides legacy stored default exclusions from custom-exclusion presentation', async () => {
    const userId = 'web-chases-legacy-exclusions-user';
    const headers = auth(userId, 'chases-legacy-exclusions-token');
    addChase({
      userId,
      cardName: 'Mew RC24',
      negativeKeywords: ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica', 'Korean', 'Chinese']
    });

    const response = await handleWebRequest({ method: 'GET', url: '/api/chases', headers }, { config });
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.items[0].chase.negativeKeywords).toEqual(['Korean', 'Chinese']);

    clearUser(userId);
  });

  it('creates chases for the session account only and ignores body userId and guildId', async () => {
    const userId = 'web-chases-create-user';
    const otherUserId = 'web-chases-create-other';
    const headers = auth(userId, 'chases-create-token');
    clearUser(otherUserId);
    const response = await handleWebRequest({
      method: 'POST',
      url: '/api/chases',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: otherUserId,
        guildId: 'guild-from-client',
        cardName: 'Mew RC24',
        maxPrice: 100,
        gradingType: 'PSA',
        gradeValue: '10',
        condition: 'NM_OR_BETTER',
        listingType: 'BUY_IT_NOW',
        priority: 'GRAIL',
        targetNote: 'clean',
        customExclusions: 'korean'
      })
    }, { config });
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(201);
    expect(body.item.chase).toMatchObject({ cardName: 'Mew RC24', maxPrice: 100, grade: 'PSA 10' });
    expect(listChases(userId)).toHaveLength(1);
    expect(listChases(otherUserId)).toHaveLength(0);
    expect(listChases(userId)[0].guildId).toBeUndefined();

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('maps create duplicate, limit, invalid input, invalid grade, and Free advanced controls', async () => {
    const userId = 'web-chases-create-errors';
    const headers = auth(userId, 'chases-create-errors-token');
    addChase({ userId, cardName: 'Mew RC24' });

    const duplicate = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Mew RC24' }) }, { config });
    expect(duplicate.status).toBe(409);
    expect(JSON.parse(duplicate.body ?? '{}').error).toBe('DUPLICATE_CHASE');

    const invalid = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'ab' }) }, { config });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.body ?? '{}')).toMatchObject({ error: 'INVALID_INPUT', field: 'cardName' });

    const invalidGrade = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Pichu Expedition 22/165', gradingType: 'RAW', gradeValue: '10' }) }, { config });
    expect(invalidGrade.status).toBe(400);
    expect(JSON.parse(invalidGrade.body ?? '{}').error).toBe('INVALID_GRADE_PREFERENCE');

    const freeBlocked = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Gardevoir ex 233/091', priority: 'GRAIL', customExclusions: 'korean' }) }, { config });
    expect(freeBlocked.status).toBe(201);
    expect(JSON.parse(freeBlocked.body ?? '{}').blockedControls).toEqual(['priority', 'custom exclusions']);
    expect(listChases(userId).find((chase) => chase.cardName === 'Gardevoir ex 233/091')?.priority).toBe('NORMAL');

    const third = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Third Card' }) }, { config });
    expect(third.status).toBe(201);
    const limit = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Fourth Card' }) }, { config });
    expect(limit.status).toBe(409);
    expect(JSON.parse(limit.body ?? '{}').error).toBe('VAULT_LIMIT_REACHED');

    clearUser(userId);
  });

  it('supports Pro create/edit controls, duplicate rename, cross-account 404, Free blocked edit, mixed edit, and clear semantics', async () => {
    const userId = 'web-chases-edit-user';
    const otherUserId = 'web-chases-edit-other';
    const headers = auth(userId, 'chases-edit-token');
    clearUser(otherUserId);
    setUserPlan(userId, 'PRO');
    const first = addChase({ userId, cardName: 'Mew RC24', priority: 'NORMAL', listingType: 'ANY' });
    const second = addChase({ userId, cardName: 'Pichu Expedition 22/165' });
    const other = addChase({ userId: otherUserId, cardName: 'Other Chase' });

    const update = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${first.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ maxPrice: 125, condition: 'LP_OR_BETTER', listingType: 'BUY_IT_NOW', priority: 'GRAIL', targetNote: 'binder', customExclusions: 'proxy, korean' }) }, { config });
    expect(update.status).toBe(200);
    expect(JSON.parse(update.body ?? '{}').item.chase).toMatchObject({ maxPrice: 125, condition: 'NM,LP', listingType: 'BUY_IT_NOW', priority: 'GRAIL', targetNote: 'binder', negativeKeywords: ['korean'] });

    const duplicateRename = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${first.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: second.cardName }) }, { config });
    expect(duplicateRename.status).toBe(409);

    const otherPatch = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${other.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ maxPrice: 10 }) }, { config });
    expect(otherPatch.status).toBe(404);

    const invalid = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${first.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ maxPrice: 0 }) }, { config });
    expect(invalid.status).toBe(400);

    const cleared = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${first.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ maxPrice: null, targetNote: 'none', customExclusions: 'none' }) }, { config });
    expect(cleared.status).toBe(200);
    expect(JSON.parse(cleared.body ?? '{}').item.chase.maxPrice).toBeUndefined();

    setUserPlan(userId, 'FREE');
    const blockedOnly = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${second.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ priority: 'GRAIL' }) }, { config });
    expect(blockedOnly.status).toBe(422);
    const mixed = await handleWebRequest({ method: 'PATCH', url: `/api/chases/${second.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ maxPrice: 80, priority: 'GRAIL' }) }, { config });
    expect(mixed.status).toBe(200);
    expect(JSON.parse(mixed.body ?? '{}').blockedControls).toEqual(['priority']);
    expect(JSON.parse(mixed.body ?? '{}').item.chase).toMatchObject({ maxPrice: 80, priority: 'NORMAL' });

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('requires explicit removal outcomes and preserves completion semantics', async () => {
    const userId = 'web-chases-remove-user';
    const otherUserId = 'web-chases-remove-other';
    const headers = auth(userId, 'chases-remove-token');
    clearUser(otherUserId);
    const completed = addChase({ userId, cardName: 'Mew RC24' });
    const notInterested = addChase({ userId, cardName: 'Pichu Expedition 22/165' });
    const mistake = addChase({ userId, cardName: 'Zapdos Expedition 48' });
    const other = addChase({ userId: otherUserId, cardName: 'Other Remove' });

    const invalid = await handleWebRequest({ method: 'DELETE', url: `/api/chases/${completed.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'DELETE' }) }, { config });
    expect(invalid.status).toBe(400);

    const otherDelete = await handleWebRequest({ method: 'DELETE', url: `/api/chases/${other.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'COMPLETED' }) }, { config });
    expect(otherDelete.status).toBe(404);

    for (const [chase, outcome] of [[completed, 'COMPLETED'], [notInterested, 'NO_LONGER_INTERESTED'], [mistake, 'ADDED_BY_MISTAKE']] as const) {
      const response = await handleWebRequest({ method: 'DELETE', url: `/api/chases/${chase.id}`, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ outcome }) }, { config });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body ?? '{}')).toEqual({ ok: true, outcome });
    }
    expect(listChases(userId)).toHaveLength(0);
    expect(listCompletedChases(userId).map((chase) => chase.cardName)).toEqual(['Mew RC24']);
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).toContain('Mew RC24');
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).not.toContain('Pichu Expedition 22/165');
    expect(listUserTasteMemoryChases(userId).map((chase) => chase.cardName)).not.toContain('Zapdos Expedition 48');

    const list = await handleWebRequest({ method: 'GET', url: '/api/chases', headers }, { config });
    const listBody = JSON.parse(list.body ?? '{}');
    expect(listBody.items).toEqual([]);
    expect(listBody.completedItems.map((chase: any) => chase.cardName)).toEqual(['Mew RC24']);

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('uses the existing autocomplete flow and bounds malformed queries', async () => {
    const userId = 'web-chases-autocomplete-user';
    const headers = auth(userId, 'chases-autocomplete-token');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'sv4pt5-232', name: 'Mew ex', number: '232', set: { name: 'Paldean Fates' }, images: { large: 'https://images.example/mew.png' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    const response = await handleWebRequest({ method: 'GET', url: '/api/chases/autocomplete?q=mew', headers }, { config });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({ unavailable: false, stale: false });
    expect(JSON.parse(response.body ?? '{}').items.length).toBeLessThanOrEqual(25);
    expect(globalThis.fetch).toHaveBeenCalled();

    const malformed = await handleWebRequest({ method: 'GET', url: `/api/chases/autocomplete?q=${'x'.repeat(101)}`, headers }, { config });
    expect(malformed.status).toBe(400);
    globalThis.fetch = originalFetch;
    clearUser(userId);
  });

  it('distinguishes autocomplete outage from a genuine empty result', async () => {
    const userId = 'web-chases-autocomplete-outage';
    const headers = auth(userId, 'chases-autocomplete-outage-token');
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const unavailable = await handleWebRequest({ method: 'GET', url: '/api/chases/autocomplete?q=mew', headers }, { config });
    expect(unavailable.status).toBe(200);
    expect(JSON.parse(unavailable.body ?? '{}')).toMatchObject({ items: [], unavailable: true });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('api.pokemontcg.io') ? { data: [] } : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const empty = await handleWebRequest({ method: 'GET', url: '/api/chases/autocomplete?q=zzzmew', headers }, { config });
    expect(empty.status).toBe(200);
    expect(JSON.parse(empty.body ?? '{}')).toMatchObject({ items: [], unavailable: false });

    globalThis.fetch = originalFetch;
    clearUser(userId);
  });

  it('returns autocomplete choices during partial provider failure', async () => {
    const userId = 'web-chases-autocomplete-partial';
    const headers = auth(userId, 'chases-autocomplete-partial-token');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.tcgdex.net')) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({
        data: [{ id: 'si1-1', name: 'Mew', number: '1', set: { name: 'Southern Islands' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const response = await handleWebRequest({ method: 'GET', url: '/api/chases/autocomplete?q=mew', headers }, { config });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({ unavailable: false });
    expect(JSON.parse(response.body ?? '{}').items).toContainEqual({ name: 'Mew — Southern Islands #1', value: 'Mew Southern Islands 1' });

    globalThis.fetch = originalFetch;
    clearUser(userId);
  });

  it('validates JSON bodies without affecting existing GET routes', async () => {
    const userId = 'web-chases-body-user';
    const headers = auth(userId, 'chases-body-token');

    const malformed = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: '{' }, { config });
    expect(malformed.status).toBe(400);

    const wrongType = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'text/plain' }, body: JSON.stringify({ cardName: 'Mew RC24' }) }, { config });
    expect(wrongType.status).toBe(415);

    const oversized = await handleWebRequest({ method: 'POST', url: '/api/chases', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Mew RC24', targetNote: 'x'.repeat(40_000) }) }, { config });
    expect(oversized.status).toBe(413);

    const me = await handleWebRequest({ method: 'GET', url: '/api/me', headers }, { config });
    expect(me.status).toBe(200);

    clearUser(userId);
  });
});
