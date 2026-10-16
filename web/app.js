const app = document.querySelector('#app');
const isPreviewMode = window.location.pathname === '/preview' || window.location.pathname === '/preview/';
const appHomePath = isPreviewMode ? '/preview' : '/app';
let artworkReturnFocus = null;
let artworkPreviousBodyOverflow = '';
let artworkKeydownHandler = null;

function apiUrl(url) {
  if (!isPreviewMode || !url.startsWith('/api/')) return url;
  return `/api/preview/${url.slice('/api/'.length)}`;
}

const state = {
  user: null,
  activePage: 'home',
  priority: 'ALL',
  source: 'ALL',
  alertReviewState: 'NEW',
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
  alertNotice: '',
  dismissUndo: null,
  dismissUndoTimer: null,
  homeAttentionAlerts: [],
  homeAttentionLoading: false,
  homeAttentionLoaded: false,
  homeAttentionError: null,
  homeAttentionRequestId: 0,
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
  homeShelfIndex: 0,
  settings: null,
  settingsDraft: null,
  settingsLoaded: false,
  isSettingsLoading: false,
  settingsError: null,
  settingsSaving: false,
  settingsSaveStatus: '',
  settingsFieldErrors: {},
  settingsDirty: false,
  settingsCurrencyConfirmation: null,
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
  vaultCardSelection: null,
  removeTargetId: null,
  removeError: '',
  acquireTargetId: null,
  lifecycleError: '',
  pendingVaultFocusId: null
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function artworkTriggerMarkup({ imageUrl, identity, imageKind, imageClass, imageDataAttribute }) {
  if (!imageUrl) return '';
  return `
    <button
      class="artwork-trigger"
      type="button"
      data-action="open-artwork"
      data-artwork-url="${escapeHtml(imageUrl)}"
      data-artwork-identity="${escapeHtml(identity)}"
      data-artwork-kind="${escapeHtml(imageKind)}"
      aria-label="View larger ${escapeHtml(imageKind.toLowerCase())} for ${escapeHtml(identity)}"
    >
      <img class="${escapeHtml(imageClass)}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(identity)} ${escapeHtml(imageKind.toLowerCase())}" loading="lazy" ${imageDataAttribute}>
    </button>
  `;
}

function artworkOverlayMarkup({ imageUrl, identity, imageKind }) {
  return `
    <div class="artwork-overlay" data-artwork-overlay>
      <section class="artwork-dialog" role="dialog" aria-modal="true" aria-labelledby="artwork-dialog-title">
        <header class="artwork-dialog-header">
          <div>
            <p class="eyebrow">${escapeHtml(imageKind)}</p>
            <h2 id="artwork-dialog-title">${escapeHtml(identity)}</h2>
          </div>
          <button class="button-ghost artwork-close" type="button" data-action="close-artwork">Close</button>
        </header>
        <div class="artwork-stage">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(identity)} ${escapeHtml(imageKind.toLowerCase())}" data-artwork-dialog-image>
          <p class="artwork-error" role="status" hidden>Artwork could not be loaded.</p>
        </div>
      </section>
    </div>
  `;
}

function closeArtworkOverlay() {
  const overlay = document.querySelector('[data-artwork-overlay]');
  if (!overlay) return;
  if (artworkKeydownHandler) document.removeEventListener('keydown', artworkKeydownHandler);
  artworkKeydownHandler = null;
  overlay.remove();
  document.querySelector('.app-shell')?.removeAttribute('inert');
  document.body.style.overflow = artworkPreviousBodyOverflow;
  if (artworkReturnFocus instanceof HTMLElement && artworkReturnFocus.isConnected) artworkReturnFocus.focus();
  artworkReturnFocus = null;
}

function openArtworkOverlay(trigger) {
  const imageUrl = trigger.getAttribute('data-artwork-url');
  const identity = trigger.getAttribute('data-artwork-identity');
  const imageKind = trigger.getAttribute('data-artwork-kind');
  if (!imageUrl || !identity || !imageKind) return;
  closeArtworkOverlay();
  artworkReturnFocus = trigger;
  artworkPreviousBodyOverflow = document.body.style.overflow;
  document.body.insertAdjacentHTML('beforeend', artworkOverlayMarkup({ imageUrl, identity, imageKind }));
  const overlay = document.querySelector('[data-artwork-overlay]');
  const closeButton = overlay?.querySelector('[data-action="close-artwork"]');
  const image = overlay?.querySelector('[data-artwork-dialog-image]');
  const error = overlay?.querySelector('.artwork-error');
  document.querySelector('.app-shell')?.setAttribute('inert', '');
  document.body.style.overflow = 'hidden';
  closeButton?.addEventListener('click', closeArtworkOverlay);
  image?.addEventListener('error', () => {
    image.hidden = true;
    if (error) error.hidden = false;
  });
  artworkKeydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeArtworkOverlay();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeButton?.focus();
    }
  };
  document.addEventListener('keydown', artworkKeydownHandler);
  closeButton?.focus();
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
  if (value === 'home' || value === 'vault' || value === 'alerts' || value === 'shelf' || value === 'settings') return value;
  return 'home';
}

async function loadActivePageData() {
  if (state.activePage === 'home') {
    await Promise.all([
      state.vaultLoaded ? Promise.resolve() : loadVault(),
      state.homeAttentionLoaded ? Promise.resolve() : loadHomeAttention(),
      state.shelfLoaded ? Promise.resolve() : loadShelf()
    ]);
  }
  if (state.activePage === 'alerts' && !state.alertsLoaded) await loadAlerts();
  if (state.activePage === 'vault') await loadVault();
  if (state.activePage === 'shelf') await loadShelf();
  if (state.activePage === 'settings' && !state.settingsLoaded) await loadSettings();
}

async function navigateToPage(page, { updateHash = true } = {}) {
  const nextPage = page === 'home' || page === 'vault' || page === 'alerts' || page === 'shelf' || page === 'settings' ? page : 'home';
  if (state.activePage === 'settings' && nextPage !== 'settings' && state.settingsDirty) {
    if (!window.confirm('Discard your unsaved Settings changes?')) {
      if (!updateHash) window.history.replaceState(null, '', '#settings');
      return;
    }
    resetSettingsDraft();
  }
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

function gradeValueIsEnabled(gradingType) {
  return gradingType !== 'ANY' && gradingType !== 'RAW';
}

function effectiveGradeValue(gradingType, gradeValue) {
  return gradeValueIsEnabled(gradingType) ? gradeValue || 'ANY' : 'ANY';
}

function syncGradeValueControl(form) {
  const gradingType = form.querySelector('[name="gradingType"]');
  const gradeValue = form.querySelector('[name="gradeValue"]');
  if (!(gradingType instanceof HTMLSelectElement) || !(gradeValue instanceof HTMLSelectElement)) return;
  const enabled = gradeValueIsEnabled(gradingType.value);
  gradeValue.disabled = !enabled;
  if (!enabled) gradeValue.value = 'ANY';
  gradeValue.setAttribute('aria-disabled', enabled ? 'false' : 'true');
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

function cardIdentityConfirmationMarkup(cardName = '') {
  const selection = state.vaultCardSelection;
  if (selection?.kind === 'suggestion') {
    return `<span class="identity-confirmed">Selected suggestion</span><strong>${escapeHtml(selection.value)}</strong>`;
  }
  if (selection?.kind === 'existing') {
    return `<span class="identity-current">Current Chase</span><strong>${escapeHtml(selection.value)}</strong>`;
  }
  if (String(cardName).trim()) {
    return `<span>Entered card name</span><strong>${escapeHtml(String(cardName).trim())}</strong><small>Confirm the set, card number, and language before saving.</small>`;
  }
  return '';
}

function updateCardIdentityConfirmation(input) {
  if (state.vaultCardSelection && input.value.trim() !== state.vaultCardSelection.value) {
    state.vaultCardSelection = null;
  }
  const confirmation = document.querySelector('#card-identity-confirmation');
  if (!confirmation) return;
  confirmation.innerHTML = cardIdentityConfirmationMarkup(input.value);
  confirmation.hidden = confirmation.innerHTML.length === 0;
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
  const accountPlan = state.vaultPlan ? planLabel(state.vaultPlan.tier) : '';
  return `
    <div class="app-shell">
      <aside class="app-sidebar">
        <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span class="brand-copy"><strong>Vaultr</strong><small>Collector workspace</small></span>
        </a>
        <nav class="app-nav desktop-nav" aria-label="Vaultr app navigation">
          ${navButton('home', 'Home')}
          ${navButton('vault', 'Vault')}
          ${navButton('alerts', 'Inbox')}
          ${navButton('shelf', 'Discover')}
        </nav>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <span class="user-copy"><strong class="user-name">${escapeHtml(displayName)}</strong>${accountPlan ? `<small>${escapeHtml(accountPlan)}</small>` : ''}</span>
          <button class="button-ghost account-settings-button" type="button" data-page="settings" aria-current="${state.activePage === 'settings' ? 'page' : 'false'}">Settings</button>
          ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : '<button class="button-ghost" type="button" data-action="logout">Log out</button>'}
        </div>
      </aside>
      <header class="mobile-header">
        <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span class="brand-copy"><strong>Vaultr</strong><small>Collector workspace</small></span>
        </a>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <button class="button-ghost account-settings-button" type="button" data-page="settings" aria-current="${state.activePage === 'settings' ? 'page' : 'false'}">Settings</button>
          ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : '<button class="button-ghost" type="button" data-action="logout">Log out</button>'}
        </div>
      </header>
      <main id="app-main" class="app-main">
        ${content}
      </main>
      <nav class="mobile-nav" aria-label="Vaultr mobile navigation">
        ${navButton('home', 'Home')}
        ${navButton('vault', 'Vault')}
        ${navButton('alerts', 'Inbox')}
        ${navButton('shelf', 'Discover')}
      </nav>
    </div>
  `;
}

function navButton(page, label) {
  const selected = state.activePage === page;
  return `<button class="nav-button" type="button" data-page="${page}" aria-selected="${selected ? 'true' : 'false'}">${label}</button>`;
}

function settingsComparable(value) {
  if (!value) return null;
  return {
    minScore: value.minScore,
    alertVolume: value.alertVolume,
    alertCurrency: value.alertCurrency,
    shippingCountry: value.shippingCountry ?? null,
    shippingPostalCode: value.shippingPostalCode ?? null,
    listingSourceMode: value.listingSourceMode
  };
}

function settingsAreDirty() {
  return JSON.stringify(settingsComparable(state.settingsDraft)) !== JSON.stringify(settingsComparable(state.settings));
}

function resetSettingsDraft() {
  state.settingsDraft = state.settings ? { ...state.settings } : null;
  state.settingsDirty = false;
  state.settingsFieldErrors = {};
  state.settingsSaveStatus = '';
}

function applySettingsResponse(body) {
  state.settings = { ...(body.settings || {}), access: body.access || {}, options: body.options || {} };
  resetSettingsDraft();
  state.settingsLoaded = true;
  state.settingsError = null;
}

function settingsFieldError(field) {
  const message = state.settingsFieldErrors[field];
  return message ? `<small class="field-error" id="settings-${escapeHtml(field)}-error">${escapeHtml(message)}</small>` : '';
}

function settingsCurrencyOptions(settings, options) {
  const savedCurrency = typeof settings?.alertCurrency === 'string' ? settings.alertCurrency : '';
  const supported = Array.isArray(options?.currencies)
    ? options.currencies.filter((currency) => typeof currency === 'string' && currency)
    : [];
  return savedCurrency && !supported.includes(savedCurrency)
    ? [savedCurrency, ...supported]
    : supported;
}

function settingsCurrencyConfirmationMarkup() {
  const confirmation = state.settingsCurrencyConfirmation;
  if (!confirmation) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="vault-dialog settings-currency-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-currency-title" aria-describedby="settings-currency-description">
        <header>
          <p class="eyebrow">CONFIRM CURRENCY</p>
          <h2 id="settings-currency-title">Change ${escapeHtml(confirmation.oldCurrency)} to ${escapeHtml(confirmation.newCurrency)}?</h2>
          <p id="settings-currency-description" class="dialog-intro">Saved Chase budgets will be converted using available exchange rates and rounded. Switching back may not restore the exact original amounts.</p>
        </header>
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="cancel-settings-currency">Cancel</button>
          <button class="button-primary" type="button" data-action="confirm-settings-currency">Convert and save</button>
        </footer>
      </section>
    </div>
  `;
}

function settingsPageMarkup() {
  if (state.isSettingsLoading && !state.settingsLoaded) {
    return `<section class="settings-page" aria-labelledby="settings-title"><header class="page-header"><p class="eyebrow">Account</p><h1 id="settings-title">Settings</h1></header><div class="settings-loading" role="status">Loading Settings…</div></section>`;
  }
  if (state.settingsError && !state.settingsLoaded) {
    return `<section class="settings-page" aria-labelledby="settings-title"><header class="page-header"><p class="eyebrow">Account</p><h1 id="settings-title">Settings</h1></header><div class="state-panel"><h2>Couldn't load Settings.</h2><p>Try again when you are ready.</p><button class="retry-button" type="button" data-action="retry-settings">Try again</button></div></section>`;
  }
  const draft = state.settingsDraft;
  const access = state.settings?.access || {};
  const options = state.settings?.options || {};
  if (!draft) return statePanelMarkup('Settings are unavailable.', 'Refresh and try again.', 'Try again', 'retry-settings');
  const controlsDisabled = isPreviewMode || state.settingsSaving;
  const country = draft.shippingCountry || 'OFF';
  const supportsPostal = country === 'CA' || country === 'US';
  const currencyOptions = settingsCurrencyOptions(draft, options);
  const sourceMismatch = draft.listingSourceMode !== draft.effectiveListingSourceMode;
  const describedBy = (field, base) => `${base}${state.settingsFieldErrors[field] ? ` settings-${field}-error` : ''}`;
  return `
    <section class="settings-page" aria-labelledby="settings-title">
      <header class="page-header">
        <p class="eyebrow">Account</p>
        <h1 id="settings-title">Settings</h1>
        <p>Shape which matches Vaultr surfaces and how listing costs are evaluated.</p>
      </header>
      ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. You can inspect these settings, but changes will not be saved.</p>' : ''}
      <form class="settings-form" data-settings-form novalidate>
        <section class="settings-group" aria-labelledby="settings-matching-title">
          <div class="settings-group-heading">
            <p class="eyebrow">Matching</p>
            <h2 id="settings-matching-title">Match quality</h2>
          </div>
          <label class="field settings-confidence-field">
            <span>Match confidence <output data-confidence-output>${escapeHtml(draft.minScore)}</output></span>
            <input name="minScore" type="range" min="${escapeHtml(options.confidence?.min ?? 0)}" max="${escapeHtml(options.confidence?.max ?? 100)}" step="1" value="${escapeHtml(draft.minScore)}" aria-describedby="${describedBy('minScore', 'settings-confidence-help')}"${controlsDisabled ? ' disabled' : ''}>
            <small class="field-hint" id="settings-confidence-help">Higher confidence means fewer, stricter matches enter your Inbox.</small>
            ${settingsFieldError('minScore')}
          </label>
        </section>
        <section class="settings-group" aria-labelledby="settings-volume-title">
          <div class="settings-group-heading">
            <p class="eyebrow">Match volume</p>
            <h2 id="settings-volume-title">How many matches to surface</h2>
            <p>Limits matches surfaced in your Inbox and Discord. It does not change how often Vaultr checks.</p>
          </div>
          <fieldset class="settings-segments" aria-describedby="settings-volume-help">
            <legend class="sr-only">Match volume</legend>
            ${(options.volumes || []).map((option) => `
              <label>
                <input type="radio" name="alertVolume" value="${escapeHtml(option.value)}"${draft.alertVolume === option.value ? ' checked' : ''}${controlsDisabled ? ' disabled' : ''}>
                <span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.maxAlertsPerHour)}/hour</small></span>
              </label>
            `).join('')}
          </fieldset>
          <small class="field-hint" id="settings-volume-help">The limit applies across your active Chases.</small>
          ${settingsFieldError('alertVolume')}
        </section>
        <section class="settings-group" aria-labelledby="settings-sources-title">
          <div class="settings-group-heading">
            <p class="eyebrow">Sources</p>
            <h2 id="settings-sources-title">Where Vaultr watches</h2>
          </div>
          <label class="field">
            <span>Listing sources</span>
            <select name="listingSourceMode" aria-describedby="${describedBy('listingSourceMode', 'settings-source-help')}"${controlsDisabled ? ' disabled' : ''}>
              ${(options.sources || []).map((option) => {
                const locked = option.requiresPro && !access.trustedShops;
                return `<option value="${escapeHtml(option.value)}"${draft.listingSourceMode === option.value ? ' selected' : ''}${locked ? ' disabled' : ''}>${escapeHtml(option.label)}${locked ? ' — Full Vault' : ''}</option>`;
              }).join('')}
            </select>
            <small class="field-hint" id="settings-source-help">Trusted Shops require Full Vault.${sourceMismatch ? ` Your saved preference is retained, but Vaultr currently watches ${escapeHtml(draft.effectiveListingSourceMode === 'EBAY' ? 'eBay' : draft.effectiveListingSourceMode)}.` : ''}</small>
            ${settingsFieldError('listingSourceMode')}
          </label>
        </section>
        <section class="settings-group" aria-labelledby="settings-pricing-title">
          <div class="settings-group-heading">
            <p class="eyebrow">Pricing & shipping</p>
            <h2 id="settings-pricing-title">Your market context</h2>
          </div>
          <div class="settings-field-grid">
            <label class="field">
              <span>Currency</span>
              <select name="alertCurrency" aria-describedby="${describedBy('alertCurrency', 'settings-currency-help')}"${controlsDisabled ? ' disabled' : ''}>
                ${currencyOptions.map((currency) => `<option value="${escapeHtml(currency)}"${draft.alertCurrency === currency ? ' selected' : ''}>${escapeHtml(currency)}</option>`).join('')}
              </select>
              <small class="field-hint" id="settings-currency-help">Changing currency converts and rounds saved Chase budgets. Shipping destination remains independent.</small>
              ${settingsFieldError('alertCurrency')}
            </label>
            <label class="field">
              <span>Ship-to country</span>
              <select name="shippingCountry" aria-describedby="${describedBy('shippingCountry', 'settings-country-help')}"${controlsDisabled ? ' disabled' : ''}>
                ${(options.shippingCountries || []).map((option) => `<option value="${escapeHtml(option.value)}"${country === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
              </select>
              <small class="field-hint" id="settings-country-help">Used for shipping availability and estimates.</small>
              ${settingsFieldError('shippingCountry')}
            </label>
            <label class="field settings-postal-field"${supportsPostal ? '' : ' hidden'}>
              <span>${country === 'CA' ? 'Postal region' : 'ZIP region'}</span>
              <input name="shippingPostalCode" maxlength="16" value="${escapeHtml(draft.shippingPostalCode || '')}" placeholder="${country === 'CA' ? 'M5V' : '90210'}" aria-describedby="${describedBy('shippingPostalCode', 'settings-postal-help')}"${controlsDisabled || !supportsPostal ? ' disabled' : ''}>
              <small class="field-hint" id="settings-postal-help">Only a coarse region is retained: the first three Canadian characters or five-digit US ZIP.</small>
              ${settingsFieldError('shippingPostalCode')}
            </label>
          </div>
        </section>
        <footer class="settings-actions">
          <p class="settings-save-status" role="status" aria-live="polite">${escapeHtml(state.settingsSaveStatus)}</p>
          <button class="button-primary" type="submit"${controlsDisabled || !state.settingsDirty ? ' disabled' : ''}>${state.settingsSaving ? 'Saving…' : 'Save changes'}</button>
        </footer>
      </form>
    </section>
    ${settingsCurrencyConfirmationMarkup()}
  `;
}

function alertsPageMarkup(inner) {
  return `
    <section aria-labelledby="alerts-title">
      <header class="page-header">
        <p class="eyebrow">Inbox</p>
        <h1 id="alerts-title">What Vaultr found for your Chases</h1>
        <p>Matches worth a look, based on the cards and filters you saved.</p>
      </header>
      ${state.alertChaseId ? `
        <div class="active-chase-filter" role="status">
          <span>Matches for <strong>${escapeHtml(state.alertChaseName || 'this Chase')}</strong></span>
          <button class="button-ghost" type="button" data-action="clear-chase-filter">Clear filter</button>
        </div>
      ` : ''}
      ${alertNoticeMarkup()}
      <div class="alert-control-stack">
        <div class="alert-control-group alert-inbox-control">
          <span class="alert-control-label">Inbox</span>
          <div class="review-state-filters" aria-label="Alert review state">
            ${reviewStateButton('NEW', 'New')}
            ${reviewStateButton('REVIEWED', 'Reviewed')}
            ${reviewStateButton('ALL', 'All')}
          </div>
        </div>
        <div class="toolbar" aria-label="Inbox filters">
          <div class="alert-control-group">
            <span class="alert-control-label">Priority</span>
            <div class="priority-filters" aria-label="Alert priority filters">
              ${priorityButton('ALL', 'All')}
              ${priorityButton('GRAIL', 'Grail')}
              ${priorityButton('HIGH', 'High')}
              ${priorityButton('NORMAL', 'Casual')}
            </div>
          </div>
          <label class="alert-control-group alert-source-control">
            <span class="alert-control-label">Source</span>
            <select class="source-select" data-action="source-filter">
              <option value="ALL"${state.source === 'ALL' ? ' selected' : ''}>All sources</option>
              <option value="EBAY"${state.source === 'EBAY' ? ' selected' : ''}>eBay</option>
              <option value="SHOPIFY"${state.source === 'SHOPIFY' ? ' selected' : ''}>Trusted shops</option>
            </select>
          </label>
        </div>
      </div>
      ${inner}
    </section>
  `;
}

function reviewStateButton(value, label) {
  return `<button class="pill-button" type="button" data-review-state="${value}" aria-pressed="${state.alertReviewState === value ? 'true' : 'false'}">${label}</button>`;
}

function alertNoticeMarkup() {
  if (!state.alertNotice && !state.dismissUndo) return '';
  return `
    <div class="alert-notice" role="status">
      <span>${escapeHtml(state.alertNotice || 'Match dismissed.')}</span>
      ${state.dismissUndo ? '<button class="vault-action-link" type="button" data-action="undo-dismiss">Undo</button>' : ''}
    </div>
  `;
}

function priorityButton(value, label) {
  return `<button class="pill-button" type="button" data-priority="${value}" aria-pressed="${state.priority === value ? 'true' : 'false'}">${label}</button>`;
}

function skeletonMarkup() {
  return alertsPageMarkup(`
    <div class="alert-list" aria-label="Loading Inbox">
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
    if (state.alertReviewState === 'NEW') {
      const broadlyCaughtUp = state.priority === 'ALL' && state.source === 'ALL' && !state.alertChaseId;
      return alertsPageMarkup(broadlyCaughtUp
        ? statePanelMarkup("You're caught up", 'No new matches need review right now.')
        : statePanelMarkup('No new matches in this view.', 'Try another filter or return to the full New inbox.'));
    }
    if (state.alertReviewState === 'REVIEWED') {
      return alertsPageMarkup(statePanelMarkup('No reviewed matches yet.', 'Matches you review will stay available here.'));
    }
    if (state.priority === 'ALL' && state.source === 'ALL' && !state.hasCheckedAllAlerts) {
      return alertsPageMarkup(statePanelMarkup('Nothing here yet.', "When Vaultr finds a match for one of your Chases, it'll show up here."));
    }
    if (state.priority !== 'ALL') {
      const filteredPriority = state.priority === 'GRAIL' ? 'Grail' : state.priority === 'NORMAL' ? 'Casual' : 'High';
      return alertsPageMarkup(statePanelMarkup(`No ${filteredPriority} matches yet.`, 'Try another priority or check back after Vaultr finds a new match.'));
    }
    return alertsPageMarkup(statePanelMarkup('No matches for this source yet.', 'Try another source or check back after Vaultr finds a new match.'));
  }

  const list = state.alerts.map(alertCardMarkup).join('');
  const loadMore = state.nextCursor
    ? `<div class="load-more-row"><button class="button-ghost" type="button" data-action="load-more" ${state.isLoadingMore ? 'disabled' : ''}>${state.isLoadingMore ? 'Loading...' : 'Load more'}</button></div>`
    : '';
  return alertsPageMarkup(`<div class="alert-list" aria-label="Inbox matches">${list}</div>${loadMore}`);
}

function alertActionMarkup(alert, { compact = false } = {}) {
  const reviewed = Boolean(alert.reviewedAt);
  return `
    ${alert.listingUrl ? `<a class="listing-link" href="${escapeHtml(alert.listingUrl)}" target="_blank" rel="noopener noreferrer" data-action="review-listing" data-alert-id="${escapeHtml(alert.id)}" data-reviewed="${reviewed ? 'true' : 'false'}">View listing</a>` : ''}
    <span class="alert-secondary-actions">
      <button class="vault-action-link" type="button" data-action="${reviewed ? 'mark-alert-new' : 'mark-alert-reviewed'}" data-alert-id="${escapeHtml(alert.id)}">${reviewed ? 'Mark new' : 'Mark reviewed'}</button>
      ${compact ? '' : `<button class="vault-action-link" type="button" data-action="view-alert-chase" data-chase-id="${escapeHtml(alert.chaseId)}">View Chase</button>`}
      <button class="vault-action-link danger" type="button" data-action="dismiss-alert" data-alert-id="${escapeHtml(alert.id)}">Dismiss</button>
    </span>
  `;
}

function homeAlertPreviewMarkup(alert) {
  const price = formatMoney(alert.listingPrice, alert.listingCurrency);
  const delta = formatPriceDelta(alert.priceDelta, alert.listingCurrency);
  return `
    <li class="home-preview-row">
      <div class="home-preview-artwork">
        ${alert.imageUrl
          ? artworkTriggerMarkup({
              imageUrl: alert.imageUrl,
              identity: alert.listingTitle || alert.chaseName || 'Alert listing',
              imageKind: 'Listing image',
              imageClass: 'home-preview-image',
              imageDataAttribute: 'data-home-alert-image'
            })
          : '<span class="home-preview-image-placeholder" aria-hidden="true">V</span>'}
      </div>
      <div class="home-preview-copy">
        <strong>${escapeHtml(alert.chaseName || 'Saved Chase')}</strong>
        <span>${escapeHtml(alert.listingTitle || sourceLabel(alert.source))}</span>
        <span class="home-preview-meta">
          <span class="review-state-pill new">New</span>
          <span>${escapeHtml(sourceLabel(alert.source))}</span>
          <span>${escapeHtml(relativeTime(alert.createdAt))}</span>
        </span>
      </div>
      <span class="home-preview-price">${price ? `<strong class="home-preview-value">${escapeHtml(price)}</strong>` : ''}${delta ? `<span>${escapeHtml(delta)}</span>` : ''}</span>
      <div class="home-preview-actions">${alertActionMarkup(alert, { compact: true })}</div>
    </li>
  `;
}

function boundedHomeShelfIndex(index, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return 0;
  const numericIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(numericIndex, 0), itemCount - 1);
}

function homeShelfPresentation(items, index) {
  const shelfItems = Array.isArray(items) ? items : [];
  const featuredIndex = boundedHomeShelfIndex(index, shelfItems.length);
  return {
    featuredIndex,
    featured: shelfItems[featuredIndex],
    decorative: shelfItems
      .filter((item, candidateIndex) => candidateIndex !== featuredIndex && item?.imageUrl)
      .slice(0, 2)
  };
}

function homeShelfFeatureMarkup(items, index) {
  const { featured: item, featuredIndex, decorative } = homeShelfPresentation(items, index);
  if (!item) return '';
  const total = items.length;
  const details = [item.setName, item.language].filter(Boolean);
  const price = item.market?.askingTotal !== undefined
    ? formatMoney(item.market.askingTotal, item.market.currency)
    : item.market?.soldTotal !== undefined
      ? formatMoney(item.market.soldTotal, item.market.currency)
      : '';
  const priceLabel = item.market?.askingTotal !== undefined ? 'Market' : item.market?.soldTotal !== undefined ? 'Sold' : '';
  return `
    <div class="home-shelf-feature">
      <div class="home-shelf-artwork${decorative.length ? ' layered' : ''}${item.imageUrl ? '' : ' empty'}">
        ${decorative.map((backgroundItem, backgroundIndex) => `<img class="home-shelf-background-card layer-${backgroundIndex + 1}" src="${escapeHtml(backgroundItem.imageUrl)}" alt="" aria-hidden="true" loading="lazy" data-home-shelf-background-image>`).join('')}
        ${item.imageUrl
          ? artworkTriggerMarkup({
              imageUrl: item.imageUrl,
              identity: item.name || 'Weekly Shelf pick',
              imageKind: 'Card artwork',
              imageClass: 'home-shelf-feature-image',
              imageDataAttribute: 'data-home-shelf-image'
            })
          : '<p class="home-shelf-artwork-unavailable">Artwork unavailable</p>'}
      </div>
      <div class="home-shelf-copy">
        <strong>${escapeHtml(item.name || 'Weekly Shelf pick')}</strong>
        ${details.length ? `<span class="home-shelf-details">${details.map(escapeHtml).join(' · ')}</span>` : ''}
        ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : '<p>Open your Weekly Shelf to explore this recommendation.</p>'}
        ${price ? `<span class="home-shelf-price"><small>${escapeHtml(priceLabel)}</small>${escapeHtml(price)}</span>` : '<span class="home-shelf-price unavailable">Pricing unavailable</span>'}
      </div>
      ${total > 1 ? `
        <div class="home-shelf-controls" aria-label="Weekly Shelf preview controls">
          <button class="home-shelf-control" type="button" data-action="previous-home-shelf" aria-label="Previous recommendation" title="Previous recommendation" ${featuredIndex === 0 ? 'disabled' : ''}>&larr;</button>
          <span>${escapeHtml(featuredIndex + 1)} of ${escapeHtml(total)}</span>
          <button class="home-shelf-control" type="button" data-action="next-home-shelf" aria-label="Next recommendation" title="Next recommendation" ${featuredIndex === total - 1 ? 'disabled' : ''}>&rarr;</button>
        </div>
      ` : ''}
    </div>
  `;
}

function homePageMarkup() {
  const activeChases = state.vaultPlan?.activeCount ?? state.vault.length;
  const userPausedChases = state.vault.filter((item) => item.monitoringState === 'PAUSED_USER').length;
  const planLimitedChases = state.vault.filter((item) => item.monitoringState === 'PAUSED_PLAN_LIMIT').length;
  const completedChases = state.completedChases?.length ?? 0;
  const alertPreview = state.homeAttentionAlerts.slice(0, 4);
  const shelfItems = state.shelf?.items || [];
  const shelfCount = state.shelf?.itemCount ?? shelfItems.length;
  const shelfReady = shelfItems.length > 0;
  const shelfIndex = boundedHomeShelfIndex(state.homeShelfIndex, shelfItems.length);

  return `
    <section class="home-page" aria-labelledby="home-title">
      <header class="home-header">
        <div>
          <p class="eyebrow">HOME</p>
          <h1 id="home-title">Welcome back, ${escapeHtml(userDisplayName(state.user))}</h1>
          <p>Build your Vault. Chase your grails. Discover what you love next.</p>
        </div>
        <button class="button-primary home-add-chase" type="button" data-action="open-add-chase" ${state.vaultLoaded ? '' : 'disabled'}>Add Chase</button>
      </header>
      ${alertNoticeMarkup()}
      <section class="home-discovery" aria-labelledby="home-shelf-title">
        <div class="home-discovery-copy">
          <p class="eyebrow">WEEKLY SHELF</p>
          <h2 id="home-shelf-title">Same favourites. New discoveries.</h2>
          <p>${state.isShelfLoading
            ? 'Opening your latest collector picks...'
            : state.shelfError
              ? 'Your Weekly Shelf is unavailable right now.'
              : shelfReady
                ? `${escapeHtml(shelfCount)} picks are ready to explore.`
                : 'Your next set of collector picks is still taking shape.'}</p>
          ${shelfReady && state.shelf.marketReadyCount !== undefined ? `<span class="home-shelf-count">${escapeHtml(state.shelf.marketReadyCount)} priced</span>` : ''}
          <button class="button-primary home-explore-shelf" type="button" data-page="shelf">Explore your Shelf</button>
        </div>
        <div class="home-discovery-stage">
          ${state.shelfError
            ? '<div class="home-discovery-state"><p>Your Weekly Shelf could not be loaded right now.</p><button class="button-ghost" type="button" data-action="retry-shelf">Try again</button></div>'
            : shelfReady
              ? homeShelfFeatureMarkup(shelfItems, shelfIndex)
              : `<div class="home-discovery-state"><p>${state.shelfLoaded ? 'Personalized picks will appear when your next shelf is prepared.' : 'Loading your latest collector picks...'}</p></div>`}
        </div>
      </section>

      <section class="home-attention-section" aria-labelledby="home-alerts-title">
        <div class="home-section-heading">
          <div>
            <p class="eyebrow">NEEDS ATTENTION</p>
            <h2 id="home-alerts-title">${state.homeAttentionLoading ? 'Checking matches...' : alertPreview.length ? 'New matches to review' : "You're caught up"}</h2>
          </div>
          <button class="home-text-link" type="button" data-action="view-new-alerts">Open Inbox</button>
          ${alertPreview.length ? '<span class="home-plan-label">New</span>' : ''}
        </div>
        ${state.homeAttentionError
          ? '<p class="home-section-state">New matches could not be loaded right now.</p>'
          : alertPreview.length
            ? `<ul class="home-preview-list">${alertPreview.map(homeAlertPreviewMarkup).join('')}</ul>`
            : `<p class="home-section-state">${state.homeAttentionLoaded ? 'No new matches need review right now.' : 'Loading your latest matches...'}</p>`}
      </section>

      <section class="home-vault-strip" aria-labelledby="home-vault-title">
        <div class="home-vault-copy">
          <p class="eyebrow">VAULT</p>
          <h2 id="home-vault-title">${state.isVaultLoading ? 'Loading your Vault...' : 'Your collection watchlist'}</h2>
          <p>${state.vaultError ? "Your Vault couldn't be loaded right now." : activeChases ? 'Chases and lifecycle states at a glance.' : 'Add a card to start building your collection watchlist.'}</p>
        </div>
        <div class="home-vault-stats" aria-label="Vault summary">
          <span><strong>${escapeHtml(activeChases)}</strong> Watching</span>
          <span><strong>${escapeHtml(userPausedChases)}</strong> Paused</span>
          <span><strong>${escapeHtml(planLimitedChases)}</strong> Plan limit</span>
          <span><strong>${escapeHtml(completedChases)}</strong> Completed</span>
        </div>
        <button class="home-text-link" type="button" data-page="vault">View Vault</button>
      </section>
      ${vaultDialogMarkup()}
    </section>
  `;
}

function alertCardMarkup(alert) {
  const priority = alert.chasePriority || 'NORMAL';
  const price = formatMoney(alert.listingPrice, alert.listingCurrency);
  const delta = formatPriceDelta(alert.priceDelta, alert.listingCurrency);
  const reviewed = Boolean(alert.reviewedAt);
  return `
    <article class="alert-card ${reviewed ? 'reviewed' : 'new'} ${alert.imageUrl ? 'has-image' : 'no-image'}">
      <div class="alert-artwork">
        ${alert.imageUrl
          ? artworkTriggerMarkup({
              imageUrl: alert.imageUrl,
              identity: alert.listingTitle || alert.chaseName || 'Alert listing',
              imageKind: 'Listing image',
              imageClass: 'alert-image',
              imageDataAttribute: 'data-alert-image'
            })
          : '<span class="alert-image-placeholder" aria-hidden="true">V</span>'}
      </div>
      <div class="alert-content">
        <div class="alert-main">
          <div class="alert-meta">
            <span class="priority-pill ${priority === 'GRAIL' ? 'grail' : ''}">${escapeHtml(priority)}</span>
            <span class="review-state-pill ${reviewed ? 'reviewed' : 'new'}">${reviewed ? 'Reviewed' : 'New'}</span>
          </div>
          <h2 class="chase-name">${escapeHtml(alert.chaseName || 'Saved Chase')}</h2>
          ${alert.listingTitle ? `<p class="listing-title">${escapeHtml(alert.listingTitle)}</p>` : ''}
          <div class="alert-context">
            <span class="source-pill">${escapeHtml(sourceLabel(alert.source))}</span>
            <span class="match-pill">${escapeHtml(matchLabel(alert.matchScore))}</span>
            <span class="alert-age">${escapeHtml(relativeTime(alert.createdAt))}</span>
          </div>
        </div>
        <div class="alert-price-column">
          ${price ? `<span class="price">${escapeHtml(price)}</span>` : '<span class="price-unavailable">Price unavailable</span>'}
          ${delta ? `<span class="price-delta">${escapeHtml(delta)}</span>` : ''}
        </div>
        <div class="alert-actions">${alertActionMarkup(alert)}</div>
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
        <p class="eyebrow">VAULT</p>
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
    <article class="vault-card ${paused ? 'paused' : ''}" data-vault-chase-id="${escapeHtml(chase.id)}" tabindex="-1">
      ${chase.cardImageUrl ? artworkTriggerMarkup({
        imageUrl: chase.cardImageUrl,
        identity: chase.cardName || 'Saved Chase',
        imageKind: 'Card artwork',
        imageClass: 'vault-card-image',
        imageDataAttribute: 'data-vault-card-image'
      }) : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
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
    <article class="vault-card completed" data-vault-chase-id="${escapeHtml(chase.id)}" tabindex="-1">
      ${chase.cardImageUrl ? artworkTriggerMarkup({
        imageUrl: chase.cardImageUrl,
        identity: chase.cardName || 'Completed Chase',
        imageKind: 'Card artwork',
        imageClass: 'vault-card-image',
        imageDataAttribute: 'data-vault-card-image'
      }) : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
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
      <section class="shelf-page" aria-labelledby="shelf-title">
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
      <section class="shelf-page" aria-labelledby="shelf-title">
        ${shelfHeaderMarkup()}
        ${statePanelMarkup("Couldn't load your Weekly Shelf.", 'Try again when you are ready.', 'Try again').replace('data-action="retry-alerts"', 'data-action="retry-shelf"')}
      </section>
    `;
  }
  const items = state.shelf?.items || [];
  return `
    <section class="shelf-page" aria-labelledby="shelf-title">
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
      <p class="eyebrow">DISCOVER</p>
      <h1 id="shelf-title">Your Weekly Shelf</h1>
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
      ${item.imageUrl ? artworkTriggerMarkup({
        imageUrl: item.imageUrl,
        identity: item.name || 'Weekly Shelf pick',
        imageKind: 'Card artwork',
        imageClass: 'shelf-card-image',
        imageDataAttribute: 'data-shelf-card-image'
      }) : '<div class="shelf-card-image placeholder-image shelf-image-unavailable"><span>Image unavailable</span></div>'}
      <div class="shelf-card-body">
        <div class="shelf-card-meta">
          ${item.signalLabel ? `<span class="source-pill">${escapeHtml(item.signalLabel)}</span>` : ''}
        </div>
        <h2>${escapeHtml(item.name || 'Weekly Shelf pick')}</h2>
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        ${item.reason ? `<p class="shelf-reason">${escapeHtml(item.reason)}</p>` : ''}
        <div class="shelf-card-footer">
          ${price ? `<p class="shelf-price"><span>${escapeHtml(priceLabel)}</span>${escapeHtml(price)}</p>` : '<p class="shelf-price unavailable">Pricing unavailable</p>'}
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
  const gradeValueEnabled = gradeValueIsEnabled(grade.gradingType);
  const isFullVault = state.vaultPlan?.tier === 'PRO';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="vault-dialog" data-vault-form="${editing ? 'edit' : 'add'}" aria-labelledby="vault-form-title">
        <header>
          <p class="eyebrow">${editing ? 'EDIT CHASE' : 'ADD CHASE'}</p>
          <h2 id="vault-form-title">${editing ? 'Refine this Chase' : 'Add a Chase'}</h2>
          <p class="dialog-intro">Card is required. Every other criterion is optional and can be left blank or set to Any.</p>
        </header>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. You can inspect this form, but changes will not be saved.</p>' : ''}
        ${state.vaultFormError ? `<p class="form-error" role="alert">${escapeHtml(state.vaultFormError)}</p>` : ''}
        <label class="field">
          <span>Card <span class="required-marker">Required</span></span>
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
            <p id="card-autocomplete-hint" class="field-hint">Include the set and card number, plus language when relevant. Suggestions help identify the exact printing; free text is still allowed.</p>
            <div id="card-suggestion-list" class="card-suggestion-list" role="listbox" hidden></div>
          </div>
          <span id="card-identity-confirmation" class="card-identity-confirmation"${cardIdentityConfirmationMarkup(chase.cardName) ? '' : ' hidden'}>${cardIdentityConfirmationMarkup(chase.cardName)}</span>
        </label>
        <div class="form-grid">
          <label class="field">
            <span>Maximum (${escapeHtml(state.vaultCurrency)})</span>
            <input name="maxPrice" type="number" min="0.01" step="0.01" aria-describedby="max-price-hint" value="${chase.maxPrice !== undefined ? escapeHtml(chase.maxPrice) : ''}">
            <small id="max-price-hint" class="field-hint">Blank means no maximum. Uses item price plus known shipping; otherwise item price only. Other checkout costs may apply.</small>
          </label>
          <label class="field">
            <span>Grading type</span>
            <select name="gradingType" aria-describedby="grading-type-hint">${optionMarkup(state.vaultOptions?.gradingTypes, grade.gradingType)}</select>
            <small id="grading-type-hint" class="field-hint">Any accepts any grading state. Raw / Ungraded excludes graded copies.</small>
          </label>
          <label class="field">
            <span>Grade value</span>
            <select name="gradeValue" aria-describedby="grade-value-hint" aria-disabled="${gradeValueEnabled ? 'false' : 'true'}"${gradeValueEnabled ? '' : ' disabled'}>${optionMarkup(state.vaultOptions?.gradeValues, effectiveGradeValue(grade.gradingType, grade.gradeValue))}</select>
            <small id="grade-value-hint" class="field-hint">For a named grader, Any means no numeric preference. A number requests that listed grade exactly, not that grade or better.</small>
          </label>
        </div>
        <section class="advanced-section" aria-labelledby="advanced-fields-title">
          <div class="advanced-section-heading">
            <h3 id="advanced-fields-title">Precision controls</h3>
            <p>${isFullVault ? 'Optional controls for narrowing matches and shaping Chase context.' : 'These controls require Full Vault. Existing locked values remain saved.'}</p>
          </div>
        <fieldset class="advanced-fields" aria-describedby="advanced-fields-title" ${isFullVault ? '' : 'disabled'}>
          <legend class="visually-hidden">Precision controls</legend>
          <div class="form-grid">
            <label class="field">
              <span>Condition</span>
              <select name="condition" aria-describedby="condition-hint">${optionMarkup(state.vaultOptions?.conditions, conditionToChoice(chase.condition))}</select>
              <small id="condition-hint" class="field-hint">Choose Any or an allowed range: Near Mint (NM), Lightly Played (LP), Moderately Played (MP), or Heavily Played (HP). Damaged is exact. Seller condition is not independently verified.</small>
            </label>
            <label class="field">
              <span>Listing type</span>
              <select name="listingType" aria-describedby="listing-type-hint">${optionMarkup(state.vaultOptions?.listingTypes, chase.listingType || 'ANY')}</select>
              <small id="listing-type-hint" class="field-hint">Allow Any listing, or limit matches to Auction or Buy It Now.</small>
            </label>
            <label class="field">
              <span>Priority</span>
              <select name="priority" aria-describedby="priority-hint">${optionMarkup(state.vaultOptions?.priorities, chase.priority || 'NORMAL')}</select>
              <small id="priority-hint" class="field-hint">Sets alert emphasis and which Chases are monitored first when plan limits apply. It does not change polling speed.</small>
            </label>
          </div>
          <label class="field">
            <span>Target note</span>
            <input name="targetNote" type="text" maxlength="120" aria-describedby="target-note-hint" value="${escapeHtml(chase.targetNote || '')}">
            <small id="target-note-hint" class="field-hint">Add focused context such as raw or language intent. Notes can inform matching and Discovery, but are not a general natural-language filter.</small>
          </label>
          <label class="field">
            <span>Custom exclusions</span>
            <input name="customExclusions" type="text" maxlength="240" aria-describedby="custom-exclusions-hint" value="${escapeHtml(chase.negativeKeywords?.join(', ') || '')}">
            <small id="custom-exclusions-hint" class="field-hint">Add up to 15 comma-separated terms. These supplement Vaultr's automatic exclusions.</small>
          </label>
        </fieldset>
        </section>
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
    focusPendingVaultChase();
    return;
  }
  if (state.activePage === 'shelf') {
    renderShell(shelfPageMarkup());
    return;
  }
  if (state.activePage === 'settings') {
    renderShell(settingsPageMarkup());
    return;
  }
  renderShell(alertsMarkup());
}

function focusPendingVaultChase() {
  if (!state.pendingVaultFocusId) return;
  const chaseId = state.pendingVaultFocusId;
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll('[data-vault-chase-id]')]
      .find((element) => element.getAttribute('data-vault-chase-id') === chaseId);
    if (card instanceof HTMLElement) {
      state.pendingVaultFocusId = null;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (state.vaultLoaded && !state.isVaultLoading) state.pendingVaultFocusId = null;
  });
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
  if (state.alertReviewState !== 'ALL') params.set('reviewState', state.alertReviewState);
  if (cursor) params.set('cursor', cursor);
  return params.toString() ? `/api/alerts?${params.toString()}` : '/api/alerts';
}

async function loadHomeAttention() {
  const requestId = ++state.homeAttentionRequestId;
  state.homeAttentionLoading = true;
  state.homeAttentionError = null;
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/alerts?reviewState=NEW&limit=4');
    if (requestId !== state.homeAttentionRequestId) return;
    state.homeAttentionAlerts = body.items || [];
    state.homeAttentionLoaded = true;
    state.homeAttentionLoading = false;
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized' || requestId !== state.homeAttentionRequestId) return;
    state.homeAttentionLoading = false;
    state.homeAttentionError = 'load_failed';
    renderCurrentPage();
  }
}

async function refreshAlertSurfaces() {
  const work = [];
  state.homeAttentionLoaded = false;
  if (state.activePage === 'home') work.push(loadHomeAttention());
  if (state.activePage === 'alerts') {
    state.alertsLoaded = false;
    work.push(loadAlerts());
  }
  await Promise.all(work);
}

function clearDismissUndo() {
  if (state.dismissUndoTimer) window.clearTimeout(state.dismissUndoTimer);
  state.dismissUndoTimer = null;
  state.dismissUndo = null;
}

async function mutateAlert(alertId, action) {
  if (!alertId) return;
  if (isPreviewMode) {
    state.alertNotice = 'Preview mode is read-only. No changes were made.';
    renderCurrentPage();
    return;
  }
  try {
    const body = await fetchJson(`/api/alerts/${encodeURIComponent(alertId)}/${action}`, { method: 'POST' });
    state.alertNotice = action === 'dismiss' ? 'Match dismissed.' : '';
    if (action === 'dismiss') {
      clearDismissUndo();
      state.dismissUndo = body.item;
      state.dismissUndoTimer = window.setTimeout(() => {
        clearDismissUndo();
        state.alertNotice = '';
        renderCurrentPage();
      }, 8000);
    }
    await refreshAlertSurfaces();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.alertNotice = 'That match could not be updated. Please try again.';
    renderCurrentPage();
  }
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
      renderShell(alertsPageMarkup(statePanelMarkup("Couldn't load your Inbox.", 'Try again when you are ready.', 'Try again')));
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

async function loadSettings({ force = false } = {}) {
  if (state.settingsLoaded && !force) {
    renderCurrentPage();
    return;
  }
  state.isSettingsLoading = true;
  state.settingsError = null;
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/settings');
    applySettingsResponse(body);
    state.isSettingsLoading = false;
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.isSettingsLoading = false;
    state.settingsError = 'load_failed';
    renderCurrentPage();
  }
}

function settingsPatch() {
  const current = settingsComparable(state.settings);
  const draft = settingsComparable(state.settingsDraft);
  const patch = {};
  if (!current || !draft) return patch;
  for (const field of Object.keys(draft)) {
    if (draft[field] !== current[field]) patch[field] = draft[field];
  }
  return patch;
}

function syncSettingsFormState() {
  state.settingsDirty = settingsAreDirty();
  const save = document.querySelector('[data-settings-form] button[type="submit"]');
  if (save instanceof HTMLButtonElement) save.disabled = isPreviewMode || state.settingsSaving || !state.settingsDirty;
  const status = document.querySelector('.settings-save-status');
  if (status) status.textContent = state.settingsSaveStatus;
}

function clearSettingsFieldError(field) {
  if (!state.settingsFieldErrors[field]) return;
  delete state.settingsFieldErrors[field];
  document.querySelector(`#settings-${field}-error`)?.remove();
}

function updateSettingsPostalControl(country) {
  const wrapper = document.querySelector('.settings-postal-field');
  const input = document.querySelector('[data-settings-form] [name="shippingPostalCode"]');
  if (!(wrapper instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const supported = country === 'CA' || country === 'US';
  wrapper.hidden = !supported;
  input.disabled = isPreviewMode || state.settingsSaving || !supported;
  wrapper.querySelector('span').textContent = country === 'CA' ? 'Postal region' : 'ZIP region';
  input.placeholder = country === 'CA' ? 'M5V' : '90210';
  if (!supported) input.value = '';
}

async function persistSettingsPatch(patch) {
  if (isPreviewMode || state.settingsSaving || !state.settingsDirty) return;
  const currencyChanged = patch.alertCurrency !== undefined;
  state.settingsSaving = true;
  state.settingsSaveStatus = 'Saving changes…';
  state.settingsFieldErrors = {};
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch)
    });
    applySettingsResponse(body);
    state.settingsSaving = false;
    state.settingsSaveStatus = 'Settings saved.';
    if (currencyChanged) {
      state.vault = [];
      state.completedChases = [];
      state.vaultLoaded = false;
      await loadVault({ force: true });
    }
    renderCurrentPage();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.settingsSaving = false;
    const field = error?.body?.field;
    if (field) state.settingsFieldErrors[field] = error.body.message || 'Check this value and try again.';
    state.settingsSaveStatus = field ? 'Some settings need attention.' : 'Settings could not be saved. Please try again.';
    renderCurrentPage();
  }
}

async function submitSettingsForm() {
  if (isPreviewMode || state.settingsSaving || !state.settingsDirty) return;
  const patch = settingsPatch();
  if (patch.alertCurrency !== undefined) {
    state.settingsCurrencyConfirmation = {
      oldCurrency: state.settings.alertCurrency,
      newCurrency: patch.alertCurrency
    };
    renderCurrentPage();
    document.querySelector('[data-action="confirm-settings-currency"]')?.focus();
    return;
  }
  await persistSettingsPatch(patch);
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
  const gradeValue = effectiveGradeValue(gradingType, String(data.get('gradeValue') || 'ANY'));
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
    state.vaultCardSelection = null;
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
  updateCardIdentityConfirmation(input);
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
  state.vaultCardSelection = { kind: 'suggestion', value: item.value };
  resetVaultAutocomplete();
  updateAutocompleteDom(input);
  updateCardIdentityConfirmation(input);
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
      state.alertReviewState = 'NEW';
      state.alertsLoaded = false;
    }
    await navigateToPage(page);
    return;
  }

  const reviewState = target.getAttribute('data-review-state');
  if (reviewState) {
    state.alertReviewState = reviewState;
    state.alertsLoaded = false;
    await loadAlerts();
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
    state.alertsLoaded = false;
    await navigateToPage('alerts');
    return;
  }

  const action = target.getAttribute('data-action');
  if (action === 'open-artwork') {
    event.preventDefault();
    openArtworkOverlay(target);
    return;
  }
  if (action === 'review-listing') {
    if (target.getAttribute('data-reviewed') !== 'true' && !isPreviewMode) {
      void mutateAlert(target.getAttribute('data-alert-id'), 'review');
    }
    return;
  }
  if (action === 'mark-alert-reviewed' || action === 'mark-alert-new' || action === 'dismiss-alert') {
    const operation = action === 'mark-alert-reviewed' ? 'review' : action === 'mark-alert-new' ? 'mark-new' : 'dismiss';
    await mutateAlert(target.getAttribute('data-alert-id'), operation);
    return;
  }
  if (action === 'undo-dismiss') {
    const alertId = state.dismissUndo?.id;
    clearDismissUndo();
    state.alertNotice = '';
    await mutateAlert(alertId, 'restore');
    return;
  }
  if (action === 'view-new-alerts') {
    state.alertChaseId = null;
    state.alertChaseName = '';
    state.alertReviewState = 'NEW';
    state.alertsLoaded = false;
    await navigateToPage('alerts');
    return;
  }
  if (action === 'previous-home-shelf' || action === 'next-home-shelf') {
    const itemCount = state.shelf?.items?.length || 0;
    if (itemCount > 1) {
      const direction = action === 'previous-home-shelf' ? -1 : 1;
      const currentIndex = boundedHomeShelfIndex(state.homeShelfIndex, itemCount);
      state.homeShelfIndex = boundedHomeShelfIndex(currentIndex + direction, itemCount);
      renderCurrentPage();
    }
    return;
  }
  if (action === 'view-alert-chase') {
    state.vaultFilter = 'ALL';
    state.pendingVaultFocusId = target.getAttribute('data-chase-id');
    await navigateToPage('vault');
    return;
  }
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
  if (action === 'retry-settings') {
    await loadSettings({ force: true });
    return;
  }
  if (action === 'view-chase-matches') {
    state.alertChaseId = target.getAttribute('data-chase-id');
    state.alertChaseName = target.getAttribute('data-card-name') || '';
    state.alertReviewState = 'ALL';
    state.alertsLoaded = false;
    await navigateToPage('alerts');
    return;
  }
  if (action === 'clear-chase-filter') {
    state.alertChaseId = null;
    state.alertChaseName = '';
    state.alertReviewState = 'NEW';
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
  if (action === 'cancel-settings-currency') {
    state.settingsCurrencyConfirmation = null;
    renderCurrentPage();
    return;
  }
  if (action === 'confirm-settings-currency') {
    const patch = settingsPatch();
    state.settingsCurrencyConfirmation = null;
    await persistSettingsPatch(patch);
    return;
  }
  if (action === 'open-add-chase') {
    resetVaultAutocomplete();
    state.vaultCardSelection = null;
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
    state.vaultCardSelection = null;
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
    const chaseId = target.getAttribute('data-chase-id');
    const existingName = state.vault.find((entry) => entry.chase.id === chaseId)?.chase.cardName;
    state.vaultCardSelection = existingName ? { kind: 'existing', value: existingName } : null;
    state.vaultFormMode = 'edit';
    state.vaultEditingId = chaseId;
    state.vaultPrefillCardName = '';
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'close-vault-dialog') {
    resetVaultAutocomplete();
    state.vaultCardSelection = null;
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
    if (state.activePage === 'settings' && state.settingsDirty && !window.confirm('Discard your unsaved Settings changes?')) return;
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
  if (target instanceof HTMLInputElement && target.closest('[data-settings-form]') && target.name === 'alertVolume') {
    state.settingsDraft.alertVolume = target.value;
    state.settingsSaveStatus = '';
    clearSettingsFieldError('alertVolume');
    syncSettingsFormState();
    return;
  }
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.closest('[data-settings-form]')) {
    state.settingsDraft[target.name] = target.value === 'OFF' ? null : target.value;
    state.settingsSaveStatus = '';
    clearSettingsFieldError(target.name);
    if (target.name === 'shippingCountry') {
      state.settingsDraft.shippingPostalCode = null;
      updateSettingsPostalControl(target.value);
      const postalInput = document.querySelector('[data-settings-form] [name="shippingPostalCode"]');
      if (postalInput instanceof HTMLInputElement) postalInput.value = '';
    }
    syncSettingsFormState();
    return;
  }
  if (target.name === 'gradingType' && target.closest('[data-vault-form]')) {
    syncGradeValueControl(target.closest('[data-vault-form]'));
    return;
  }
  if (target.getAttribute('data-action') === 'source-filter') {
    state.source = target.value;
    state.alertsLoaded = false;
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
  if (form.matches('[data-settings-form]')) {
    event.preventDefault();
    await submitSettingsForm();
    return;
  }
  if (!form.matches('[data-vault-form]')) return;
  event.preventDefault();
  await submitVaultForm(form);
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.closest('[data-settings-form]')) {
    if (target.name === 'minScore') {
      state.settingsDraft.minScore = Number(target.value);
      const output = document.querySelector('[data-confidence-output]');
      if (output) output.textContent = target.value;
    }
    if (target.name === 'shippingPostalCode') state.settingsDraft.shippingPostalCode = target.value.trim() || null;
    state.settingsSaveStatus = '';
    clearSettingsFieldError(target.name);
    syncSettingsFormState();
    return;
  }
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
      const placeholder = document.createElement('span');
      placeholder.className = 'alert-image-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'V';
      (target.closest('.artwork-trigger') || target).replaceWith(placeholder);
    } else if (target instanceof HTMLImageElement && target.matches('[data-home-alert-image]')) {
      const placeholder = document.createElement('span');
      placeholder.className = 'home-preview-image-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'V';
      (target.closest('.artwork-trigger') || target).replaceWith(placeholder);
    } else if (target instanceof HTMLImageElement && target.matches('[data-home-shelf-image]')) {
      const placeholder = document.createElement('p');
      placeholder.className = 'home-shelf-artwork-unavailable';
      placeholder.textContent = 'Artwork unavailable';
      (target.closest('.artwork-trigger') || target).replaceWith(placeholder);
    } else if (target instanceof HTMLImageElement && target.matches('[data-home-shelf-background-image]')) {
      target.remove();
    } else if (target instanceof HTMLImageElement && target.matches('[data-vault-card-image], [data-shelf-card-image]')) {
      const placeholder = document.createElement('div');
      placeholder.className = `${target.matches('[data-shelf-card-image]') ? 'shelf-card-image' : 'vault-card-image'} placeholder-image`;
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = target.matches('[data-shelf-card-image]') ? 'Image unavailable' : 'V';
      if (target.matches('[data-shelf-card-image]')) placeholder.classList.add('shelf-image-unavailable');
      (target.closest('.artwork-trigger') || target).replaceWith(placeholder);
    }
  },
  true
);

window.addEventListener('beforeunload', (event) => {
  if (!state.settingsDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

bootstrap();
