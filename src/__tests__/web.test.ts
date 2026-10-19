import { describe, expect, it, vi } from 'vitest';
import { addChase, enqueueAlertEventDelivery, getUserAlertSettings, listChases, listCompletedChases, listUserTasteMemoryChases, removeAllChases, setUserAlertSettings, setUserPlan } from '../services/chase-store.js';
import { createUser, getIdentity, getUserById, linkIdentity } from '../services/accounts.js';
import { db } from '../services/db.js';
import {
  createWebSession,
  getWebSessionByTokenHash,
  hashWebSessionToken,
  resolveWebSession
} from '../services/web-sessions.js';
import { __chaseCardCatalogTestHooks, clearChaseCardAutocompleteCache } from '../services/chase-card-catalog.js';
import { getOrCreateOnboardingState } from '../services/onboarding.js';
import {
  deleteScheduledDiscoveryDrop,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop
} from '../services/scheduled-discovery-drops.js';
import { decodeAlertCursor, handleWebRequest, webConfigFromEnv, type WebConfig } from '../web.js';

const config: WebConfig = {
  discordClientId: 'discord-client-id',
  discordClientSecret: 'discord-client-secret',
  baseUrl: 'http://127.0.0.1:8790',
  postLoginRedirectPath: '/app'
};

const emailConfig: WebConfig = {
  ...config,
  emailAuth: {
    postmarkServerToken: 'test-postmark-token',
    fromEmail: 'login@vaultr.example',
    encryptionKey: Buffer.alloc(32, 9)
  }
};

function clearUser(userId: string): void {
  clearChaseCardAutocompleteCache();
  removeAllChases(userId);
  db.prepare('DELETE FROM completed_chases WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM alert_deliveries WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM alert_events WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_taste_memory WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_alert_settings WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_scheduled_drop_items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM discovery_scheduled_drops WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_onboarding WHERE user_id = ?').run(userId);
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

function seedWeeklyShelf(
  userId: string,
  date = new Date('2026-08-31T13:00:00.000Z'),
  options: { name?: string; cardNumber?: string; setName?: string; language?: 'ENGLISH' | 'JAPANESE'; updatedAt?: string } = {}
) {
  const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date);
  const { availableAt, expiresAt } = scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date);
  const name = options.name ?? 'Mew CoroCoro Promo 151';
  const cardNumber = options.cardNumber ?? '151';
  const setName = options.setName ?? 'CoroCoro Promo';
  const language = options.language ?? 'JAPANESE';
  const updatedAt = options.updatedAt ?? '2026-08-30T12:00:00.000Z';
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
          name,
          lane: 'Promo Trail',
          laneWhy: 'Matches your Japanese promo interest',
          why: 'Connects to the Japanese promo cards already in your Vault',
          nearby: [],
          referenceSourceCardId: `curated-${cardNumber}`,
          discoveryRole: 'CORE_MATCH',
          canonicalReference: {
            provider: 'CURATED',
            sourceCardId: `curated-${cardNumber}`,
            canonicalCardId: `curated-${cardNumber}`,
            canonicalName: name,
            setName,
            cardNumber,
            language,
            imageUrl: 'https://example.test/mew-reference.png',
            imageSourceKind: 'CARD_REFERENCE'
          },
          rankExplanation: {
            recommendationStrength: 'DIRECT_PROFILE',
            anchors: ['internal-score-should-not-leak']
          } as any
        },
        imageUrl: 'https://example.test/mew-reference.png',
        imageSourceName: 'CURATED',
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
          lane: 'multi-card discovery',
          laneWhy: 'Matches your e-reader interest',
          why: 'feature tag score debug',
          nearby: [],
          discoveryRole: 'CONTROLLED_EXPLORATION'
        },
        imageUrl: 'https://i.ebayimg.test/listing.jpg',
        imageSourceName: 'eBay',
        imageSourceKind: 'MARKET_LISTING',
        market: {
          status: 'TIMEOUT',
          currency: 'CAD',
          listing: {
            id: 'unsafe-listing',
            title: 'Unsafe listing',
            url: 'javascript:alert(1)'
          }
        }
      }
    ]
  }, updatedAt);
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
    const fontResponse = await handleWebRequest({ method: 'GET', url: '/fonts/roboto-latin-variable.woff2' }, { config });
    const onboardingArtResponse = await handleWebRequest({ method: 'GET', url: '/onboarding-art/mew-corocoro-promo-151.webp' }, { config });

    expect(appResponse.status).toBe(200);
    expect(appResponse.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
    expect(appResponse.headers?.['Cache-Control']).toBe('no-cache');
    expect(appResponse.body).toContain('Vaultr | Your Collection, Watched');
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers?.['Content-Type']).toBe('text/css; charset=utf-8');
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers?.['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(fontResponse.status).toBe(200);
    expect(fontResponse.headers?.['Content-Type']).toBe('font/woff2');
    expect(fontResponse.body?.slice(0, 4)).toBe('wOF2');
    expect(onboardingArtResponse.status).toBe(200);
    expect(onboardingArtResponse.headers?.['Content-Type']).toBe('image/webp');
    expect(onboardingArtResponse.body?.slice(0, 4)).toBe('RIFF');
    expect(cssResponse.body).not.toContain('@font-face');
    expect(cssResponse.body).toContain('font-family: Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif;');
    expect(cssResponse.body).toContain('.environment-label');
    expect(jsResponse.body).toContain('state.authConfig?.environment?.label');
    expect(jsResponse.body).toContain('PICKUPS');
    expect(jsResponse.body).toContain('completedChasesSectionMarkup');
    expect(jsResponse.body).toContain('const hasVisibleRows = items.length > 0 || completed.length > 0;');
    expect(jsResponse.body).toContain("hasVisibleRows\n    ? ''\n    : state.vaultFilter === 'ALL'");
    expect(jsResponse.body).toContain("function pageFromHash(hash = window.location.hash)");
    expect(jsResponse.body).toContain("if (value === 'home' || value === 'vault' || value === 'alerts' || value === 'shelf' || value === 'settings' || value === 'onboarding') return value;");
    expect(jsResponse.body).toContain("return 'home';");
    expect(jsResponse.body).toContain("activePage: 'home'");
    expect(jsResponse.body).toContain('Welcome back, ${escapeHtml(userDisplayName(state.user))}');
    expect(jsResponse.body).toContain('Build your Vault. Chase your grails. Discover what you love next.');
    expect(jsResponse.body).toContain('Your collection, watched.');
    expect(jsResponse.body).toContain("const isPreviewMode = window.location.pathname === '/preview'");
    expect(jsResponse.body).toContain("return `/api/preview/${url.slice('/api/'.length)}`;");
    expect(jsResponse.body).toContain('Preview mode is read-only. No changes were saved.');
    expect(jsResponse.body).toContain("const appHomePath = isPreviewMode ? '/preview' : '/app';");
    expect(jsResponse.body).toContain("navButton('vault', 'Watchlist')");
    expect(jsResponse.body).toContain("navButton('alerts', 'Inbox')");
    expect(jsResponse.body).toContain("navButton('shelf', 'Discover')");
    expect(jsResponse.body).toContain('data-page="settings"');
    expect(jsResponse.body).toContain('data-settings-form');
    expect(jsResponse.body).toContain('data-onboarding-market-form');
    expect(jsResponse.body).toContain('Finish setting up Vaultr');
    expect(jsResponse.body).toContain('Your progress is saved.');
    expect(jsResponse.body).toContain("state.onboarding?.status !== 'IN_PROGRESS'");
    expect(jsResponse.body).toContain('data-action="revisit-onboarding">Revisit setup');
    expect(jsResponse.body).toContain('onboardingRevisitMode');
    expect(jsResponse.body).toContain("state.onboarding?.status === 'IN_PROGRESS'");
    expect(jsResponse.body).toContain("const hasExplicitRoute = /^#(home|vault|alerts|shelf|settings|onboarding)$/i.test(window.location.hash);");
    expect(jsResponse.body).toContain('Tell Vaultr which Pokémon cards you\'re looking for and what matters to you.');
    expect(jsResponse.body).toContain('Get started');
    expect(jsResponse.body).toContain('const hasLoadedChase = !isPreviewMode');
    expect(jsResponse.body).toContain('Continue simulation without saving');
    expect(jsResponse.body).toContain('Inspect Watchlist form');
    expect(jsResponse.body).not.toContain("${hasLoadedChase ? '<button class=\"button-primary\" type=\"button\" data-action=\"onboarding-chase-saved\">Continue</button>' : '<button class=\"button-primary\" type=\"button\" data-action=\"onboarding-add-chase\">Add your first Chase</button>'}${isPreviewMode ?");
    const navigationSource = jsResponse.body?.slice(jsResponse.body.indexOf('async function navigateToPage'), jsResponse.body.indexOf('function resetViewportForPage')) ?? '';
    expect(navigationSource).not.toContain("updateOnboarding('SKIP')");
    expect(jsResponse.body).toContain('Build your Vault. Chase your grails. Discover what you love next.');
    expect(jsResponse.body).toContain('${vaultDialogMarkup()}');
    expect(jsResponse.body).toContain("fetchJson('/api/settings'");
    expect(jsResponse.body).toContain("window.addEventListener('beforeunload'");
    expect(jsResponse.body).toContain('Saved Watchlist budgets will be converted using available exchange rates and rounded.');
    expect(jsResponse.body).toContain('settingsCurrencyConfirmationMarkup');
    expect(jsResponse.body).toContain('function settingsCurrencyOptions(settings, options)');
    expect(jsResponse.body).toContain('? [savedCurrency, ...supported]');
    expect(jsResponse.body).toContain('await loadVault({ force: true })');
    expect(jsResponse.body).toContain('Preview mode is read-only. You can inspect these settings, but changes will not be saved.');
    expect(jsResponse.body).not.toContain("navButton('vault', 'My Vault')");
    expect(jsResponse.body).not.toContain("navButton('alerts', 'Alerts')");
    expect(jsResponse.body).toContain("priorityButton('NORMAL', 'Casual')");
    expect(jsResponse.body).toContain('if (pageChanged) resetViewportForPage(nextPage);');
    expect(jsResponse.body).toContain('window.scrollTo(0, 0);');
    expect(jsResponse.body).toContain('window.location.hash = nextPage;');
    expect(jsResponse.body).toContain("window.addEventListener('hashchange'");
    expect(jsResponse.body).toContain('await loadActivePageData();');
    expect(jsResponse.body).toContain('Choose the exact printing, then add only the preferences that matter to you.');
    expect(jsResponse.body).toContain('Maximum (${escapeHtml(state.vaultCurrency)})');
    expect(jsResponse.body).toContain('Known shipping is included when available.');
    expect(jsResponse.body).toContain('A number requests that exact listed grade.');
    expect(jsResponse.body).toContain('Advanced filters and Trusted Shops monitoring are included with Vaultr Plus.');
    expect(jsResponse.body).toContain("state.vaultCardSelection = item.selection");
    expect(jsResponse.body).toContain('body.cardSelectionToken = state.vaultCardSelection.token;');
    expect(jsResponse.body).toContain('input.value.trim() !== state.vaultCardSelection.value');
    expect(jsResponse.body).toContain("alertReviewState: 'NEW'");
    expect(jsResponse.body).toContain("fetchJson('/api/alerts?reviewState=NEW&limit=4')");
    expect(jsResponse.body).toContain("imageKind: 'Listing image'");
    expect(jsResponse.body).toContain('data-home-alert-image');
    expect(jsResponse.body).toContain("reviewStateButton('REVIEWED', 'Reviewed')");
    expect(jsResponse.body).toContain('No new matches need review right now.');
    expect(jsResponse.body).toContain('data-action="dismiss-alert"');
    expect(jsResponse.body).toContain('data-action="undo-dismiss"');
    expect(jsResponse.body).toContain('data-action="view-alert-chase"');
    expect(jsResponse.body).toContain("target.getAttribute('data-reviewed') !== 'true' && !isPreviewMode");
    expect(jsResponse.body).toContain("alertPreview.length ? '<span class=\"home-plan-label\">New</span>' : ''");
    expect(jsResponse.body).toContain('if (state.vaultLoaded && !state.isVaultLoading) state.pendingVaultFocusId = null;');
    expect(jsResponse.body).not.toContain('${escapeHtml(alertPreview.length)} New');
    expect(jsResponse.body).toContain('function homeShelfFeatureMarkup(items, index)');
    expect(jsResponse.body).toContain('Same favourites. New discoveries.');
    expect(jsResponse.body).toContain('Explore your Display Case');
    expect(jsResponse.body).toContain('Open Inbox');
    expect(jsResponse.body).toContain('View Watchlist');
    expect(jsResponse.body).toContain("data-action=\"previous-home-shelf\"");
    expect(jsResponse.body).toContain("data-action=\"next-home-shelf\"");
    expect(jsResponse.body).toContain("total > 1 ?");
    expect(jsResponse.body).toContain("item.monitoringState === 'PAUSED_USER'");
    expect(jsResponse.body).toContain("item.monitoringState === 'PAUSED_PLAN_LIMIT'");
    expect(jsResponse.body).toContain('Discover cards inspired by your Watchlist and pickups.');
    expect(jsResponse.body).toContain('<h1 id="shelf-title">Your Display Case</h1>');
    expect(jsResponse.body).toContain('<p class="eyebrow">DISCOVER</p>');
    expect(jsResponse.body).toContain('data-action="add-shelf-card-to-vault"');
    expect(jsResponse.body).toContain('Add to Watchlist');
    expect(jsResponse.body).toContain('Your next favourite starts here.');
    expect(jsResponse.body).toContain('A LITTLE INSPIRATION');
    expect(jsResponse.body).toContain('These are not personalized recommendations.');
    expect(jsResponse.body).toContain('See Vaultr Plus controls');
    expect(jsResponse.body).toContain('View on eBay');
    expect(jsResponse.body).toContain('Pricing unavailable');
    expect(jsResponse.body).toContain('async function ensureVaultLoaded()');
    expect(jsResponse.body).toContain('state.vaultPrefillCardName = selectedCardName;');
    expect(jsResponse.body).toContain("data-action=\"view-discovery-card\"");
    expect(jsResponse.body).toContain('On your Watchlist');
    expect(jsResponse.body).toContain('In your Pickups');
    expect(jsResponse.body).toContain('Exact card selected');
    expect(jsResponse.body).toContain('The cards you’re watching');
    expect(jsResponse.body).toContain('vaultNotice');
    expect(jsResponse.body).toContain('data-action="open-artwork"');
    expect(jsResponse.body).toContain('role="dialog" aria-modal="true"');
    expect(jsResponse.body).toContain("if (event.key === 'Escape')");
    expect(jsResponse.body).toContain('artworkReturnFocus.focus()');
    expect(jsResponse.body).toContain('document.body.style.overflow = artworkPreviousBodyOverflow;');
    expect(jsResponse.body).toContain("imageKind: 'Listing image'");
    expect(jsResponse.body).toContain("imageKind: 'Card artwork'");
    expect(jsResponse.body).toContain("fetchJson(editing ? `/api/chases/${encodeURIComponent(state.vaultEditingId)}` : '/api/chases'");
    expect(jsResponse.body).toContain('state.vaultFormDraft = captureVaultFormDraft(form);');
    expect(jsResponse.body).toContain('await reconcileUncertainVaultCreate(body.cardName)');
    expect(jsResponse.body).toContain('await finishConfirmedVaultSave({ response, editing });');
    expect(jsResponse.body).toContain('Setup could not advance, but you can continue without adding the card again.');
    expect(jsResponse.body).toContain("setVaultNotice('Nice pickup. It’s yours!');");
    expect(jsResponse.body).toContain("['ALL', 'All'], ['WATCHING', 'Watching'], ['PAUSED', 'Paused'], ['COMPLETED', 'Pickups']");
    expect(jsResponse.body).toContain('input.value.trim() !== state.vaultCardSelection.value');
    expect(jsResponse.body).not.toContain("${state.vaultNotice ? `<div class=\"vault-notice\"");
    expect(jsResponse.body).not.toContain('${item.roleLabel ? `<span class="status-pill active">');
    expect(jsResponse.body).not.toContain('A read-only shelf');
    expect(cssResponse.body).toContain('.shelf-card-actions');
    expect(cssResponse.body).toContain('.shelf-card-actions .shelf-ebay-link');
    expect(cssResponse.body).toContain('.shelf-card-meta > .status-pill.active');
    expect(cssResponse.body).toContain('display: none;');
    expect(cssResponse.body).not.toContain('-webkit-line-clamp: 4');
  });

  it('keeps the Home Shelf preview bounded and uses only real secondary artwork', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/app.js' }, { config });
    const source = response.body ?? '';
    const functionSource = (name: string): string => {
      const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
      expect(match?.[0]).toBeTruthy();
      return match![0];
    };
    const utilities = new Function(
      `${functionSource('boundedHomeShelfIndex')}\n${functionSource('homeShelfPresentation')}\nreturn { boundedHomeShelfIndex, homeShelfPresentation };`
    )() as {
      boundedHomeShelfIndex: (index: number, itemCount: number) => number;
      homeShelfPresentation: (items: Array<{ name: string; imageUrl?: string }>, index: number) => {
        featuredIndex: number;
        featured?: { name: string; imageUrl?: string };
        decorative: Array<{ name: string; imageUrl?: string }>;
      };
    };

    expect(utilities.boundedHomeShelfIndex(-1, 3)).toBe(0);
    expect(utilities.boundedHomeShelfIndex(9, 3)).toBe(2);
    expect(utilities.boundedHomeShelfIndex(1, 0)).toBe(0);

    const presentation = utilities.homeShelfPresentation([
      { name: 'First', imageUrl: '/first.png' },
      { name: 'Featured' },
      { name: 'Second artwork', imageUrl: '/second.png' },
      { name: 'Third artwork', imageUrl: '/third.png' }
    ], 1);
    expect(presentation.featured?.name).toBe('Featured');
    expect(presentation.decorative.map((item) => item.name)).toEqual(['First', 'Second artwork']);
    expect(utilities.homeShelfPresentation([{ name: 'Only' }], 0).decorative).toEqual([]);
    expect(utilities.homeShelfPresentation([], 4).featured).toBeUndefined();
  });

  it('normalizes and updates grading controls without touching unsaved fields', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/app.js' }, { config });
    const source = response.body ?? '';
    const functionSource = (name: string): string => {
      const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
      expect(match?.[0]).toBeTruthy();
      return match![0];
    };
    const utilities = new Function(
      'HTMLSelectElement',
      `${functionSource('gradeValueIsEnabled')}\n${functionSource('effectiveGradeValue')}\n${functionSource('syncGradeValueControl')}\nreturn { effectiveGradeValue, syncGradeValueControl };`
    );
    class FakeSelect {
      disabled = false;
      attributes: Record<string, string> = {};
      constructor(public value: string) {}
      setAttribute(name: string, value: string) { this.attributes[name] = value; }
    }
    const gradingType = new FakeSelect('ANY');
    const gradeValue = new FakeSelect('10');
    const unsaved = { cardName: 'Mew Expedition 19', maxPrice: '125', targetNote: 'Japanese copy' };
    const form = {
      querySelector(selector: string) {
        if (selector === '[name="gradingType"]') return gradingType;
        if (selector === '[name="gradeValue"]') return gradeValue;
        throw new Error(`Unexpected control access: ${selector}`);
      }
    };
    const helpers = utilities(FakeSelect) as {
      effectiveGradeValue: (type: string, value: string) => string;
      syncGradeValueControl: (form: { querySelector: (selector: string) => FakeSelect }) => void;
    };

    helpers.syncGradeValueControl(form);
    expect(gradeValue).toMatchObject({ disabled: true, value: 'ANY', attributes: { 'aria-disabled': 'true' } });
    expect(helpers.effectiveGradeValue('ANY', '10')).toBe('ANY');
    expect(helpers.effectiveGradeValue('RAW', '9')).toBe('ANY');

    gradingType.value = 'PSA';
    helpers.syncGradeValueControl(form);
    expect(gradeValue.disabled).toBe(false);
    expect(gradeValue.attributes['aria-disabled']).toBe('false');
    gradeValue.value = '9';
    expect(helpers.effectiveGradeValue('PSA', gradeValue.value)).toBe('9');

    gradingType.value = 'RAW';
    helpers.syncGradeValueControl(form);
    expect(gradeValue).toMatchObject({ disabled: true, value: 'ANY' });
    gradingType.value = 'CGC';
    helpers.syncGradeValueControl(form);
    expect(gradeValue).toMatchObject({ disabled: false, value: 'ANY' });
    expect(unsaved).toEqual({ cardName: 'Mew Expedition 19', maxPrice: '125', targetNote: 'Japanese copy' });
  });

  it('returns 404 for unknown or traversal-style static paths', async () => {
    const missing = await handleWebRequest({ method: 'GET', url: '/missing-app.js' }, { config });
    const traversal = await handleWebRequest({ method: 'GET', url: '/app/../README.md' }, { config });

    expect(missing.status).toBe(404);
    expect(traversal.status).toBe(404);
  });
});

describe('web app preview mode', () => {
  const previewConfig: WebConfig = { ...config, previewEnabled: true };

  it('hides preview routes unless explicitly enabled', async () => {
    const page = await handleWebRequest({ method: 'GET', url: '/preview' }, { config });
    const api = await handleWebRequest({ method: 'GET', url: '/api/preview/me' }, { config });

    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });

  it('serves the shared app and fixture APIs without a session when enabled', async () => {
    const page = await handleWebRequest({ method: 'GET', url: '/preview/' }, { config: previewConfig });
    const me = await handleWebRequest({ method: 'GET', url: '/api/preview/me' }, { config: previewConfig });
    const vault = await handleWebRequest({ method: 'GET', url: '/api/preview/chases' }, { config: previewConfig });
    const alerts = await handleWebRequest({ method: 'GET', url: '/api/preview/alerts' }, { config: previewConfig });
    const shelf = await handleWebRequest({ method: 'GET', url: '/api/preview/shelf' }, { config: previewConfig });
    const settings = await handleWebRequest({ method: 'GET', url: '/api/preview/settings' }, { config: previewConfig });
    const onboarding = await handleWebRequest({ method: 'GET', url: '/api/preview/onboarding' }, { config: previewConfig });
    const authConfig = await handleWebRequest({ method: 'GET', url: '/api/preview/auth/config' }, { config: previewConfig });

    expect(page.status).toBe(200);
    expect(page.body).toContain('/app.js');
    expect(JSON.parse(me.body ?? '{}')).toMatchObject({
      user: { id: 'preview-user', displayName: 'Catherine Preview' },
      identities: { email: { connected: true, verified: true }, discord: { connected: true } },
      preview: true
    });
    expect(JSON.parse(authConfig.body ?? '{}')).toEqual({ email: { available: true }, discord: { available: true }, preview: true });
    expect(JSON.parse(vault.body ?? '{}').items.length).toBeGreaterThanOrEqual(6);
    expect(JSON.parse(vault.body ?? '{}').completedItems).toHaveLength(1);
    const previewVault = JSON.parse(vault.body ?? '{}');
    const previewAlerts = JSON.parse(alerts.body ?? '{}');
    const previewShelf = JSON.parse(shelf.body ?? '{}');
    const previewSettings = JSON.parse(settings.body ?? '{}');
    const previewOnboarding = JSON.parse(onboarding.body ?? '{}');
    expect(previewAlerts.items.length).toBeGreaterThanOrEqual(4);
    expect(previewVault.items.some((item: { monitoringState: string }) => item.monitoringState === 'PAUSED_USER')).toBe(true);
    expect(previewVault.items.some((item: { monitoringState: string }) => item.monitoringState === 'PAUSED_PLAN_LIMIT')).toBe(true);
    expect(previewAlerts.items.map((item: { priceDelta: number }) => item.priceDelta)).toEqual([27, 6, 7, 6, 15]);
    expect(previewShelf).toMatchObject({ status: 'READY', itemCount: 12, marketReadyCount: 10, imageReadyCount: 8 });
    expect(previewSettings).toMatchObject({
      settings: { alertCurrency: 'CAD', listingSourceMode: 'EBAY_SHOPIFY', effectiveListingSourceMode: 'EBAY' },
      access: { tier: 'FREE', trustedShops: false }
    });
    expect(previewOnboarding).toMatchObject({ state: { status: 'SKIPPED', automatic: false }, preview: true });
    expect(previewSettings.options.currencies).toContain(previewSettings.settings.alertCurrency);
    const chaseNames = new Set([
      ...previewVault.items.map((item: { chase: { cardName: string } }) => item.chase.cardName),
      ...previewVault.completedItems.map((item: { cardName: string }) => item.cardName)
    ]);
    expect(previewShelf.items.filter((item: { name: string }) => chaseNames.has(item.name))).toHaveLength(0);
    expect(previewShelf.items.filter((item: { language: string }) => item.language === 'JAPANESE').every((item: { imageUrl?: string }) => !item.imageUrl)).toBe(true);
  });

  it('serves bounded in-memory autocomplete choices for preview forms', async () => {
    const response = await handleWebRequest(
      { method: 'GET', url: '/api/preview/chases/autocomplete?q=umbreon' },
      { config: previewConfig }
    );
    const malformed = await handleWebRequest(
      { method: 'GET', url: `/api/preview/chases/autocomplete?q=${'x'.repeat(101)}` },
      { config: previewConfig }
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toEqual({
      items: [{ name: 'Umbreon V', value: 'Umbreon V Brilliant Stars Trainer Gallery TG22' }],
      unavailable: false,
      stale: false
    });
    expect(malformed.status).toBe(400);
  });

  it('supports fixture alert filters without accepting a user selector', async () => {
    const regular = await handleWebRequest(
      { method: 'GET', url: '/api/preview/alerts?priority=GRAIL&source=EBAY' },
      { config: previewConfig }
    );
    const selected = await handleWebRequest(
      { method: 'GET', url: '/api/preview/alerts?priority=GRAIL&source=EBAY&userId=real-user' },
      { config: previewConfig }
    );
    const chaseSelected = await handleWebRequest(
      { method: 'GET', url: '/api/preview/alerts?chaseId=preview-mew' },
      { config: previewConfig }
    );
    const newOnly = await handleWebRequest(
      { method: 'GET', url: '/api/preview/alerts?reviewState=NEW&chaseId=preview-mew' },
      { config: previewConfig }
    );
    const reviewedOnly = await handleWebRequest(
      { method: 'GET', url: '/api/preview/alerts?reviewState=REVIEWED' },
      { config: previewConfig }
    );

    expect(selected.body).toBe(regular.body);
    expect(JSON.parse(selected.body ?? '{}').items.every((item: { chasePriority: string; source: string }) => item.chasePriority === 'GRAIL' && item.source === 'EBAY')).toBe(true);
    expect(JSON.parse(chaseSelected.body ?? '{}').items.map((item: { chaseId: string }) => item.chaseId)).toEqual(['preview-mew']);
    expect(JSON.parse(newOnly.body ?? '{}').items).toHaveLength(1);
    expect(JSON.parse(reviewedOnly.body ?? '{}').items).toHaveLength(2);
  });

  it('rejects every preview API mutation and leaves persistent state untouched', async () => {
    const before = {
      users: (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count,
      chases: listChases('preview-user').length,
      sessions: (db.prepare('SELECT COUNT(*) AS count FROM web_sessions').get() as { count: number }).count
    };
    const alertMutation = await handleWebRequest(
      { method: 'POST', url: '/api/preview/alerts/preview-alert-1/review' },
      { config: previewConfig }
    );
    expect(alertMutation.status).toBe(405);

    for (const [method, url] of [
      ['POST', '/api/preview/chases'],
      ['PATCH', '/api/preview/chases/preview-mew'],
      ['DELETE', '/api/preview/chases/preview-mew'],
      ['POST', '/api/preview/chases/preview-mew/pause'],
      ['POST', '/api/preview/chases/preview-gardevoir/resume'],
      ['POST', '/api/preview/completed-chases/preview-pichu/reopen'],
      ['POST', '/api/preview/account/email'],
      ['PATCH', '/api/preview/settings'],
      ['PATCH', '/api/preview/onboarding']
    ]) {
      const response = await handleWebRequest(
        { method, url, headers: { 'content-type': 'application/json' }, body: '{}' },
        { config: previewConfig }
      );
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body ?? '{}')).toEqual({ error: 'preview_read_only' });
    }

    expect((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count).toBe(before.users);
    expect(listChases('preview-user')).toHaveLength(before.chases);
    expect((db.prepare('SELECT COUNT(*) AS count FROM web_sessions').get() as { count: number }).count).toBe(before.sessions);
  });

  it('keeps production API authentication unchanged when preview is enabled', async () => {
    const response = await handleWebRequest({ method: 'GET', url: '/api/me' }, { config: previewConfig });
    expect(response.status).toBe(401);
  });
});

describe('web auth routes', () => {
  it('labels staging and isolates its OAuth cookie names', async () => {
    expect(webConfigFromEnv({
      VAULTR_WEB_BASE_URL: 'https://staging.vaultr.example',
      VAULTR_WEB_ENVIRONMENT_LABEL: 'Staging',
      VAULTR_WEB_COOKIE_NAMESPACE: 'staging'
    })).toMatchObject({
      environmentLabel: 'Staging',
      cookieNamespace: 'staging'
    });

    const stagingConfig: WebConfig = {
      ...config,
      baseUrl: 'https://staging.vaultr.example',
      environmentLabel: 'Staging',
      cookieNamespace: 'staging'
    };
    const methods = await handleWebRequest({ method: 'GET', url: '/api/auth/config' }, { config: stagingConfig });
    expect(JSON.parse(methods.body ?? '{}')).toEqual({
      email: { available: false },
      discord: { available: true },
      environment: { label: 'Staging' }
    });

    const authorize = await handleWebRequest({ method: 'GET', url: '/auth/discord' }, { config: stagingConfig });
    expect(authorize.status).toBe(302);
    expect(authorize.headers?.['Set-Cookie']).toEqual(expect.stringContaining('vaultr_staging_oauth_state='));
    expect(authorize.headers?.Location).toEqual(expect.stringContaining(encodeURIComponent('https://staging.vaultr.example/auth/discord/callback')));
  });

  it('reports configured methods and permits email-only web startup', async () => {
    expect(webConfigFromEnv({
      VAULTR_WEB_BASE_URL: 'https://vaultr.example',
      POSTMARK_SERVER_TOKEN: 'server-token',
      POSTMARK_FROM_EMAIL: 'login@vaultr.example',
      VAULTR_AUTH_OUTBOX_KEY: Buffer.alloc(32, 4).toString('base64')
    })).toMatchObject({ baseUrl: 'https://vaultr.example', emailAuth: { fromEmail: 'login@vaultr.example' } });

    const methods = await handleWebRequest({ method: 'GET', url: '/api/auth/config' }, { config: emailConfig });
    expect(JSON.parse(methods.body ?? '{}')).toEqual({ email: { available: true }, discord: { available: true } });
    const emailOnly = await handleWebRequest(
      { method: 'GET', url: '/api/auth/config' },
      { config: { baseUrl: 'https://vaultr.example', emailAuth: emailConfig.emailAuth } }
    );
    expect(JSON.parse(emailOnly.body ?? '{}')).toEqual({ email: { available: true }, discord: { available: false } });
  });

  it('requests, confirms without consuming, and redeems an email sign-in with rotated protected cookies', async () => {
    db.prepare('DELETE FROM auth_email_outbox').run();
    db.prepare('DELETE FROM auth_magic_link_confirmations').run();
    db.prepare('DELETE FROM auth_magic_links').run();
    let deliveredUrl = '';
    const emailTransport = {
      sendMagicLink: vi.fn(async (message: { signInUrl: string }) => {
        deliveredUrl = message.signInUrl;
        return { messageId: 'postmark-auth-1' };
      })
    };
    const now = () => new Date('2026-10-16T12:00:00.000Z');
    const requested = await handleWebRequest({
      method: 'POST',
      url: '/auth/email/request',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.30' },
      body: JSON.stringify({ email: 'EmailOnly@Example.com', returnPath: '/app#vault' })
    }, { config: emailConfig, emailTransport, now });
    expect(requested.status).toBe(202);
    expect(JSON.parse(requested.body ?? '{}')).toEqual({ accepted: true });
    expect(deliveredUrl).toMatch(/^http:\/\/127\.0\.0\.1:8790\/auth\/email\/confirm\?token=/);

    const confirmed = await handleWebRequest({ method: 'GET', url: new URL(deliveredUrl).pathname + new URL(deliveredUrl).search }, { config: emailConfig, emailTransport, now });
    expect(confirmed.status).toBe(302);
    expect(confirmed.headers?.Location).toBe('/app?emailConfirm=ready');
    expect((db.prepare('SELECT consumed_at FROM auth_magic_links').get() as { consumed_at: string | null }).consumed_at).toBeNull();
    const confirmationCookie = cookieValue(confirmed.headers, 'vaultr_email_confirm');
    expect(confirmationCookie).toBeTruthy();

    const redeemed = await handleWebRequest({
      method: 'POST',
      url: '/auth/email/redeem',
      headers: { cookie: `vaultr_email_confirm=${confirmationCookie}` }
    }, { config: emailConfig, emailTransport, now });
    expect(redeemed.status).toBe(200);
    expect(JSON.parse(redeemed.body ?? '{}')).toMatchObject({ ok: true, returnPath: '/app#vault', purpose: 'SIGN_IN' });
    const sessionToken = cookieValue(redeemed.headers, 'vaultr_session');
    expect(sessionToken).toBeTruthy();
    expect(String((redeemed.headers?.['Set-Cookie'] as string[])[1])).toContain('HttpOnly');
    const session = resolveWebSession(decodeURIComponent(sessionToken!), now());
    expect(getIdentity('EMAIL', 'emailonly@example.com')?.userId).toBe(session?.userId);
    expect((await handleWebRequest({ method: 'POST', url: '/auth/email/redeem', headers: { cookie: `vaultr_email_confirm=${confirmationCookie}` } }, { config: emailConfig, emailTransport, now })).status).toBe(400);
    if (session?.userId) clearUser(session.userId);
  });

  it('links a verified email only to the authenticated requesting account and rotates its session', async () => {
    db.prepare('DELETE FROM auth_email_outbox').run();
    db.prepare('DELETE FROM auth_magic_link_confirmations').run();
    db.prepare('DELETE FROM auth_magic_links').run();
    const user = createUser({ displayName: 'Discord Collector' });
    linkIdentity({ userId: user.id, provider: 'DISCORD', providerUserId: 'discord-link-owner', username: 'collector' });
    setUserPlan(user.id, 'PRO');
    setUserAlertSettings(user.id, { minScore: 74 });
    addChase({ userId: user.id, cardName: 'Mew RC24', priority: 'NORMAL' });
    expect(getOrCreateOnboardingState(user.id).status).toBe('SKIPPED');
    const oldSession = createWebSession({ userId: user.id }, { token: 'email-link-old-session', now: new Date('2026-10-16T12:00:00.000Z') });
    let deliveredUrl = '';
    const emailTransport = { sendMagicLink: vi.fn(async (message: { signInUrl: string }) => { deliveredUrl = message.signInUrl; return { messageId: 'postmark-link-1' }; }) };
    const now = () => new Date('2026-10-16T12:00:00.000Z');
    const requested = await handleWebRequest({
      method: 'POST', url: '/api/account/email',
      headers: { cookie: sessionCookie(oldSession.token), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'linked@example.com' })
    }, { config: emailConfig, emailTransport, now });
    expect(requested.status).toBe(202);
    const linkUrl = new URL(deliveredUrl);
    const confirmed = await handleWebRequest({ method: 'GET', url: `${linkUrl.pathname}${linkUrl.search}` }, { config: emailConfig, emailTransport, now });
    const nonce = cookieValue(confirmed.headers, 'vaultr_email_confirm');
    const redeemed = await handleWebRequest({
      method: 'POST', url: '/auth/email/redeem',
      headers: { cookie: `${sessionCookie(oldSession.token)}; vaultr_email_confirm=${nonce}` }
    }, { config: emailConfig, emailTransport, now });
    expect(redeemed.status).toBe(200);
    expect(resolveWebSession(oldSession.token, now())).toBeNull();
    expect(getIdentity('EMAIL', 'linked@example.com')?.userId).toBe(user.id);
    expect(getUserAlertSettings(user.id).minScore).toBe(74);
    expect(listChases(user.id).map((chase) => chase.cardName)).toEqual(['Mew RC24']);
    expect(getIdentity('DISCORD', 'discord-link-owner')?.userId).toBe(user.id);
    expect(getUserById(user.id)?.displayName).toBe('Discord Collector');
    expect(getOrCreateOnboardingState(user.id).status).toBe('SKIPPED');
    clearUser(user.id);
  });

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

    const me = await handleWebRequest(
      { method: 'GET', url: '/api/me', headers: { cookie: sessionCookie(decodeURIComponent(token!)) } },
      { config, now: () => new Date('2026-08-20T12:00:00.000Z') }
    );
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

describe('authenticated onboarding API', () => {
  it('requires authentication and uses only the session account', async () => {
    const unauthenticated = await handleWebRequest({ method: 'GET', url: '/api/onboarding' }, { config });
    expect(unauthenticated.status).toBe(401);

    const userId = createUser({ displayName: 'Owned onboarding' }).id;
    const otherUserId = createUser({ displayName: 'Other onboarding' }).id;
    createWebSession({ userId }, { token: 'web-onboarding-token' });
    const headers = { cookie: sessionCookie('web-onboarding-token'), 'content-type': 'application/json' };
    const initial = await handleWebRequest({ method: 'GET', url: `/api/onboarding?userId=${otherUserId}`, headers }, { config });
    expect(initial.status).toBe(200);
    expect(JSON.parse(initial.body ?? '{}')).toMatchObject({ state: { status: 'IN_PROGRESS', step: 'WELCOME' } });

    const continued = await handleWebRequest({ method: 'PATCH', url: '/api/onboarding', headers, body: JSON.stringify({ action: 'CONTINUE', expectedStep: 'WELCOME' }) }, { config });
    expect(continued.status).toBe(200);
    expect(JSON.parse(continued.body ?? '{}')).toMatchObject({ state: { step: 'MARKET' } });
    expect(db.prepare('SELECT step FROM user_onboarding WHERE user_id = ?').get(otherUserId)).toBeUndefined();
    clearUser(userId);
    clearUser(otherUserId);
  });

  it('rejects malformed and stale transitions while keeping retries canonical', async () => {
    const userId = createUser({ displayName: 'Guarded onboarding' }).id;
    createWebSession({ userId }, { token: 'web-onboarding-guards-token' });
    const headers = { cookie: sessionCookie('web-onboarding-guards-token'), 'content-type': 'application/json' };
    await handleWebRequest({ method: 'GET', url: '/api/onboarding', headers }, { config });

    const malformed = await handleWebRequest({ method: 'PATCH', url: '/api/onboarding', headers, body: JSON.stringify({ action: 'NOPE' }) }, { config });
    const unsupported = await handleWebRequest({ method: 'PATCH', url: '/api/onboarding', headers, body: JSON.stringify({ action: 'CONTINUE', userId: 'other' }) }, { config });
    const first = await handleWebRequest({ method: 'PATCH', url: '/api/onboarding', headers, body: JSON.stringify({ action: 'CONTINUE', expectedStep: 'WELCOME' }) }, { config });
    const stale = await handleWebRequest({ method: 'PATCH', url: '/api/onboarding', headers, body: JSON.stringify({ action: 'CONTINUE', expectedStep: 'WELCOME' }) }, { config });

    expect(malformed.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body ?? '{}')).toMatchObject({ error: 'STALE_STATE', state: { step: 'MARKET' } });
    clearUser(userId);
  });
});

describe('authenticated settings API', () => {
  function auth(userId: string, token: string) {
    clearUser(userId);
    createWebSession({ userId }, { token });
    return { cookie: sessionCookie(token), 'content-type': 'application/json' };
  }

  it('requires authentication for reading and updating settings', async () => {
    const read = await handleWebRequest({ method: 'GET', url: '/api/settings' }, { config });
    const update = await handleWebRequest({ method: 'PATCH', url: '/api/settings', headers: { 'content-type': 'application/json' }, body: '{}' }, { config });

    expect(read.status).toBe(401);
    expect(update.status).toBe(401);
  });

  it('uses only the session account and returns public form metadata', async () => {
    const userId = 'web-settings-owned';
    const otherUserId = 'web-settings-other';
    const headers = auth(userId, 'settings-owned-token');
    clearUser(otherUserId);
    setUserAlertSettings(userId, { minScore: 71, shippingCountry: 'CA', shippingPostalCode: 'M5V' });
    setUserAlertSettings(otherUserId, { minScore: 22 });

    const response = await handleWebRequest({ method: 'GET', url: '/api/settings?userId=web-settings-other', headers }, { config });
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      settings: { minScore: 71, shippingCountry: 'CA', shippingPostalCode: 'M5V' },
      options: { confidence: { min: 0, max: 100 } }
    });
    expect(body.options.currencies).toContain(body.settings.alertCurrency);
    expect(response.body).not.toContain(otherUserId);
    expect(body).not.toHaveProperty('userId');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('applies partial updates without erasing an inactive Pro source preference', async () => {
    const userId = 'web-settings-partial';
    const headers = auth(userId, 'settings-partial-token');
    setUserPlan(userId, 'PRO');
    setUserAlertSettings(userId, { minScore: 60, listingSourceMode: 'EBAY_SHOPIFY' });
    setUserPlan(userId, 'FREE');

    const response = await handleWebRequest({
      method: 'PATCH',
      url: '/api/settings',
      headers,
      body: JSON.stringify({ minScore: 76 })
    }, { config });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      settings: { minScore: 76, listingSourceMode: 'EBAY_SHOPIFY', effectiveListingSourceMode: 'EBAY' }
    });
    expect(getUserAlertSettings(userId).listingSourceMode).toBe('EBAY_SHOPIFY');

    clearUser(userId);
  });

  it('enforces source access, updates supported currency, and rejects invalid or unsupported fields', async () => {
    const userId = 'web-settings-validation';
    const otherUserId = 'web-settings-validation-other';
    const headers = auth(userId, 'settings-validation-token');
    clearUser(otherUserId);
    setUserPlan(userId, 'FREE');
    setUserAlertSettings(userId, { alertCurrency: 'CAD' });
    setUserAlertSettings(otherUserId, { alertCurrency: 'CAD' });
    addChase({ userId, cardName: 'Owned Currency Chase', maxPrice: 200 });
    addChase({ userId: otherUserId, cardName: 'Other Currency Chase', maxPrice: 200 });

    const source = await handleWebRequest({ method: 'PATCH', url: '/api/settings', headers, body: JSON.stringify({ listingSourceMode: 'SHOPIFY' }) }, { config });
    const currency = await handleWebRequest({ method: 'PATCH', url: '/api/settings', headers, body: JSON.stringify({ alertCurrency: 'USD', minScore: 77, shippingCountry: 'GB' }) }, { config });
    const invalidCurrency = await handleWebRequest({ method: 'PATCH', url: '/api/settings', headers, body: JSON.stringify({ alertCurrency: 'AUD' }) }, { config });
    const unsupported = await handleWebRequest({ method: 'PATCH', url: '/api/settings', headers, body: JSON.stringify({ deliveryChannel: 'EMAIL' }) }, { config });

    expect(source.status).toBe(403);
    expect(JSON.parse(source.body ?? '{}')).toMatchObject({ error: 'PRO_REQUIRED', field: 'listingSourceMode' });
    expect(currency.status).toBe(200);
    expect(JSON.parse(currency.body ?? '{}')).toMatchObject({ settings: { alertCurrency: 'USD', minScore: 77, shippingCountry: 'GB' } });
    expect(listChases(userId)[0]?.maxPrice).toBe(150);
    expect(listChases(otherUserId)[0]?.maxPrice).toBe(200);
    expect(invalidCurrency.status).toBe(400);
    expect(JSON.parse(invalidCurrency.body ?? '{}')).toMatchObject({ error: 'INVALID_SETTINGS', field: 'alertCurrency' });
    expect(unsupported.status).toBe(400);
    expect(JSON.parse(unsupported.body ?? '{}')).toMatchObject({ error: 'INVALID_SETTINGS', field: 'deliveryChannel' });
    expect(getUserAlertSettings(userId)).toMatchObject({ alertCurrency: 'USD', minScore: 77, shippingCountry: 'GB', listingSourceMode: 'EBAY' });
    expect(getUserAlertSettings(otherUserId).alertCurrency).toBe('CAD');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('normalizes postal regions and clears them when the destination changes', async () => {
    const userId = 'web-settings-shipping';
    const headers = auth(userId, 'settings-shipping-token');

    const canadian = await handleWebRequest({
      method: 'PATCH',
      url: '/api/settings',
      headers,
      body: JSON.stringify({ shippingCountry: 'CA', shippingPostalCode: 'm5v 2t6' })
    }, { config });
    const british = await handleWebRequest({
      method: 'PATCH',
      url: '/api/settings',
      headers,
      body: JSON.stringify({ shippingCountry: 'GB' })
    }, { config });

    expect(JSON.parse(canadian.body ?? '{}').settings).toMatchObject({ shippingCountry: 'CA', shippingPostalCode: 'M5V' });
    expect(JSON.parse(british.body ?? '{}').settings).toMatchObject({ shippingCountry: 'GB', shippingPostalCode: null });
    expect(getUserAlertSettings(userId).shippingPostalCode).toBeUndefined();

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
        url: '/api/alerts?reviewState=NEW&priority=HIGH&source=SHOPIFY&chaseId=target-chase&limit=1',
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
        url: `/api/alerts?reviewState=NEW&priority=HIGH&source=SHOPIFY&chaseId=target-chase&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
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
    const invalidReviewState = await handleWebRequest({ method: 'GET', url: '/api/alerts?reviewState=ARCHIVED', headers: { cookie: sessionCookie(token) } }, { config });

    expect(JSON.parse(invalidLimit.body ?? '{}')).toEqual({ error: 'invalid_limit' });
    expect(JSON.parse(invalidCursor.body ?? '{}')).toEqual({ error: 'invalid_cursor' });
    expect(JSON.parse(invalidPriority.body ?? '{}')).toEqual({ error: 'invalid_priority' });
    expect(JSON.parse(invalidSource.body ?? '{}')).toEqual({ error: 'invalid_source' });
    expect(JSON.parse(invalidReviewState.body ?? '{}')).toEqual({ error: 'invalid_review_state' });

    clearUser(userId);
  });

  it('persists account-scoped review and dismissal actions without changing delivery state', async () => {
    const userId = 'web-alert-inbox-user';
    const otherUserId = 'web-alert-inbox-other';
    clearUser(userId);
    clearUser(otherUserId);
    const owned = seedAlert(userId, 1);
    seedAlert(userId, 2);
    const other = seedAlert(otherUserId, 3);
    const originalDeliveryStatus = (db.prepare('SELECT status FROM alert_events WHERE id = ?').get(owned.alertId) as { status: string }).status;
    const { token } = createWebSession({ userId }, { token: 'alert-inbox-token' });
    const cookie = { cookie: sessionCookie(token) };

    const initial = await handleWebRequest({ method: 'GET', url: '/api/alerts?reviewState=NEW', headers: cookie }, { config });
    expect(JSON.parse(initial.body ?? '{}').items).toHaveLength(2);

    const reviewed = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/review`, headers: cookie }, { config });
    const reviewedAgain = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/review`, headers: cookie }, { config });
    expect(reviewed.status).toBe(200);
    expect(JSON.parse(reviewed.body ?? '{}').item.reviewedAt).toBeTruthy();
    expect(JSON.parse(reviewedAgain.body ?? '{}').item.reviewedAt).toBe(JSON.parse(reviewed.body ?? '{}').item.reviewedAt);

    const reviewedList = await handleWebRequest({ method: 'GET', url: '/api/alerts?reviewState=REVIEWED', headers: cookie }, { config });
    expect(JSON.parse(reviewedList.body ?? '{}').items.map((item: { id: string }) => item.id)).toEqual([owned.alertId]);

    const dismissed = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/dismiss`, headers: cookie }, { config });
    expect(dismissed.status).toBe(200);
    expect(JSON.parse(dismissed.body ?? '{}').item.dismissedAt).toBeTruthy();
    const afterDismiss = await handleWebRequest({ method: 'GET', url: '/api/alerts', headers: cookie }, { config });
    expect(JSON.parse(afterDismiss.body ?? '{}').items.map((item: { id: string }) => item.id)).not.toContain(owned.alertId);

    const restored = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/restore`, headers: cookie }, { config });
    expect(restored.status).toBe(200);
    expect(JSON.parse(restored.body ?? '{}').item.dismissedAt).toBeUndefined();
    const markedNew = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/mark-new`, headers: cookie }, { config });
    expect(markedNew.status).toBe(200);
    expect(JSON.parse(markedNew.body ?? '{}').item.reviewedAt).toBeUndefined();

    const forbidden = await handleWebRequest({ method: 'POST', url: `/api/alerts/${other.alertId}/review`, headers: cookie }, { config });
    const missing = await handleWebRequest({ method: 'POST', url: '/api/alerts/missing-alert/review', headers: cookie }, { config });
    const unauthenticated = await handleWebRequest({ method: 'POST', url: `/api/alerts/${owned.alertId}/review` }, { config });
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(unauthenticated.status).toBe(401);
    expect((db.prepare('SELECT status FROM alert_events WHERE id = ?').get(owned.alertId) as { status: string }).status).toBe(originalDeliveryStatus);

    clearUser(userId);
    clearUser(otherUserId);
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
      imageReadyCount: 1,
      discovery: { state: 'POPULATED' }
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      position: 1,
      name: 'Mew CoroCoro Promo 151',
      imageUrl: 'https://example.test/mew-reference.png',
      setName: 'CoroCoro Promo',
      cardNumber: '151',
      language: 'JAPANESE',
      cardIdentity: { value: 'Mew CoroCoro Promo 151', sourceName: 'CURATED', sourceCardId: 'curated-151' },
      roleLabel: 'Right up your alley',
      signalLabel: 'Promo Trail',
      reason: 'Connects to the Japanese promo cards already in your Vault',
      market: { status: 'READY', currency: 'CAD', askingTotal: 185 }
    });
    expect(body.items[0].ebayUrl).toMatch(/^https:\/\/www\.ebay\.ca\/sch\/i\.html\?_nkw=/);
    expect(decodeURIComponent(new URL(body.items[0].ebayUrl).searchParams.get('_nkw') ?? '')).toContain('CoroCoro Shining Mew');
    expect(body.items[1].imageUrl).toBeUndefined();
    expect(body.items[1].reason).toBeUndefined();
    expect(body.items[1].signalLabel).toBe('Collector Thread');
    expect(body.items[1].ebayUrl).toMatch(/^https:\/\/www\.ebay\.ca\/sch\/i\.html\?_nkw=/);
    expect(JSON.stringify(body)).not.toContain('rankExplanation');
    expect(JSON.stringify(body)).not.toContain('CORE_MATCH');
    expect(JSON.stringify(body)).not.toContain('multi-card discovery');
    expect(JSON.stringify(body)).not.toContain('javascript:alert');
    expect(JSON.stringify(body)).not.toContain('internal-score-should-not-leak');

    clearUser(userId);
    clearUser(otherUserId);
  });

  it('keeps Weekly Shelf read-only and uses the Chase API as the write path', async () => {
    const userId = 'web-shelf-read-only-user';
    clearUser(userId);
    seedWeeklyShelf(userId);
    const { token } = createWebSession({ userId }, { token: 'shelf-read-only-token' });
    const headers = { cookie: sessionCookie(token) };

    const shelfRead = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const shelfItem = JSON.parse(shelfRead.body ?? '{}').items[0];

    const shelfWrite = await handleWebRequest(
      { method: 'POST', url: '/api/shelf', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ cardName: 'Mew RC24' }) },
      { config }
    );
    const chaseWrite = await handleWebRequest(
      {
        method: 'POST',
        url: '/api/chases',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ cardName: shelfItem.name, cardSelectionToken: shelfItem.selection.token })
      },
      { config }
    );

    expect(shelfWrite.status).toBe(404);
    expect(chaseWrite.status).toBe(201);
    expect(JSON.parse(chaseWrite.body ?? '{}').item.chase).toMatchObject({
      cardName: 'Mew CoroCoro Promo 151',
      cardImageUrl: 'https://example.test/mew-reference.png',
      cardIdentity: { sourceName: 'CURATED', sourceCardId: 'curated-151' }
    });

    clearUser(userId);
  });

  it('prefers a prepared target-period shelf over the still-current previous week', async () => {
    const userId = 'web-shelf-target-period-user';
    clearUser(userId);
    seedWeeklyShelf(userId, new Date('2026-08-24T13:00:00.000Z'), {
      name: 'W35 Shelf Card',
      cardNumber: '035',
      setName: 'Older Set',
      language: 'ENGLISH',
      updatedAt: '2026-08-21T12:00:00.000Z'
    });
    seedWeeklyShelf(userId, new Date('2026-08-31T13:00:00.000Z'), {
      name: 'W36 Shelf Card',
      cardNumber: '036',
      setName: 'Upcoming Set',
      language: 'ENGLISH',
      updatedAt: '2026-08-29T12:00:00.000Z'
    });
    const { token } = createWebSession({ userId }, { token: 'shelf-target-period-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.shelfKind).toBe('PREPARED');
    expect(body.periodKey).toBe('2026-W36');
    expect(body.items[0].name).toBe('W36 Shelf Card');
    expect(JSON.stringify(body)).not.toContain('W35 Shelf Card');

    clearUser(userId);
  });

  it('falls back to an older shelf only as an identifiable previous shelf', async () => {
    const userId = 'web-shelf-previous-user';
    clearUser(userId);
    seedWeeklyShelf(userId, new Date('2026-08-17T13:00:00.000Z'), {
      name: 'W34 Previous Shelf Card',
      cardNumber: '034',
      setName: 'Previous Set',
      language: 'ENGLISH',
      updatedAt: '2026-08-17T12:00:00.000Z'
    });
    const { token } = createWebSession({ userId }, { token: 'shelf-previous-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const body = JSON.parse(response.body ?? '{}');

    expect(response.status).toBe(200);
    expect(body.shelfKind).toBe('PREVIOUS');
    expect(body.periodKey).toBe('2026-W34');
    expect(body.items[0].name).toBe('W34 Previous Shelf Card');

    clearUser(userId);
  });

  it('builds encoded eBay search URLs from shelf card identity only', async () => {
    const userId = 'web-shelf-ebay-user';
    clearUser(userId);
    seedWeeklyShelf(userId, new Date('2026-08-31T13:00:00.000Z'), {
      name: 'Mega Gardevoir ex 087/063',
      cardNumber: '087/063',
      setName: 'Mega Symphonia',
      language: 'JAPANESE'
    });
    const { token } = createWebSession({ userId }, { token: 'shelf-ebay-token' });

    const response = await handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );
    const body = JSON.parse(response.body ?? '{}');
    const url = new URL(body.items[0].ebayUrl);
    const query = decodeURIComponent(url.searchParams.get('_nkw') ?? '');

    expect(url.origin).toBe('https://www.ebay.ca');
    expect(body.items.every((item: any) => /^https:\/\/www\.ebay\.ca\/sch\/i\.html\?_nkw=/.test(item.ebayUrl))).toBe(true);
    expect(query).toContain('Mega Gardevoir ex');
    expect(query).toContain('087/063');
    expect(query).toContain('Mega Symphonia');
    expect(query).toContain('Japanese');
    expect(query).not.toContain('Connects to');
    expect(query).not.toContain('feature tag');

    clearUser(userId);
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

  it('describes plan, signal, preparation, and editorial starter states honestly', async () => {
    const userId = 'web-shelf-discovery-state-user';
    clearUser(userId);
    const { token } = createWebSession({ userId }, { token: 'shelf-discovery-state-token' });
    const request = (webConfig = config) => handleWebRequest(
      { method: 'GET', url: '/api/shelf', headers: { cookie: sessionCookie(token) } },
      { config: webConfig, now: () => new Date('2026-08-30T13:00:00.000Z') }
    );

    const free = JSON.parse((await request()).body ?? '{}');
    expect(free.discovery).toMatchObject({ state: 'PLAN_RESTRICTED', tier: 'FREE', minimumSignalCount: 5 });
    expect(free.starterItems).toEqual([
      expect.objectContaining({ name: 'Mew CoroCoro Promo 151', imageUrl: '/onboarding-art/mew-corocoro-promo-151.webp' }),
      expect.objectContaining({ name: 'Pichu Expedition Base Set 22/165' }),
      expect.objectContaining({ name: 'Sylveon ex 212/187' })
    ]);
    expect(JSON.stringify(free.starterItems)).not.toContain('market');
    expect(JSON.stringify(free.starterItems)).not.toContain('reason');

    setUserPlan(userId, 'PRO');
    const thin = JSON.parse((await request()).body ?? '{}');
    expect(thin.discovery).toMatchObject({ state: 'INSUFFICIENT_SIGNALS', tier: 'PRO', uniqueSignalCount: 0, signalsNeeded: 5 });

    for (let index = 1; index <= 5; index += 1) addChase({ userId, cardName: `Distinct Card ${index}` });
    const waiting = JSON.parse((await request()).body ?? '{}');
    expect(waiting.discovery).toMatchObject({ state: 'AWAITING_PREPARATION', uniqueSignalCount: 5, signalsNeeded: 0 });

    const staging = JSON.parse((await request({ ...config, environmentLabel: 'Staging' })).body ?? '{}');
    expect(staging.discovery).toMatchObject({ state: 'PREPARATION_UNAVAILABLE', preparationExpected: false });

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
    expect(body.items).toEqual([]);
    expect(body.starterItems).toBeDefined();

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
          suggestion: { name: 'Shelf Card', lane: 'language-wide discovery', laneWhy: '', why: '', nearby: [] },
          imageUrl: 'https://static.example.test/pokemon-card-back.png',
          imageSourceKind: 'CARD_REFERENCE',
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
    expect(body.items[0]).toMatchObject({ name: 'Shelf Card', signalLabel: 'Language Trail', market: { status: 'MISSING', currency: 'USD' } });
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
      { method: 'POST', url: '/api/chases/chase-1/pause' },
      { method: 'POST', url: '/api/chases/chase-1/resume' },
      { method: 'POST', url: '/api/completed-chases/chase-1/reopen' },
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
    expect(body.options.plans).toEqual([
      expect.objectContaining({ tier: 'FREE', label: 'Free', maxActiveChases: 3, checkIntervalMinutes: 30, advancedFiltering: false, storefrontMonitoring: false }),
      expect.objectContaining({ tier: 'PRO', label: 'Vaultr Plus', maxActiveChases: 50, checkIntervalMinutes: 15, advancedFiltering: true, storefrontMonitoring: true })
    ]);
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

  it('persists a server-resolved Discover selection and rejects a mismatched printing name', async () => {
    const userId = 'web-chases-trusted-selection';
    const otherUserId = 'web-chases-trusted-selection-other';
    const headers = auth(userId, 'chases-trusted-selection-token');
    const otherHeaders = auth(otherUserId, 'chases-trusted-selection-other-token');
    const cardName = 'Mew CoroCoro Promo 151';
    __chaseCardCatalogTestHooks.cachePreview(cardName, {
      imageUrl: 'https://cards.example/mew-corocoro-151.png',
      imageIdentity: cardName,
      imageSourceName: 'CURATED',
      imageSourceKind: 'CARD_REFERENCE',
      imageSourceCardId: 'curated-mew-corocoro-151'
    });

    const selectionResponse = await handleWebRequest({
      method: 'GET',
      url: `/api/chases/selection?cardName=${encodeURIComponent(cardName)}`,
      headers
    }, { config });
    const selection = JSON.parse(selectionResponse.body ?? '{}').selection;
    expect(selectionResponse.status).toBe(200);
    expect(selection).toMatchObject({ value: cardName, imageUrl: 'https://cards.example/mew-corocoro-151.png' });

    const mismatch = await handleWebRequest({
      method: 'POST',
      url: '/api/chases',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ cardName: 'Mew Expedition Base Set 19', cardSelectionToken: selection.token })
    }, { config });
    expect(mismatch.status).toBe(400);
    expect(JSON.parse(mismatch.body ?? '{}').error).toBe('invalid_card_selection');

    const crossAccount = await handleWebRequest({
      method: 'POST',
      url: '/api/chases',
      headers: { ...otherHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ cardName, cardSelectionToken: selection.token })
    }, { config });
    expect(crossAccount.status).toBe(400);
    expect(listChases(otherUserId)).toHaveLength(0);

    const created = await handleWebRequest({
      method: 'POST',
      url: '/api/chases',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ cardName, cardSelectionToken: selection.token })
    }, { config });
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body ?? '{}').item.chase).toMatchObject({
      cardName,
      cardImageUrl: 'https://cards.example/mew-corocoro-151.png',
      cardIdentity: {
        value: cardName,
        sourceName: 'CURATED',
        sourceCardId: 'curated-mew-corocoro-151'
      }
    });

    const untrusted = await handleWebRequest({
      method: 'POST',
      url: '/api/chases',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        cardName: 'Mew Expedition Base Set 19',
        cardImageUrl: 'https://attacker.example/wrong-printing.png',
        cardImageSourceKind: 'CARD_REFERENCE'
      })
    }, { config });
    expect(untrusted.status).toBe(201);
    expect(JSON.parse(untrusted.body ?? '{}').item.chase.cardImageUrl).toBeUndefined();

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

  it('pauses, resumes, completes, and reopens only the authenticated account Chase', async () => {
    const userId = 'web-chases-lifecycle-user';
    const otherUserId = 'web-chases-lifecycle-other';
    const headers = auth(userId, 'chases-lifecycle-token');
    clearUser(otherUserId);
    setUserPlan(userId, 'PRO');
    const chase = addChase({
      userId,
      cardName: 'Mew RC24',
      maxPrice: 145,
      grade: 'PSA 9',
      condition: 'NM',
      listingType: 'BUY_IT_NOW',
      priority: 'GRAIL'
    });
    const other = addChase({ userId: otherUserId, cardName: 'Other Lifecycle Chase' });

    const pause = await handleWebRequest({ method: 'POST', url: `/api/chases/${chase.id}/pause`, headers }, { config });
    expect(pause.status).toBe(200);
    expect(JSON.parse(pause.body ?? '{}').item).toMatchObject({ monitoringState: 'PAUSED_USER', chase: { id: chase.id, maxPrice: 145 } });
    expect(listChases(userId)[0]?.pausedAt).toBeTruthy();

    const otherPause = await handleWebRequest({ method: 'POST', url: `/api/chases/${other.id}/pause`, headers }, { config });
    expect(otherPause.status).toBe(404);
    expect(listChases(otherUserId)[0]?.pausedAt).toBeUndefined();

    const resume = await handleWebRequest({ method: 'POST', url: `/api/chases/${chase.id}/resume`, headers }, { config });
    expect(resume.status).toBe(200);
    expect(JSON.parse(resume.body ?? '{}').item.monitoringState).toBe('ACTIVE');
    expect(listChases(userId)[0]?.pausedAt).toBeUndefined();

    const complete = await handleWebRequest({
      method: 'DELETE',
      url: `/api/chases/${chase.id}`,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'COMPLETED' })
    }, { config });
    expect(complete.status).toBe(200);

    const reopen = await handleWebRequest({ method: 'POST', url: `/api/completed-chases/${chase.id}/reopen`, headers }, { config });
    expect(reopen.status).toBe(200);
    expect(JSON.parse(reopen.body ?? '{}').item).toMatchObject({
      monitoringState: 'ACTIVE',
      chase: { id: chase.id, cardName: 'Mew RC24', maxPrice: 145, grade: 'PSA 9', condition: 'NM', listingType: 'BUY_IT_NOW', priority: 'GRAIL' }
    });
    expect(listCompletedChases(userId)).toHaveLength(0);

    const missingReopen = await handleWebRequest({ method: 'POST', url: `/api/completed-chases/${other.id}/reopen`, headers }, { config });
    expect(missingReopen.status).toBe(404);

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
    expect(JSON.parse(response.body ?? '{}').items).toContainEqual(expect.objectContaining({
      name: 'Mew — Southern Islands #1',
      value: 'Mew Southern Islands 1',
      selection: expect.objectContaining({ sourceName: 'POKEMONTCG', sourceCardId: 'si1-1' })
    }));

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
