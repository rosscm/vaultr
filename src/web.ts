import 'dotenv/config';
import { logBuildInfo } from './services/build-info.js';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import {
  dismissAlert,
  getUserPlan,
  getUserDiscoveryFeedback,
  getUserAlertSettings,
  getAlertEventForUser,
  listAlertEventsForUser,
  markAlertNew,
  markAlertReviewed,
  restoreAlert,
  type ListAlertEventsForUserOptions
} from './services/chase-store.js';
import { applyPreparedDiscoveryFeedback, type DiscoveryFeedbackAction } from './services/discovery-feedback.js';
import {
  autocompleteChaseCardsWithStatus,
  cacheTrustedChaseCardPreview,
  getCachedChaseCardPreview,
  normalizeChaseCardName,
  resolveTrustedChaseCardReference,
  type TrustedChaseCardPreview
} from './services/chase-card-catalog.js';
import { customExclusionTerms } from './services/chase-exclusions.js';
import {
  addUserChase,
  getVaultChases,
  reopenUserCompletedChase,
  resolveUserChaseRemoval,
  setUserChasePaused,
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
import { getEntitlementsForTier } from './services/entitlements.js';
import { activePlanTier } from './services/plans.js';
import { weeklyDiscoveryEligibilityForUser, weeklyDiscoveryExplicitPreferenceEligibilityForUser } from './services/weekly-discovery-eligibility.js';
import {
  getLatestAvailableScheduledDiscoveryDrop,
  listScheduledDiscoveryDropsForUser,
  scheduledDiscoveryPeriodKey,
  type ScheduledDiscoveryDrop,
  type ScheduledDiscoveryDropItem
} from './services/scheduled-discovery-drops.js';
import { weeklyPreparationTargetDate } from './services/discovery-drop-scheduler.js';
import { alertSettingsResponse, updateAlertSettings } from './services/alert-settings.js';
import { getOrCreateOnboardingState, transitionOnboarding, type OnboardingAction, type OnboardingStep } from './services/onboarding.js';
import { collectorPreferenceOptions, getCollectorPreferences, saveCollectorPreferences } from './services/collector-preferences.js';
import { tasteOnboardingEnabled } from './services/features.js';
import { weeklyGeneralDiscoveryForUser, weeklyGeneralDiscoveryPeriodKey } from './services/weekly-general-discovery.js';
import { APPROVED_STARTER_DISCOVERY } from './services/starter-discovery.js';
import { buildEbaySearchKeywords } from './services/ebay.js';
import { listTrustedShopifyShopNames } from './services/shopify.js';
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
import {
  createPostmarkMagicLinkTransport,
  magicLinkConfirmationState,
  parseEmailAuthEncryptionKey,
  prepareMagicLinkConfirmation,
  processPendingMagicLinkEmails,
  redeemMagicLink,
  requestMagicLink,
  type EmailAuthConfig,
  type MagicLinkEmailTransport
} from './services/email-auth.js';
import type { AlertHistoryCursor, AlertHistoryItem, ListingSource } from './types.js';
import { WEB_PREVIEW_ALERTS, WEB_PREVIEW_AUTOCOMPLETE, WEB_PREVIEW_CHASES, WEB_PREVIEW_ME, WEB_PREVIEW_ONBOARDING, WEB_PREVIEW_SETTINGS, WEB_PREVIEW_SHELF } from './web-preview-fixtures.js';

logBuildInfo('web');

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL = 'https://discord.com/api/users/@me';
const OAUTH_STATE_COOKIE = 'vaultr_oauth_state';
const SESSION_COOKIE = 'vaultr_session';
const EMAIL_CONFIRM_COOKIE = 'vaultr_email_confirm';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_TTL_DAYS = 30;
const WEB_ASSET_ROOT = path.resolve('web');
const DOCS_ASSET_ROOT = path.resolve('docs');
const MAX_JSON_BODY_BYTES = 32 * 1024;
const CARD_SELECTION_TTL_MS = 15 * 60 * 1000;
const MAX_CARD_SELECTIONS = 500;
const cardSelections = new Map<string, { expiresAt: number; userId: string; cardName: string; preview: TrustedChaseCardPreview }>();
const WEB_ASSETS: Record<string, { file: string; contentType: string }> = {
  '/app': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/vaultr-icon.svg': { file: 'assets/brand/vaultr-icon.svg', contentType: 'image/svg+xml' },
  '/vaultr-lockup-dark.svg': { file: 'assets/brand/vaultr-lockup-dark.svg', contentType: 'image/svg+xml' },
  '/onboarding-art/mew-corocoro-promo-151.webp': { file: 'assets/onboarding/mew-corocoro-promo-151.webp', contentType: 'image/webp' },
  '/onboarding-art/pichu-expedition-022.webp': { file: 'assets/onboarding/pichu-expedition-022.webp', contentType: 'image/webp' },
  '/onboarding-art/sylveon-ex-212.webp': { file: 'assets/onboarding/sylveon-ex-212.webp', contentType: 'image/webp' },
  '/fonts/roboto-latin-variable.woff2': { file: 'fonts/roboto-latin-variable.woff2', contentType: 'font/woff2' }
};
const LEGAL_ASSETS: Record<string, { file: string; contentType: string }> = {
  '/privacy': { file: 'privacy.html', contentType: 'text/html; charset=utf-8' },
  '/privacy/': { file: 'privacy.html', contentType: 'text/html; charset=utf-8' },
  '/terms': { file: 'terms.html', contentType: 'text/html; charset=utf-8' },
  '/terms/': { file: 'terms.html', contentType: 'text/html; charset=utf-8' },
  '/legal.css': { file: 'styles.css', contentType: 'text/css; charset=utf-8' },
  '/legal-favicon.svg': { file: 'assets/favicon.svg', contentType: 'image/svg+xml' }
};

type FetchLike = typeof fetch;

export type WebConfig = {
  discordClientId?: string;
  discordClientSecret?: string;
  baseUrl: string;
  postLoginRedirectPath?: string;
  previewEnabled?: boolean;
  environmentLabel?: string;
  cookieNamespace?: string;
  emailAuth?: {
    postmarkServerToken: string;
    fromEmail: string;
    encryptionKey: Buffer;
  };
};

function cookieNames(config: WebConfig): { oauthState: string; session: string; emailConfirm: string } {
  const namespace = config.cookieNamespace?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!namespace) return { oauthState: OAUTH_STATE_COOKIE, session: SESSION_COOKIE, emailConfirm: EMAIL_CONFIRM_COOKIE };
  return {
    oauthState: `vaultr_${namespace}_oauth_state`,
    session: `vaultr_${namespace}_session`,
    emailConfirm: `vaultr_${namespace}_email_confirm`
  };
}

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
  bodyEncoding?: BufferEncoding;
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
  emailTransport?: MagicLinkEmailTransport;
};

function configuredEmailAuth(options: WebHandlerOptions): EmailAuthConfig | null {
  const email = options.config.emailAuth;
  if (!email) return null;
  return {
    baseUrl: baseOrigin(options.config),
    encryptionKey: email.encryptionKey,
    transport: options.emailTransport ?? createPostmarkMagicLinkTransport({
      serverToken: email.postmarkServerToken,
      fromEmail: email.fromEmail,
      fetchImpl: options.fetchImpl
    })
  };
}

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

function requestIpAddress(request: WebRequest): string {
  return getHeader(request.headers, 'cf-connecting-ip')?.trim()
    || getHeader(request.headers, 'x-vaultr-remote-address')?.trim()
    || 'unknown';
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
    cardIdentity: chase.cardImageSourceKind === 'CARD_REFERENCE' && chase.cardImageIdentity && chase.cardImageSourceName && chase.cardImageSourceCardId
      ? {
          value: chase.cardImageIdentity,
          matchKey: normalizedCardIdentity(normalizeChaseCardName(chase.cardName)),
          sourceName: chase.cardImageSourceName,
          sourceCardId: chase.cardImageSourceCardId
        }
      : undefined,
    priority: chase.priority,
    targetNote: chase.targetNote,
    maxPrice: chase.maxPrice,
    grade: chase.grade,
    condition: chase.condition,
    listingType: chase.listingType,
    negativeKeywords: customExclusionTerms(chase.negativeKeywords),
    pausedAt: chase.pausedAt,
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
  const plans = (['FREE', 'PRO'] as const).map((tier) => {
    const entitlements = getEntitlementsForTier(tier);
    return {
      tier,
      label: tier === 'PRO' ? 'Vaultr Plus' : 'Free',
      maxActiveChases: entitlements.maxActiveChases,
      checkIntervalMinutes: Math.round(entitlements.pollIntervalSeconds / 60),
      monitoringPriority: entitlements.monitoringPriority,
      advancedFiltering: entitlements.advancedFiltering,
      storefrontMonitoring: entitlements.storefrontMonitoring,
      discoveryDepth: entitlements.discoveryDepth
    };
  });
  return {
    gradingTypes: GRADING_TYPE_CHOICES,
    gradeValues: GRADE_VALUE_CHOICES,
    conditions: CONDITION_CHOICES,
    listingTypes: LISTING_TYPE_CHOICES,
    priorities: PRIORITY_CHOICES,
    plans,
    supportedShopNames: listTrustedShopifyShopNames(),
    billing: { selfServiceAvailable: false }
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

function weeklyShelfRoleLabel(role: ScheduledDiscoveryDropItem['suggestion']['discoveryRole'], lane?: string): string {
  if (role === 'CORE_MATCH') return 'Right up your alley';
  if (role === 'ADJACENT_DISCOVERY') return 'Worth exploring';
  if (role === 'CONTROLLED_EXPLORATION') return 'Something different';
  const normalizedLane = lane?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalizedLane === 'source-backed matches') return 'Right up your alley';
  if (normalizedLane === 'adjacent collector source match' || normalizedLane === 'multi-card discovery') return 'Worth exploring';
  return 'Something different';
}

function shelfSignalLabel(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/\s+/g, ' ');
  const mapped: Record<string, string> = {
    'multi-card discovery': 'Collector Thread',
    'adjacent collector source match': 'Collector Trail',
    'language-wide discovery': 'Language Trail',
    'source-backed matches': 'Collector Match',
    'release-family discovery': 'Release Trail'
  };
  if (mapped[normalized]) return mapped[normalized];
  if (/\btrail\b|\bcompass\b|\bmatch\b/i.test(value) && !/\b(discovery|source-backed|language-wide|adjacent)\b/i.test(value)) return value;
  return undefined;
}

function safeShelfReason(item: ScheduledDiscoveryDropItem): string | undefined {
  const reason = item.suggestion.why?.trim();
  if (!reason) return undefined;
  if (/\b(score|rank|vector|confidence|debug|feature tag|affinity)\b/i.test(reason)) return undefined;
  return reason;
}

function discoveryIdentitySearchText(item: { name: string; setName?: string; cardNumber?: string; language?: string }): string {
  const parts = [
    item.name,
    item.cardNumber,
    item.setName,
    item.language === 'Japanese' ? 'Japanese' : undefined
  ].filter((part): part is string => !!part?.trim());
  const selected: string[] = [];
  const normalizedSelected: string[] = [];
  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || normalizedSelected.some((existing) => existing === normalized || existing.includes(normalized))) continue;
    selected.push(part.trim());
    normalizedSelected.push(normalized);
  }
  return selected.join(' ');
}

function shelfEbayUrl(item: ScheduledDiscoveryDropItem, currency: ScheduledDiscoveryDrop['currency']): string {
  return discoveryEbayUrl({
    name: item.suggestion.canonicalReference?.canonicalName || item.suggestion.name,
    setName: item.suggestion.canonicalReference?.setName,
    cardNumber: item.suggestion.canonicalReference?.cardNumber,
    language: item.suggestion.canonicalReference?.language === 'JAPANESE' ? 'Japanese' : undefined
  }, currency);
}

function discoveryEbayUrl(item: { name: string; setName?: string; cardNumber?: string; language?: string }, currency: ScheduledDiscoveryDrop['currency']): string {
  const host = currency === 'CAD' ? 'www.ebay.ca' : 'www.ebay.com';
  const keywords = buildEbaySearchKeywords({
    id: 'dashboard-shelf-search',
    userId: 'dashboard',
    cardName: discoveryIdentitySearchText(item),
    createdAt: new Date(0).toISOString()
  }).trim();
  const query = /\bpokemon card\b/i.test(keywords) ? keywords : `${keywords} Pokemon card`;
  return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(query)}`;
}

function usefulShelfImageUrl(item: ScheduledDiscoveryDropItem): string | undefined {
  if (item.imageSourceKind !== 'CARD_REFERENCE') return undefined;
  const imageUrl = item.imageUrl?.trim();
  if (!imageUrl) return undefined;
  if (/card[_-]?back|back(?:\.|_|-)|placeholder|default-card/i.test(imageUrl)) return undefined;
  return imageUrl;
}

function publicShelfItem(item: ScheduledDiscoveryDropItem, userId: string, periodKey: string) {
  const reference = item.suggestion.canonicalReference;
  const marketReady = item.market.status === 'READY';
  const imageUrl = usefulShelfImageUrl(item);
  const selection = imageUrl && reference?.sourceCardId
    ? issueCardSelection(userId, item.suggestion.name, {
        imageUrl,
        imageIdentity: item.suggestion.name,
        imageSourceName: reference.provider,
        imageSourceKind: 'CARD_REFERENCE',
        imageSourceCardId: reference.sourceCardId
      })
    : undefined;
  return {
    position: item.position,
    recommendation: { periodKey, position: item.position },
    feedback: getUserDiscoveryFeedback(userId, item.suggestion.name),
    name: item.suggestion.name,
    displayName: reference?.canonicalName,
    nativeName: item.suggestion.nativeName,
    imageUrl,
    setName: reference?.setName,
    language: reference?.language,
    cardNumber: reference?.cardNumber,
    cardIdentity: reference?.sourceCardId
      ? {
          value: reference.canonicalName || item.suggestion.name,
          matchKey: normalizedCardIdentity(normalizeChaseCardName(item.suggestion.name)),
          sourceName: reference.provider,
          sourceCardId: reference.sourceCardId
        }
      : undefined,
    selection,
    roleLabel: weeklyShelfRoleLabel(item.suggestion.discoveryRole, item.suggestion.lane),
    signalLabel: shelfSignalLabel(item.suggestion.lane),
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
      : { status: item.market.status, currency: item.market.currency },
    ebayUrl: shelfEbayUrl(item, item.market.currency)
  };
}

function normalizedCardIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trustedPreview(preview: ReturnType<typeof getCachedChaseCardPreview>): TrustedChaseCardPreview | undefined {
  if (!preview?.imageUrl || !preview.imageIdentity || preview.imageSourceKind !== 'CARD_REFERENCE' || !preview.imageSourceName || !preview.imageSourceCardId) return undefined;
  return preview as TrustedChaseCardPreview;
}

function issueCardSelection(userId: string, cardName: string, preview: TrustedChaseCardPreview) {
  const now = Date.now();
  for (const [token, selection] of cardSelections) {
    if (selection.expiresAt <= now) cardSelections.delete(token);
  }
  while (cardSelections.size >= MAX_CARD_SELECTIONS) {
    const oldest = cardSelections.keys().next().value;
    if (!oldest) break;
    cardSelections.delete(oldest);
  }
  const token = randomBytes(24).toString('base64url');
  cardSelections.set(token, { expiresAt: now + CARD_SELECTION_TTL_MS, userId, cardName, preview });
  return {
    token,
    value: cardName,
    imageUrl: preview.imageUrl,
    imageIdentity: preview.imageIdentity,
    sourceName: preview.imageSourceName,
    sourceCardId: preview.imageSourceCardId
  };
}

function applyCardSelection(userId: string, body: Record<string, unknown>): WebResponse | null {
  if (body.cardSelectionToken === undefined) return null;
  if (typeof body.cardSelectionToken !== 'string' || typeof body.cardName !== 'string') return errorResponse(400, 'invalid_card_selection');
  const selection = cardSelections.get(body.cardSelectionToken);
  if (!selection || selection.expiresAt <= Date.now()) {
    cardSelections.delete(body.cardSelectionToken);
    return errorResponse(400, 'invalid_card_selection');
  }
  if (selection.userId !== userId) return errorResponse(400, 'invalid_card_selection');
  if (normalizedCardIdentity(selection.cardName) !== normalizedCardIdentity(body.cardName)) return errorResponse(400, 'invalid_card_selection');
  cacheTrustedChaseCardPreview(selection.cardName, selection.preview);
  body.cardName = selection.cardName;
  return null;
}

function publicEditorialDiscoveryItems(userId: string, config: WebConfig) {
  const currency = getUserAlertSettings(userId).alertCurrency;
  const owned = getVaultChases(userId);
  const ownedChases = [...owned.chases.map((item) => item.chase), ...owned.completedChases];
  const ownedSources = new Set(ownedChases
    .filter((chase) => chase.cardImageSourceKind === 'CARD_REFERENCE' && chase.cardImageSourceName && chase.cardImageSourceCardId)
    .map((chase) => `${chase.cardImageSourceName}:${chase.cardImageSourceCardId}`));
  const ownedNames = new Set(ownedChases.flatMap((chase) => [chase.cardName, chase.cardImageIdentity].filter(Boolean).map((name) => normalizedCardIdentity(name!))));
  return APPROVED_STARTER_DISCOVERY.filter((item) =>
    !ownedSources.has(`VAULTR_EDITORIAL:${item.sourceCardId}`)
    && !ownedNames.has(normalizedCardIdentity(item.name))
  ).map((item) => ({
    name: item.name,
    displayName: item.canonicalName,
    imageUrl: item.imageUrl,
    ...('setName' in item ? { setName: item.setName } : {}),
    ...('cardNumber' in item ? { cardNumber: item.cardNumber } : {}),
    ...('language' in item ? { language: item.language } : {}),
    reason: item.reason,
    roleLabel: 'Collector pick',
    ebayUrl: discoveryEbayUrl(item, currency),
    cardIdentity: {
      value: item.name,
      matchKey: normalizedCardIdentity(normalizeChaseCardName(item.name)),
      sourceName: 'VAULTR_EDITORIAL',
      sourceCardId: item.sourceCardId
    },
    selection: issueCardSelection(userId, item.name, {
      imageUrl: `${baseOrigin(config)}${item.imageUrl}`,
      imageIdentity: item.name,
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceName: 'VAULTR_EDITORIAL',
      imageSourceCardId: item.sourceCardId
    })
  }));
}

function publicGeneralDiscovery(userId: string, config: WebConfig, now: Date) {
  const weekly = weeklyGeneralDiscoveryForUser(userId, now);
  const currency = getUserAlertSettings(userId).alertCurrency;
  const weeklyItems = weekly.items.map((item) => ({
    name: item.name,
    displayName: item.canonicalName,
    imageUrl: item.imageUrl,
    setName: item.setName,
    cardNumber: item.cardNumber,
    language: item.language,
    roleLabel: 'Weekly find',
    ebayUrl: discoveryEbayUrl(item, currency),
    cardIdentity: {
      value: item.name,
      matchKey: normalizedCardIdentity(normalizeChaseCardName(item.name)),
      sourceName: item.sourceName,
      sourceCardId: item.sourceCardId
    },
    selection: issueCardSelection(userId, item.name, {
      imageUrl: item.imageUrl,
      imageIdentity: item.name,
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceName: item.sourceName,
      imageSourceCardId: item.sourceCardId
    })
  }));
  const seen = new Set(weeklyItems.map((item) => normalizedCardIdentity(item.name)));
  const editorial = publicEditorialDiscoveryItems(userId, config);
  const fallback = editorial.filter((item) => !seen.has(normalizedCardIdentity(item.name)));
  const account = getUserById(userId);
  const starterWeek = !!account?.generalDiscoveryStartedAt
    && weeklyGeneralDiscoveryPeriodKey(new Date(account.generalDiscoveryStartedAt)) === weekly.periodKey;
  if (starterWeek) {
    const starterSeen = new Set(editorial.map((item) => normalizedCardIdentity(item.name)));
    const replacements = weeklyItems
      .filter((item) => !starterSeen.has(normalizedCardIdentity(item.name)))
      .map((item) => ({ ...item, roleLabel: 'Collector pick' }));
    return {
      periodKey: weekly.periodKey,
      status: weekly.status,
      mode: 'STARTER' as const,
      catalogItemCount: weeklyItems.length,
      items: [...editorial, ...replacements].slice(0, 3)
    };
  }
  const status = weekly.status === 'WEEKLY'
    ? weeklyItems.length >= 3 ? 'WEEKLY' : 'INSUFFICIENT'
    : weekly.status;
  return {
    periodKey: weekly.periodKey,
    status,
    mode: status === 'WEEKLY' ? 'WEEKLY' as const : 'FALLBACK' as const,
    catalogItemCount: weeklyItems.length,
    items: [...weeklyItems, ...fallback].slice(0, 3)
  };
}

function webDiscoveryState(userId: string, config: WebConfig, populated: boolean) {
  const tier = activePlanTier(getUserPlan(userId));
  const eligibility = weeklyDiscoveryEligibilityForUser(userId);
  const explicitPreferenceReady = weeklyDiscoveryExplicitPreferenceEligibilityForUser(userId);
  const preparationExpected = config.environmentLabel?.trim().toLowerCase() !== 'staging'
    && process.env.DISCOVERY_DROP_SCHEDULER_ENABLED !== 'false';
  const state = tier !== 'PRO'
    ? 'PLAN_RESTRICTED'
    : populated
      ? 'POPULATED'
      : !eligibility.eligible && !explicitPreferenceReady
        ? 'INSUFFICIENT_SIGNALS'
        : preparationExpected
          ? 'AWAITING_PREPARATION'
          : 'PREPARATION_UNAVAILABLE';
  return {
    state,
    tier,
    preparationExpected,
    minimumSignalCount: eligibility.minimumSignalCount,
    uniqueSignalCount: eligibility.uniqueSignalCount,
    signalsNeeded: eligibility.signalsNeeded,
    explicitPreferenceReady
  };
}

function shelfResponse(userId: string, config: WebConfig, now = new Date()): WebResponse {
  const targetDate = weeklyPreparationTargetDate(now);
  const targetPeriod = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', targetDate);
  const nowIso = now.toISOString();
  const allDrops = listScheduledDiscoveryDropsForUser(userId, 'WEEKLY_DISCOVERY').filter(validDashboardShelf);
  const currentDrop = allDrops
    .filter((drop) => Date.parse(drop.availableAt) <= now.getTime() && (!drop.expiresAt || Date.parse(drop.expiresAt) > now.getTime()))
    .sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt))[0];
  const latestAvailableDrop = getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', nowIso);
  const latestHistoricalDrop = allDrops
    .filter((drop) => Date.parse(drop.availableAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt))[0];
  const drop = currentDrop ?? latestAvailableDrop ?? latestHistoricalDrop;
  const shelfKind = !drop
    ? 'UPCOMING'
    : currentDrop?.periodKey === drop.periodKey
      ? 'CURRENT'
      : 'PREVIOUS';

  if (!validDashboardShelf(drop)) {
    const generalDiscovery = publicGeneralDiscovery(userId, config, now);
    return jsonResponse(200, {
      status: 'UPCOMING',
      shelfKind,
      periodKey: targetPeriod,
      title: 'Display Case',
      items: [],
      discovery: webDiscoveryState(userId, config, false),
      starterItems: generalDiscovery.items,
      generalDiscovery: { periodKey: generalDiscovery.periodKey, status: generalDiscovery.status, mode: generalDiscovery.mode, catalogItemCount: generalDiscovery.catalogItemCount }
    });
  }

  const discovery = webDiscoveryState(userId, config, true);
  const personalized = discovery.state === 'POPULATED' && discovery.tier === 'PRO';
  const generalDiscovery = personalized ? undefined : publicGeneralDiscovery(userId, config, now);
  return jsonResponse(200, {
    status: drop.status,
    shelfKind,
    periodKey: drop.periodKey,
    title: 'Display Case',
    summary: drop.summary,
    availableAt: drop.availableAt,
    updatedAt: drop.updatedAt,
    itemCount: personalized ? drop.itemCount : 0,
    marketReadyCount: personalized ? drop.marketReadyCount : 0,
    imageReadyCount: personalized ? drop.imageReadyCount : 0,
    currency: drop.currency,
    items: personalized ? drop.items.map((item) => publicShelfItem(item, userId, drop.periodKey)) : [],
    discovery,
    ...(personalized ? {} : {
      starterItems: generalDiscovery!.items,
      generalDiscovery: { periodKey: generalDiscovery!.periodKey, status: generalDiscovery!.status, mode: generalDiscovery!.mode, catalogItemCount: generalDiscovery!.catalogItemCount }
    })
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
  const asset = WEB_ASSETS[pathname] ?? LEGAL_ASSETS[pathname];
  if (!asset) return null;
  const assetRoot = LEGAL_ASSETS[pathname] ? DOCS_ASSET_ROOT : WEB_ASSET_ROOT;
  const filePath = path.resolve(assetRoot, asset.file);
  if (!filePath.startsWith(`${assetRoot}${path.sep}`)) return errorResponse(404, 'not_found');
  try {
    const isBinary = asset.contentType === 'font/woff2' || asset.contentType.startsWith('image/');
    let body = isBinary ? fs.readFileSync(filePath).toString('latin1') : fs.readFileSync(filePath, 'utf8');
    if (asset.contentType.startsWith('text/html') && LEGAL_ASSETS[pathname]) {
      body = body
        .replaceAll('./styles.css', '/legal.css')
        .replaceAll('./assets/favicon.svg', '/legal-favicon.svg')
        .replaceAll('./index.html#how-it-works', '/app#home')
        .replaceAll('./index.html#weekly-shelf', '/app#shelf')
        .replaceAll('./index.html#plans', '/app#plus')
        .replaceAll('./index.html', '/app')
        .replaceAll('./privacy.html', '/privacy')
        .replaceAll('./terms.html', '/terms');
    }
    return {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin'
      },
      body,
      bodyEncoding: isBinary ? 'latin1' : undefined
    };
  } catch {
    return errorResponse(404, 'not_found');
  }
}

function previewResponse(method: string, url: URL): WebResponse | null {
  if (!url.pathname.startsWith('/api/preview/')) return null;
  if (method !== 'GET') return errorResponse(405, 'preview_read_only', { Allow: 'GET' });
  if (url.pathname === '/api/preview/me') return jsonResponse(200, WEB_PREVIEW_ME);
  if (url.pathname === '/api/preview/auth/config') return jsonResponse(200, { email: { available: true }, discord: { available: true }, features: { tasteOnboarding: true }, preview: true });
  if (url.pathname === '/api/preview/auth/email/confirmation') return jsonResponse(200, { ready: false, preview: true });
  if (url.pathname === '/api/preview/onboarding') return jsonResponse(200, WEB_PREVIEW_ONBOARDING);
  if (url.pathname === '/api/preview/collector-profile') return jsonResponse(200, {
    preferences: { subjects: [], artwork: [], readiness: { ready: false, subjectCount: 0, artworkCount: 0, neededArtworkCount: 3 } },
    options: collectorPreferenceOptions(),
    readOnly: true
  });
  if (url.pathname === '/api/preview/settings') return jsonResponse(200, WEB_PREVIEW_SETTINGS);
  if (url.pathname === '/api/preview/chases') return jsonResponse(200, WEB_PREVIEW_CHASES);
  if (url.pathname === '/api/preview/chases/autocomplete') {
    const query = url.searchParams.get('q') ?? '';
    if (query.length > 100) return errorResponse(400, 'invalid_query');
    const normalized = query.trim().toLowerCase();
    const items = normalized.length < 2
      ? []
      : WEB_PREVIEW_AUTOCOMPLETE.filter((item) => `${item.name} ${item.value}`.toLowerCase().includes(normalized)).slice(0, 25);
    return jsonResponse(200, { items, unavailable: false, stale: false });
  }
  if (url.pathname === '/api/preview/shelf') return jsonResponse(200, WEB_PREVIEW_SHELF);
  if (url.pathname === '/api/preview/alerts') {
    const priority = url.searchParams.get('priority');
    const source = url.searchParams.get('source');
    const chaseId = url.searchParams.get('chaseId');
    const reviewState = url.searchParams.get('reviewState');
    if (priority && !['GRAIL', 'HIGH', 'NORMAL'].includes(priority)) return errorResponse(400, 'invalid_priority');
    if (source && !['EBAY', 'SHOPIFY'].includes(source)) return errorResponse(400, 'invalid_source');
    if (reviewState && !['NEW', 'REVIEWED'].includes(reviewState)) return errorResponse(400, 'invalid_review_state');
    const items = WEB_PREVIEW_ALERTS.filter((item) =>
      (!priority || item.chasePriority === priority) &&
      (!source || item.source === source) &&
      (!chaseId || item.chaseId === chaseId) &&
      (!reviewState || (reviewState === 'NEW' ? !item.reviewedAt : !!item.reviewedAt))
    );
    return jsonResponse(200, { items, nextCursor: null });
  }
  return errorResponse(404, 'not_found');
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

  const reviewState = url.searchParams.get('reviewState');
  if (reviewState !== null) {
    if (!['NEW', 'REVIEWED'].includes(reviewState)) return { error: 'invalid_review_state' };
    options.reviewState = reviewState as ListAlertEventsForUserOptions['reviewState'];
  }

  return { options };
}

async function exchangeDiscordCode(code: string, options: WebHandlerOptions): Promise<string | null> {
  const clientId = options.config.discordClientId;
  const clientSecret = options.config.discordClientSecret;
  if (!clientId || !clientSecret) return null;
  const response = await (options.fetchImpl ?? fetch)(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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
  return resolveWebSession(cookies[cookieNames(options.config).session], options.now?.() ?? new Date());
}

export async function handleWebRequest(request: WebRequest, options: WebHandlerOptions): Promise<WebResponse> {
  const url = new URL(request.url, baseOrigin(options.config));
  const secureCookies = isProductionSecure(options.config);
  const method = request.method.toUpperCase();

  if (method === 'GET' && url.pathname === '/') {
    return redirectResponse('/app');
  }

  const isPreviewPath = url.pathname === '/preview' || url.pathname === '/preview/';
  const isPreviewApi = url.pathname.startsWith('/api/preview/');
  if ((isPreviewPath || isPreviewApi) && options.config.previewEnabled !== true) {
    return errorResponse(404, 'not_found');
  }
  if (isPreviewPath) {
    if (method !== 'GET') return errorResponse(405, 'method_not_allowed', { Allow: 'GET' });
    return staticResponse('/app') ?? errorResponse(404, 'not_found');
  }
  if (isPreviewApi) {
    return previewResponse(method, url) ?? errorResponse(404, 'not_found');
  }

  if (method === 'GET') {
    const asset = staticResponse(url.pathname);
    if (asset) return asset;
  }

  if (method === 'GET' && url.pathname === '/api/auth/config') {
    return jsonResponse(200, {
      email: { available: configuredEmailAuth(options) !== null },
      discord: { available: Boolean(options.config.discordClientId && options.config.discordClientSecret) },
      ...(options.config.environmentLabel ? { environment: { label: options.config.environmentLabel } } : {}),
      features: { tasteOnboarding: tasteOnboardingEnabled() }
    });
  }

  if (method === 'POST' && url.pathname === '/auth/email/request') {
    const emailAuth = configuredEmailAuth(options);
    if (!emailAuth) return errorResponse(503, 'email_auth_unavailable');
    const parsed = requireJsonBody(request);
    if (!('ok' in parsed)) return parsed;
    if (typeof parsed.body.email !== 'string') return errorResponse(400, 'invalid_email');
    try {
      requestMagicLink({
        email: parsed.body.email,
        purpose: 'SIGN_IN',
        returnPath: parsed.body.returnPath as string | undefined,
        ipAddress: requestIpAddress(request),
        config: emailAuth,
        now: options.now?.()
      });
      await processPendingMagicLinkEmails(emailAuth, { now: options.now?.(), limit: 1 });
      return jsonResponse(202, { accepted: true });
    } catch (error) {
      if ((error as Error).message === 'invalid_email') return errorResponse(400, 'invalid_email');
      options.logger?.error('[web] email sign-in request failed');
      return jsonResponse(202, { accepted: true });
    }
  }

  if (method === 'GET' && url.pathname === '/auth/email/confirm') {
    const prepared = prepareMagicLinkConfirmation(url.searchParams.get('token') ?? '', options.now?.() ?? new Date());
    if (!prepared) return redirectResponse('/app?emailConfirm=invalid');
    return redirectResponse('/app?emailConfirm=ready', {
      'Set-Cookie': cookieHeaderParts(cookieNames(options.config).emailConfirm, prepared.nonce, {
        maxAgeSeconds: 10 * 60,
        secure: secureCookies
      }),
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
  }

  if (method === 'GET' && url.pathname === '/api/auth/email/confirmation') {
    const cookies = parseCookies(getHeader(request.headers, 'cookie'));
    const state = magicLinkConfirmationState(cookies[cookieNames(options.config).emailConfirm], options.now?.() ?? new Date());
    return state ? jsonResponse(200, { ready: true, purpose: state.purpose, email: state.email }) : jsonResponse(200, { ready: false });
  }

  if (method === 'POST' && url.pathname === '/auth/email/redeem') {
    const cookies = parseCookies(getHeader(request.headers, 'cookie'));
    const session = resolveWebSession(cookies[cookieNames(options.config).session], options.now?.() ?? new Date());
    const result = redeemMagicLink({
      nonce: cookies[cookieNames(options.config).emailConfirm] ?? '',
      sessionUserId: session?.userId,
      now: options.now?.()
    });
    if (!result.ok) {
      const status = result.code === 'AUTH_REQUIRED' ? 401 : result.code === 'ACCOUNT_MISMATCH' || result.code === 'EMAIL_ALREADY_LINKED' || result.code === 'IDENTITY_CONFLICT' ? 409 : 400;
      return jsonResponse(status, { error: result.code.toLowerCase() });
    }
    revokeWebSession(cookies[cookieNames(options.config).session]);
    const { token } = createWebSession({ userId: result.userId }, { now: options.now?.() ?? new Date(), ttlDays: SESSION_TTL_DAYS });
    return jsonResponse(200, { ok: true, returnPath: result.returnPath, purpose: result.purpose }, {
      'Set-Cookie': [
        clearCookieHeader(cookieNames(options.config).emailConfirm, secureCookies),
        cookieHeaderParts(cookieNames(options.config).session, token, { maxAgeSeconds: SESSION_TTL_DAYS * 24 * 60 * 60, secure: secureCookies })
      ]
    });
  }

  if (method === 'GET' && url.pathname === '/auth/discord') {
    if (!options.config.discordClientId || !options.config.discordClientSecret) return errorResponse(503, 'discord_auth_unavailable');
    const state = randomBytes(32).toString('base64url');
    const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('client_id', options.config.discordClientId);
    authorizeUrl.searchParams.set('redirect_uri', oauthCallbackUrl(options.config));
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    return redirectResponse(authorizeUrl.toString(), {
      'Set-Cookie': cookieHeaderParts(cookieNames(options.config).oauthState, state, {
        maxAgeSeconds: OAUTH_STATE_MAX_AGE_SECONDS,
        secure: secureCookies
      })
    });
  }

  if (method === 'GET' && url.pathname === '/auth/discord/callback') {
    if (!options.config.discordClientId || !options.config.discordClientSecret) return errorResponse(503, 'discord_auth_unavailable');
    const clearStateCookie = clearCookieHeader(cookieNames(options.config).oauthState, secureCookies);
    if (url.searchParams.has('error')) {
      return errorResponse(400, 'oauth_denied', { 'Set-Cookie': clearStateCookie });
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(getHeader(request.headers, 'cookie'));
    const expectedState = cookies[cookieNames(options.config).oauthState];
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
      const sessionCookie = cookieHeaderParts(cookieNames(options.config).session, token, {
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
    revokeWebSession(cookies[cookieNames(options.config).session]);
    return jsonResponse(
      200,
      { ok: true },
      { 'Set-Cookie': clearCookieHeader(cookieNames(options.config).session, secureCookies) }
    );
  }

  if (method === 'GET' && url.pathname === '/api/me') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    const user = getUserById(session.userId);
    const discord = getIdentityForUser(session.userId, 'DISCORD');
    const email = getIdentityForUser(session.userId, 'EMAIL');
    return jsonResponse(200, {
      user: {
        id: session.userId,
        displayName: user?.displayName ?? discord?.displayName ?? discord?.username,
        avatarUrl: user?.avatarUrl ?? discord?.avatarUrl
      },
      identities: {
        email: email ? { connected: true, email: email.providerUserId, verified: true } : { connected: false },
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

  if (method === 'POST' && url.pathname === '/api/account/email') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    const emailAuth = configuredEmailAuth(options);
    if (!emailAuth) return errorResponse(503, 'email_auth_unavailable');
    const parsed = requireJsonBody(request);
    if (!('ok' in parsed)) return parsed;
    if (typeof parsed.body.email !== 'string') return errorResponse(400, 'invalid_email');
    try {
      requestMagicLink({
        email: parsed.body.email,
        purpose: 'LINK_EMAIL',
        userId: session.userId,
        returnPath: '/app#settings',
        ipAddress: requestIpAddress(request),
        config: emailAuth,
        now: options.now?.()
      });
      await processPendingMagicLinkEmails(emailAuth, { now: options.now?.(), limit: 1 });
      return jsonResponse(202, { accepted: true });
    } catch (error) {
      if ((error as Error).message === 'invalid_email') return errorResponse(400, 'invalid_email');
      options.logger?.error('[web] email linking request failed');
      return jsonResponse(202, { accepted: true });
    }
  }

  if (url.pathname === '/api/settings') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    if (method === 'GET') return jsonResponse(200, alertSettingsResponse(session.userId));
    if (method === 'PATCH') {
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;
      const result = updateAlertSettings(session.userId, parsed.body);
      if (!result.ok) {
        const status = result.code === 'PRO_REQUIRED' ? 403 : 400;
        return jsonResponse(status, { error: result.code, field: result.field, message: result.message });
      }
      return jsonResponse(200, alertSettingsResponse(session.userId));
    }
    return errorResponse(405, 'method_not_allowed', { Allow: 'GET, PATCH' });
  }

  if (url.pathname === '/api/onboarding') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    if (method === 'GET') return jsonResponse(200, { state: getOrCreateOnboardingState(session.userId) });
    if (method === 'PATCH') {
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;
      const allowedFields = new Set(['action', 'expectedStep']);
      if (Object.keys(parsed.body).some((field) => !allowedFields.has(field))) return errorResponse(400, 'invalid_onboarding_update');
      const action = parsed.body.action;
      const expectedStep = parsed.body.expectedStep;
      const actions: OnboardingAction[] = ['CONTINUE', 'BACK', 'MARKET_SAVED', 'PROFILE_SAVED', 'CHASE_CREATED', 'SKIP', 'FINISH', 'RESUME'];
      const steps: OnboardingStep[] = ['WELCOME', 'MARKET', 'PROFILE', 'CHASE', 'READY'];
      if (typeof action !== 'string' || !actions.includes(action as OnboardingAction)) return errorResponse(400, 'invalid_onboarding_action');
      if (expectedStep !== undefined && (typeof expectedStep !== 'string' || !steps.includes(expectedStep as OnboardingStep))) return errorResponse(400, 'invalid_onboarding_step');
      const result = transitionOnboarding(session.userId, action as OnboardingAction, expectedStep as OnboardingStep | undefined);
      if (!result.ok) return jsonResponse(result.code === 'STALE_STATE' ? 409 : 400, { error: result.code, state: result.state });
      return jsonResponse(200, { state: result.state });
    }
    return errorResponse(405, 'method_not_allowed', { Allow: 'GET, PATCH' });
  }

  if (url.pathname === '/api/collector-profile') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    if (!tasteOnboardingEnabled()) return errorResponse(404, 'feature_disabled');
    if (method === 'GET') return jsonResponse(200, { preferences: getCollectorPreferences(session.userId), options: collectorPreferenceOptions() });
    if (method === 'PUT') {
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;
      if (Object.keys(parsed.body).some((field) => !['subjects', 'artwork'].includes(field))) return errorResponse(400, 'invalid_preferences');
      try {
        return jsonResponse(200, { preferences: saveCollectorPreferences(session.userId, parsed.body as { subjects: unknown; artwork: unknown }), options: collectorPreferenceOptions() });
      } catch (error) {
        return errorResponse(400, error instanceof Error ? error.message : 'invalid_preferences');
      }
    }
    return errorResponse(405, 'method_not_allowed', { Allow: 'GET, PUT' });
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

  const alertActionMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)\/(review|mark-new|dismiss|restore)$/);
  if (method === 'POST' && alertActionMatch) {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    let alertId: string;
    try {
      alertId = decodeURIComponent(alertActionMatch[1]);
    } catch {
      return errorResponse(400, 'invalid_alert_id');
    }
    const action = alertActionMatch[2];
    const now = options.now?.().toISOString();
    const item = action === 'review'
      ? markAlertReviewed(session.userId, alertId, now)
      : action === 'mark-new'
        ? markAlertNew(session.userId, alertId)
        : action === 'dismiss'
          ? dismissAlert(session.userId, alertId, now)
          : restoreAlert(session.userId, alertId);
    return item ? jsonResponse(200, { item: publicAlertItem(item) }) : errorResponse(404, 'not_found');
  }

  if (method === 'POST' && url.pathname === '/api/shelf/feedback') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    const parsed = requireJsonBody(request);
    if ('status' in parsed) return parsed;
    const allowedFields = new Set(['periodKey', 'position', 'action', 'expectedVersion']);
    if (Object.keys(parsed.body).some((field) => !allowedFields.has(field))) return errorResponse(400, 'invalid_feedback_request');
    const { periodKey, position, action, expectedVersion } = parsed.body;
    if (
      typeof periodKey !== 'string' || !/^\d{4}-W\d{2}(?:-[A-Z]+)?$/.test(periodKey) ||
      typeof position !== 'number' || !Number.isInteger(position) || position < 1 ||
      typeof action !== 'string' || !['MORE_LIKE_THIS', 'NOT_FOR_ME', 'UNDO'].includes(action) ||
      (expectedVersion !== undefined && (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion)))
    ) return errorResponse(400, 'invalid_feedback_request');
    const result = applyPreparedDiscoveryFeedback({
      userId: session.userId,
      periodKey,
      position: Number(position),
      action: action as DiscoveryFeedbackAction,
      expectedVersion: expectedVersion as number | undefined
    });
    if (!result.ok) {
      const status = result.code === 'STALE_FEEDBACK' ? 409 : result.code === 'RECOMMENDATION_NOT_FOUND' ? 404 : result.code === 'PLUS_REQUIRED' ? 403 : 400;
      return jsonResponse(status, { error: result.code });
    }
    return jsonResponse(200, { feedback: result.feedback });
  }

  if (method === 'GET' && url.pathname === '/api/shelf') {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    return shelfResponse(session.userId, options.config, options.now?.() ?? new Date());
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
        items: result.choices.slice(0, 25).map((choice) => {
          const preview = trustedPreview(getCachedChaseCardPreview(choice.value));
          return preview ? { ...choice, selection: issueCardSelection(session.userId, choice.value, preview) } : choice;
        }),
        unavailable: result.unavailable,
        stale: result.stale
      });
    }

    if (method === 'GET' && url.pathname === '/api/chases/selection') {
      const cardName = (url.searchParams.get('cardName') ?? '').trim();
      if (cardName.length < 3 || cardName.length > 100) return errorResponse(400, 'invalid_query');
      const cached = trustedPreview(getCachedChaseCardPreview(cardName));
      const resolution = cached ? undefined : await resolveTrustedChaseCardReference(cardName);
      const preview = cached ?? (resolution?.status === 'RESOLVED' ? resolution.preview : undefined);
      if (!preview) return errorResponse(422, 'card_selection_unavailable');
      const resolvedName = resolution?.status === 'RESOLVED' ? resolution.resolvedCardName : cardName;
      return jsonResponse(200, { selection: issueCardSelection(session.userId, resolvedName, preview) });
    }

    if (method === 'POST' && url.pathname === '/api/chases') {
      const parsed = requireJsonBody(request);
      if ('status' in parsed) return parsed;
      const selectionError = applyCardSelection(session.userId, parsed.body);
      if (selectionError) return selectionError;
      const result = addUserChase({ userId: session.userId, ...chasePayload(parsed.body) } as Parameters<typeof addUserChase>[0]);
      if (!result.ok) return chaseErrorResponse(result);
      return jsonResponse(201, {
        item: publicVaultItem({ chase: result.chase, monitoringState: 'ACTIVE' }),
        blockedControls: result.blockedControls,
        isFirstChase: result.isFirstChase
      });
    }

    const lifecycleMatch = url.pathname.match(/^\/api\/chases\/([^/]+)\/(pause|resume)$/);
    if (method === 'POST' && lifecycleMatch) {
      let chaseId: string;
      try {
        chaseId = decodeURIComponent(lifecycleMatch[1]);
      } catch {
        return errorResponse(400, 'invalid_chase_id');
      }
      const result = setUserChasePaused({ userId: session.userId, chaseId, paused: lifecycleMatch[2] === 'pause' });
      if (!result.ok) return chaseErrorResponse(result);
      const view = getVaultChases(session.userId).chases.find((item) => item.chase.id === chaseId);
      return jsonResponse(200, { item: view ? publicVaultItem(view) : undefined });
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
        const selectionError = applyCardSelection(session.userId, parsed.body);
        if (selectionError) return selectionError;
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

  const reopenMatch = url.pathname.match(/^\/api\/completed-chases\/([^/]+)\/reopen$/);
  if (method === 'POST' && reopenMatch) {
    const session = authenticatedSession(request, options);
    if (!session) return errorResponse(401, 'unauthorized');
    let chaseId: string;
    try {
      chaseId = decodeURIComponent(reopenMatch[1]);
    } catch {
      return errorResponse(400, 'invalid_chase_id');
    }
    const result = reopenUserCompletedChase({ userId: session.userId, chaseId });
    if (!result.ok) return chaseErrorResponse(result);
    const view = getVaultChases(session.userId).chases.find((item) => item.chase.id === chaseId);
    return jsonResponse(200, { item: view ? publicVaultItem(view) : undefined });
  }

  return errorResponse(404, 'not_found');
}

function toHeaderRecord(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  return headers;
}

function writeWebResponse(res: ServerResponse, response: WebResponse): void {
  res.writeHead(response.status, response.headers);
  if (response.bodyEncoding) {
    res.end(response.body, response.bodyEncoding);
    return;
  }
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
  if (!baseUrl) throw new Error('Missing VAULTR_WEB_BASE_URL in environment');
  const encryptionKey = parseEmailAuthEncryptionKey(env.VAULTR_AUTH_OUTBOX_KEY);
  const emailConfigured = Boolean(env.POSTMARK_SERVER_TOKEN && env.POSTMARK_FROM_EMAIL && encryptionKey);
  return {
    discordClientId,
    discordClientSecret,
    baseUrl,
    postLoginRedirectPath: env.VAULTR_WEB_POST_LOGIN_REDIRECT_PATH ?? '/app',
    previewEnabled: env.VAULTR_WEB_PREVIEW === 'true',
    environmentLabel: env.VAULTR_WEB_ENVIRONMENT_LABEL,
    cookieNamespace: env.VAULTR_WEB_COOKIE_NAMESPACE,
    emailAuth: emailConfigured ? {
      postmarkServerToken: env.POSTMARK_SERVER_TOKEN!,
      fromEmail: env.POSTMARK_FROM_EMAIL!,
      encryptionKey: encryptionKey!
    } : undefined
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
        headers: {
          ...toHeaderRecord(req.headers),
          'x-vaultr-remote-address': req.socket.remoteAddress
        },
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
  const emailAuth = config.emailAuth ? configuredEmailAuth({ config, logger: console }) : null;
  if (emailAuth) {
    const timer = setInterval(() => {
      void processPendingMagicLinkEmails(emailAuth).catch(() => console.error('[web] email authentication delivery retry failed'));
    }, 30_000);
    timer.unref();
  }
  server.listen(port, host, () => {
    console.log(`Vaultr web API listening on http://${host}:${port}`);
  });
}
