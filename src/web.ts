import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import {
  getAlertEventForUser,
  listAlertEventsForUser,
  type ListAlertEventsForUserOptions
} from './services/chase-store.js';
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

  return errorResponse(404, 'not_found');
}

function toHeaderRecord(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  return headers;
}

function writeWebResponse(res: ServerResponse, response: WebResponse): void {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
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
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    handleWebRequest(
      {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: toHeaderRecord(req.headers)
      },
      options
    )
      .then((response) => writeWebResponse(res, response))
      .catch((error) => {
        options.logger?.error('[web] request failed', error);
        writeWebResponse(res, errorResponse(500, 'internal_error'));
      });
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
