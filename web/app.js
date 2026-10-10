const app = document.querySelector('#app');
const isPreviewMode = window.location.pathname === '/preview' || window.location.pathname === '/preview/';
const appHomePath = isPreviewMode ? '/preview' : '/app';

function apiUrl(url) {
  if (!isPreviewMode || !url.startsWith('/api/')) return url;
  return `/api/preview/${url.slice('/api/'.length)}`;
}

const state = {
  user: null,
  activePage: 'home',
  priority: 'ALL',
  source: 'ALL',
  alertChaseId: null,
  alertChaseName: '',
  alerts: [],
  alertsLoaded: false,
  alertsError: null,
  isAlertsLoading: false,
  nextCursor: null,
  requestId: 0,
  hasCheckedAllAlerts: false,
  isLoadingMore: false,
  vault: [],
  vaultFilter: 'ALL',
  completedChases: [],
  vaultPlan: null,
  vaultCurrency: 'CAD',
  vaultOptions: null,
  isVaultLoading: false,
  vaultLoaded: false,
  vaultError: null,
  shelf: null,
  isShelfLoading: false,
  shelfLoaded: false,
  shelfError: null,
  vaultNotice: '',
  vaultFormMode: null,
  vaultEditingId: null,
  vaultPrefillCardName: '',
  vaultFormError: '',
  vaultSubmitting: false,
  vaultAutocompleteTimer: null,
  vaultAutocompleteRequestId: 0,
  vaultAutocompleteItems: [],
  vaultAutocompleteOpen: false,
  vaultAutocompleteLoading: false,
  vaultAutocompleteUnavailable: false,
  vaultAutocompleteActiveIndex: -1,
  vaultAutocompleteQuery: '',
  removeTargetId: null,
  removeError: '',
  acquireTargetId: null,
  lifecycleError: ''
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function userDisplayName(user) {
  return user?.displayName || 'Collector';
}

function avatarHtml(user) {
  const name = userDisplayName(user);
  if (user?.avatarUrl) {
    return `<img class="avatar" src="${escapeHtml(user.avatarUrl)}" alt="">`;
  }
  return `<span class="avatar-fallback" aria-hidden="true">${escapeHtml(name.trim().charAt(0).toUpperCase() || 'V')}</span>`;
}

function currencySymbol(currency) {
  if (currency === 'CAD') return 'C$';
  if (currency === 'USD') return 'US$';
  return `${currency ?? ''} `;
}

function formatMoney(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  return `${currencySymbol(currency)}${amount.toFixed(2)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function planLabel(tier) {
  return tier === 'PRO' ? 'Full Vault' : 'Free Vault';
}

function priorityLabel(priority) {
  if (priority === 'GRAIL') return 'Grail';
  if (priority === 'HIGH') return 'High';
  return 'Casual';
}

function listingTypeLabel(value) {
  if (value === 'BUY_IT_NOW') return 'Buy Now';
  if (value === 'AUCTION') return 'Auction';
  return 'Any listing';
}

function pageFromHash(hash = window.location.hash) {
  const value = String(hash || '').replace(/^#/, '').toLowerCase();
  if (value === 'home' || value === 'vault' || value === 'alerts' || value === 'shelf') return value;
  return 'home';
}

async function loadActivePageData() {
  if (state.activePage === 'home') {
    await Promise.all([
      state.vaultLoaded ? Promise.resolve() : loadVault(),
      state.alertsLoaded ? Promise.resolve() : loadAlerts(),
      state.shelfLoaded ? Promise.resolve() : loadShelf()
    ]);
  }
  if (state.activePage === 'alerts' && !state.alertsLoaded) await loadAlerts();
  if (state.activePage === 'vault') await loadVault();
  if (state.activePage === 'shelf') await loadShelf();
}

async function navigateToPage(page, { updateHash = true } = {}) {
  const nextPage = page === 'home' || page === 'vault' || page === 'alerts' || page === 'shelf' ? page : 'home';
  if (updateHash && window.location.hash !== `#${nextPage}`) {
    window.location.hash = nextPage;
    return;
  }
  const pageChanged = state.activePage !== nextPage;
  state.activePage = nextPage;
  renderCurrentPage();
  await loadActivePageData();
  if (pageChanged) resetViewportForPage(nextPage);
}

function resetViewportForPage(page) {
  const heading = document.querySelector(`#${page}-title`);
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function gradeToChoices(grade) {
  if (!grade) return { gradingType: 'ANY', gradeValue: 'ANY' };
  if (grade === 'UNGRADED' || grade === 'RAW') return { gradingType: 'RAW', gradeValue: 'ANY' };
  const [type, value] = String(grade).split(/\s+/, 2);
  return { gradingType: type || 'ANY', gradeValue: value || 'ANY' };
}

function conditionToChoice(condition) {
  if (!condition) return 'ANY';
  if (condition === 'NM') return 'NM_OR_BETTER';
  if (condition === 'NM,LP') return 'LP_OR_BETTER';
  if (condition === 'NM,LP,MP') return 'MP_OR_BETTER';
  if (condition === 'NM,LP,MP,HP') return 'HP_OR_BETTER';
  if (condition === 'DMG') return 'DMG';
  return 'ANY';
}

function displayGradeValue(grade) {
  if (!grade) return 'Any grade';
  if (grade === 'UNGRADED') return 'Raw';
  return grade;
}

function displayConditionValue(condition) {
  const mapped = conditionToChoice(condition);
  const option = state.vaultOptions?.conditions?.find((item) => item.value === mapped);
  return option?.name || 'Any condition';
}

function optionMarkup(options, selected) {
  return (options || []).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selected ? ' selected' : ''}>${escapeHtml(option.name)}</option>`).join('');
}

function resetVaultAutocomplete() {
  window.clearTimeout(state.vaultAutocompleteTimer);
  state.vaultAutocompleteItems = [];
  state.vaultAutocompleteOpen = false;
  state.vaultAutocompleteLoading = false;
  state.vaultAutocompleteUnavailable = false;
  state.vaultAutocompleteActiveIndex = -1;
  state.vaultAutocompleteQuery = '';
}

function autocompleteListMarkup() {
  if (!state.vaultAutocompleteOpen) return '';
  if (state.vaultAutocompleteLoading) {
    return '<div class="card-suggestion-status" role="status">Searching cards...</div>';
  }
  if (!state.vaultAutocompleteItems.length && state.vaultAutocompleteQuery.length >= 2) {
    return state.vaultAutocompleteUnavailable
      ? '<div class="card-suggestion-status">Card search is temporarily unavailable. Try again in a moment.</div>'
      : '<div class="card-suggestion-status">No matching cards found. You can still use this name.</div>';
  }
  return state.vaultAutocompleteItems.map((item, index) => `
    <button
      id="card-suggestion-${index}"
      class="card-suggestion-option ${index === state.vaultAutocompleteActiveIndex ? 'active' : ''}"
      type="button"
      role="option"
      aria-selected="${index === state.vaultAutocompleteActiveIndex ? 'true' : 'false'}"
      data-action="select-card-suggestion"
      data-index="${index}"
    >
      <span>${escapeHtml(item.value)}</span>
      ${item.name && item.name !== item.value ? `<small>${escapeHtml(item.name)}</small>` : ''}
    </button>
  `).join('');
}

function updateAutocompleteDom(input) {
  const list = document.querySelector('#card-suggestion-list');
  if (!list) return;
  const hint = document.querySelector('#card-autocomplete-hint');
  const hasPopup = state.vaultAutocompleteOpen && (state.vaultAutocompleteLoading || state.vaultAutocompleteItems.length > 0 || state.vaultAutocompleteQuery.length >= 2);
  input.setAttribute('aria-expanded', hasPopup ? 'true' : 'false');
  input.setAttribute('aria-activedescendant', state.vaultAutocompleteActiveIndex >= 0 ? `card-suggestion-${state.vaultAutocompleteActiveIndex}` : '');
  if (hint) hint.hidden = hasPopup;
  list.hidden = !hasPopup;
  list.innerHTML = autocompleteListMarkup();
}

function apiErrorMessage(error) {
  const body = error?.body || {};
  if (body.message) return body.message;
  if (body.error === 'VAULT_LIMIT_REACHED') return 'This Vault has reached its active Chase limit.';
  if (body.error === 'DUPLICATE_CHASE') return 'That card is already saved in your Vault.';
  if (body.error === 'NO_APPLICABLE_CHANGES') return 'Those changes are Full Vault controls.';
  if (body.error === 'NO_CHANGES_REQUESTED') return 'Choose at least one change.';
  if (body.error === 'INVALID_GRADE_PREFERENCE') return 'Choose a valid grade preference.';
  if (body.error === 'TOO_MANY_CUSTOM_EXCLUSIONS') return 'Use at most 15 custom exclusions.';
  return 'Something went wrong. Try again.';
}

function formatPriceDelta(delta, currency) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return '';
  const value = formatMoney(Math.abs(delta), currency);
  if (!value) return '';
  if (delta > 0) return `${value} under max`;
  if (delta < 0) return `${value} over max`;
  return 'At max';
}

function matchLabel(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'Match found';
  if (score >= 85) return 'Strong match';
  if (score >= 65) return 'Good match';
  return 'Speculative match';
}

function sourceLabel(source) {
  if (source === 'EBAY') return 'eBay';
  if (source === 'SHOPIFY') return 'Trusted shop';
  return 'Source';
}

function relativeTime(value) {
  const created = Date.parse(value);
  if (Number.isNaN(created)) return '';
  const diffMs = Date.now() - created;
  if (diffMs < 60_000) return 'Just now';
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(created));
}

function signedOutMarkup() {
  return `
    <main id="app-main" class="signed-out">
      <section class="signed-out-card" aria-labelledby="signed-out-title">
        <div class="boot-mark" aria-hidden="true"><span>V</span></div>
        <h1 id="signed-out-title">Your collection, watched.</h1>
        <p>Track the cards you're chasing, review matches, and discover cards picked around your collection.</p>
        <a class="button-primary" href="/auth/discord">Sign in with Discord</a>
      </section>
    </main>
  `;
}

function shellMarkup(content) {
  const displayName = userDisplayName(state.user);
  return `
    <div class="app-shell">
      <aside class="app-sidebar">
        <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span>Vaultr</span>
        </a>
        <nav class="app-nav desktop-nav" aria-label="Vaultr app navigation">
          ${navButton('home', 'Home')}
          ${navButton('vault', 'My Vault')}
          ${navButton('alerts', 'Alerts')}
          ${navButton('shelf', 'Weekly Shelf')}
        </nav>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <span class="user-name">${escapeHtml(displayName)}</span>
          ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : '<button class="button-ghost" type="button" data-action="logout">Log out</button>'}
        </div>
      </aside>
      <header class="mobile-header">
        <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span>Vaultr</span>
        </a>
        <div class="user-area">
          ${avatarHtml(state.user)}
          ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : '<button class="button-ghost" type="button" data-action="logout">Log out</button>'}
        </div>
      </header>
      <main id="app-main" class="app-main">
        ${content}
      </main>
      <nav class="mobile-nav" aria-label="Vaultr mobile navigation">
        ${navButton('home', 'Home')}
        ${navButton('vault', 'My Vault')}
        ${navButton('alerts', 'Alerts')}
        ${navButton('shelf', 'Weekly Shelf')}
      </nav>
    </div>
  `;
}

function navButton(page, label) {
  const selected = state.activePage === page;
  return `<button class="nav-button" type="button" data-page="${page}" aria-selected="${selected ? 'true' : 'false'}">${label}</button>`;
}

function alertsPageMarkup(inner) {
  return `
    <section aria-labelledby="alerts-title">
      <header class="page-header">
        <p class="eyebrow">Alerts</p>
        <h1 id="alerts-title">What Vaultr found for your Chases</h1>
        <p>Matches worth a look, based on the cards and filters you saved.</p>
      </header>
      ${state.alertChaseId ? `
        <div class="active-chase-filter" role="status">
          <span>Matches for <strong>${escapeHtml(state.alertChaseName || 'this Chase')}</strong></span>
          <button class="button-ghost" type="button" data-action="clear-chase-filter">Clear filter</button>
        </div>
      ` : ''}
      <div class="toolbar">
        <div class="priority-filters" aria-label="Alert priority filters">
          ${priorityButton('ALL', 'All')}
          ${priorityButton('GRAIL', 'Grail')}
          ${priorityButton('HIGH', 'High')}
          ${priorityButton('NORMAL', 'Casual')}
        </div>
        <label>
          <span class="visually-hidden">Alert source</span>
          <select class="source-select" data-action="source-filter">
            <option value="ALL"${state.source === 'ALL' ? ' selected' : ''}>All sources</option>
            <option value="EBAY"${state.source === 'EBAY' ? ' selected' : ''}>eBay</option>
            <option value="SHOPIFY"${state.source === 'SHOPIFY' ? ' selected' : ''}>Trusted shops</option>
          </select>
        </label>
      </div>
      ${inner}
    </section>
  `;
}

function priorityButton(value, label) {
  return `<button class="pill-button" type="button" data-priority="${value}" aria-pressed="${state.priority === value ? 'true' : 'false'}">${label}</button>`;
}

function skeletonMarkup() {
  return alertsPageMarkup(`
    <div class="alert-list" aria-label="Loading alerts">
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    </div>
  `);
}

function statePanelMarkup(title, copy, actionLabel) {
  return `
    <div class="state-panel">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(copy)}</p>
      ${actionLabel ? `<button class="retry-button" type="button" data-action="retry-alerts">${escapeHtml(actionLabel)}</button>` : ''}
    </div>
  `;
}

function alertsMarkup() {
  if (!state.alerts.length) {
    if (state.priority === 'ALL' && state.source === 'ALL' && !state.hasCheckedAllAlerts) {
      return alertsPageMarkup(statePanelMarkup('Nothing here yet.', "When Vaultr finds a match for one of your Chases, it'll show up here."));
    }
    if (state.priority !== 'ALL') {
      const filteredPriority = state.priority === 'GRAIL' ? 'Grail' : state.priority === 'NORMAL' ? 'Casual' : 'High';
      return alertsPageMarkup(statePanelMarkup(`No ${filteredPriority} alerts yet.`, 'Try another priority or check back after Vaultr finds a new match.'));
    }
    return alertsPageMarkup(statePanelMarkup('No alerts for this source yet.', 'Try another source or check back after Vaultr finds a new match.'));
  }

  const list = state.alerts.map(alertCardMarkup).join('');
  const loadMore = state.nextCursor
    ? `<div class="load-more-row"><button class="button-ghost" type="button" data-action="load-more" ${state.isLoadingMore ? 'disabled' : ''}>${state.isLoadingMore ? 'Loading...' : 'Load more'}</button></div>`
    : '';
  return alertsPageMarkup(`<div class="alert-list" aria-label="Alerts">${list}</div>${loadMore}`);
}

function homeAlertPreviewMarkup(alert) {
  const price = formatMoney(alert.listingPrice, alert.listingCurrency);
  return `
    <li class="home-preview-row">
      <div>
        <strong>${escapeHtml(alert.chaseName || 'Saved Chase')}</strong>
        <span>${escapeHtml(alert.listingTitle || sourceLabel(alert.source))}</span>
      </div>
      ${price ? `<span class="home-preview-value">${escapeHtml(price)}</span>` : ''}
    </li>
  `;
}

function homeShelfPreviewMarkup(item) {
  return `
    <li class="home-shelf-pick">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" data-home-shelf-image>` : '<span class="home-shelf-placeholder" aria-hidden="true">V</span>'}
      <strong>${escapeHtml(item.name || 'Weekly Shelf pick')}</strong>
    </li>
  `;
}

function homePageMarkup() {
  const activeChases = state.vaultPlan?.activeCount ?? state.vault.length;
  const alertPreview = state.alerts.slice(0, 3);
  const shelfItems = state.shelf?.items || [];
  const shelfCount = state.shelf?.itemCount ?? shelfItems.length;
  const shelfReady = shelfItems.length > 0;

  return `
    <section class="home-page" aria-labelledby="home-title">
      <header class="page-header home-header">
        <p class="eyebrow">HOME</p>
        <h1 id="home-title">Welcome back, ${escapeHtml(userDisplayName(state.user))}</h1>
        <p>Your collection, matches, and discoveries in one place.</p>
      </header>
      <div class="home-grid">
        <section class="home-panel home-vault-panel" aria-labelledby="home-vault-title">
          <div class="home-panel-heading">
            <div>
              <p class="eyebrow">MY VAULT</p>
              <h2 id="home-vault-title">${state.isVaultLoading ? 'Loading your Vault...' : `${escapeHtml(activeChases)} active ${activeChases === 1 ? 'Chase' : 'Chases'}`}</h2>
            </div>
            ${state.vaultPlan ? `<span class="home-plan-label">${escapeHtml(planLabel(state.vaultPlan.tier))}</span>` : ''}
          </div>
          <p>${state.vaultError ? "Your Vault couldn't be loaded right now." : activeChases ? 'The cards Vaultr is actively watching for you.' : 'Add a card to start building your collection watchlist.'}</p>
          <div class="home-actions">
            <button class="button-primary" type="button" data-page="vault">View My Vault</button>
            <button class="button-ghost" type="button" data-action="open-add-chase" ${state.vaultLoaded ? '' : 'disabled'}>Add Chase</button>
          </div>
        </section>

        <section class="home-panel" aria-labelledby="home-alerts-title">
          <div class="home-panel-heading">
            <div>
              <p class="eyebrow">ALERTS</p>
              <h2 id="home-alerts-title">${state.isAlertsLoading ? 'Checking matches...' : `${state.alerts.length} recent ${state.alerts.length === 1 ? 'match' : 'matches'}`}</h2>
            </div>
          </div>
          ${state.alertsError
            ? '<p>Alerts could not be loaded right now.</p>'
            : alertPreview.length
              ? `<ul class="home-preview-list">${alertPreview.map(homeAlertPreviewMarkup).join('')}</ul>`
              : `<p>${state.alertsLoaded ? 'New matches will appear here when Vaultr finds them.' : 'Loading your latest matches...'}</p>`}
          <button class="home-text-link" type="button" data-page="alerts">View Alerts</button>
        </section>

        <section class="home-panel home-shelf-panel" aria-labelledby="home-shelf-title">
          <div class="home-panel-heading">
            <div>
              <p class="eyebrow">WEEKLY SHELF</p>
              <h2 id="home-shelf-title">${state.isShelfLoading ? 'Opening your Shelf...' : shelfReady ? `${escapeHtml(shelfCount)} collector picks` : 'Your next Shelf is brewing'}</h2>
            </div>
            ${shelfReady && state.shelf.marketReadyCount !== undefined ? `<span class="home-plan-label">${escapeHtml(state.shelf.marketReadyCount)} priced</span>` : ''}
          </div>
          ${state.shelfError
            ? '<p>Your Weekly Shelf could not be loaded right now.</p>'
            : shelfReady
              ? `<ul class="home-shelf-preview">${shelfItems.slice(0, 3).map(homeShelfPreviewMarkup).join('')}</ul>`
              : `<p>${state.shelfLoaded ? 'Personalized picks will appear when your next shelf is prepared.' : 'Loading your latest collector picks...'}</p>`}
          <button class="home-text-link" type="button" data-page="shelf">View Weekly Shelf</button>
        </section>
      </div>
      ${vaultDialogMarkup()}
    </section>
  `;
}

function alertCardMarkup(alert) {
  const priority = alert.chasePriority || 'NORMAL';
  const price = formatMoney(alert.listingPrice, alert.listingCurrency);
  const delta = formatPriceDelta(alert.priceDelta, alert.listingCurrency);
  const listingLink = alert.listingUrl
    ? `<a class="listing-link" href="${escapeHtml(alert.listingUrl)}" target="_blank" rel="noopener noreferrer">View listing</a>`
    : '';
  return `
    <article class="alert-card ${alert.imageUrl ? 'has-image' : 'no-image'}">
      ${alert.imageUrl ? `<img class="alert-image" src="${escapeHtml(alert.imageUrl)}" alt="${escapeHtml(alert.listingTitle || alert.chaseName || 'Alert listing image')}" loading="lazy" data-alert-image>` : ''}
      <div class="alert-content">
        <div class="alert-main">
          <div class="alert-meta">
            <span class="priority-pill ${priority === 'GRAIL' ? 'grail' : ''}">${escapeHtml(priority)}</span>
            <span class="alert-age">${escapeHtml(relativeTime(alert.createdAt))}</span>
          </div>
          <h2 class="chase-name">${escapeHtml(alert.chaseName || 'Saved Chase')}</h2>
          ${alert.listingTitle ? `<p class="listing-title">${escapeHtml(alert.listingTitle)}</p>` : ''}
          <div class="price-line">
            ${price ? `<span class="price">${escapeHtml(price)}</span>` : ''}
            ${delta ? `<span class="price-delta">${escapeHtml(delta)}</span>` : ''}
          </div>
        </div>
        <div class="alert-footer">
          <span class="match-pill">${escapeHtml(matchLabel(alert.matchScore))}</span>
          <span class="source-pill">${escapeHtml(sourceLabel(alert.source))}</span>
          ${listingLink}
        </div>
      </div>
    </article>
  `;
}

function vaultPageMarkup() {
  if (state.isVaultLoading) {
    return `
      <section aria-labelledby="vault-title">
        ${vaultHeaderMarkup()}
        <div class="alert-list" aria-label="Loading Vault">
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
        </div>
      </section>
    `;
  }
  if (state.vaultError) {
    return `
      <section aria-labelledby="vault-title">
        ${vaultHeaderMarkup()}
        ${statePanelMarkup("Couldn't load your Vault.", 'Try again when you are ready.', 'Try again').replace('data-action="retry-alerts"', 'data-action="retry-vault"')}
      </section>
    `;
  }
  const items = (state.vault || []).filter((item) => {
    if (state.vaultFilter === 'WATCHING') return item.monitoringState === 'ACTIVE';
    if (state.vaultFilter === 'PAUSED') return item.monitoringState !== 'ACTIVE';
    if (state.vaultFilter === 'COMPLETED') return false;
    return true;
  });
  const completed = state.vaultFilter === 'ALL' || state.vaultFilter === 'COMPLETED' ? state.completedChases || [] : [];
  const hasVisibleRows = items.length > 0 || completed.length > 0;
  const emptyState = hasVisibleRows
    ? ''
    : state.vaultFilter === 'ALL'
      ? vaultEmptyMarkup()
      : '<div class="state-panel"><h2>No Chases in this view</h2><p>Choose another lifecycle filter to see the rest of your Vault.</p></div>';
  return `
    <section aria-labelledby="vault-title">
      ${vaultHeaderMarkup()}
      ${state.vaultNotice ? `<div class="vault-notice" role="status">${escapeHtml(state.vaultNotice)}</div>` : ''}
      ${vaultSummaryMarkup()}
      ${vaultLifecycleFiltersMarkup()}
      ${items.length ? `<div class="vault-grid" aria-label="Saved Chases">${items.map(vaultCardMarkup).join('')}</div>` : ''}
      ${emptyState}
      ${completedChasesSectionMarkup(completed)}
      ${vaultDialogMarkup()}
      ${removeDialogMarkup()}
      ${acquireDialogMarkup()}
    </section>
  `;
}

function vaultLifecycleFiltersMarkup() {
  const filters = [['ALL', 'All'], ['WATCHING', 'Watching'], ['PAUSED', 'Paused'], ['COMPLETED', 'Completed']];
  return `<div class="vault-lifecycle-filters" aria-label="Vault lifecycle filters">${filters.map(([value, label]) => `<button class="pill-button" type="button" data-vault-filter="${value}" aria-pressed="${state.vaultFilter === value ? 'true' : 'false'}">${label}</button>`).join('')}</div>`;
}

function vaultHeaderMarkup() {
  return `
    <header class="page-header vault-page-header">
      <div>
        <p class="eyebrow">MY VAULT</p>
        <h1 id="vault-title">The cards Vaultr is watching for you</h1>
        <p>Add, refine, or complete a Chase without leaving your Vault.</p>
      </div>
      <button class="button-primary vault-add-button" type="button" data-action="open-add-chase">Add Chase</button>
    </header>
    <p class="vault-auto-filter-note">Common proxy, reprint, lot, code-card, and non-card listings are filtered automatically.</p>
  `;
}

function vaultSummaryMarkup() {
  const plan = state.vaultPlan || {};
  const active = plan.activeCount ?? 0;
  const max = plan.maxActiveChases ?? 0;
  const paused = plan.pausedCount ?? 0;
  const completed = state.completedChases?.length ?? 0;
  return `
    <div class="vault-summary" aria-label="Vault plan summary">
      <div>
        <span class="summary-label">Active Chases</span>
        <strong>${escapeHtml(active)} / ${escapeHtml(max)}</strong>
      </div>
      <div>
        <span class="summary-label">Plan</span>
        <strong>${escapeHtml(planLabel(plan.tier))}</strong>
      </div>
      ${completed > 0 ? `<div>
        <span class="summary-label">Completed</span>
        <strong>${escapeHtml(completed)}</strong>
      </div>` : ''}
      ${paused > 0 ? `<p>${escapeHtml(paused)} saved ${paused === 1 ? 'Chase is' : 'Chases are'} currently paused or outside the monitoring limit.</p>` : ''}
    </div>
  `;
}

function vaultEmptyMarkup() {
  return `
    <div class="state-panel vault-empty">
      <h2>Your Vault is ready for its first Chase</h2>
      <p>Save a specific card and Vaultr will start watching for listings that match your preferences.</p>
      <button class="button-primary" type="button" data-action="open-add-chase">Add a Chase</button>
    </div>
  `;
}

function vaultCardMarkup(item) {
  const chase = item.chase || {};
  const paused = item.monitoringState !== 'ACTIVE';
  const userPaused = item.monitoringState === 'PAUSED_USER';
  const statusLabel = userPaused ? 'Paused' : item.monitoringState === 'PAUSED_PLAN_LIMIT' ? 'Plan limit' : 'Watching';
  const details = [
    chase.maxPrice !== undefined ? `Max ${formatMoney(chase.maxPrice, state.vaultCurrency)}` : undefined,
    chase.grade ? displayGradeValue(chase.grade) : undefined,
    chase.condition ? displayConditionValue(chase.condition) : undefined,
    chase.listingType && chase.listingType !== 'ANY' ? listingTypeLabel(chase.listingType) : undefined
  ].filter(Boolean);
  return `
    <article class="vault-card ${paused ? 'paused' : ''}">
      ${chase.cardImageUrl ? `<img class="vault-card-image" src="${escapeHtml(chase.cardImageUrl)}" alt="${escapeHtml(chase.cardName)} card image" loading="lazy" data-vault-card-image>` : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
      <div class="vault-card-body">
        <div class="vault-card-meta">
          <span class="status-pill ${paused ? 'paused' : 'active'}">${statusLabel}</span>
          <span class="priority-pill ${chase.priority === 'GRAIL' ? 'grail' : ''}">${escapeHtml(priorityLabel(chase.priority))}</span>
        </div>
        <h2>${escapeHtml(chase.cardName || 'Saved Chase')}</h2>
        ${item.monitoringState === 'PAUSED_PLAN_LIMIT' ? '<p class="paused-copy">Saved in your Vault, but not monitored under the current plan limit.</p>' : userPaused ? '<p class="paused-copy">Watching is paused. Your Chase criteria are preserved.</p>' : ''}
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        ${chase.targetNote ? `<p class="vault-note">${escapeHtml(chase.targetNote)}</p>` : ''}
        ${chase.negativeKeywords?.length ? `<p class="vault-note">Custom exclusions: ${escapeHtml(chase.negativeKeywords.join(', '))}</p>` : ''}
        <div class="vault-actions">
          <button class="vault-action-link" type="button" data-action="view-chase-matches" data-chase-id="${escapeHtml(chase.id)}" data-card-name="${escapeHtml(chase.cardName)}">View matches</button>
          <button class="button-ghost" type="button" data-action="open-edit-chase" data-chase-id="${escapeHtml(chase.id)}">Edit</button>
          ${item.monitoringState === 'ACTIVE' ? `<button class="vault-action-link" type="button" data-action="pause-chase" data-chase-id="${escapeHtml(chase.id)}">Pause</button>` : userPaused ? `<button class="vault-action-link" type="button" data-action="resume-chase" data-chase-id="${escapeHtml(chase.id)}">Resume</button>` : ''}
          <button class="vault-action-link acquired" type="button" data-action="open-acquire-chase" data-chase-id="${escapeHtml(chase.id)}">Mark acquired</button>
          <button class="button-ghost danger" type="button" data-action="open-remove-chase" data-chase-id="${escapeHtml(chase.id)}">Remove</button>
        </div>
      </div>
    </article>
  `;
}

function completedChaseMarkup(chase) {
  const completedDate = chase.completedAt ? formatDate(chase.completedAt) : '';
  const details = [
    completedDate ? `Completed ${completedDate}` : 'Completed',
    chase.maxPrice !== undefined ? `Max ${formatMoney(chase.maxPrice, state.vaultCurrency)}` : undefined,
    chase.grade ? displayGradeValue(chase.grade) : undefined,
    chase.condition ? displayConditionValue(chase.condition) : undefined,
    chase.listingType && chase.listingType !== 'ANY' ? listingTypeLabel(chase.listingType) : undefined,
    chase.priority ? priorityLabel(chase.priority) : undefined
  ].filter(Boolean);
  return `
    <article class="vault-card completed">
      ${chase.cardImageUrl ? `<img class="vault-card-image" src="${escapeHtml(chase.cardImageUrl)}" alt="${escapeHtml(chase.cardName)} card image" loading="lazy" data-vault-card-image>` : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
      <div class="vault-card-body">
        <div class="vault-card-meta">
          <span class="status-pill completed">Completed</span>
        </div>
        <h2>${escapeHtml(chase.cardName || 'Completed Chase')}</h2>
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        <div class="vault-actions">
          <button class="vault-action-link" type="button" data-action="reopen-chase" data-chase-id="${escapeHtml(chase.id)}">Reopen Chase</button>
        </div>
      </div>
    </article>
  `;
}

function completedChasesSectionMarkup(completed = state.completedChases || []) {
  if (!completed.length) return '';
  return `
    <section class="completed-vault-section" aria-labelledby="completed-vault-title">
      <div class="section-heading">
        <p class="eyebrow">COMPLETED CHASES</p>
        <h2 id="completed-vault-title">Found cards, kept as history</h2>
      </div>
      <div class="vault-grid completed-grid" aria-label="Completed Chases">
        ${completed.map(completedChaseMarkup).join('')}
      </div>
    </section>
  `;
}

function shelfPageMarkup() {
  if (state.isShelfLoading) {
    return `
      <section aria-labelledby="shelf-title">
        ${shelfHeaderMarkup()}
        <div class="shelf-grid" aria-label="Loading Weekly Shelf">
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
        </div>
      </section>
    `;
  }
  if (state.shelfError) {
    return `
      <section aria-labelledby="shelf-title">
        ${shelfHeaderMarkup()}
        ${statePanelMarkup("Couldn't load your Weekly Shelf.", 'Try again when you are ready.', 'Try again').replace('data-action="retry-alerts"', 'data-action="retry-shelf"')}
      </section>
    `;
  }
  const items = state.shelf?.items || [];
  return `
    <section aria-labelledby="shelf-title">
      ${shelfHeaderMarkup()}
      ${state.vaultNotice ? `<div class="vault-notice" role="status">${escapeHtml(state.vaultNotice)}</div>` : ''}
      ${items.length ? shelfMetaMarkup(state.shelf) : ''}
      ${items.length ? `<div class="shelf-grid" aria-label="Weekly Shelf picks">${items.map(shelfCardMarkup).join('')}</div>` : shelfEmptyMarkup()}
      ${vaultDialogMarkup()}
    </section>
  `;
}

function shelfHeaderMarkup() {
  return `
    <header class="page-header shelf-page-header">
      <p class="eyebrow">WEEKLY SHELF</p>
      <h1 id="shelf-title">Collector discoveries picked for you</h1>
      <p>Personalized picks shaped by your Vault, completed Chases, and the cards you keep coming back to.</p>
    </header>
  `;
}

function shelfMetaMarkup(shelf) {
  const updated = shelf.updatedAt ? formatDate(shelf.updatedAt) : '';
  const marketReady = shelf.marketReadyCount !== undefined && shelf.itemCount !== undefined
    ? `${shelf.marketReadyCount} priced`
    : '';
  const details = [
    shelf.periodKey,
    shelf.shelfKind === 'PREVIOUS' ? 'Previous shelf' : shelf.status === 'READY' ? 'Ready' : shelf.status === 'PARTIAL' ? 'Preview' : '',
    `${shelf.itemCount || shelf.items?.length || 0} picks`,
    marketReady,
    updated ? `Updated ${updated}` : ''
  ].filter(Boolean);
  return `
    <div class="shelf-summary" aria-label="Weekly Shelf summary">
      ${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}
    </div>
  `;
}

function shelfEmptyMarkup() {
  return `
    <div class="state-panel shelf-empty">
      <h2>Your next Weekly Shelf is brewing</h2>
      <p>Personalized picks will appear here when your next shelf is prepared.</p>
    </div>
  `;
}

function shelfCardMarkup(item) {
  const details = [item.setName, item.language].filter(Boolean);
  const price = item.market?.askingTotal !== undefined
    ? formatMoney(item.market.askingTotal, item.market.currency)
    : item.market?.soldTotal !== undefined
      ? formatMoney(item.market.soldTotal, item.market.currency)
      : '';
  const priceLabel = item.market?.askingTotal !== undefined ? 'Market' : item.market?.soldTotal !== undefined ? 'Sold' : '';
  return `
    <article class="shelf-card">
      ${item.imageUrl ? `<img class="shelf-card-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)} card image" loading="lazy" data-shelf-card-image>` : '<div class="shelf-card-image placeholder-image shelf-image-unavailable"><span>Image unavailable</span></div>'}
      <div class="shelf-card-body">
        <div class="shelf-card-meta">
          ${item.signalLabel ? `<span class="source-pill">${escapeHtml(item.signalLabel)}</span>` : ''}
        </div>
        <h2>${escapeHtml(item.name || 'Weekly Shelf pick')}</h2>
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        ${item.reason ? `<p class="shelf-reason">${escapeHtml(item.reason)}</p>` : ''}
        <div class="shelf-card-footer">
          ${price ? `<p class="shelf-price"><span>${escapeHtml(priceLabel)}</span>${escapeHtml(price)}</p>` : ''}
          <div class="shelf-card-actions">
            <button class="button-primary shelf-add-button" type="button" data-action="add-shelf-card-to-vault" data-card-name="${escapeHtml(item.name || '')}">Add to Vault</button>
            ${item.ebayUrl ? `<a class="listing-link shelf-ebay-link" href="${escapeHtml(item.ebayUrl)}" target="_blank" rel="noopener noreferrer">View on eBay</a>` : ''}
          </div>
        </div>
      </div>
    </article>
  `;
}

function vaultDialogMarkup() {
  if (!state.vaultFormMode) return '';
  const editing = state.vaultFormMode === 'edit';
  const item = editing ? state.vault.find((entry) => entry.chase.id === state.vaultEditingId) : null;
  const chase = editing ? item?.chase || {} : { cardName: state.vaultPrefillCardName };
  const grade = gradeToChoices(chase.grade);
  const isFullVault = state.vaultPlan?.tier === 'PRO';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="vault-dialog" data-vault-form="${editing ? 'edit' : 'add'}" aria-labelledby="vault-form-title">
        <header>
          <p class="eyebrow">${editing ? 'EDIT CHASE' : 'ADD CHASE'}</p>
          <h2 id="vault-form-title">${editing ? 'Refine this Chase' : 'Add a Chase'}</h2>
        </header>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. You can inspect this form, but changes will not be saved.</p>' : ''}
        ${state.vaultFormError ? `<p class="form-error" role="alert">${escapeHtml(state.vaultFormError)}</p>` : ''}
        <label class="field">
          <span>Card</span>
          <div class="card-autocomplete">
            <input
              id="vault-card-input"
              name="cardName"
              type="text"
              required
              maxlength="100"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="card-suggestion-list"
              aria-expanded="false"
              aria-describedby="card-autocomplete-hint"
              value="${escapeHtml(chase.cardName || '')}"
            >
            <p id="card-autocomplete-hint" class="field-hint">Start typing a card name to see suggestions</p>
            <div id="card-suggestion-list" class="card-suggestion-list" role="listbox" hidden></div>
          </div>
        </label>
        <div class="form-grid">
          <label class="field">
            <span>Max price</span>
            <input name="maxPrice" type="number" min="0.01" step="0.01" value="${chase.maxPrice !== undefined ? escapeHtml(chase.maxPrice) : ''}">
          </label>
          <label class="field">
            <span>Grading type</span>
            <select name="gradingType">${optionMarkup(state.vaultOptions?.gradingTypes, grade.gradingType)}</select>
          </label>
          <label class="field">
            <span>Grade value</span>
            <select name="gradeValue">${optionMarkup(state.vaultOptions?.gradeValues, grade.gradeValue)}</select>
          </label>
        </div>
        <fieldset class="advanced-fields" ${isFullVault ? '' : 'disabled'}>
          <legend>Full Vault controls${isFullVault ? '' : ' · Full Vault'}</legend>
          <div class="form-grid">
            <label class="field">
              <span>Condition</span>
              <select name="condition">${optionMarkup(state.vaultOptions?.conditions, conditionToChoice(chase.condition))}</select>
            </label>
            <label class="field">
              <span>Listing type</span>
              <select name="listingType">${optionMarkup(state.vaultOptions?.listingTypes, chase.listingType || 'ANY')}</select>
            </label>
            <label class="field">
              <span>Priority</span>
              <select name="priority">${optionMarkup(state.vaultOptions?.priorities, chase.priority || 'NORMAL')}</select>
            </label>
          </div>
          <label class="field">
            <span>Target note</span>
            <input name="targetNote" type="text" maxlength="120" value="${escapeHtml(chase.targetNote || '')}">
          </label>
          <label class="field">
            <span>Custom exclusions</span>
            <input name="customExclusions" type="text" maxlength="240" value="${escapeHtml(chase.negativeKeywords?.join(', ') || '')}">
          </label>
        </fieldset>
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="close-vault-dialog">Cancel</button>
          <button class="button-primary" type="submit" ${state.vaultSubmitting ? 'disabled' : ''}>${state.vaultSubmitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Chase'}</button>
        </footer>
      </form>
    </div>
  `;
}

function removeDialogMarkup() {
  if (!state.removeTargetId) return '';
  const item = state.vault.find((entry) => entry.chase.id === state.removeTargetId);
  if (!item) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="vault-dialog" aria-labelledby="remove-title">
        <header>
          <p class="eyebrow">REMOVE CHASE</p>
          <h2 id="remove-title">Remove ${escapeHtml(item.chase.cardName)}?</h2>
        </header>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. This Chase will not be removed.</p>' : ''}
        ${state.removeError ? `<p class="form-error" role="alert">${escapeHtml(state.removeError)}</p>` : ''}
        <div class="remove-options">
          <button class="button-ghost remove-option" type="button" data-action="remove-chase" data-outcome="NO_LONGER_INTERESTED">
            <span class="remove-option-title">No longer interested</span>
            <span class="remove-option-copy">Remove it without marking it completed</span>
          </button>
          <button class="button-ghost remove-option" type="button" data-action="remove-chase" data-outcome="ADDED_BY_MISTAKE">
            <span class="remove-option-title">Added by mistake</span>
            <span class="remove-option-copy">Remove it without changing my collector profile</span>
          </button>
        </div>
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="close-remove-dialog">Cancel</button>
        </footer>
      </section>
    </div>
  `;
}

function acquireDialogMarkup() {
  if (!state.acquireTargetId) return '';
  const item = state.vault.find((entry) => entry.chase.id === state.acquireTargetId);
  if (!item) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="vault-dialog" aria-labelledby="acquire-title">
        <header>
          <p class="eyebrow">MARK ACQUIRED</p>
          <h2 id="acquire-title">Mark ${escapeHtml(item.chase.cardName)} as acquired?</h2>
        </header>
        <p>Vaultr will stop watching this Chase and keep it in your completed history.</p>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. This Chase will not be changed.</p>' : ''}
        ${state.lifecycleError ? `<p class="form-error" role="alert">${escapeHtml(state.lifecycleError)}</p>` : ''}
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="close-acquire-dialog">Cancel</button>
          <button class="button-primary" type="button" data-action="confirm-acquire-chase">Mark acquired</button>
        </footer>
      </section>
    </div>
  `;
}

function renderSignedOut() {
  state.user = null;
  app.innerHTML = signedOutMarkup();
}

function renderShell(content) {
  app.innerHTML = shellMarkup(content);
}

function renderCurrentPage() {
  if (!state.user) {
    renderSignedOut();
    return;
  }
  if (state.activePage === 'home') {
    renderShell(homePageMarkup());
    return;
  }
  if (state.activePage === 'vault') {
    renderShell(vaultPageMarkup());
    return;
  }
  if (state.activePage === 'shelf') {
    renderShell(shelfPageMarkup());
    return;
  }
  renderShell(alertsMarkup());
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (isPreviewMode && method !== 'GET') {
    const error = new Error('preview_read_only');
    error.status = 405;
    throw error;
  }
  const response = await fetch(apiUrl(url), { credentials: 'same-origin', ...options });
  let body = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await response.json().catch(() => null);
  }
  if (response.status === 401) {
    renderSignedOut();
    const error = new Error('unauthorized');
    error.status = 401;
    error.body = body;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(body?.error || 'request_failed');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function alertQuery(cursor) {
  const params = new URLSearchParams();
  if (state.priority !== 'ALL') params.set('priority', state.priority);
  if (state.source !== 'ALL') params.set('source', state.source);
  if (state.alertChaseId) params.set('chaseId', state.alertChaseId);
  if (cursor) params.set('cursor', cursor);
  return params.toString() ? `/api/alerts?${params.toString()}` : '/api/alerts';
}

async function loadAlerts({ append = false } = {}) {
  const requestId = ++state.requestId;
  if (!append) {
    state.alerts = [];
    state.nextCursor = null;
    state.hasCheckedAllAlerts = false;
    state.isAlertsLoading = true;
    state.alertsError = null;
    if (state.activePage === 'alerts') renderShell(skeletonMarkup());
    else renderCurrentPage();
  } else {
    state.isLoadingMore = true;
    renderCurrentPage();
  }

  try {
    const body = await fetchJson(alertQuery(append ? state.nextCursor : null));
    if (requestId !== state.requestId) return;
    state.alerts = append ? state.alerts.concat(body.items || []) : body.items || [];
    state.alertsLoaded = true;
    state.alertsError = null;
    state.isAlertsLoading = false;
    state.nextCursor = body.nextCursor || null;
    state.isLoadingMore = false;
    if (state.priority !== 'ALL' || state.source !== 'ALL') {
      state.hasCheckedAllAlerts = true;
    }
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    if (requestId !== state.requestId) return;
    state.isLoadingMore = false;
    state.isAlertsLoading = false;
    state.alertsError = 'load_failed';
    if (state.activePage === 'alerts') {
      renderShell(alertsPageMarkup(statePanelMarkup("Couldn't load your alerts.", 'Try again when you are ready.', 'Try again')));
    } else {
      renderCurrentPage();
    }
  }
}

async function loadVault({ force = false } = {}) {
  if (state.vaultLoaded && !force) {
    renderCurrentPage();
    return;
  }
  state.isVaultLoading = true;
  state.vaultError = null;
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/chases');
    state.vault = body.items || [];
    state.completedChases = body.completedItems || [];
    state.vaultPlan = body.plan || null;
    state.vaultCurrency = body.currency || 'CAD';
    state.vaultOptions = body.options || null;
    state.vaultLoaded = true;
    state.isVaultLoading = false;
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.vaultError = 'load_failed';
    state.isVaultLoading = false;
    renderCurrentPage();
  }
}

async function ensureVaultLoaded() {
  if (!state.vaultLoaded || !state.vaultOptions || !state.vaultPlan) {
    await loadVault({ force: true });
  }
  return state.vaultLoaded;
}

async function loadShelf({ force = false } = {}) {
  if (state.shelfLoaded && !force) {
    renderCurrentPage();
    return;
  }
  state.isShelfLoading = true;
  state.shelfError = null;
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/shelf');
    state.shelf = body || null;
    state.shelfLoaded = true;
    state.isShelfLoading = false;
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.shelfError = 'load_failed';
    state.isShelfLoading = false;
    renderCurrentPage();
  }
}

function vaultFormBody(form) {
  const data = new FormData(form);
  const body = {};
  const editing = state.vaultFormMode === 'edit';
  const current = editing ? state.vault.find((entry) => entry.chase.id === state.vaultEditingId)?.chase : null;
  const cardName = String(data.get('cardName') || '').trim();
  if (cardName) body.cardName = cardName;
  const maxPriceRaw = String(data.get('maxPrice') || '').trim();
  if (maxPriceRaw) body.maxPrice = Number(maxPriceRaw);
  else if (editing && current?.maxPrice !== undefined) body.maxPrice = null;
  const gradingType = String(data.get('gradingType') || 'ANY');
  const gradeValue = String(data.get('gradeValue') || 'ANY');
  if (gradingType) body.gradingType = gradingType;
  if (gradeValue) body.gradeValue = gradeValue;
  const advancedDisabled = form.querySelector('.advanced-fields')?.disabled;
  if (!advancedDisabled) {
    body.condition = String(data.get('condition') || 'ANY');
    body.listingType = String(data.get('listingType') || 'ANY');
    body.priority = String(data.get('priority') || 'NORMAL');
    const targetNote = String(data.get('targetNote') || '').trim();
    if (targetNote) body.targetNote = targetNote;
    else if (editing && current?.targetNote) body.targetNote = null;
    const customExclusions = String(data.get('customExclusions') || '').trim();
    if (customExclusions) body.customExclusions = customExclusions;
    else if (editing && current?.negativeKeywords?.length) body.customExclusions = null;
  }
  return body;
}

async function submitVaultForm(form) {
  if (isPreviewMode) {
    state.vaultFormError = 'Preview mode is read-only. No changes were saved.';
    renderCurrentPage();
    return;
  }
  state.vaultSubmitting = true;
  state.vaultFormError = '';
  renderCurrentPage();
  const body = vaultFormBody(form);
  const editing = state.vaultFormMode === 'edit';
  try {
    const response = await fetchJson(editing ? `/api/chases/${encodeURIComponent(state.vaultEditingId)}` : '/api/chases', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    state.vaultNotice = response.blockedControls?.length
      ? `Saved. Some Full Vault controls were not applied: ${response.blockedControls.join(', ')}.`
      : editing ? 'Chase updated.' : 'Chase added.';
    state.vaultFormMode = null;
    state.vaultEditingId = null;
    state.vaultPrefillCardName = '';
    state.vaultSubmitting = false;
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.vaultSubmitting = false;
    state.vaultFormError = apiErrorMessage(error);
    renderCurrentPage();
  }
}

function scheduleAutocomplete(input) {
  window.clearTimeout(state.vaultAutocompleteTimer);
  const requestId = ++state.vaultAutocompleteRequestId;
  const query = input.value.trim();
  state.vaultAutocompleteQuery = query;
  state.vaultAutocompleteActiveIndex = -1;
  if (query.length < 2) {
    state.vaultAutocompleteItems = [];
    state.vaultAutocompleteOpen = false;
    state.vaultAutocompleteLoading = false;
    state.vaultAutocompleteUnavailable = false;
    updateAutocompleteDom(input);
    return;
  }
  state.vaultAutocompleteItems = [];
  state.vaultAutocompleteOpen = true;
  state.vaultAutocompleteLoading = true;
  state.vaultAutocompleteUnavailable = false;
  updateAutocompleteDom(input);
  state.vaultAutocompleteTimer = window.setTimeout(async () => {
    try {
      const body = await fetchJson(`/api/chases/autocomplete?q=${encodeURIComponent(query)}`);
      if (requestId !== state.vaultAutocompleteRequestId || input.value.trim() !== query) return;
      state.vaultAutocompleteItems = body.items || [];
      state.vaultAutocompleteUnavailable = body.unavailable === true;
      state.vaultAutocompleteOpen = true;
      state.vaultAutocompleteLoading = false;
      state.vaultAutocompleteActiveIndex = -1;
      updateAutocompleteDom(input);
    } catch {
      if (requestId !== state.vaultAutocompleteRequestId) return;
      state.vaultAutocompleteItems = [];
      state.vaultAutocompleteUnavailable = true;
      state.vaultAutocompleteOpen = true;
      state.vaultAutocompleteLoading = false;
      updateAutocompleteDom(input);
    }
  }, 240);
}

function selectAutocompleteSuggestion(index) {
  const item = state.vaultAutocompleteItems[index];
  const input = document.querySelector('#vault-card-input');
  if (!item || !(input instanceof HTMLInputElement)) return;
  input.value = item.value;
  resetVaultAutocomplete();
  updateAutocompleteDom(input);
  input.focus();
}

function moveAutocompleteActive(delta, input) {
  if (!state.vaultAutocompleteItems.length) return;
  const count = state.vaultAutocompleteItems.length;
  const next = state.vaultAutocompleteActiveIndex < 0
    ? delta > 0 ? 0 : count - 1
    : (state.vaultAutocompleteActiveIndex + delta + count) % count;
  state.vaultAutocompleteActiveIndex = next;
  state.vaultAutocompleteOpen = true;
  updateAutocompleteDom(input);
}

async function removeChase(outcome) {
  if (!state.removeTargetId) return;
  if (isPreviewMode) {
    state.removeError = 'Preview mode is read-only. No changes were made.';
    renderCurrentPage();
    return;
  }
  state.removeError = '';
  try {
    await fetchJson(`/api/chases/${encodeURIComponent(state.removeTargetId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome })
    });
    state.vaultNotice = 'Chase removed.';
    state.removeTargetId = null;
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.removeError = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function setChasePaused(chaseId, paused) {
  if (!chaseId) return;
  if (isPreviewMode) {
    state.vaultNotice = 'Preview mode is read-only. No changes were made.';
    renderCurrentPage();
    return;
  }
  state.lifecycleError = '';
  try {
    await fetchJson(`/api/chases/${encodeURIComponent(chaseId)}/${paused ? 'pause' : 'resume'}`, { method: 'POST' });
    state.vaultNotice = paused ? 'Chase paused.' : 'Chase resumed.';
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.vaultNotice = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function markChaseAcquired() {
  if (!state.acquireTargetId) return;
  if (isPreviewMode) {
    state.lifecycleError = 'Preview mode is read-only. No changes were made.';
    renderCurrentPage();
    return;
  }
  state.lifecycleError = '';
  try {
    await fetchJson(`/api/chases/${encodeURIComponent(state.acquireTargetId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'COMPLETED' })
    });
    state.acquireTargetId = null;
    state.vaultNotice = 'Chase marked acquired.';
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.lifecycleError = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function reopenChase(chaseId) {
  if (!chaseId) return;
  if (isPreviewMode) {
    state.vaultNotice = 'Preview mode is read-only. No changes were made.';
    renderCurrentPage();
    return;
  }
  try {
    await fetchJson(`/api/completed-chases/${encodeURIComponent(chaseId)}/reopen`, { method: 'POST' });
    state.vaultNotice = 'Chase reopened.';
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.vaultNotice = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function bootstrap() {
  try {
    const body = await fetchJson('/api/me');
    state.user = body.user;
    state.activePage = pageFromHash();
    renderCurrentPage();
    await loadActivePageData();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    app.innerHTML = `
      <main id="app-main" class="signed-out">
        <section class="signed-out-card">
          <div class="boot-mark" aria-hidden="true"><span>V</span></div>
          <h1>Vaultr could not open.</h1>
          <p>Refresh the page and try again.</p>
          <button class="button-primary" type="button" data-action="reload">Try again</button>
        </section>
      </main>
    `;
  }
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('button, a');
  if (!target) return;

  const page = target.getAttribute('data-page');
  if (page) {
    if (page === 'alerts') {
      state.alertChaseId = null;
      state.alertChaseName = '';
      state.alertsLoaded = false;
    }
    await navigateToPage(page);
    return;
  }

  const vaultFilter = target.getAttribute('data-vault-filter');
  if (vaultFilter) {
    state.vaultFilter = vaultFilter;
    renderCurrentPage();
    return;
  }

  const priority = target.getAttribute('data-priority');
  if (priority) {
    if (state.activePage !== 'alerts') {
      state.alertChaseId = null;
      state.alertChaseName = '';
    }
    state.priority = priority;
    await navigateToPage('alerts');
    return;
  }

  const action = target.getAttribute('data-action');
  if (action === 'load-more' && state.nextCursor && !state.isLoadingMore) {
    await loadAlerts({ append: true });
    return;
  }
  if (action === 'retry-alerts') {
    await loadAlerts();
    return;
  }
  if (action === 'retry-vault') {
    await loadVault({ force: true });
    return;
  }
  if (action === 'retry-shelf') {
    await loadShelf({ force: true });
    return;
  }
  if (action === 'view-chase-matches') {
    state.alertChaseId = target.getAttribute('data-chase-id');
    state.alertChaseName = target.getAttribute('data-card-name') || '';
    state.alertsLoaded = false;
    await navigateToPage('alerts');
    return;
  }
  if (action === 'clear-chase-filter') {
    state.alertChaseId = null;
    state.alertChaseName = '';
    await loadAlerts();
    return;
  }
  if (action === 'pause-chase' || action === 'resume-chase') {
    await setChasePaused(target.getAttribute('data-chase-id'), action === 'pause-chase');
    return;
  }
  if (action === 'open-acquire-chase') {
    state.acquireTargetId = target.getAttribute('data-chase-id');
    state.lifecycleError = '';
    renderCurrentPage();
    return;
  }
  if (action === 'close-acquire-dialog') {
    state.acquireTargetId = null;
    state.lifecycleError = '';
    renderCurrentPage();
    return;
  }
  if (action === 'confirm-acquire-chase') {
    await markChaseAcquired();
    return;
  }
  if (action === 'reopen-chase') {
    await reopenChase(target.getAttribute('data-chase-id'));
    return;
  }
  if (action === 'open-add-chase') {
    resetVaultAutocomplete();
    state.vaultFormMode = 'add';
    state.vaultEditingId = null;
    state.vaultPrefillCardName = '';
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'add-shelf-card-to-vault') {
    const cardName = target.getAttribute('data-card-name') || '';
    resetVaultAutocomplete();
    if (!await ensureVaultLoaded()) return;
    state.vaultFormMode = 'add';
    state.vaultEditingId = null;
    state.vaultPrefillCardName = cardName;
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'open-edit-chase') {
    resetVaultAutocomplete();
    state.vaultFormMode = 'edit';
    state.vaultEditingId = target.getAttribute('data-chase-id');
    state.vaultPrefillCardName = '';
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'close-vault-dialog') {
    resetVaultAutocomplete();
    state.vaultFormMode = null;
    state.vaultEditingId = null;
    state.vaultPrefillCardName = '';
    state.vaultFormError = '';
    renderCurrentPage();
    return;
  }
  if (action === 'open-remove-chase') {
    state.removeTargetId = target.getAttribute('data-chase-id');
    state.removeError = '';
    renderCurrentPage();
    return;
  }
  if (action === 'close-remove-dialog') {
    state.removeTargetId = null;
    state.removeError = '';
    renderCurrentPage();
    return;
  }
  if (action === 'remove-chase') {
    await removeChase(target.getAttribute('data-outcome'));
    return;
  }
  if (action === 'select-card-suggestion') {
    selectAutocompleteSuggestion(Number(target.getAttribute('data-index')));
    return;
  }
  if (action === 'logout') {
    if (isPreviewMode) return;
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    renderSignedOut();
    return;
  }
  if (action === 'reload') {
    window.location.reload();
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.getAttribute('data-action') === 'source-filter') {
    state.source = target.value;
    await navigateToPage('alerts');
  }
});

window.addEventListener('hashchange', () => {
  if (!state.user) return;
  void navigateToPage(pageFromHash(), { updateHash: false });
});

app.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.matches('[data-vault-form]')) return;
  event.preventDefault();
  await submitVaultForm(form);
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === 'cardName' && target.closest('[data-vault-form]')) {
    scheduleAutocomplete(target);
  }
});

app.addEventListener('keydown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== 'cardName' || !target.closest('[data-vault-form]')) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveAutocompleteActive(1, target);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveAutocompleteActive(-1, target);
  } else if (event.key === 'Enter' && state.vaultAutocompleteActiveIndex >= 0) {
    event.preventDefault();
    selectAutocompleteSuggestion(state.vaultAutocompleteActiveIndex);
  } else if (event.key === 'Escape') {
    resetVaultAutocomplete();
    updateAutocompleteDom(target);
  }
});

app.addEventListener(
  'error',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.matches('[data-alert-image]')) {
      const card = target.closest('.alert-card');
      card?.classList.remove('has-image');
      card?.classList.add('no-image');
      target.remove();
    } else if (target instanceof HTMLImageElement && target.matches('[data-home-shelf-image]')) {
      const placeholder = document.createElement('span');
      placeholder.className = 'home-shelf-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'V';
      target.replaceWith(placeholder);
    } else if (target instanceof HTMLImageElement && target.matches('[data-vault-card-image], [data-shelf-card-image]')) {
      const placeholder = document.createElement('div');
      placeholder.className = `${target.matches('[data-shelf-card-image]') ? 'shelf-card-image' : 'vault-card-image'} placeholder-image`;
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = target.matches('[data-shelf-card-image]') ? 'Image unavailable' : 'V';
      if (target.matches('[data-shelf-card-image]')) placeholder.classList.add('shelf-image-unavailable');
      target.replaceWith(placeholder);
    }
  },
  true
);

bootstrap();
