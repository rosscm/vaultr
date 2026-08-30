import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import {
  getUserAlertSettings,
  getAlertEventForUser,
  listAlertEventsForUser,
  type ListAlertEventsForUserOptions
} from './services/chase-store.js';
import { autocompleteChaseCardsWithStatus } from './services/chase-card-catalog.js';
import { customExclusionTerms } from './services/chase-exclusions.js';
import {
  addUserChase,
  getVaultChases,
  resolveUserChaseRemoval,
  updateUserChase,
  type ChaseServiceError
} from './services/chase-service.js';
import {
  CONDITION_CHOICES,
  GRADE_VALUE_CHOICES,
  GRADING_TYPE_CHOICES,
  LISTING_TYPE_CHOICES,
  PRIORITY_CHOICES
} from './services/chase-options.js';
import {
  getLatestAvailableScheduledDiscoveryDrop,
  getScheduledDiscoveryDrop,
  scheduledDiscoveryPeriodKey,
  type ScheduledDiscoveryDrop,
  type ScheduledDiscoveryDropItem
} from './services/scheduled-discovery-drops.js';
import { weeklyPreparationTargetDate } from './services/discovery-drop-scheduler.js';
import {
  createWebSession,
  resolveWebSession,
  revokeWebSession,
  type WebSession
} from './services/web-sessions.js';
import {
  discordAvatarUrl,
  getIdentityForUser,
  getUserById,
  resolveOrCreateDiscordUser
} from './services/accounts.js';
import type { AlertHistoryCursor, AlertHistoryItem, ListingSource } from './types.js';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL = 'https://discord.com/api/users/@me';
const OAUTH_STATE_COOKIE = 'vaultr_oauth_state';
const SESSION_COOKIE = 'vaultr_session';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_TTL_DAYS = 30;
const WEB_ASSET_ROOT = path.resolve('web');
const MAX_JSON_BODY_BYTES = 32 * 1024;
const WEB_ASSETS: Record<string, { file: string; contentType: string }> = {
  '/app': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }
};

type FetchLike = typeof fetch;

export type WebConfig = {
  discordClientId: string;
  discordClientSecret: string;
  baseUrl: string;
  postLoginRedirectPath?: string;
};

export type WebRequest = {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
};

export type WebResponse = {
  status: number;
  headers?: Record<string, string | string[]>;
  body?: string;
};

type DiscordTokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
};

type DiscordUserResponse = {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
};

type DiscordOAuthProfile = {
  discordUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
};

type WebHandlerOptions = {
  config: WebConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
};

function isProductionSecure(config: WebConfig): boolean {
  return config.baseUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
}

function baseOrigin(config: WebConfig): string {
  return config.baseUrl.replace(/\/+$/, '');
}

function oauthCallbackUrl(config: WebConfig): string {
  return `${baseOrigin(config)}/auth/discord/callback`;
}

function cookieHeaderParts(name: string, value: string, options: { maxAgeSeconds?: number; secure: boolean }): string {
  const encodedValue = encodeURIComponent(value);
  const parts = [`${name}=${encodedValue}`, 'HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader(name: string, secure: boolean): string {
  return cookieHeaderParts(name, '', { maxAgeSeconds: 0, secure });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join('=') ?? '');
    } catch {
      cookies[rawName] = '';
    }
  }
  return cookies;
}

function getHeader(headers: WebRequest['headers'], name: string): string | undefined {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(found) ? found.join('; ') : found;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string | string[]> = {}): WebResponse {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function redirectResponse(location: string, headers: Record<string, string | string[]> = {}): WebResponse {
  return {
    status: 302,
    headers: {
      Location: location,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...headers
    }
  };
}

function errorResponse(status: number, error: string, headers: Record<string, string | string[]> = {}): WebResponse {
  return jsonResponse(status, { error }, headers);
}

function chaseErrorResponse(error: ChaseServiceError): WebResponse {
  const statusByCode: Record<ChaseServiceError['code'], number> = {
    INVALID_INPUT: 400,
    INVALID_GRADE_PREFERENCE: 400,
    TOO_MANY_CUSTOM_EXCLUSIONS: 400,
    NO_CHANGES_REQUESTED: 400,
    NO_APPLICABLE_CHANGES: 422,
    CHASE_NOT_FOUND: 404,
    DUPLICATE_CHASE: 409,
    VAULT_LIMIT_REACHED: 409
  };
  return jsonResponse(statusByCode[error.code] ?? 400, {
    error: error.code,
    field: error.field,
    message: error.message,
    blockedControls: error.blockedControls,
    maxChases: error.maxChases,
    activeTier: error.activeTier
  });
}

function requireJsonBody(request: WebRequest): { ok: true; body: Record<string, unknown> } | WebResponse {
  const contentType = getHeader(request.headers, 'content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) return errorResponse(415, 'unsupported_media_type');
  const raw = request.body ?? '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BODY_BYTES) return errorResponse(413, 'payload_too_large');
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse(400, 'invalid_json');
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return errorResponse(400, 'invalid_json');
  }
}

function publicChase(chase: ReturnType<typeof getVaultChases>['chases'][number]['chase']) {
  return {
    id: chase.id,
    cardName: chase.cardName,
    cardImageUrl: chase.cardImageUrl,
    priority: chase.priority,
    targetNote: chase.targetNote,
    maxPrice: chase.maxPrice,
    grade: chase.grade,
    condition: chase.condition,
    listingType: chase.listingType,
    negativeKeywords: customExclusionTerms(chase.negativeKeywords),
    createdAt: chase.createdAt
  };
}

function publicCompletedChase(chase: ReturnType<typeof getVaultChases>['completedChases'][number]) {
  return {
    ...publicChase(chase),
    completedAt: chase.completedAt
  };
}

function publicVaultItem(view: ReturnType<typeof getVaultChases>['chases'][number]) {
  return {
    chase: publicChase(view.chase),
    monitoringState: view.monitoringState
  };
}

function vaultOptions() {
  return {
    gradingTypes: GRADING_TYPE_CHOICES,
    gradeValues: GRADE_VALUE_CHOICES,
    conditions: CONDITION_CHOICES,
    listingTypes: LISTING_TYPE_CHOICES,
    priorities: PRIORITY_CHOICES
  };
}

function vaultResponse(userId: string): WebResponse {
  const vault = getVaultChases(userId);
  const settings = getUserAlertSettings(userId);
  return jsonResponse(200, {
    items: vault.chases.map(publicVaultItem),
    completedItems: vault.completedChases.map(publicCompletedChase),
    plan: vault.plan,
    currency: settings.alertCurrency,
    options: vaultOptions()
  });
}

function validDashboardShelf(drop: ScheduledDiscoveryDrop | null): drop is ScheduledDiscoveryDrop {
  return !!drop && (drop.status === 'READY' || drop.status === 'PARTIAL') && drop.itemCount > 0;
}

function weeklyShelfRoleLabel(role: ScheduledDiscoveryDropItem['suggestion']['discoveryRole']): string | undefined {
  if (role === 'CORE_MATCH') return 'Right up your alley';
  if (role === 'ADJACENT_DISCOVERY') return 'Worth exploring';
  if (role === 'CONTROLLED_EXPLORATION') return 'Something different';
  return undefined;
}

function safeShelfReason(item: ScheduledDiscoveryDropItem): string | undefined {
  const reason = item.suggestion.why?.trim();
  if (!reason) return undefined;
  if (/\b(score|rank|vector|confidence|debug|feature tag|affinity)\b/i.test(reason)) return undefined;
  return reason;
}

function publicShelfItem(item: ScheduledDiscoveryDropItem) {
  const reference = item.suggestion.canonicalReference;
  const marketReady = item.market.status === 'READY';
  return {
    position: item.position,
    name: item.suggestion.name,
    imageUrl: item.imageSourceKind === 'CARD_REFERENCE' ? item.imageUrl : undefined,
    setName: reference?.setName,
    language: reference?.language,
    roleLabel: weeklyShelfRoleLabel(item.suggestion.discoveryRole),
    lane: item.suggestion.lane,
    reason: safeShelfReason(item),
    market: marketReady
      ? {
          status: item.market.status,
          currency: item.market.currency,
          askingTotal: item.market.askingTotal,
          askingSampleSize: item.market.askingSampleSize,
          soldTotal: item.market.soldTotal,
          soldSampleSize: item.market.soldSampleSize,
          updatedAt: item.market.updatedAt
        }
      : { status: item.market.status, currency: item.market.currency }
  };
}

function shelfResponse(userId: string, now = new Date()): WebResponse {
  const targetDate = weeklyPreparationTargetDate(now);
  const targetPeriod = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', targetDate);
  const targetDrop = getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', targetPeriod);
  const drop = validDashboardShelf(targetDrop)
    ? targetDrop
    : getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', now.toISOString());

  if (!validDashboardShelf(drop)) {
    return jsonResponse(200, {
      status: 'UPCOMING',
      periodKey: targetPeriod,
      title: 'Weekly Shelf',
      items: []
    });
  }

  return jsonResponse(200, {
    status: drop.status,
    periodKey: drop.periodKey,
    title: drop.title,
    summary: drop.summary,
    availableAt: drop.availableAt,
    updatedAt: drop.updatedAt,
    itemCount: drop.itemCount,
    marketReadyCount: drop.marketReadyCount,
    imageReadyCount: drop.imageReadyCount,
    currency: drop.currency,
    items: drop.items.map(publicShelfItem)
  });
}

function chasePayload(body: Record<string, unknown>) {
  return {
    cardName: body.cardName,
    maxPrice: body.maxPrice,
    gradingType: body.gradingType,
    gradeValue: body.gradeValue,
    condition: body.condition,
    listingType: body.listingType,
    priority: body.priority,
    targetNote: body.targetNote,
    customExclusions: body.customExclusions
  };
}

function staticResponse(pathname: string): WebResponse | null {
  if (pathname.includes('..')) return errorResponse(404, 'not_found');
  const asset = WEB_ASSETS[pathname];
  if (!asset) return null;
  const filePath = path.resolve(WEB_ASSET_ROOT, asset.file);
  if (!filePath.startsWith(`${WEB_ASSET_ROOT}${path.sep}`)) return errorResponse(404, 'not_found');
  try {
    return {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin'
      },
      body: fs.readFileSync(filePath, 'utf8')
    };
  } catch {
    return errorResponse(404, 'not_found');
  }
}

function encodeCursor(cursor: AlertHistoryCursor | undefined): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeAlertCursor(raw: string): AlertHistoryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<AlertHistoryCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function publicAlertItem(item: AlertHistoryItem): AlertHistoryItem {
  return { ...item };
}

function parseAlertListOptions(url: URL): { options: ListAlertEventsForUserOptions } | { error: string } {
  const options: ListAlertEventsForUserOptions = {};
  const limit = url.searchParams.get('limit');
  if (limit !== null) {
    if (!/^\d+$/.test(limit)) return { error: 'invalid_limit' };
    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) return { error: 'invalid_limit' };
    options.limit = parsed;
  }

  const cursor = url.searchParams.get('cursor');
  if (cursor !== null) {
    const decoded = decodeAlertCursor(cursor);
    if (!decoded) return { error: 'invalid_cursor' };
    options.cursor = decoded;
  }

  const chaseId = url.searchParams.get('chaseId');
  if (chaseId) options.chaseId = chaseId;

  const priority = url.searchParams.get('priority');
  if (priority !== null) {
    if (!['GRAIL', 'HIGH', 'NORMAL'].includes(priority)) return { error: 'invalid_priority' };
    options.chasePriority = priority as ListAlertEventsForUserOptions['chasePriority'];
  }

  const source = url.searchParams.get('source');
  if (source !== null) {
    if (!['EBAY', 'SHOPIFY'].includes(source)) return { error: 'invalid_source' };
    options.source = source as ListingSource;
  }

  return { options };
}

async function exchangeDiscordCode(code: string, options: WebHandlerOptions): Promise<string | null> {
  const response = await (options.fetchImpl ?? fetch)(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.config.discordClientId,
      client_secret: options.config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthCallbackUrl(options.config)
    })
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as DiscordTokenResponse;
  return typeof payload.access_token === 'string' ? payload.access_token : null;
}

async function fetchDiscordUser(accessToken: string, options: WebHandlerOptions): Promise<DiscordOAuthProfile | null> {
  const response = await (options.fetchImpl ?? fetch)(DISCORD_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as DiscordUserResponse;
  if (typeof payload.id !== 'string' || !payload.id) return null;
  return {
    discordUserId: payload.id,
    username: typeof payload.username === 'string' ? payload.username : undefined,
    displayName: typeof payload.global_name === 'string' ? payload.global_name : undefined,
    avatarUrl: discordAvatarUrl(payload.id, typeof payload.avatar === 'string' ? payload.avatar : undefined)
  };
}

function authenticatedSession(request: WebRequest, options: WebHandlerOptions): WebSession | null {
  const cookies = parseCookies(getHeader(request.headers, 'cookie'));
  return resolveWebSession(cookies[SESSION_COOKIE], options.now?.() ?? new Date());
}

export async function handleWebRequest(request: WebRequest, options: WebHandlerOptions): Promise<WebResponse> {
  const url = new URL(request.url, baseOrigin(options.config));
  const secureCookies = isProductionSecure(options.config);
  const method = request.method.toUpperCase();

  if (method === 'GET' && url.pathname === '/') {
    return redirectResponse('/app');
  }

  if (method === 'GET') {
    const asset = staticResponse(url.pathname);
    if (asset) return asset;
  }

  if (method === 'GET' && url.pathname === '/auth/discord') {
    const state = randomBytes(32).toString('base64url');
    const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('client_id', options.config.discordClientId);
    authorizeUrl.searchParams.set('redirect_uri', oauthCallbackUrl(options.config));
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    return redirectResponse(authorizeUrl.toString(), {
      'Set-Cookie': cookieHeaderParts(OAUTH_STATE_COOKIE, state, {
        maxAgeSeconds: OAUTH_STATE_MAX_AGE_SECONDS,
        secure: secureCookies
      })
    });
  }

  if (method === 'GET' && url.pathname === '/auth/discord/callback') {
    const clearStateCookie = clearCookieHeader(OAUTH_STATE_COOKIE, secureCookies);
    if (url.searchParams.has('error')) {
      return errorResponse(400, 'oauth_denied', { 'Set-Cookie': clearStateCookie });
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(getHeader(request.headers, 'cookie'));
    const expectedState = cookies[OAUTH_STATE_COOKIE];
    if (!code) return errorResponse(400, 'missing_code', { 'Set-Cookie': clearStateCookie });
    if (!state || !expectedState) return errorResponse(400, 'invalid_state', { 'Set-Cookie': clearStateCookie });
    if (state !== expectedState) return errorResponse(400, 'invalid_state', { 'Set-Cookie': clearStateCookie });

    try {
      const accessToken = await exchangeDiscordCode(code, options);
      if (!accessToken) return errorResponse(502, 'discord_oauth_failed', { 'Set-Cookie': clearStateCookie });
      const profile = await fetchDiscordUser(accessToken, options);
      if (!profile) return errorResponse(502, 'discord_profile_failed', { 'Set-Cookie': clearStateCookie });
      const user = resolveOrCreateDiscordUser(profile);
      const { token } = createWebSession({ userId: user.id }, { now: options.now?.() ?? new Date(), ttlDays: SESSION_TTL_DAYS });
      const sessionCookie = cookieHeaderParts(SESSION_COOKIE, token, {
        maxAgeSeconds: SESSION_TTL_DAYS * 24 * 60 * 60,
        secure: secureCookies
      });
      return redirectResponse(options.config.postLoginRedirectPath ?? '/app', {
        'Set-Cookie': [clearStateCookie, sessionCookie]
      });
    } catch (error) {
      options.logger?.error('[web] Discord OAuth callback failed', error);
      return errorResponse(502, 'discord_oauth_failed', { 'Set-Cookie': clearStateCookie });
    }
  }

  if (method === 'POST' && url.pathname === '/auth/logout') {
    const cookies = parseCookies(getHeader(request.headers, 'cookie'));
    revokeWebSession(cookies[SESSION_COOKIE]);
    return jsonResponse(
      200,
      { ok: true },
      { 'Set-Cookie': clearCookieHeader(SESSION_COOKIE, secureCookies) }
    );
  }

  if (method === 'GET' && url.pathname === '/api/me') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    const user = getUserById(session.userId);
    const discord = getIdentityForUser(session.userId, 'DISCORD');
    return jsonResponse(200, {
      user: {
        id: session.userId,
        displayName: user?.displayName ?? discord?.displayName ?? discord?.username,
        avatarUrl: user?.avatarUrl ?? discord?.avatarUrl
      },
      identities: {
        discord: discord
          ? {
              connected: true,
              username: discord.username,
              displayName: discord.displayName,
              avatarUrl: discord.avatarUrl
            }
          : { connected: false }
      }
    });
  }

  if (method === 'GET' && url.pathname === '/api/alerts') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    const parsedOptions = parseAlertListOptions(url);
    if ('error' in parsedOptions) return errorResponse(400, parsedOptions.error);
    const page = listAlertEventsForUser(session.userId, parsedOptions.options);
    return jsonResponse(200, {
      items: page.items.map(publicAlertItem),
      nextCursor: encodeCursor(page.nextCursor)
    });
  }

  if (method === 'GET' && url.pathname === '/api/shelf') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    return shelfResponse(session.userId, options.now?.() ?? new Date());
  }

  const alertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)$/);
  if (method === 'GET' && alertMatch) {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    let alertId: string;
    try {
      alertId = decodeURIComponent(alertMatch[1]);
    } catch {
      return errorResponse(400, 'invalid_alert_id');
    }
    const alert = getAlertEventForUser(session.userId, alertId);
    if (!alert) return errorResponse(404, 'not_found');
    return jsonResponse(200, { item: publicAlertItem(alert) });
  }

  if (url.pathname === '/api/chases' || url.pathname.startsWith('/api/chases/')) {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');

    if (method === 'GET' && url.pathname === '/api/chases') {
      return vaultResponse(session.userId);
    }

    if (method === 'GET' && url.pathname === '/api/chases/autocomplete') {
      const query = url.searchParams.get('q') ?? '';
      if (query.length > 100) return errorResponse(400, 'invalid_query');
      const result = await autocompleteChaseCardsWithStatus(query, 25);
      return jsonResponse(200, {
        items: result.choices.slice(0, 25),
        unavailable: result.unavailable,
        stale: result.stale
      });
    }

    if (method === 'POST' && url.pathname === '/api/chases') {
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;
      const result = addUserChase({ userId: session.userId, ...chasePayload(parsed.body) } as Parameters<typeof addUserChase>[0]);
      if (!result.ok) return chaseErrorResponse(result);
      return jsonResponse(201, {
        item: publicVaultItem({ chase: result.chase, monitoringState: 'ACTIVE' }),
        blockedControls: result.blockedControls,
        isFirstChase: result.isFirstChase
      });
    }

    const chaseMatch = url.pathname.match(/^\/api\/chases\/([^/]+)$/);
    if (chaseMatch && (method === 'PATCH' || method === 'DELETE')) {
      let chaseId: string;
      try {
        chaseId = decodeURIComponent(chaseMatch[1]);
      } catch {
        return errorResponse(400, 'invalid_chase_id');
      }
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;

      if (method === 'PATCH') {
        const result = updateUserChase({
          userId: session.userId,
          chaseId,
          changes: chasePayload(parsed.body) as Parameters<typeof updateUserChase>[0]['changes']
        });
        if (!result.ok) return chaseErrorResponse(result);
        const view = getVaultChases(session.userId).chases.find((item) => item.chase.id === result.chase.id);
        return jsonResponse(200, {
          item: publicVaultItem(view ?? { chase: result.chase, monitoringState: 'ACTIVE' }),
          blockedControls: result.blockedControls
        });
      }

      const outcome = parsed.body.outcome;
      if (outcome !== 'COMPLETED' && outcome !== 'NO_LONGER_INTERESTED' && outcome !== 'ADDED_BY_MISTAKE') {
        return errorResponse(400, 'invalid_outcome');
      }
      const result = resolveUserChaseRemoval({ userId: session.userId, chaseId, outcome });
      if (!result.ok) return chaseErrorResponse(result);
      return jsonResponse(200, { ok: true, outcome });
    }
  }

  return errorResponse(404, 'not_found');
}

function toHeaderRecord(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  return headers;
}

function writeWebResponse(res: ServerResponse, response: WebResponse): void {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

export function readRequestBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload_too_large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function webConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const discordClientId = env.DISCORD_CLIENT_ID;
  const discordClientSecret = env.DISCORD_CLIENT_SECRET;
  const baseUrl = env.VAULTR_WEB_BASE_URL;
  if (!discordClientId || !discordClientSecret || !baseUrl) {
    throw new Error('Missing DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or VAULTR_WEB_BASE_URL in environment');
  }
  return {
    discordClientId,
    discordClientSecret,
    baseUrl,
    postLoginRedirectPath: env.VAULTR_WEB_POST_LOGIN_REDIRECT_PATH ?? '/app'
  };
}

export function createVaultrWebServer(options: WebHandlerOptions) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method ?? 'GET';
      const shouldReadBody = !['GET', 'HEAD'].includes(method.toUpperCase());
      const body = shouldReadBody ? await readRequestBody(req) : undefined;
      const response = await handleWebRequest(
      {
        method,
        url: req.url ?? '/',
        headers: toHeaderRecord(req.headers),
        body
      },
      options
      );
      writeWebResponse(res, response);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 413) {
        writeWebResponse(res, errorResponse(413, 'payload_too_large'));
        return;
      }
      options.logger?.error('[web] request failed', error);
      writeWebResponse(res, errorResponse(500, 'internal_error'));
    }
  });
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  const config = webConfigFromEnv();
  const port = Number(process.env.VAULTR_WEB_PORT ?? '8790');
  const host = process.env.VAULTR_WEB_HOST ?? '127.0.0.1';
  const server = createVaultrWebServer({ config, logger: console });
  server.listen(port, host, () => {
    console.log(`Vaultr web API listening on http://${host}:${port}`);
  });
}
