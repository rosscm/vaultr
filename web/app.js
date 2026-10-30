const app = document.querySelector('#app');
const isPreviewMode = window.location.pathname === '/preview' || window.location.pathname === '/preview/';
const appHomePath = isPreviewMode ? '/preview' : '/app';
let artworkReturnFocus = null;
let artworkPreviousBodyOverflow = '';
let artworkKeydownHandler = null;
let logoutReturnFocus = null;
let newAlertPresenceRequest = null;
let newAlertPresenceTimer = null;

function apiUrl(url) {
  if (!isPreviewMode || !url.startsWith('/api/')) return url;
  return `/api/preview/${url.slice('/api/'.length)}`;
}

const state = {
  user: null,
  identities: { email: { connected: false }, discord: { connected: false } },
  authConfig: { email: { available: false }, discord: { available: false }, environment: null },
  emailConfirmation: null,
  authBusy: false,
  authEmailDraft: '',
  authNotice: '',
  authError: '',
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
  hasNewAlerts: false,
  vault: [],
  vaultFilter: 'ALL',
  completedChases: [],
  vaultPlan: null,
  vaultCurrency: 'CAD',
  vaultOptions: null,
  isVaultLoading: false,
  vaultLoaded: false,
  vaultError: null,
  vaultRequestId: 0,
  shelf: null,
  isShelfLoading: false,
  shelfLoaded: false,
  shelfError: null,
  homeShelfIndex: 0,
  discoveryFeedbackPending: {},
  discoveryFeedbackErrors: {},
  discoveryFeedbackNotices: {},
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
  settingsSaveContext: null,
  onboarding: null,
  onboardingLoaded: false,
  onboardingError: '',
  onboardingBusy: false,
  onboardingPreviewChaseCreated: false,
  onboardingRevisitMode: false,
  onboardingRevisitStep: 'WELCOME',
  vaultNotice: null,
  vaultFormMode: null,
  vaultEditingId: null,
  vaultPrefillCardName: '',
  vaultFormDraft: null,
  vaultFormError: '',
  vaultSubmitting: false,
  vaultCreateRecovery: null,
  onboardingSavedChasePending: false,
  collectorProfile: null,
  collectorProfileOptions: null,
  collectorProfileDraft: null,
  collectorProfileLoading: false,
  collectorProfileError: '',
  planComparisonOpen: false,
  logoutConfirmationOpen: false,
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

function tasteOnboardingEnabled() {
  return isPreviewMode || state.authConfig?.features?.tasteOnboarding === true;
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

function inlineVaultrPlusCopy(value) {
  return escapeHtml(value).replaceAll('Vaultr Plus', '<strong class="inline-vaultr-plus">Vaultr Plus</strong>');
}

function linkedVaultrPlusCopy(value) {
  return escapeHtml(value).replaceAll('Vaultr Plus', '<a class="inline-vaultr-plus" href="#plus" data-page="plus">Vaultr Plus</a>');
}

function pageHeaderMarkup({ id, title, tagline, copy, className = '' }) {
  return `
    <header class="page-header${className ? ` ${className}` : ''}">
      <h1 id="${escapeHtml(id)}">${escapeHtml(title)}</h1>
      <p class="page-tagline">${escapeHtml(tagline)}</p>
      ${copy ? `<p class="page-support">${escapeHtml(copy)}</p>` : ''}
    </header>
  `;
}

function planLabel(tier) {
  return tier === 'PRO' ? 'Vaultr Plus' : 'Free';
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
  if (value === 'home' || value === 'vault' || value === 'alerts' || value === 'shelf' || value === 'plus' || value === 'settings' || value === 'onboarding') return value;
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
  if (state.activePage === 'shelf') {
    await Promise.all([
      state.shelfLoaded ? Promise.resolve() : loadShelf(),
      state.vaultLoaded ? Promise.resolve() : loadVault()
    ]);
  }
  if (state.activePage === 'settings') {
    await Promise.all([
      state.settingsLoaded ? Promise.resolve() : loadSettings(),
      state.vaultLoaded ? Promise.resolve() : loadVault()
    ]);
  }
  if (state.activePage === 'plus') {
    await Promise.all([
      state.vaultLoaded ? Promise.resolve() : loadVault(),
      state.shelfLoaded ? Promise.resolve() : loadShelf()
    ]);
  }
  if (state.activePage === 'onboarding') {
    await Promise.all([
      state.settingsLoaded ? Promise.resolve() : loadSettings(),
      state.vaultLoaded ? Promise.resolve() : loadVault(),
      state.collectorProfileDraft ? Promise.resolve() : loadCollectorProfile()
    ]);
  }
}

async function navigateToPage(page, { updateHash = true } = {}) {
  const nextPage = page === 'home' || page === 'vault' || page === 'alerts' || page === 'shelf' || page === 'plus' || page === 'settings' || page === 'onboarding' ? page : 'home';
  if ((state.activePage === 'settings' || state.activePage === 'onboarding') && nextPage !== state.activePage && state.settingsDirty) {
    if (!window.confirm('Discard your unsaved Settings changes?')) {
      if (!updateHash) window.history.replaceState(null, '', `#${state.activePage}`);
      return false;
    }
    resetSettingsDraft();
  }
  if (state.activePage === 'onboarding' && nextPage !== 'onboarding' && state.settingsDirty) {
    if (!window.confirm('Discard unsaved setup changes?')) {
      if (!updateHash) window.history.replaceState(null, '', '#onboarding');
      return false;
    }
    resetSettingsDraft();
  }
  if (updateHash && window.location.hash !== `#${nextPage}`) {
    window.location.hash = nextPage;
    return true;
  }
  const pageChanged = state.activePage !== nextPage;
  if (pageChanged && state.vaultNotice?.kind !== 'error' && nextPage !== state.vaultNotice?.scope) state.vaultNotice = null;
  state.activePage = nextPage;
  renderCurrentPage();
  await loadActivePageData();
  if (pageChanged) resetViewportForPage(nextPage);
  return true;
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

function vaultDraftFromChase(chase = {}) {
  const grade = gradeToChoices(chase.grade);
  return {
    cardName: chase.cardName || '',
    maxPrice: chase.maxPrice !== undefined ? String(chase.maxPrice) : '',
    gradingType: grade.gradingType,
    gradeValue: effectiveGradeValue(grade.gradingType, grade.gradeValue),
    condition: conditionToChoice(chase.condition),
    listingType: chase.listingType || 'ANY',
    priority: chase.priority || 'NORMAL',
    targetNote: chase.targetNote || '',
    customExclusions: chase.negativeKeywords?.join(', ') || ''
  };
}

function captureVaultFormDraft(form) {
  const data = new FormData(form);
  const value = (name, fallback = '') => String(data.get(name) ?? fallback);
  const gradingType = value('gradingType', 'ANY');
  return {
    cardName: value('cardName').trimStart(),
    maxPrice: value('maxPrice'),
    gradingType,
    gradeValue: effectiveGradeValue(gradingType, value('gradeValue', 'ANY')),
    condition: value('condition', state.vaultFormDraft?.condition || 'ANY'),
    listingType: value('listingType', state.vaultFormDraft?.listingType || 'ANY'),
    priority: value('priority', state.vaultFormDraft?.priority || 'NORMAL'),
    targetNote: value('targetNote', state.vaultFormDraft?.targetNote || ''),
    customExclusions: value('customExclusions', state.vaultFormDraft?.customExclusions || '')
  };
}

function setVaultNotice(message, scope = 'vault', kind = 'success') {
  state.vaultNotice = { message, scope, kind };
}

function vaultNoticeMarkup(scope = 'vault') {
  if (!state.vaultNotice || state.vaultNotice.scope !== scope) return '';
  return `<div class="vault-notice${state.vaultNotice.kind === 'error' ? ' error' : ''}" role="${state.vaultNotice.kind === 'error' ? 'alert' : 'status'}"><span>${escapeHtml(state.vaultNotice.message)}</span><button class="vault-action-link" type="button" data-action="dismiss-vault-notice" aria-label="Dismiss message">Dismiss</button></div>`;
}

function planComparisonMarkup() {
  if (!state.planComparisonOpen) return '';
  const plans = state.vaultOptions?.plans || [];
  const currentTier = state.vaultPlan?.tier;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="vault-dialog plan-comparison-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-comparison-title">
        <header><p class="eyebrow">PLANS</p><h2 id="plan-comparison-title">Compare plans</h2><p class="dialog-intro">Choose how much room and precision you need. Vaultr checks regularly for new matches. Timing can vary depending on the source and when new listings become available.</p></header>
        <div class="plan-comparison-grid">
          ${plans.map((plan) => `<article class="plan-comparison-item${plan.tier === currentTier ? ' current' : ''}"><span>${plan.tier === currentTier ? 'Your plan' : 'Plan'}</span><h3>${escapeHtml(plan.label)}</h3><ul><li>Watch up to ${escapeHtml(plan.maxActiveChases)} cards</li><li>Checks every ${escapeHtml(plan.checkIntervalMinutes)} minutes</li><li>${plan.advancedFiltering ? 'Advanced filters included' : 'Core matching controls'}</li><li>${plan.storefrontMonitoring ? 'eBay and Trusted Shops' : 'eBay monitoring'}</li><li>${plan.discoveryDepth === 'full' ? 'A full personalized Display Case shaped by what you collect, with market context when reliable data is available' : 'Three general finds each week, starting with collector picks'}</li></ul></article>`).join('')}
        </div>
        ${currentTier === 'FREE' ? '<p class="plan-availability"><strong class="inline-vaultr-plus">Vaultr Plus</strong> is not available for self-service purchase yet.</p>' : ''}
        <footer class="dialog-actions"><button class="button-ghost" type="button" data-action="close-plan-comparison">Close</button><button class="button-primary" type="button" data-page="plus">Explore Plus</button></footer>
      </section>
    </div>`;
}

function logoutConfirmationMarkup() {
  if (!state.logoutConfirmationOpen) return '';
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="vault-dialog logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-confirmation-title" aria-describedby="logout-confirmation-copy">
        <header>
          <h2 id="logout-confirmation-title">Log out of Vaultr?</h2>
          <p id="logout-confirmation-copy" class="dialog-intro">You’ll need to sign in again to access your collection.</p>
        </header>
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="cancel-logout">Cancel</button>
          <button class="button-primary" type="button" data-action="confirm-logout">Log out</button>
        </footer>
      </section>
    </div>
  `;
}

function restoreLogoutTriggerFocus() {
  const target = logoutReturnFocus instanceof HTMLElement && logoutReturnFocus.isConnected
    ? logoutReturnFocus
    : document.querySelector('[data-action="logout"]');
  target?.focus();
  logoutReturnFocus = null;
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
    const details = [selection.setName, selection.cardNumber, selection.language].filter(Boolean);
    return `${selection.imageUrl ? `<img class="card-identity-thumbnail" src="${escapeHtml(selection.imageUrl)}" alt="" aria-hidden="true">` : ''}<span class="card-identity-copy"><span class="identity-confirmed">Exact card selected</span>${details.length ? `<small>${details.map(escapeHtml).join(' · ')}</small>` : '<small>Trusted card reference</small>'}</span><button class="vault-action-link card-identity-change" type="button" data-action="change-card-selection">Change</button>`;
  }
  if (selection?.kind === 'existing') {
    return `<span class="identity-current">Current Watchlist card</span><strong>${escapeHtml(selection.value)}</strong>`;
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
  if (body.error === 'VAULT_LIMIT_REACHED') return 'Your Watchlist has reached its active card limit.';
  if (body.error === 'DUPLICATE_CHASE') return 'That card is already in your Watchlist.';
  if (body.error === 'NO_APPLICABLE_CHANGES') return 'Those changes use Vaultr Plus controls.';
  if (body.error === 'NO_CHANGES_REQUESTED') return 'Choose at least one change.';
  if (body.error === 'INVALID_GRADE_PREFERENCE') return 'Choose a valid grade preference.';
  if (body.error === 'invalid_card_selection') return 'That exact card selection expired or changed. Your preferences are still here; choose the card again to refresh it before saving.';
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

function environmentBadgeMarkup() {
  const label = state.authConfig?.environment?.label;
  if (!label) return '';
  const staging = String(label).toLowerCase() === 'staging';
  const detail = staging ? 'Marketplace checks paused' : '';
  return `<span class="environment-label"${detail ? ` title="${detail}" aria-label="${escapeHtml(label)}. ${detail}."` : ''}>${escapeHtml(label)}</span>`;
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
  const emailAvailable = state.authConfig?.email?.available;
  const discordAvailable = state.authConfig?.discord?.available;
  const confirmationReady = state.emailConfirmation?.ready;
  return `
    <main id="app-main" class="signed-out">
      <section class="signed-out-card" aria-labelledby="signed-out-title">
        ${state.authConfig?.environment?.label ? `<span class="environment-label">${escapeHtml(state.authConfig.environment.label)}</span>` : ''}
        <img class="boot-logo" src="/vaultr-icon.svg" alt="" aria-hidden="true">
        <h1 id="signed-out-title">Your collection, watched.</h1>
        <p>Track the cards you're chasing, review matches, and discover cards picked around your collection.</p>
        ${confirmationReady ? `
          <div class="auth-confirmation" role="status">
            <strong>${state.emailConfirmation.purpose === 'LINK_EMAIL' ? 'Verify this email login' : 'Your secure sign-in link is ready'}</strong>
            <p>${state.emailConfirmation.purpose === 'LINK_EMAIL' ? 'Sign in to the existing Vaultr account that requested this link, then return here to finish.' : `Continue as ${escapeHtml(state.emailConfirmation.email)}.`}</p>
            ${state.emailConfirmation.purpose === 'SIGN_IN' ? '<button class="button-primary" type="button" data-action="redeem-email-link">Continue to Vaultr</button>' : ''}
          </div>
          ${state.emailConfirmation.purpose === 'LINK_EMAIL' && discordAvailable ? '<a class="button-primary auth-discord-button" href="/auth/discord">Sign in with Discord</a>' : ''}
        ` : `
          ${emailAvailable ? `
            <form class="email-auth-form" data-email-signin-form novalidate>
              <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.authEmailDraft)}" required></label>
              <button class="button-primary" type="submit"${state.authBusy ? ' disabled' : ''}>${state.authBusy ? 'Sending…' : 'Send sign-in link'}</button>
            </form>
            <p class="auth-fine-print">If this email is new to Vaultr, your account will be created after verification.</p>
          ` : '<p class="auth-unavailable">Email sign-in isn’t available here yet.</p>'}
          ${discordAvailable ? '<div class="auth-divider"><span>or</span></div><a class="button-ghost auth-discord-button" href="/auth/discord">Sign in with Discord</a>' : ''}
        `}
        ${state.authNotice ? `<p class="form-success" role="status">${escapeHtml(state.authNotice)}</p>` : ''}
        ${state.authError ? `<p class="form-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
      </section>
    </main>
  `;
}

function shellMarkup(content) {
  const displayName = userDisplayName(state.user);
  const accountPlan = state.vaultPlan ? planLabel(state.vaultPlan.tier) : '';
  const accountPlanClass = state.vaultPlan?.tier === 'PRO' ? 'plan-plus' : '';
  return `
    <div class="app-page">
      <div class="app-shell">
        <header class="desktop-header">
          <div class="desktop-header-inner">
            <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
              <img class="brand-lockup" src="/vaultr-lockup-dark.svg" alt="" aria-hidden="true">
              ${environmentBadgeMarkup()}
            </a>
            <nav class="app-nav desktop-nav" aria-label="Vaultr app navigation">
              ${navButton('home', 'Home')}
              ${navButton('vault', 'Watchlist')}
              ${navButton('alerts', 'Inbox')}
              ${navButton('shelf', 'Display Case')}
              ${navButton('plus', 'Vaultr Plus')}
              ${navButton('settings', 'Settings')}
            </nav>
            <div class="user-area">
              ${avatarHtml(state.user)}
              <span class="user-copy"><strong class="user-name">${escapeHtml(displayName)}</strong>${accountPlan ? `<small class="${accountPlanClass.trim()}">${escapeHtml(accountPlan)}</small>` : ''}</span>
              ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : `<button class="button-ghost" type="button" data-action="logout">${iconMarkup('logout')}<span>Log out</span></button>`}
            </div>
          </div>
        </header>
        <header class="mobile-header">
        <a class="brand" href="${appHomePath}" aria-label="Vaultr app">
          <img class="brand-icon" src="/vaultr-icon.svg" alt="" aria-hidden="true">
          ${environmentBadgeMarkup()}
        </a>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <button class="button-ghost account-plus-button" type="button" data-page="plus" aria-current="${state.activePage === 'plus' ? 'page' : 'false'}">${iconMarkup('plus')}<span>Plus</span></button>
          <button class="button-ghost account-settings-button" type="button" data-page="settings" aria-current="${state.activePage === 'settings' ? 'page' : 'false'}">${iconMarkup('settings')}<span>Settings</span></button>
          ${isPreviewMode ? '<span class="preview-label">Preview mode</span>' : `<button class="button-ghost" type="button" data-action="logout">${iconMarkup('logout')}<span>Log out</span></button>`}
        </div>
        </header>
        <main id="app-main" class="app-main">
          ${onboardingResumePromptMarkup()}
          ${content}
        </main>
        <nav class="mobile-nav" aria-label="Vaultr mobile navigation">
          ${navButton('home', 'Home')}
          ${navButton('vault', 'Watchlist')}
          ${navButton('alerts', 'Inbox')}
          ${navButton('shelf', 'Display Case')}
        </nav>
      </div>
      ${appFooterMarkup()}
      ${planComparisonMarkup()}
      ${logoutConfirmationMarkup()}
    </div>
  `;
}

function appFooterMarkup() {
  return `
    <footer class="app-footer-region">
      <div class="app-footer">
        <div class="app-footer-brand">
          <a class="app-footer-lockup" href="#home" data-page="home" aria-label="Vaultr home">
            <img class="brand-icon" src="/vaultr-icon.svg" alt="" aria-hidden="true">
            <div><strong>Vaultr</strong><p>Build your Vault. Chase your grails. Discover what you love next.</p></div>
          </a>
          <p class="app-footer-credit">Built with <span aria-label="love">♥</span> by <a href="https://linktr.ee/pokaccini" target="_blank" rel="noreferrer">Pokaccini</a></p>
        </div>
        <nav class="app-footer-link-grid" aria-label="Footer">
          <div class="app-footer-links">
            <h2>Product</h2>
            <a href="#vault" data-page="vault">Watchlist</a>
            <a href="#alerts" data-page="alerts">Inbox</a>
            <a href="#shelf" data-page="shelf">Discover</a>
            <a href="#plus" data-page="plus">Vaultr Plus</a>
          </div>
          <div class="app-footer-links">
            <h2>Trust &amp; Support</h2>
            <a href="#onboarding" data-action="revisit-onboarding">How Vaultr works</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
          </div>
          <div class="app-footer-links">
            <h2>Community</h2>
            <a href="https://linktr.ee/pokaccini" target="_blank" rel="noreferrer">Pokaccini</a>
          </div>
        </nav>
      </div>
    </footer>
  `;
}

function onboardingResumePromptMarkup() {
  if (state.activePage === 'onboarding' || state.onboarding?.status !== 'IN_PROGRESS') return '';
  return `
    <aside class="onboarding-resume-prompt" aria-label="Incomplete Vaultr setup">
      <span><strong>Finish setting up Vaultr</strong><small>Your progress is saved.</small></span>
      <button class="button-ghost" type="button" data-action="resume-onboarding">Resume setup</button>
    </aside>
  `;
}

function navButton(page, label) {
  const selected = state.activePage === page;
  const hasNewMatches = page === 'alerts' && state.hasNewAlerts;
  const accessibleLabel = hasNewMatches ? `${label}, new matches available` : label;
  return `<button class="nav-button" type="button" data-page="${page}" aria-label="${accessibleLabel}" aria-selected="${selected ? 'true' : 'false'}">${iconMarkup(page)}<span class="nav-label">${label}${hasNewMatches ? '<span class="nav-notification-dot" aria-hidden="true"></span>' : ''}</span></button>`;
}

function iconMarkup(name) {
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
    vault: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    alerts: '<path d="M4 5h16v14H4z"/><path d="m4 14 4-4h8l4 4"/><path d="M8 14h8"/>',
    shelf: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z"/>',
    plus: '<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.4v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-1.5-1H2V10h.1A1.7 1.7 0 0 0 3.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 4.2l.06.06A1.7 1.7 0 0 0 8 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.4 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h7v18h-7"/>'
  };
  return `<svg class="nav-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">${paths[name] || ''}</svg>`;
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
          <p id="settings-currency-description" class="dialog-intro">Saved Watchlist budgets will be converted using available exchange rates and rounded. Switching back may not restore the exact original amounts.</p>
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
  const header = pageHeaderMarkup({
    id: 'settings-title',
    title: 'Settings',
    tagline: 'Set Vaultr up your way.',
    copy: 'Make Vaultr feel right for you. Manage your account and adjust how we find matches for the cards you love.'
  });
  if (state.isSettingsLoading && !state.settingsLoaded) {
    return `<section class="settings-page" aria-labelledby="settings-title">${header}<div class="settings-loading" role="status">Loading Settings…</div></section>`;
  }
  if (state.settingsError && !state.settingsLoaded) {
    return `<section class="settings-page" aria-labelledby="settings-title">${header}<div class="state-panel"><h2>Couldn't load Settings.</h2><p>Try again when you are ready.</p><button class="retry-button" type="button" data-action="retry-settings">Try again</button></div></section>`;
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
  const emailIdentity = state.identities?.email || { connected: false };
  const discordIdentity = state.identities?.discord || { connected: false };
  const emailLinkAvailable = state.authConfig?.email?.available;
  const discordAvailable = state.authConfig?.discord?.available;
  const currentPlan = planLabel(state.vaultPlan?.tier || 'FREE');
  return `
    <section class="settings-page" aria-labelledby="settings-title">
      ${header}
      ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. You can inspect these settings, but changes will not be saved.</p>' : ''}
      <section class="settings-overview" aria-label="Account overview">
        <div class="settings-overview-row"><span><small>Current plan</small><strong>${escapeHtml(currentPlan)}</strong></span><button class="button-ghost settings-plan-link" type="button" data-action="open-plan-comparison">Compare plans</button></div>
        ${tasteOnboardingEnabled() ? '<div class="settings-overview-row"><span><strong>Collecting profile</strong><small>Update favourite Pokémon and artwork without changing your Watchlist.</small></span><button class="button-ghost settings-onboarding-link" type="button" data-action="edit-collector-profile">Edit profile</button></div>' : ''}
        <div class="settings-overview-row"><span><strong>Getting started</strong><small>Review your market preferences or the first-card walkthrough.</small></span><button class="button-ghost settings-onboarding-link" type="button" data-action="revisit-onboarding">Revisit setup</button></div>
      </section>
      <section class="settings-group account-methods" aria-labelledby="settings-login-title">
        <div class="settings-group-heading"><p class="eyebrow">Account</p><h2 id="settings-login-title">Login methods</h2></div>
        <div class="account-method-content">
          <div class="account-method-list">
            <div class="account-method-row">
              <span><strong>Email</strong><small>${emailIdentity.connected ? `${escapeHtml(emailIdentity.email)} · Verified` : 'Not connected'}</small><small>${emailIdentity.connected ? 'Use this address to sign in with a secure email link.' : emailLinkAvailable ? 'Add an email address as another way to sign in.' : 'Email sign-in isn’t available here yet.'}</small></span>
              ${emailIdentity.connected || !emailLinkAvailable ? '' : `<form class="email-link-form" data-email-link-form novalidate><label class="field"><span class="visually-hidden">Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(state.authEmailDraft)}" placeholder="you@example.com" required${isPreviewMode ? ' disabled' : ''}></label><button class="button-ghost" type="submit"${isPreviewMode || state.authBusy ? ' disabled' : ''}>Send verification link</button></form>`}
            </div>
            <div class="account-method-row">
              <span><strong>Discord</strong><small>${discordIdentity.connected ? escapeHtml(discordIdentity.displayName || discordIdentity.username || 'Connected') : 'Not connected'}</small><small>${discordIdentity.connected ? 'Connected for sign-in and supported Discord features.' : 'Optional. Connect Discord as another way to access Vaultr.'}</small></span>
              ${discordIdentity.connected || !discordAvailable || isPreviewMode ? '' : '<a class="button-ghost account-method-action" href="/auth/discord">Connect Discord</a>'}
            </div>
          </div>
          ${state.emailConfirmation?.ready && state.emailConfirmation.purpose === 'LINK_EMAIL' ? '<button class="button-primary" type="button" data-action="redeem-email-link">Finish adding email</button>' : ''}
          ${state.authNotice ? `<p class="form-success" role="status">${escapeHtml(state.authNotice)}</p>` : ''}
          ${state.authError ? `<p class="form-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}
        </div>
      </section>
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
          <small class="field-hint" id="settings-volume-help">The limit applies across active Watchlist searches.</small>
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
                return `<option value="${escapeHtml(option.value)}"${draft.listingSourceMode === option.value ? ' selected' : ''}${locked ? ' disabled' : ''}>${escapeHtml(option.label)}${locked ? ' (Vaultr Plus)' : ''}</option>`;
              }).join('')}
            </select>
            <small class="field-hint" id="settings-source-help">Trusted Shops require <strong class="inline-vaultr-plus">Vaultr Plus</strong>.${sourceMismatch ? ` Your saved preference is retained, but Vaultr currently watches ${escapeHtml(draft.effectiveListingSourceMode === 'EBAY' ? 'eBay' : draft.effectiveListingSourceMode)}.` : ''}</small>
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
              <small class="field-hint" id="settings-currency-help">Changing currency converts and rounds saved Watchlist budgets. Shipping destination remains independent.</small>
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

function plusPlanFeatureList(plan) {
  return `
    <ul>
      <li>Watch up to ${escapeHtml(plan.maxActiveChases)} cards at once</li>
      <li>${plan.monitoringPriority === 'PRIORITY' ? 'Priority monitoring with targeted checks' : 'Standard monitoring with targeted eBay checks'} every ${escapeHtml(plan.checkIntervalMinutes)} minutes</li>
      <li>${plan.advancedFiltering ? 'Precision condition, listing, priority, note, and exclusion controls' : 'Core card, budget, and grading preferences'}</li>
      <li>${plan.storefrontMonitoring ? 'eBay and Trusted Shops monitoring' : 'eBay monitoring'}</li>
      <li>${plan.discoveryDepth === 'full' ? 'A full personalized Display Case shaped by what you collect, with market context when reliable data is available' : 'Three general finds each week, starting with collector picks'}</li>
    </ul>
  `;
}

function plusNextStep({ isPlus, atLimit, billingAvailable, staging }) {
  if (isPlus) {
    return {
      heading: 'Make the most of Plus',
      copy: 'Your Plus access is active. Add or refine the cards you want Vaultr to watch.',
      action: 'Open Watchlist',
      page: 'vault'
    };
  }
  if (!atLimit) {
    return {
      heading: 'Keep building your Watchlist',
      copy: 'Add another card when you are ready. Your Free Watchlist remains fully usable.',
      action: 'Build your Watchlist',
      page: 'vault'
    };
  }
  if (billingAvailable && !staging) {
    return {
      heading: 'Ready for more room?',
      copy: 'Upgrade to add more chases and unlock priority monitoring, Trusted Shops, precision controls, and personalized discovery.',
      action: 'Upgrade to Vaultr Plus',
      page: 'settings'
    };
  }
  return {
    heading: 'Your Watchlist is full',
    copy: 'Manage your current chases, or compare what Vaultr Plus adds when upgrades become available.',
    action: 'Manage Watchlist',
    page: 'vault'
  };
}

function plusPageMarkup() {
  const header = pageHeaderMarkup({
    id: 'plus-title',
    title: 'Vaultr Plus',
    tagline: 'Make discovery feel more like you.',
    copy: 'Give your collection more room to grow, with more cards to watch and a personalized Display Case that gets to know what you love.',
    className: 'plus-header'
  });
  if (state.isVaultLoading && !state.vaultLoaded) {
    return `<section class="plus-page" aria-labelledby="plus-title">${header}<div class="settings-loading" role="status">Loading plan details…</div></section>`;
  }
  if (state.vaultError && !state.vaultLoaded) {
    return `<section class="plus-page" aria-labelledby="plus-title">${header}${statePanelMarkup("Couldn't load plan details.", 'Try again when you are ready.', 'Try again', 'retry-vault')}</section>`;
  }
  const plans = state.vaultOptions?.plans || [];
  const currentTier = state.vaultPlan?.tier || 'FREE';
  const currentPlan = plans.find((plan) => plan.tier === currentTier);
  const isPlus = currentTier === 'PRO';
  const activeCount = state.vaultPlan?.activeCount ?? 0;
  const maxActiveChases = currentPlan?.maxActiveChases ?? state.vaultPlan?.maxActiveChases ?? 0;
  const atLimit = maxActiveChases > 0 && activeCount >= maxActiveChases;
  const environmentLabel = state.authConfig?.environment?.label || '';
  const staging = environmentLabel.toLowerCase() === 'staging';
  const billingAvailable = Boolean(state.vaultOptions?.billing?.selfServiceAvailable);
  const supportedShopNames = state.vaultOptions?.supportedShopNames || [];
  const nextStep = plusNextStep({ isPlus, atLimit, billingAvailable, staging });
  return `
    <section class="plus-page" aria-labelledby="plus-title">
      ${header}
      ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. No plan changes can be made here.</p>' : ''}
      <section class="plus-comparison" aria-labelledby="plus-comparison-title">
        <div class="plus-section-heading"><p class="eyebrow">COMPARE</p><h2 id="plus-comparison-title">Choose the room and precision that fit your collection</h2><p>Vaultr checks regularly for new matches. Timing can vary depending on the source and when new listings become available.</p></div>
        <div class="plus-plan-grid">
          ${plans.map((plan) => `<article class="plus-plan${plan.tier === currentTier ? ' current' : ''}${plan.tier === 'PRO' ? ' featured' : ''}"><span>${plan.tier === currentTier ? 'Your plan' : plan.tier === 'PRO' ? 'VAULTR PLUS' : 'Plan'}</span><h3>${escapeHtml(plan.label)}</h3>${plusPlanFeatureList(plan)}</article>`).join('')}
        </div>
        <p class="plus-discovery-note">Free starts with collector picks, then brings three general finds each week. <strong class="inline-vaultr-plus">Vaultr Plus</strong> adds a full personalized Display Case once Vaultr has enough collecting history to understand your taste.</p>
      </section>
      <section class="plus-source-note" aria-labelledby="plus-source-title">
        <div><p class="eyebrow">LISTING SOURCES</p><h2 id="plus-source-title">Where Vaultr searches</h2><p>eBay is available to everyone. <strong class="inline-vaultr-plus">Vaultr Plus</strong> can also search supported card shops when available. We’ll continue expanding supported sources over time.</p></div>
        ${supportedShopNames.length ? `<ul aria-label="Supported card shops">${supportedShopNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` : ''}
      </section>
      <section class="plus-next-step" aria-labelledby="plus-next-title">
        <div><p class="eyebrow">NEXT STEP</p><h2 id="plus-next-title">${escapeHtml(nextStep.heading)}</h2><p>${inlineVaultrPlusCopy(nextStep.copy)}</p></div>
        <button class="button-primary" type="button" data-page="${escapeHtml(nextStep.page)}">${escapeHtml(nextStep.action)}</button>
      </section>
    </section>
  `;
}

function onboardingStepIndicator(step) {
  const steps = tasteOnboardingEnabled() ? ['WELCOME', 'MARKET', 'PROFILE', 'CHASE', 'READY'] : ['WELCOME', 'MARKET', 'CHASE', 'READY'];
  const labels = tasteOnboardingEnabled() ? ['Welcome', 'Market', 'Your taste', 'First card', 'Ready'] : ['Welcome', 'Market', 'First card', 'Ready'];
  const active = Math.max(0, steps.indexOf(step));
  return `<ol class="onboarding-steps" aria-label="Setup progress">${steps.map((item, index) => `<li${index === active ? ' aria-current="step"' : ''}><span>${index + 1}</span><small>${labels[index]}</small></li>`).join('')}</ol>`;
}

function collectorProfileMarkup(revisit = false) {
  if (state.collectorProfileLoading && !state.collectorProfileDraft) return '<div class="state-panel" role="status">Loading collecting-profile choices…</div>';
  if (!state.collectorProfileDraft || !state.collectorProfileOptions) return `<div class="state-panel"><p>Collecting-profile choices are unavailable right now.</p><button class="button-ghost" type="button" data-action="retry-collector-profile">Try again</button></div>`;
  const selectedSubjects = new Set(state.collectorProfileDraft.subjects);
  const selectedArtwork = new Set(state.collectorProfileDraft.artwork.map((item) => `${item.source}:${item.sourceCardId}`));
  const subjectCount = selectedSubjects.size;
  const artworkCount = selectedArtwork.size;
  const ready = artworkCount >= 3 || (subjectCount >= 1 && artworkCount >= 2);
  const needed = Math.max(0, (subjectCount ? 2 : 3) - artworkCount);
  return `
    <div class="collector-profile-setup">
      <div class="collector-profile-group">
        <h2>Favourite Pokémon</h2>
        <p>Choose any favourites you would enjoy seeing more often.</p>
        <label class="field"><span>Search supported Pokémon</span><input type="search" data-collector-subject-search autocomplete="off" placeholder="Search Pokémon"></label>
        <div class="collector-subject-options" role="group" aria-label="Favourite Pokémon">
          ${state.collectorProfileOptions.subjects.map((subject) => `<button class="choice-chip${selectedSubjects.has(subject) ? ' selected' : ''}" type="button" data-action="toggle-collector-subject" data-subject="${escapeHtml(subject)}" aria-pressed="${selectedSubjects.has(subject)}">${escapeHtml(subject)}</button>`).join('')}
        </div>
      </div>
      <div class="collector-profile-group">
        <h2>Artwork you like</h2>
        <p>Pick exact printings whose artwork catches your eye.</p>
        <div class="collector-artwork-options">
          ${state.collectorProfileOptions.artwork.map((item) => {
            const key = `${item.source}:${item.sourceCardId}`;
            return `<button class="collector-artwork-choice${selectedArtwork.has(key) ? ' selected' : ''}" type="button" data-action="toggle-collector-artwork" data-artwork-key="${escapeHtml(key)}" aria-pressed="${selectedArtwork.has(key)}"><img src="${escapeHtml(item.imageUrl)}" alt=""><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.setName, item.cardNumber, item.language].filter(Boolean).join(' · '))}</small></span></button>`;
          }).join('')}
        </div>
      </div>
      <p class="collector-profile-progress" role="status">${ready ? 'Ready to find your first picks.' : `Choose ${needed} more artwork ${subjectCount ? '' : 'or add a favourite Pokémon'} to prepare a sample.`}</p>
      ${state.collectorProfileError ? `<p class="form-error" role="alert">${escapeHtml(state.collectorProfileError)}</p>` : ''}
      <footer class="onboarding-actions"><button class="button-ghost" type="button" data-action="onboarding-back">Back</button><button class="onboarding-exit" type="button" data-action="skip-collector-profile">Skip for now</button><button class="button-primary" type="button" data-action="save-collector-profile">Save and continue</button></footer>
    </div>`;
}

function onboardingMarketMarkup(revisit = false) {
  const draft = state.settingsDraft;
  const options = state.settings?.options || {};
  if (!draft) return '<p role="status">Loading your market settings…</p>';
  const country = draft.shippingCountry || 'OFF';
  const supportsPostal = country === 'CA' || country === 'US';
  const currencies = settingsCurrencyOptions(draft, options);
  return `
    <form class="onboarding-market-form" data-settings-form data-onboarding-market-form novalidate>
      <div class="settings-field-grid">
        <label class="field"><span>Currency</span><select name="alertCurrency"${isPreviewMode ? ' disabled' : ''}>${currencies.map((currency) => `<option value="${escapeHtml(currency)}"${draft.alertCurrency === currency ? ' selected' : ''}>${escapeHtml(currency)}</option>`).join('')}</select><small class="field-hint">Saved Watchlist budgets use this currency. It stays independent from destination.</small>${settingsFieldError('alertCurrency')}</label>
        <label class="field"><span>Ship-to country</span><select name="shippingCountry"${isPreviewMode ? ' disabled' : ''}>${(options.shippingCountries || []).map((option) => `<option value="${escapeHtml(option.value)}"${country === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select><small class="field-hint">Used for shipping availability and estimates.</small>${settingsFieldError('shippingCountry')}</label>
        <label class="field settings-postal-field"${supportsPostal ? '' : ' hidden'}><span>${country === 'CA' ? 'Postal region' : 'ZIP region'}</span><input name="shippingPostalCode" value="${escapeHtml(draft.shippingPostalCode || '')}" placeholder="${country === 'CA' ? 'M5V' : '90210'}" maxlength="16"${isPreviewMode || !supportsPostal ? ' disabled' : ''}><small class="field-hint">Only a coarse region is retained.</small>${settingsFieldError('shippingPostalCode')}</label>
      </div>
      <footer class="onboarding-actions"><button class="button-ghost" type="button" data-action="onboarding-back">Back</button><button class="onboarding-exit" type="button" data-action="${revisit ? 'exit-onboarding-revisit' : 'skip-onboarding'}">${revisit ? 'Exit setup' : 'Skip setup'}</button><button class="button-primary" type="submit"${state.onboardingBusy ? ' disabled' : ''}>Save and continue</button></footer>
    </form>`;
}

function onboardingWelcomeMarkup(revisit = false) {
  return `
    <div class="onboarding-welcome-copy">
      <p class="eyebrow">WELCOME TO VAULTR</p>
      <h1 id="onboarding-title">Build your Vault. Chase your grails. Discover what you love next.</h1>
      <p class="onboarding-intro">Tell Vaultr which Pokémon cards you're looking for and what matters to you. We watch supported marketplaces for matching listings and help you discover cards around your collecting interests.</p>
      <ol class="onboarding-primer" aria-label="How Vaultr works">
        <li><span aria-hidden="true">1</span><div><strong>Chase</strong><p>Choose a card and the criteria that matter to you.</p></div></li>
        <li><span aria-hidden="true">2</span><div><strong>Watch</strong><p>Review qualifying marketplace listings in your Inbox.</p></div></li>
        <li><span aria-hidden="true">3</span><div><strong>Discover</strong><p>Explore personalized recommendations as your collector profile develops.</p></div></li>
      </ol>
      <div class="onboarding-actions onboarding-welcome-actions"><button class="button-primary" type="button" data-action="onboarding-continue">Get started</button><button class="onboarding-skip" type="button" data-action="${revisit ? 'exit-onboarding-revisit' : 'skip-onboarding'}">${revisit ? 'Back to Settings' : 'Skip setup'}</button></div>
    </div>
    <div class="onboarding-art-stack" aria-hidden="true">
      <img class="onboarding-art-card art-card-one" src="/onboarding-art/mew-corocoro-promo-151.webp" alt="">
      <img class="onboarding-art-card art-card-two" src="/onboarding-art/pichu-expedition-022.webp" alt="">
      <img class="onboarding-art-card art-card-three" src="/onboarding-art/sylveon-ex-212.webp" alt="">
      <small>Illustrative card artwork</small>
    </div>
  `;
}

function onboardingPageMarkup() {
  const revisit = state.onboardingRevisitMode;
  const step = revisit ? state.onboardingRevisitStep : state.onboarding?.step || 'WELCOME';
  const hasLoadedChase = !isPreviewMode && ((state.vault || []).length > 0 || state.onboardingSavedChasePending);
  const leaveAction = revisit
    ? '<button class="onboarding-exit" type="button" data-action="exit-onboarding-revisit">Exit setup</button>'
    : '<button class="onboarding-exit" type="button" data-action="skip-onboarding">Skip setup</button>';
  const previewNotice = isPreviewMode ? '<p class="preview-read-only" role="status">Preview simulation is read-only. No settings or Watchlist cards will be saved.</p>' : '';
  let content = '';
  if (step === 'WELCOME') content = onboardingWelcomeMarkup(revisit);
  if (step === 'MARKET') content = `<p class="eyebrow">PRICING & SHIPPING</p><h1 id="onboarding-title">Set your market context</h1><p>Choose how prices are shown and where listings need to ship.</p>${onboardingMarketMarkup(revisit)}`;
  if (step === 'PROFILE') content = `<p class="eyebrow">YOUR TASTE</p><h1 id="onboarding-title">What catches your eye?</h1><p>These choices stay separate from your Watchlist and Pickups.</p>${collectorProfileMarkup(revisit)}`;
  if (step === 'CHASE' && isPreviewMode) content = `<p class="eyebrow">YOUR FIRST CARD</p><h1 id="onboarding-title">Inspect the shared Watchlist form</h1><p>Try the same form used in the writable app. Preview entries remain local to this screen and are never saved.</p><div class="onboarding-actions"><button class="button-ghost" type="button" data-action="onboarding-back">Back</button>${leaveAction}<button class="button-ghost" type="button" data-action="onboarding-preview-ready">Continue simulation without saving</button><button class="button-primary" type="button" data-action="onboarding-add-chase">Inspect Watchlist form</button></div>`;
  if (step === 'CHASE' && !isPreviewMode) content = `<p class="eyebrow">YOUR FIRST CARD</p><h1 id="onboarding-title">${hasLoadedChase ? 'Your card is saved' : 'What card are you looking for?'}</h1><p>${hasLoadedChase ? 'You already have a card on your Watchlist. You’re ready to continue.' : 'Search for an exact printing or enter a clear card name. You can refine your preferences later.'}</p><div class="onboarding-actions"><button class="button-ghost" type="button" data-action="onboarding-back">Back</button>${leaveAction}${hasLoadedChase ? `<button class="button-primary" type="button" data-action="${!revisit && state.onboardingSavedChasePending ? 'retry-onboarding-after-save' : 'onboarding-chase-saved'}">${!revisit && state.onboardingSavedChasePending ? 'Retry setup' : 'Continue'}</button>` : '<button class="button-primary" type="button" data-action="onboarding-add-chase">Add your first card</button>'}</div>`;
  if (step === 'READY') content = `<p class="eyebrow">READY</p><h1 id="onboarding-title">Your Watchlist is ready</h1><p>${isPreviewMode ? state.onboardingPreviewChaseCreated ? 'The simulation advanced without saving a card. ' : 'This preview did not save a card. ' : state.onboarding?.hasChase || hasLoadedChase ? 'Your existing card is safe. ' : ''}Qualifying matches appear in Inbox after Vaultr checks find them. Your Watchlist and Pickups shape your collecting profile; personalized recommendations require <strong class="inline-vaultr-plus">Vaultr Plus</strong> and enough distinct card history, and may not appear immediately.</p><div class="onboarding-actions"><button class="button-ghost" type="button" data-action="onboarding-back">Back</button><button class="button-primary" type="button" data-action="finish-onboarding">${revisit ? 'Back to Settings' : 'Open Home'}</button></div>`;
  return `<section class="onboarding-page${step === 'WELCOME' ? ' welcome' : ''}" aria-labelledby="onboarding-title">${onboardingStepIndicator(step)}${previewNotice}${vaultNoticeMarkup('onboarding')}${state.onboardingError ? `<p class="form-error" role="alert">${escapeHtml(state.onboardingError)}</p>` : ''}<div class="onboarding-content${step === 'WELCOME' ? ' onboarding-welcome' : ''}">${content}</div>${vaultDialogMarkup()}${settingsCurrencyConfirmationMarkup()}</section>`;
}

function alertsPageMarkup(inner) {
  return `
    <section aria-labelledby="alerts-title">
      ${pageHeaderMarkup({
        id: 'alerts-title',
        title: 'Your matches',
        tagline: 'The right card might have just turned up.',
        copy: 'See what’s turned up for the cards you’re watching. Take a closer look, compare your options, and find the right one for your collection.'
      })}
      ${state.alertChaseId ? `
        <div class="active-chase-filter" role="status">
          <span>Matches for <strong>${escapeHtml(state.alertChaseName || 'this Watchlist card')}</strong></span>
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

function inboxCaughtUpMarkup() {
  return `
    <div class="state-panel inbox-empty-state">
      <span class="inbox-empty-icon" aria-hidden="true">${iconMarkup('alerts')}</span>
      <h2>You’re all caught up</h2>
      <p>New matches for the cards you’re watching will appear here.</p>
    </div>
  `;
}

function alertsMarkup() {
  if (!state.alerts.length) {
    if (state.alertReviewState === 'NEW') {
      const broadlyCaughtUp = state.priority === 'ALL' && state.source === 'ALL' && !state.alertChaseId;
      return alertsPageMarkup(broadlyCaughtUp
        ? inboxCaughtUpMarkup()
        : statePanelMarkup('No new matches in this view.', 'Try another filter or return to the full New inbox.'));
    }
    if (state.alertReviewState === 'REVIEWED') {
      return alertsPageMarkup(statePanelMarkup('No reviewed matches yet.', 'Matches you review will stay available here.'));
    }
    if (state.priority === 'ALL' && state.source === 'ALL' && !state.hasCheckedAllAlerts) {
      return alertsPageMarkup(statePanelMarkup('Nothing here yet.', "When Vaultr finds a match for a card on your Watchlist, it'll show up here."));
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
      ${compact ? '' : `<button class="vault-action-link" type="button" data-action="view-alert-chase" data-chase-id="${escapeHtml(alert.chaseId)}">View Watchlist item</button>`}
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
        <strong>${escapeHtml(alert.chaseName || 'Watchlist card')}</strong>
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
  const featured = shelfItems[featuredIndex];
  const seenImages = new Set(featured?.imageUrl ? [featured.imageUrl] : []);
  const supporting = [];
  for (let offset = 1; offset < shelfItems.length && supporting.length < 2; offset += 1) {
    const candidate = shelfItems[(featuredIndex + offset) % shelfItems.length];
    if (!candidate?.imageUrl || seenImages.has(candidate.imageUrl)) continue;
    seenImages.add(candidate.imageUrl);
    supporting.push(candidate);
  }
  return {
    featuredIndex,
    featured,
    supporting
  };
}

function homeShelfFeatureMarkup(items, index, { editorial = false, feedback = !editorial, label } = {}) {
  const { featured: item, featuredIndex, supporting } = homeShelfPresentation(items, index);
  if (!item) return '';
  const total = items.length;
  const details = [item.setName, item.cardNumber, item.language].filter(Boolean);
  const price = item.market?.askingTotal !== undefined
    ? formatMoney(item.market.askingTotal, item.market.currency)
    : item.market?.soldTotal !== undefined
      ? formatMoney(item.market.soldTotal, item.market.currency)
      : '';
  const priceLabel = item.market?.askingTotal !== undefined ? 'Asking price' : item.market?.soldTotal !== undefined ? 'Recent sold' : '';
  return `
    <div class="home-shelf-feature">
      <div class="home-shelf-artwork${item.imageUrl ? '' : ' empty'}${supporting.length ? ` has-${supporting.length + 1}-cards` : ''}">
        ${supporting.map((supportingItem, supportingIndex) => `<img class="home-shelf-supporting-card supporting-${supportingIndex + 1}" src="${escapeHtml(supportingItem.imageUrl)}" alt="" aria-hidden="true" loading="lazy" data-home-shelf-background-image>`).join('')}
        ${item.imageUrl
          ? artworkTriggerMarkup({
              imageUrl: item.imageUrl,
              identity: item.name || 'Display Case pick',
              imageKind: 'Card artwork',
              imageClass: 'home-shelf-feature-image',
              imageDataAttribute: 'data-home-shelf-image'
            })
          : '<p class="home-shelf-artwork-unavailable">Artwork unavailable</p>'}
      </div>
      <div class="home-shelf-copy">
        <small class="home-shelf-kind">${escapeHtml(label || (editorial ? 'Collector pick' : 'Picked for you'))}</small>
        <h3>${escapeHtml(item.displayName || item.name || 'Display Case pick')}</h3>
        ${item.nativeName ? `<span class="home-shelf-details">Original name: ${escapeHtml(item.nativeName)}</span>` : ''}
        ${details.length ? `<span class="home-shelf-details">${details.map(escapeHtml).join(' · ')}</span>` : ''}
        ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}
        ${price ? `<span class="home-shelf-price"><small>${escapeHtml(priceLabel)}</small>${escapeHtml(price)}</span>` : ''}
        ${feedback ? discoveryFeedbackMarkup(item, true) : ''}
      </div>
      ${total > 1 ? `
        <div class="home-shelf-controls" aria-label="Display Case preview controls">
          <button class="home-shelf-control" type="button" data-action="previous-home-shelf" aria-label="Previous recommendation" title="Previous recommendation" ${featuredIndex === 0 ? 'disabled' : ''}>&larr;</button>
          <button class="home-shelf-control" type="button" data-action="next-home-shelf" aria-label="Next recommendation" title="Next recommendation" ${featuredIndex === total - 1 ? 'disabled' : ''}>&rarr;</button>
        </div>
        <p class="home-shelf-position" role="status" aria-live="polite">${escapeHtml(featuredIndex + 1)} of ${escapeHtml(total)}</p>
      ` : ''}
    </div>
  `;
}

function homeWatchlistPreviewMarkup(item) {
  const chase = item.chase || {};
  const paused = item.monitoringState !== 'ACTIVE';
  const status = item.monitoringState === 'PAUSED_USER'
    ? 'Paused'
    : item.monitoringState === 'PAUSED_PLAN_LIMIT'
      ? 'Plan limit'
      : 'Watching';
  return `
    <article class="home-watchlist-card${paused ? ' paused' : ''}">
      <div class="home-watchlist-artwork">
        ${chase.cardImageUrl
          ? artworkTriggerMarkup({
              imageUrl: chase.cardImageUrl,
              identity: chase.cardName || 'Watchlist card',
              imageKind: 'Card artwork',
              imageClass: 'home-watchlist-image',
              imageDataAttribute: 'data-home-watchlist-image'
            })
          : '<span class="home-watchlist-placeholder" aria-hidden="true">V</span>'}
      </div>
      <div class="home-watchlist-copy">
        <span class="home-watchlist-status">${escapeHtml(status)}</span>
        <strong>${escapeHtml(chase.cardName || 'Watchlist card')}</strong>
        <span>${chase.maxPrice !== undefined ? `Up to ${escapeHtml(formatMoney(chase.maxPrice, state.vaultCurrency))} ${escapeHtml(state.vaultCurrency)}` : 'No maximum price'}</span>
      </div>
      <button class="home-watchlist-action" type="button" data-action="view-chase-matches" data-chase-id="${escapeHtml(chase.id)}" data-card-name="${escapeHtml(chase.cardName)}" aria-label="View matches for ${escapeHtml(chase.cardName || 'Watchlist card')}">&rarr;</button>
    </article>
  `;
}

function starterDiscoveryItems() {
  return state.shelf?.starterItems || [];
}

function hasPersonalizedDiscoveryAccess() {
  return state.vaultPlan?.tier === 'PRO'
    && state.shelf?.discovery?.tier === 'PRO'
    && state.shelf?.discovery?.state === 'POPULATED'
    && Boolean(state.shelf?.items?.length);
}

function homeDisplayCaseItems() {
  if (hasPersonalizedDiscoveryAccess()) return state.shelf.items;
  return starterDiscoveryItems();
}

function editorialDiscoveryCopy() {
  const count = starterDiscoveryItems().length;
  if (state.shelf?.generalDiscovery?.mode === 'STARTER') return 'Meet your first collector picks. Fresh finds follow each week.';
  if (state.shelf?.generalDiscovery?.mode === 'WEEKLY') return count === 3 ? 'Three cards to explore. New picks every week.' : `${count} cards to explore this week.`;
  return 'A few handpicked cards to explore.';
}

function homeDiscoveryHeadingCopy(mode) {
  if (mode === 'PERSONALIZED') return {
    heading: 'Picked for you',
    copy: 'Picks shaped by your Watchlist, Pickups, and the cards you tell Vaultr you like.'
  };
  if (mode === 'STARTER') return {
    heading: 'Your next favourite could be here.',
    copy: 'Meet your first collector picks. Fresh finds follow each week.'
  };
  if (mode === 'WEEKLY') return {
    heading: 'Your next favourite could be here.',
    copy: 'Three fresh finds each week. See what catches your eye.'
  };
  return { heading: 'Collector picks', copy: editorialDiscoveryCopy() };
}

function normalizedDiscoveryIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameDiscoveryPrinting(item, chase) {
  const itemIdentity = item?.cardIdentity;
  const chaseIdentity = chase?.cardIdentity;
  if (itemIdentity?.sourceName && itemIdentity?.sourceCardId && chaseIdentity?.sourceName && chaseIdentity?.sourceCardId) {
    if (normalizedDiscoveryIdentity(itemIdentity.sourceName) === normalizedDiscoveryIdentity(chaseIdentity.sourceName)
      && normalizedDiscoveryIdentity(itemIdentity.sourceCardId) === normalizedDiscoveryIdentity(chaseIdentity.sourceCardId)) return true;
  }
  if (itemIdentity?.matchKey && chaseIdentity?.matchKey) return itemIdentity.matchKey === chaseIdentity.matchKey;
  return Boolean(chaseIdentity?.value)
    && normalizedDiscoveryIdentity(chaseIdentity.value) === normalizedDiscoveryIdentity(item?.name);
}

function savedDiscoveryCard(item) {
  const active = state.vault.find((entry) => sameDiscoveryPrinting(item, entry.chase));
  if (active) return { kind: 'WATCHLIST', id: active.chase.id, paused: active.monitoringState !== 'ACTIVE' };
  const completed = state.completedChases.find((chase) => sameDiscoveryPrinting(item, chase));
  return completed ? { kind: 'PICKUP', id: completed.id } : null;
}

function discoveryCardActionMarkup(item, {
  addClass = 'vault-action-link',
  savedClass = 'button-watchlist',
  pickupClass = 'button-ghost'
} = {}) {
  const saved = savedDiscoveryCard(item);
  if (saved?.kind === 'WATCHLIST') {
    return `<button class="${savedClass}" type="button" data-action="view-discovery-card" data-chase-id="${escapeHtml(saved.id)}">View on Watchlist</button>`;
  }
  if (saved?.kind === 'PICKUP') {
    return `<button class="${pickupClass}" type="button" data-action="view-discovery-card" data-chase-id="${escapeHtml(saved.id)}">View Pickup</button>`;
  }
  return `<button class="${addClass}" type="button" data-action="add-shelf-card-to-vault" data-card-name="${escapeHtml(item.name || '')}" data-card-set="${escapeHtml(item.setName || '')}" data-card-number="${escapeHtml(item.cardNumber || '')}" data-card-language="${escapeHtml(item.language || '')}" data-card-image="${escapeHtml(item.imageUrl || '')}" data-card-selection-token="${escapeHtml(item.selection?.token || '')}">Add to Watchlist</button>`;
}

function discoveryCardPrimaryActionMarkup(item) {
  return discoveryCardActionMarkup(item, {
    addClass: 'button-primary shelf-add-button',
    savedClass: 'button-watchlist shelf-saved-view',
    pickupClass: 'button-ghost shelf-saved-view'
  });
}

function discoveryStateCopy(discovery, compact = false) {
  if (discovery?.state === 'PLAN_RESTRICTED') {
    return 'Your Watchlist and Pickups help shape your collecting profile. With Vaultr Plus, that profile guides your personalized Display Case.';
  }
  if (discovery?.state === 'INSUFFICIENT_SIGNALS') {
    const count = Number(discovery.uniqueSignalCount || 0);
    const minimum = Number(discovery.minimumSignalCount || 0);
    const needed = Number(discovery.signalsNeeded || 0);
    return `Your Display Case starts with what you love collecting. Your profile has ${count} of ${minimum} distinct card signals and needs ${needed} more. Watchlist cards and Pickups both help build it.`;
  }
  if (discovery?.state === 'AWAITING_PREPARATION') {
    return 'Your collecting profile is ready. We’re putting together your first personalized Display Case.';
  }
  if (discovery?.state === 'PREPARATION_UNAVAILABLE') {
    return 'Your collecting profile is ready, but personalized Display Case updates are unavailable in this environment.';
  }
  return compact ? 'A few collector favourites to get you started.' : 'Your Watchlist and Pickups help shape your collecting profile.';
}

function homeAttentionEmptyMarkup() {
  return `
    <div class="home-attention-empty">
      <span class="home-attention-empty-icon" aria-hidden="true">${iconMarkup('alerts')}</span>
      <div><strong>You’re all caught up</strong><p>New matches for the cards you’re watching will appear here.</p></div>
    </div>
  `;
}

function homePageMarkup() {
  const activeChases = state.vaultPlan?.activeCount ?? state.vault.length;
  const alertPreview = state.homeAttentionAlerts.slice(0, 4);
  const personalizedReady = hasPersonalizedDiscoveryAccess();
  const starterPicks = !personalizedReady && state.shelf?.generalDiscovery?.mode === 'STARTER';
  const weeklyFinds = !personalizedReady && state.shelf?.generalDiscovery?.mode === 'WEEKLY';
  const discoveryHeading = homeDiscoveryHeadingCopy(personalizedReady ? 'PERSONALIZED' : starterPicks ? 'STARTER' : weeklyFinds ? 'WEEKLY' : 'FALLBACK');
  const displayCaseItems = homeDisplayCaseItems();
  const watchlistPreview = state.vault.slice(0, 4);
  const shelfIndex = boundedHomeShelfIndex(state.homeShelfIndex, displayCaseItems.length);
  const discovery = state.shelf?.discovery;

  return `
    <section class="home-page" aria-labelledby="home-title">
      <header class="home-header">
        <div class="home-intro-primary">
          <p class="home-greeting">Welcome back, ${escapeHtml(userDisplayName(state.user))}</p>
          <h1 id="home-title">Less searching. <span>More collecting.</span></h1>
          <p class="home-intro-support">Finding the cards you want shouldn’t feel like a full-time job. Tell Vaultr what you’re chasing and it’ll search eBay and supported shops for listings that fit. With <a class="inline-vaultr-plus" href="#plus" data-page="plus">Vaultr Plus</a>, your Watchlist, Pickups, and feedback also shape a personalized Display Case to help surface your next favourite.</p>
        </div>
        <button class="button-primary home-watchlist-cta" type="button" data-page="vault">View Watchlist <span aria-hidden="true">&rarr;</span></button>
      </header>
      ${vaultNoticeMarkup('home')}
      ${alertNoticeMarkup()}

      <section class="home-product-section home-display-case-section" aria-labelledby="home-display-case-title">
        <div class="home-section-heading">
          <div><h2 id="home-display-case-title">${escapeHtml(discoveryHeading.heading)}</h2><p>${escapeHtml(discoveryHeading.copy)}</p></div>
          <button class="home-text-link" type="button" data-page="shelf">Explore Display Case</button>
        </div>
        <div class="home-discovery">
          <div class="home-discovery-stage">
          ${state.shelfError
            ? '<div class="home-discovery-state"><p>Your Display Case could not be loaded right now.</p><button class="button-ghost" type="button" data-action="retry-shelf">Try again</button></div>'
            : state.shelfLoaded
                ? displayCaseItems.length
                  ? homeShelfFeatureMarkup(displayCaseItems, shelfIndex, { editorial: !personalizedReady, feedback: personalizedReady, label: personalizedReady ? 'Picked for you' : weeklyFinds ? 'Weekly find' : 'Collector pick' })
                  : `<div class="home-discovery-state"><p>${inlineVaultrPlusCopy(discoveryStateCopy(discovery, true))}</p></div>`
                : '<div class="home-discovery-state"><p>Loading your latest collector picks...</p></div>'}
          </div>
        </div>
      </section>

      <section class="home-product-section home-vault-section" aria-labelledby="home-vault-title">
        <div class="home-section-heading">
          <div><h2 id="home-vault-title">Your Watchlist</h2><p>Vaultr is searching for matching listings for these cards</p></div>
          <button class="home-text-link" type="button" data-page="vault">View Watchlist</button>
        </div>
        ${watchlistPreview.length
          ? `<div class="home-watchlist-grid">${watchlistPreview.map(homeWatchlistPreviewMarkup).join('')}</div>`
          : state.vaultLoaded
            ? '<div class="home-section-state home-empty-action"><p>Add your first card to start watching for matches.</p><button class="button-ghost" type="button" data-action="open-add-chase">Add to Watchlist</button></div>'
            : '<p class="home-section-state">Loading your Watchlist…</p>'}
      </section>

      <section class="home-product-section home-attention-section" aria-labelledby="home-alerts-title">
        <div class="home-section-heading">
          <div><h2 id="home-alerts-title">Latest matches</h2><p>New listings for the cards you’re watching, ready to look through.</p></div>
          <button class="home-text-link" type="button" data-action="view-new-alerts">Open Inbox</button>
          ${alertPreview.length ? '<span class="home-plan-label">New</span>' : ''}
        </div>
        ${state.homeAttentionError
          ? '<p class="home-section-state">New matches could not be loaded right now.</p>'
          : alertPreview.length
            ? `<ul class="home-preview-list">${alertPreview.map(homeAlertPreviewMarkup).join('')}</ul>`
            : state.homeAttentionLoading || !state.homeAttentionLoaded
              ? '<p class="home-section-state">Loading your latest matches…</p>'
              : activeChases
                ? homeAttentionEmptyMarkup()
                : '<div class="home-section-state home-empty-action"><p>Add your first card to start watching for matches.</p><button class="button-ghost" type="button" data-action="open-add-chase">Add to Watchlist</button></div>'}
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
          <h2 class="chase-name">${escapeHtml(alert.chaseName || 'Watchlist card')}</h2>
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
        ${statePanelMarkup("Couldn't load your Watchlist.", 'Try again when you are ready.', 'Try again').replace('data-action="retry-alerts"', 'data-action="retry-vault"')}
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
      : state.vaultFilter === 'COMPLETED'
        ? '<div class="state-panel"><h2>No Pickups yet.</h2><p>Cards you mark acquired will stay here as part of your collecting history.</p></div>'
        : '<div class="state-panel"><h2>No cards in this view</h2><p>Choose another filter to see the rest of your Watchlist.</p></div>';
  return `
    <section aria-labelledby="vault-title">
      ${vaultHeaderMarkup()}
      ${vaultNoticeMarkup('vault')}
      ${vaultSummaryMarkup()}
      ${vaultLimitWarningMarkup()}
      ${vaultLifecycleFiltersMarkup()}
      ${items.length ? `<div class="vault-grid" aria-label="Watchlist cards">${items.map(vaultCardMarkup).join('')}</div>` : ''}
      ${emptyState}
      ${completedChasesSectionMarkup(completed)}
      ${vaultDialogMarkup()}
      ${removeDialogMarkup()}
      ${acquireDialogMarkup()}
    </section>
  `;
}

function vaultLifecycleFiltersMarkup() {
  const filters = [['ALL', 'All'], ['WATCHING', 'Watching'], ['PAUSED', 'Paused'], ['COMPLETED', 'Pickups']];
  return `<div class="vault-lifecycle-filters" aria-label="Watchlist filters">${filters.map(([value, label]) => `<button class="pill-button" type="button" data-vault-filter="${value}" aria-pressed="${state.vaultFilter === value ? 'true' : 'false'}">${label}</button>`).join('')}</div>`;
}

function vaultHeaderMarkup() {
  return `
    <header class="page-header vault-page-header">
      <div>
        <h1 id="vault-title">Your Watchlist</h1>
        <p class="page-tagline">Keep the cards you’re chasing close.</p>
        <p class="page-support">From longtime grails to cards that just caught your eye, keep them here. Vaultr looks for listings that match what you’re after.</p>
      </div>
      <button class="button-primary vault-add-button" type="button" data-action="open-add-chase">Add to Watchlist</button>
    </header>
  `;
}

function vaultSummaryMarkup() {
  const plan = state.vaultPlan || {};
  const watching = plan.activeCount ?? state.vault.filter((item) => item.monitoringState === 'ACTIVE').length;
  const max = plan.maxActiveChases ?? 0;
  const userPaused = state.vault.filter((item) => item.monitoringState === 'PAUSED_USER').length;
  const planLimited = state.vault.filter((item) => item.monitoringState === 'PAUSED_PLAN_LIMIT').length;
  const completed = state.completedChases?.length ?? 0;
  return `
    <div class="vault-summary" aria-label="Watchlist plan summary">
      <div>
        <span class="summary-label">Watching</span>
        <strong>${escapeHtml(watching)} of ${escapeHtml(max)}</strong>
      </div>
      <div>
        <span class="summary-label">Plan</span>
        <strong class="${plan.tier === 'PRO' ? 'plan-plus' : ''}">${escapeHtml(planLabel(plan.tier))}</strong>
      </div>
      <div>
        <span class="summary-label">Pickups</span>
        <strong>${escapeHtml(completed)}</strong>
      </div>
      ${userPaused > 0 ? `<p>${escapeHtml(userPaused)} user-paused ${userPaused === 1 ? 'card' : 'cards'}.</p>` : ''}
      ${planLimited > 0 ? `<p>${escapeHtml(planLimited)} ${planLimited === 1 ? 'card is' : 'cards are'} outside your plan's monitoring limit.</p>` : ''}
    </div>
  `;
}

function vaultLimitWarningMarkup() {
  const plan = state.vaultPlan || {};
  const watching = plan.activeCount ?? state.vault.filter((item) => item.monitoringState === 'ACTIVE').length;
  const max = plan.maxActiveChases ?? 0;
  if (!max || watching < max) return '';
  const isPlus = plan.tier === 'PRO';
  return `
    <aside class="vault-limit-warning" aria-labelledby="vault-limit-warning-title">
      <div><h2 id="vault-limit-warning-title">Watchlist full</h2><p>Remove a card or mark one acquired to make room${isPlus ? '.' : ', or explore <strong class="inline-vaultr-plus">Vaultr Plus</strong> for a larger Watchlist.'}</p></div>
      ${isPlus ? '' : '<button class="button-ghost" type="button" data-page="plus">Explore Plus</button>'}
    </aside>
  `;
}

function vaultEmptyMarkup() {
  return `
    <div class="state-panel vault-empty">
      <h2>Your Watchlist is ready</h2>
      <p>Add a specific card and Vaultr will start watching for listings that match your preferences.</p>
      <button class="button-primary" type="button" data-action="open-add-chase">Add to Watchlist</button>
    </div>
  `;
}

function vaultCardMarkup(item) {
  const chase = item.chase || {};
  const paused = item.monitoringState !== 'ACTIVE';
  const userPaused = item.monitoringState === 'PAUSED_USER';
  const statusLabel = userPaused ? 'Paused' : item.monitoringState === 'PAUSED_PLAN_LIMIT' ? 'Plan limit' : 'Watching';
  const criteria = [
    ['Max price', chase.maxPrice !== undefined ? `${formatMoney(chase.maxPrice, state.vaultCurrency)} ${state.vaultCurrency}` : 'No max set'],
    ['Condition', displayConditionValue(chase.condition)],
    ['Grade', displayGradeValue(chase.grade)],
    ['Listing type', listingTypeLabel(chase.listingType)]
  ];
  if (chase.priority === 'GRAIL' || chase.priority === 'HIGH') criteria.push(['Priority', priorityLabel(chase.priority)]);
  return `
    <article class="vault-card ${paused ? 'paused' : ''}" data-vault-chase-id="${escapeHtml(chase.id)}" tabindex="-1">
      ${chase.cardImageUrl ? artworkTriggerMarkup({
        imageUrl: chase.cardImageUrl,
        identity: chase.cardName || 'Watchlist card',
        imageKind: 'Card artwork',
        imageClass: 'vault-card-image',
        imageDataAttribute: 'data-vault-card-image'
      }) : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
      <div class="vault-card-body">
        <div class="vault-card-meta">
          <span class="status-pill ${paused ? 'paused' : 'active'}">${statusLabel}</span>
          ${chase.priority === 'GRAIL' || chase.priority === 'HIGH' ? `<span class="priority-pill ${chase.priority === 'GRAIL' ? 'grail' : ''}">${escapeHtml(priorityLabel(chase.priority))}</span>` : ''}
        </div>
        <h2>${escapeHtml(chase.cardName || 'Watchlist card')}</h2>
        ${item.monitoringState === 'PAUSED_PLAN_LIMIT' ? '<p class="paused-copy">Saved in your Watchlist, but not monitored under the current plan limit.</p>' : userPaused ? '<p class="paused-copy">Search is paused. Your preferences are preserved.</p>' : ''}
        <dl class="vault-search-criteria">${criteria.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
        <div class="vault-actions">
          <button class="button-primary vault-view-matches" type="button" data-action="view-chase-matches" data-chase-id="${escapeHtml(chase.id)}" data-card-name="${escapeHtml(chase.cardName)}">View matches <span aria-hidden="true">→</span></button>
          <button class="vault-action-link vault-action-secondary vault-desktop-action" type="button" data-action="open-edit-chase" data-chase-id="${escapeHtml(chase.id)}">Edit preferences</button>
          <button class="vault-action-link vault-action-secondary vault-desktop-action" type="button" data-action="open-acquire-chase" data-chase-id="${escapeHtml(chase.id)}">Mark acquired</button>
          ${item.monitoringState === 'ACTIVE' ? `<button class="vault-action-link vault-action-secondary vault-desktop-action" type="button" data-action="pause-chase" data-chase-id="${escapeHtml(chase.id)}">Pause search</button>` : userPaused ? `<button class="vault-action-link vault-action-secondary vault-desktop-action" type="button" data-action="resume-chase" data-chase-id="${escapeHtml(chase.id)}">Resume search</button>` : ''}
          <button class="vault-action-link danger vault-desktop-action" type="button" data-action="open-remove-chase" data-chase-id="${escapeHtml(chase.id)}">Remove</button>
          <details class="vault-more-actions vault-mobile-actions"><summary>More</summary><div><button class="vault-action-link" type="button" data-action="open-edit-chase" data-chase-id="${escapeHtml(chase.id)}">Edit preferences</button><button class="vault-action-link" type="button" data-action="open-acquire-chase" data-chase-id="${escapeHtml(chase.id)}">Mark acquired</button>${item.monitoringState === 'ACTIVE' ? `<button class="vault-action-link" type="button" data-action="pause-chase" data-chase-id="${escapeHtml(chase.id)}">Pause search</button>` : userPaused ? `<button class="vault-action-link" type="button" data-action="resume-chase" data-chase-id="${escapeHtml(chase.id)}">Resume search</button>` : ''}<button class="vault-action-link danger" type="button" data-action="open-remove-chase" data-chase-id="${escapeHtml(chase.id)}">Remove</button></div></details>
        </div>
      </div>
    </article>
  `;
}

function completedChaseMarkup(chase) {
  const completedDate = chase.completedAt ? formatDate(chase.completedAt) : '';
  const details = [
    completedDate ? `Acquired ${completedDate}` : 'Acquired',
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
        identity: chase.cardName || 'Pickup',
        imageKind: 'Card artwork',
        imageClass: 'vault-card-image',
        imageDataAttribute: 'data-vault-card-image'
      }) : `<div class="vault-card-image placeholder-image" aria-hidden="true">V</div>`}
      <div class="vault-card-body">
        <div class="vault-card-meta">
          <span class="status-pill completed">Pickup</span>
        </div>
        <h2>${escapeHtml(chase.cardName || 'Pickup')}</h2>
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        <div class="vault-actions">
          <button class="vault-action-link" type="button" data-action="reopen-chase" data-chase-id="${escapeHtml(chase.id)}">Watch again</button>
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
        <p class="eyebrow">PICKUPS</p>
        <h2 id="completed-vault-title">Cards you’ve acquired</h2>
      </div>
      <div class="vault-grid completed-grid" aria-label="Pickups">
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
        <div class="shelf-grid" aria-label="Loading Display Case">
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
        ${statePanelMarkup("Couldn't load your Display Case.", 'Try again when you are ready.', 'Try again').replace('data-action="retry-alerts"', 'data-action="retry-shelf"')}
      </section>
    `;
  }
  const personalized = hasPersonalizedDiscoveryAccess();
  const items = personalized ? state.shelf?.items || [] : [];
  return `
    <section class="shelf-page" aria-labelledby="shelf-title">
      ${shelfHeaderMarkup()}
      ${vaultNoticeMarkup('shelf')}
      ${personalized && items.length ? '<p class="shelf-personalized-note">There’s always another card to fall in love with. Explore discoveries shaped by your collection and what catches your eye, with familiar favourites and unexpected finds along the way.</p>' : ''}
      ${personalized && items.length ? shelfMetaMarkup(state.shelf) : ''}
      ${items.length ? `<div class="shelf-grid" aria-label="Display Case recommendations">${items.map((item) => shelfCardMarkup(item, { feedback: personalized })).join('')}</div>` : shelfEmptyMarkup(state.shelf)}
      ${vaultDialogMarkup()}
    </section>
  `;
}

function shelfHeaderMarkup() {
  return pageHeaderMarkup({
    id: 'shelf-title',
    title: 'Your Display Case',
    tagline: 'Find the cards you didn’t know you loved.',
    copy: '',
    className: 'shelf-page-header'
  });
}

function shelfMetaMarkup(shelf) {
  const updated = shelf.updatedAt ? formatDate(shelf.updatedAt) : '';
  const details = [
    shelf.periodKey,
    shelf.shelfKind === 'PREVIOUS' ? 'Previous shelf' : shelf.status === 'READY' ? 'Ready' : shelf.status === 'PARTIAL' ? 'Preview' : '',
    `${shelf.itemCount || shelf.items?.length || 0} picks`,
    updated ? `Updated ${updated}` : ''
  ].filter(Boolean);
  return `
    <div class="shelf-summary" aria-label="Display Case summary">
      ${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}
    </div>
  `;
}

function shelfEmptyMarkup(shelf) {
  const starters = shelf?.starterItems || [];
  const starter = shelf?.generalDiscovery?.mode === 'STARTER';
  const weekly = shelf?.generalDiscovery?.mode === 'WEEKLY';
  const plusAccount = state.vaultPlan?.tier === 'PRO';
  const freeIntroduction = starter
    ? 'Start with three collector picks, with fresh finds each week. With Vaultr Plus, discover a full personalized Display Case that learns from your Watchlist, Pickups, and feedback, bringing you familiar favourites and unexpected finds.'
    : weekly
    ? 'Explore three fresh finds each week. With Vaultr Plus, discover a full personalized Display Case that learns from your Watchlist, Pickups, and feedback, bringing you familiar favourites and unexpected finds.'
    : 'Explore these collector picks while this week’s finds are unavailable. With Vaultr Plus, discover a full personalized Display Case that learns from your Watchlist, Pickups, and feedback, bringing you familiar favourites and unexpected finds.';
  return `
    <section class="shelf-editorial" aria-label="General discovery picks">
      ${plusAccount
        ? `<p class="shelf-personalized-note">${inlineVaultrPlusCopy(discoveryStateCopy(shelf?.discovery))}</p>`
        : `<div class="shelf-plus-intro"><p>${linkedVaultrPlusCopy(freeIntroduction)}</p></div>`}
      <header class="shelf-editorial-heading"><h2>${weekly ? 'This week’s finds' : 'Collector picks'}</h2></header>
      ${starters.length
        ? `<div class="shelf-grid shelf-editorial-grid" aria-label="General discovery picks">${starters.map((item) => shelfCardMarkup(item, { editorial: true })).join('')}</div>`
        : '<div class="starter-artwork-fallback">Collector picks will appear here when available.</div>'}
    </section>
  `;
}

function shelfCardMarkup(item, { editorial = false, feedback = !editorial } = {}) {
  const details = [item.setName, item.cardNumber, item.language].filter(Boolean);
  const price = item.market?.askingTotal !== undefined
    ? formatMoney(item.market.askingTotal, item.market.currency)
    : item.market?.soldTotal !== undefined
      ? formatMoney(item.market.soldTotal, item.market.currency)
      : '';
  const priceLabel = item.market?.askingTotal !== undefined ? 'Asking price' : item.market?.soldTotal !== undefined ? 'Recent sold' : '';
  const marketUnavailable = item.market?.status === 'EMPTY' || item.market?.status === 'NO_ACCEPTED_SAMPLES'
    ? 'No reliable market estimate yet'
    : 'Pricing unavailable';
  const showMarket = Boolean(price) || !editorial;
  return `
    <article class="shelf-card">
      ${item.imageUrl ? artworkTriggerMarkup({
        imageUrl: item.imageUrl,
        identity: item.name || 'Display Case pick',
        imageKind: 'Card artwork',
        imageClass: 'shelf-card-image',
        imageDataAttribute: 'data-shelf-card-image'
      }) : '<div class="shelf-card-image placeholder-image shelf-image-unavailable"><span>Image unavailable</span></div>'}
      <div class="shelf-card-body">
        <div class="shelf-card-meta">
          ${item.roleLabel ? `<span class="status-pill active">${escapeHtml(item.roleLabel)}</span>` : ''}
        </div>
        <h2>${escapeHtml(item.displayName || item.name || 'Display Case pick')}</h2>
        ${item.nativeName ? `<p class="shelf-native-name">Original name: ${escapeHtml(item.nativeName)}</p>` : ''}
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        ${item.reason ? `<p class="shelf-reason">${escapeHtml(item.reason)}</p>` : ''}
        <div class="shelf-card-footer${showMarket ? '' : ' no-market'}">
          ${showMarket ? `<div class="shelf-market-status">
            ${price ? `<p class="shelf-price"><span>${escapeHtml(priceLabel)}</span>${escapeHtml(price)}</p>` : `<p class="shelf-price unavailable">${escapeHtml(marketUnavailable)}</p>`}
          </div>` : ''}
          <div class="shelf-card-actions">
            ${discoveryCardPrimaryActionMarkup(item)}
            ${item.ebayUrl ? `<a class="listing-link shelf-ebay-link" href="${escapeHtml(item.ebayUrl)}" target="_blank" rel="noopener noreferrer">View on eBay</a>` : ''}
          </div>
          ${feedback ? discoveryFeedbackMarkup(item) : ''}
        </div>
      </div>
    </article>
  `;
}

function discoveryFeedbackKey(item) {
  return `${item?.recommendation?.periodKey || ''}:${item?.recommendation?.position || ''}`;
}

function discoveryFeedbackMarkup(item, compact = false) {
  if (!item?.recommendation) return '';
  const key = discoveryFeedbackKey(item);
  const pending = Boolean(state.discoveryFeedbackPending[key]);
  const saved = item.feedback?.feedback;
  const error = state.discoveryFeedbackErrors[key];
  const notice = state.discoveryFeedbackNotices[key];
  const disabled = pending || isPreviewMode;
  const context = `data-feedback-period="${escapeHtml(item.recommendation.periodKey)}" data-feedback-position="${escapeHtml(item.recommendation.position)}"`;
  return `
    <div class="discovery-feedback${compact ? ' compact' : ''}" aria-label="Taste feedback">
      <span class="discovery-feedback-label">${isPreviewMode ? 'Taste feedback is read-only in preview.' : 'Your feedback helps shape future discoveries.'}</span>
      <div class="discovery-feedback-actions">
        <button class="discovery-feedback-button${saved === 'MORE_LIKE_THIS' ? ' selected' : ''}" type="button" data-action="discovery-feedback" data-feedback-action="MORE_LIKE_THIS" ${context} ${disabled ? 'disabled' : ''} aria-pressed="${saved === 'MORE_LIKE_THIS'}">More like this</button>
        <button class="discovery-feedback-button${saved === 'NOT_FOR_ME' ? ' selected' : ''}" type="button" data-action="discovery-feedback" data-feedback-action="NOT_FOR_ME" ${context} ${disabled ? 'disabled' : ''} aria-pressed="${saved === 'NOT_FOR_ME'}">Not for me</button>
        ${saved ? `<button class="discovery-feedback-undo" type="button" data-action="undo-discovery-feedback" ${context} data-feedback-version="${escapeHtml(item.feedback.version)}" ${disabled ? 'disabled' : ''}>Undo</button>` : ''}
      </div>
      ${pending ? '<span class="discovery-feedback-status" role="status">Saving…</span>' : error ? `<span class="discovery-feedback-status error" role="alert">${escapeHtml(error)}</span>` : notice ? `<span class="discovery-feedback-status" role="status">${escapeHtml(notice)}</span>` : ''}
    </div>
  `;
}

function vaultDialogMarkup() {
  if (!state.vaultFormMode) return '';
  const editing = state.vaultFormMode === 'edit';
  const draft = state.vaultFormDraft || vaultDraftFromChase({ cardName: state.vaultPrefillCardName });
  const gradeValueEnabled = gradeValueIsEnabled(draft.gradingType);
  const hasPlus = state.vaultPlan?.tier === 'PRO';
  const savedCount = state.vault.length;
  const atLimit = savedCount >= (state.vaultPlan?.maxActiveChases ?? Infinity);
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="vault-dialog" data-vault-form="${editing ? 'edit' : 'add'}" aria-labelledby="vault-form-title">
        <header>
          <p class="eyebrow">${editing ? 'EDIT PREFERENCES' : 'ADD TO WATCHLIST'}</p>
          <h2 id="vault-form-title">${editing ? 'Refine this search' : 'What card are you looking for?'}</h2>
          <p class="dialog-intro">Choose the exact printing, then add only the preferences that matter to you.</p>
        </header>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. You can inspect this form, but changes will not be saved.</p>' : ''}
        ${state.vaultFormError ? `<div class="form-error" role="alert"><span>${escapeHtml(state.vaultFormError)}</span>${state.vaultCreateRecovery?.uncertain ? '<button class="vault-action-link" type="button" data-action="reconcile-vault-create">Check saved card</button>' : ''}</div>` : ''}
        ${!editing && atLimit ? `<aside class="plan-limit-note"><strong>Your Watchlist has ${escapeHtml(savedCount)} cards, the limit on your ${escapeHtml(planLabel(state.vaultPlan.tier))} plan.</strong><span>${hasPlus ? 'Remove a card or mark one acquired before adding another.' : `<strong class="inline-vaultr-plus">Vaultr Plus</strong> gives you room to watch up to ${escapeHtml(state.vaultOptions?.plans?.find((plan) => plan.tier === 'PRO')?.maxActiveChases || 50)}.`}</span>${hasPlus ? '' : '<button class="vault-action-link" type="button" data-page="plus">Explore Plus</button>'}</aside>` : ''}
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
              value="${escapeHtml(draft.cardName)}"
            >
            <p id="card-autocomplete-hint" class="field-hint">Include set, card number, and language when relevant.</p>
            <div id="card-suggestion-list" class="card-suggestion-list" role="listbox" hidden></div>
          </div>
          <span id="card-identity-confirmation" class="card-identity-confirmation"${cardIdentityConfirmationMarkup(draft.cardName) ? '' : ' hidden'}>${cardIdentityConfirmationMarkup(draft.cardName)}</span>
        </label>
        <div class="vault-price-row">
          <label class="field">
            <span>Maximum (${escapeHtml(state.vaultCurrency)})</span>
            <input name="maxPrice" type="number" min="0.01" step="0.01" aria-describedby="max-price-hint" value="${escapeHtml(draft.maxPrice)}">
            <small id="max-price-hint" class="field-hint">Blank means no maximum. Known shipping is included when available.</small>
          </label>
        </div>
        <fieldset class="precision-fields">
          <legend>Grading</legend>
          <p class="field-hint">Optional and available on every plan.</p>
          <div class="form-grid grading-grid">
          <label class="field">
            <span>Grading type</span>
            <select name="gradingType" aria-describedby="grading-type-hint">${optionMarkup(state.vaultOptions?.gradingTypes, draft.gradingType)}</select>
            <small id="grading-type-hint" class="field-hint">Raw excludes graded copies.</small>
          </label>
          <label class="field">
            <span>Grade value</span>
            <select name="gradeValue" aria-describedby="grade-value-hint" aria-disabled="${gradeValueEnabled ? 'false' : 'true'}"${gradeValueEnabled ? '' : ' disabled'}>${optionMarkup(state.vaultOptions?.gradeValues, effectiveGradeValue(draft.gradingType, draft.gradeValue))}</select>
            <small id="grade-value-hint" class="field-hint">A number requests that exact listed grade.</small>
          </label>
          </div>
        </fieldset>
        <details class="advanced-section${hasPlus ? ' has-plus' : ' plus-locked'}" ${hasPlus ? 'open' : ''}>
          <summary>${hasPlus ? 'Vaultr Plus controls' : 'See Vaultr Plus controls'}</summary>
          <div class="advanced-section-heading">
            <div><h3 id="advanced-fields-title">Vaultr Plus controls</h3><p>${hasPlus ? 'Optional controls for a more precise search.' : 'Advanced filters and Trusted Shops monitoring are included with <strong class="inline-vaultr-plus">Vaultr Plus</strong>. Saved locked values stay intact.'}</p></div>
            ${hasPlus ? '' : '<button class="vault-action-link" type="button" data-page="plus">Explore Plus</button>'}
          </div>
        <fieldset class="advanced-fields" aria-describedby="advanced-fields-title" ${hasPlus ? '' : 'disabled'}>
          <legend class="visually-hidden">Precision controls</legend>
          <div class="form-grid">
            <label class="field">
              <span>Condition</span>
              <select name="condition" aria-describedby="condition-hint">${optionMarkup(state.vaultOptions?.conditions, draft.condition)}</select>
              <small id="condition-hint" class="field-hint">Seller condition is not independently verified.</small>
            </label>
            <label class="field">
              <span>Listing type</span>
              <select name="listingType" aria-describedby="listing-type-hint">${optionMarkup(state.vaultOptions?.listingTypes, draft.listingType)}</select>
            </label>
            <label class="field">
              <span>Priority</span>
              <select name="priority" aria-describedby="priority-hint">${optionMarkup(state.vaultOptions?.priorities, draft.priority)}</select>
              <small id="priority-hint" class="field-hint">Controls emphasis and plan-limit ordering, not check speed.</small>
            </label>
          </div>
          <label class="field">
            <span>Target note</span>
            <input name="targetNote" type="text" maxlength="120" aria-describedby="target-note-hint" value="${escapeHtml(draft.targetNote)}">
            <small id="target-note-hint" class="field-hint">Focused context such as language or artwork intent.</small>
          </label>
          <label class="field">
            <span>Custom exclusions</span>
            <input name="customExclusions" type="text" maxlength="240" aria-describedby="custom-exclusions-hint custom-exclusions-auto-note" value="${escapeHtml(draft.customExclusions)}">
            <small id="custom-exclusions-hint" class="field-hint">Fine-tune what Vaultr should skip for this card. Examples: Korean, Chinese, damaged, played, creased, altered.</small>
            <small id="custom-exclusions-auto-note" class="field-hint field-hint-secondary">* Vaultr already filters common proxies, reprints, replicas, code cards, accessories, and multi-card lots automatically.</small>
          </label>
        </fieldset>
        </details>
        <footer class="dialog-actions">
          <button class="button-ghost" type="button" data-action="close-vault-dialog">Cancel</button>
          <button class="button-primary" type="submit" ${state.vaultSubmitting || state.vaultCreateRecovery?.uncertain ? 'disabled' : ''}>${state.vaultSubmitting ? 'Saving...' : editing ? 'Save changes' : 'Add to Watchlist'}</button>
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
          <p class="eyebrow">REMOVE</p>
          <h2 id="remove-title">Remove ${escapeHtml(item.chase.cardName)}?</h2>
        </header>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. This card will not be removed.</p>' : ''}
        ${state.removeError ? `<p class="form-error" role="alert">${escapeHtml(state.removeError)}</p>` : ''}
        <div class="remove-options">
          <button class="button-ghost remove-option" type="button" data-action="remove-chase" data-outcome="NO_LONGER_INTERESTED">
            <span class="remove-option-title">No longer interested</span>
            <span class="remove-option-copy">Remove it without adding it to Pickups</span>
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
        <p>Vaultr will stop watching this card and keep it in Pickups.</p>
        ${isPreviewMode ? '<p class="preview-read-only" role="status">Preview mode is read-only. This card will not be changed.</p>' : ''}
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
  if (state.activePage === 'plus') {
    renderShell(plusPageMarkup());
    return;
  }
  if (state.activePage === 'onboarding') {
    renderShell(onboardingPageMarkup());
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

async function loadAuthSurface() {
  try {
    const [configBody, confirmationBody] = await Promise.all([
      fetch(apiUrl('/api/auth/config'), { credentials: 'same-origin' }).then((response) => response.json()),
      fetch(apiUrl('/api/auth/email/confirmation'), { credentials: 'same-origin' }).then((response) => response.json())
    ]);
    state.authConfig = configBody;
    state.emailConfirmation = confirmationBody?.ready ? confirmationBody : null;
    if (!state.emailConfirmation && new URLSearchParams(window.location.search).get('emailConfirm') === 'invalid') {
      state.authError = 'This link is invalid, expired, or already used. Request a new one.';
    }
  } catch {
    state.authConfig = { email: { available: false }, discord: { available: false } };
    state.emailConfirmation = null;
  }
}

async function requestAuthEmail(form, endpoint) {
  if (isPreviewMode || state.authBusy) return;
  const input = form.elements.namedItem('email');
  const email = input instanceof HTMLInputElement ? input.value.trim() : '';
  state.authEmailDraft = email;
  state.authBusy = true;
  state.authNotice = '';
  state.authError = '';
  renderCurrentPage();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, returnPath: '/app' })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(body?.error || 'request_failed'), { status: response.status });
    state.authNotice = 'Check your email for a secure Vaultr link. It expires in 15 minutes.';
  } catch (error) {
    state.authError = error?.message === 'invalid_email' ? 'Enter a valid email address.' : 'Vaultr could not send that link. Please try again.';
  } finally {
    state.authBusy = false;
    renderCurrentPage();
  }
}

async function redeemEmailLink() {
  if (isPreviewMode || state.authBusy) return;
  state.authBusy = true;
  state.authError = '';
  renderCurrentPage();
  try {
    const response = await fetch('/auth/email/redeem', { method: 'POST', credentials: 'same-origin' });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(body?.error || 'request_failed'), { status: response.status });
    window.location.replace(body.returnPath || '/app');
  } catch (error) {
    state.authBusy = false;
    if (error?.message === 'auth_required') state.authError = 'Sign in to the existing account that requested this email link, then try again.';
    else if (error?.message === 'account_mismatch') state.authError = 'This email link belongs to a different Vaultr account.';
    else if (error?.message === 'identity_conflict') state.authError = 'That email is already linked to another Vaultr account.';
    else state.authError = 'This link is invalid, expired, or already used. Request a new one.';
    renderCurrentPage();
  }
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
    state.hasNewAlerts = state.homeAttentionAlerts.length > 0;
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

async function refreshNewAlertPresence() {
  if (!state.user || document.visibilityState === 'hidden') return;
  if (newAlertPresenceRequest) return newAlertPresenceRequest;
  newAlertPresenceRequest = (async () => {
    try {
      const body = await fetchJson('/api/alerts?reviewState=NEW&limit=1');
      const hasNewAlerts = Boolean(body.items?.length);
      if (hasNewAlerts !== state.hasNewAlerts) {
        state.hasNewAlerts = hasNewAlerts;
        renderCurrentPage();
      }
    } catch (error) {
      if (String(error?.message) !== 'unauthorized') return;
    } finally {
      newAlertPresenceRequest = null;
    }
  })();
  return newAlertPresenceRequest;
}

function startNewAlertPresenceRefresh() {
  if (newAlertPresenceTimer) window.clearInterval(newAlertPresenceTimer);
  if (!state.homeAttentionLoaded) void refreshNewAlertPresence();
  newAlertPresenceTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshNewAlertPresence();
  }, 60_000);
}

async function refreshAlertSurfaces() {
  const work = [];
  state.homeAttentionLoaded = false;
  if (state.activePage === 'home') work.push(loadHomeAttention());
  if (state.activePage === 'alerts') {
    state.alertsLoaded = false;
    work.push(loadAlerts());
  }
  if (state.activePage !== 'home') work.push(refreshNewAlertPresence());
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

function applyVaultResponse(body) {
  state.vault = body.items || [];
  state.completedChases = body.completedItems || [];
  state.vaultPlan = body.plan || null;
  state.vaultCurrency = body.currency || 'CAD';
  state.vaultOptions = body.options || null;
  state.vaultLoaded = true;
  state.vaultError = null;
}

async function loadVault({ force = false, throwOnError = false } = {}) {
  if (state.vaultLoaded && !force) {
    renderCurrentPage();
    return;
  }
  const requestId = ++state.vaultRequestId;
  state.isVaultLoading = true;
  state.vaultError = null;
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/chases');
    if (requestId !== state.vaultRequestId) return null;
    applyVaultResponse(body);
    state.isVaultLoading = false;
    renderCurrentPage();
    return body;
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    if (requestId !== state.vaultRequestId) return null;
    state.vaultError = 'load_failed';
    state.isVaultLoading = false;
    renderCurrentPage();
    if (throwOnError) throw error;
    return null;
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

function updateShelfFeedback(periodKey, position, feedback) {
  const item = state.shelf?.items?.find((candidate) =>
    candidate.recommendation?.periodKey === periodKey && candidate.recommendation?.position === position
  );
  if (item) item.feedback = feedback;
}

async function mutateDiscoveryFeedback(target, action) {
  if (isPreviewMode) return;
  const periodKey = target.getAttribute('data-feedback-period') || '';
  const position = Number(target.getAttribute('data-feedback-position'));
  const key = `${periodKey}:${position}`;
  if (!periodKey || !Number.isInteger(position) || state.discoveryFeedbackPending[key]) return;
  const previousFocus = action;
  state.discoveryFeedbackPending[key] = true;
  delete state.discoveryFeedbackErrors[key];
  delete state.discoveryFeedbackNotices[key];
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/shelf/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodKey,
        position,
        action,
        ...(action === 'UNDO' ? { expectedVersion: Number(target.getAttribute('data-feedback-version')) } : {})
      })
    });
    updateShelfFeedback(periodKey, position, body.feedback || null);
    state.discoveryFeedbackNotices[key] = action === 'MORE_LIKE_THIS'
      ? 'Noted. More inspiration like this.'
      : action === 'NOT_FOR_ME'
        ? 'Got it. We’ll keep that in mind.'
        : 'Feedback undone.';
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    if (error?.status === 409) {
      state.shelfLoaded = false;
      await loadShelf({ force: true });
      state.discoveryFeedbackErrors[key] = 'Feedback changed elsewhere. The latest choice is shown.';
    } else if (error?.status === 403) {
      state.discoveryFeedbackErrors[key] = 'Vaultr Plus is required to add new Display Case feedback.';
    } else {
      state.discoveryFeedbackErrors[key] = 'Couldn’t save feedback. Try again.';
    }
  } finally {
    delete state.discoveryFeedbackPending[key];
    renderCurrentPage();
    const selector = previousFocus === 'UNDO'
      ? `[data-action="discovery-feedback"][data-feedback-period="${CSS.escape(periodKey)}"][data-feedback-position="${position}"]`
      : `[data-action="discovery-feedback"][data-feedback-action="${previousFocus}"][data-feedback-period="${CSS.escape(periodKey)}"][data-feedback-position="${position}"]`;
    document.querySelector(selector)?.focus();
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

async function loadOnboarding() {
  try {
    const body = await fetchJson('/api/onboarding');
    state.onboarding = body.state;
    state.onboardingLoaded = true;
    state.onboardingError = '';
    return body.state;
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return null;
    state.onboardingError = 'Setup could not be loaded. Please try again.';
    return null;
  }
}

async function loadCollectorProfile() {
  state.collectorProfileLoading = true;
  state.collectorProfileError = '';
  renderCurrentPage();
  try {
    const body = await fetchJson(isPreviewMode ? '/api/preview/collector-profile' : '/api/collector-profile');
    state.collectorProfile = body.preferences;
    state.collectorProfileOptions = body.options;
    state.collectorProfileDraft = { subjects: [...body.preferences.subjects], artwork: [...body.preferences.artwork] };
  } catch (error) {
    if (String(error?.message) !== 'unauthorized') state.collectorProfileError = 'Collecting-profile choices could not be loaded.';
  } finally {
    state.collectorProfileLoading = false;
    renderCurrentPage();
  }
}

async function saveCollectorProfile({ advance = true } = {}) {
  if (isPreviewMode) {
    if (advance) await updateOnboarding('PROFILE_SAVED');
    return;
  }
  state.onboardingBusy = true;
  state.collectorProfileError = '';
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/collector-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.collectorProfileDraft) });
    state.collectorProfile = body.preferences;
    state.collectorProfileOptions = body.options;
    state.collectorProfileDraft = { subjects: [...body.preferences.subjects], artwork: [...body.preferences.artwork] };
    if (advance) await updateOnboarding('PROFILE_SAVED');
  } catch (error) {
    state.collectorProfileError = 'Your collecting profile could not be saved. Your choices are still here.';
  } finally {
    state.onboardingBusy = false;
    renderCurrentPage();
  }
}

async function updateOnboarding(action) {
  if (state.onboardingRevisitMode) {
    const step = state.onboardingRevisitStep;
    if (action === 'CONTINUE') state.onboardingRevisitStep = 'MARKET';
    if (action === 'BACK') state.onboardingRevisitStep = step === 'MARKET' ? 'WELCOME' : step === 'PROFILE' ? 'MARKET' : step === 'CHASE' ? tasteOnboardingEnabled() ? 'PROFILE' : 'MARKET' : 'CHASE';
    if (action === 'MARKET_SAVED') state.onboardingRevisitStep = tasteOnboardingEnabled() ? 'PROFILE' : 'CHASE';
    if (action === 'PROFILE_SAVED') state.onboardingRevisitStep = 'CHASE';
    if (action === 'CHASE_CREATED') state.onboardingRevisitStep = 'READY';
    if (action === 'FINISH' || action === 'SKIP') {
      state.onboardingRevisitMode = false;
      state.onboardingRevisitStep = 'WELCOME';
      state.activePage = 'settings';
      window.location.hash = 'settings';
    }
    renderCurrentPage();
    return true;
  }
  if (isPreviewMode) {
    const transitions = { CONTINUE: 'MARKET', BACK: state.onboarding?.step === 'MARKET' ? 'WELCOME' : state.onboarding?.step === 'PROFILE' ? 'MARKET' : state.onboarding?.step === 'CHASE' ? 'PROFILE' : 'CHASE', MARKET_SAVED: 'PROFILE', PROFILE_SAVED: 'CHASE', CHASE_CREATED: 'READY', FINISH: 'READY', RESUME: 'WELCOME' };
    if (action === 'SKIP' || action === 'FINISH') {
      if (action === 'SKIP') resetSettingsDraft();
      state.onboarding = { ...(state.onboarding || {}), status: action === 'SKIP' ? 'SKIPPED' : 'COMPLETED', automatic: false };
      state.activePage = 'home';
      window.location.hash = 'home';
      return true;
    }
    if (action === 'RESUME') state.onboardingPreviewChaseCreated = false;
    if (action === 'CHASE_CREATED') state.onboardingPreviewChaseCreated = true;
    state.onboarding = { ...(state.onboarding || {}), status: 'IN_PROGRESS', step: transitions[action] || state.onboarding?.step, automatic: false };
    renderCurrentPage();
    return true;
  }
  state.onboardingBusy = true;
  state.onboardingError = '';
  renderCurrentPage();
  try {
    const body = await fetchJson('/api/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, expectedStep: state.onboarding?.step })
    });
    state.onboarding = body.state;
    state.onboardingBusy = false;
    if (action === 'FINISH' || action === 'SKIP') {
      if (action === 'SKIP') resetSettingsDraft();
      state.activePage = 'home';
      window.location.hash = 'home';
      return true;
    }
    renderCurrentPage();
    return true;
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return false;
    state.onboardingBusy = false;
    if (error?.body?.state) state.onboarding = error.body.state;
    state.onboardingError = 'Setup could not advance. Your saved changes are still safe; try again.';
    renderCurrentPage();
    return false;
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
  if (save instanceof HTMLButtonElement) {
    const onboardingContinue = Boolean(save.closest('[data-onboarding-market-form]'));
    save.disabled = state.settingsSaving || (!onboardingContinue && (isPreviewMode || !state.settingsDirty));
  }
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
    const saveContext = state.settingsSaveContext;
    state.settingsSaveContext = null;
    if (saveContext === 'onboarding') await updateOnboarding('MARKET_SAVED');
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
  if (state.vaultCardSelection?.kind === 'suggestion'
    && state.vaultCardSelection.token
    && state.vaultCardSelection.value === cardName) {
    body.cardSelectionToken = state.vaultCardSelection.token;
  }
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
  const body = vaultFormBody(form);
  state.vaultFormDraft = captureVaultFormDraft(form);
  const editing = state.vaultFormMode === 'edit';
  state.vaultSubmitting = true;
  state.vaultFormError = '';
  state.vaultCreateRecovery = null;
  renderCurrentPage();
  try {
    const response = await fetchJson(editing ? `/api/chases/${encodeURIComponent(state.vaultEditingId)}` : '/api/chases', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await finishConfirmedVaultSave({ response, editing });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.vaultSubmitting = false;
    if (error?.body?.error === 'invalid_card_selection') state.shelfLoaded = false;
    if (!editing && error?.status === undefined) {
      const reconciliation = await reconcileUncertainVaultCreate(body.cardName);
      if (reconciliation.found) {
        await finishConfirmedVaultSave({ response: { item: reconciliation.found, blockedControls: [] }, editing: false });
        return;
      }
      if (!reconciliation.checked) {
        state.vaultCreateRecovery = { uncertain: true, cardName: body.cardName };
        state.vaultFormError = 'We could not confirm whether this card was saved. Check again before trying to add it another time.';
        renderCurrentPage();
        return;
      }
      state.vaultFormError = 'This card was not found in your Watchlist. You can try adding it again.';
      renderCurrentPage();
      return;
    }
    state.vaultFormError = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function trustedSelectionForDiscoveryCard(target, cardName) {
  if (isPreviewMode) return null;
  const selectionToken = target.getAttribute('data-card-selection-token');
  if (selectionToken) {
    return {
      kind: 'suggestion',
      token: selectionToken,
      value: cardName,
      imageUrl: target.getAttribute('data-card-image') || '',
      setName: target.getAttribute('data-card-set') || '',
      cardNumber: target.getAttribute('data-card-number') || '',
      language: target.getAttribute('data-card-language') || ''
    };
  }
  try {
    const body = await fetchJson(`/api/chases/selection?cardName=${encodeURIComponent(cardName)}`);
    if (!body.selection) return null;
    return {
      kind: 'suggestion',
      ...body.selection,
      imageUrl: target.getAttribute('data-card-image') || body.selection.imageUrl,
      setName: target.getAttribute('data-card-set') || '',
      cardNumber: target.getAttribute('data-card-number') || '',
      language: target.getAttribute('data-card-language') || ''
    };
  } catch (error) {
    if (String(error?.message) === 'unauthorized') throw error;
    return null;
  }
}

function normalizedSavedCardName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function reconcileUncertainVaultCreate(cardName) {
  try {
    const body = await fetchJson('/api/chases');
    applyVaultResponse(body);
    const expected = normalizedSavedCardName(cardName);
    const found = state.vault.find((entry) => normalizedSavedCardName(entry.chase?.cardName) === expected);
    return { checked: true, found: found || null };
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return { checked: false, found: null };
    return { checked: false, found: null };
  }
}

async function finishConfirmedVaultSave({ response, editing }) {
  if (response.item?.chase?.id) {
    const index = state.vault.findIndex((entry) => entry.chase?.id === response.item.chase.id);
    if (index >= 0) state.vault.splice(index, 1, response.item);
    else state.vault.unshift(response.item);
  }
  const notice = response.blockedControls?.length
    ? `Saved to your Watchlist. Vaultr Plus controls were not applied: ${response.blockedControls.join(', ')}.`
    : editing ? 'Watchlist preferences updated.' : 'Added to your Watchlist.';
  const onboardingStep = state.onboardingRevisitMode ? state.onboardingRevisitStep : state.onboarding?.step;
  const onboardingSave = !editing && state.activePage === 'onboarding' && onboardingStep === 'CHASE';
  const noticeScope = onboardingSave ? 'onboarding' : ['home', 'vault', 'shelf'].includes(state.activePage) ? state.activePage : 'vault';
  setVaultNotice(notice, noticeScope);
  state.vaultFormMode = null;
  state.vaultEditingId = null;
  state.vaultPrefillCardName = '';
  state.vaultFormDraft = null;
  state.vaultCardSelection = null;
  state.vaultCreateRecovery = null;
  state.vaultSubmitting = false;
  renderCurrentPage();

  try {
    await loadVault({ force: true, throwOnError: true });
  } catch {
    setVaultNotice(`${notice} The latest Watchlist view could not refresh; reload to see current details.`, noticeScope);
    renderCurrentPage();
  }

  if (onboardingSave) {
    const advanced = await updateOnboarding('CHASE_CREATED');
    state.onboardingSavedChasePending = !advanced;
    if (!advanced) {
      setVaultNotice('Added to your Watchlist. Setup could not advance, but you can continue without adding the card again.', 'onboarding');
      renderCurrentPage();
    }
  }
}

async function retryVaultCreateReconciliation() {
  const pending = state.vaultCreateRecovery;
  if (!pending?.cardName || state.vaultSubmitting) return;
  state.vaultSubmitting = true;
  state.vaultFormError = '';
  renderCurrentPage();
  const reconciliation = await reconcileUncertainVaultCreate(pending.cardName);
  state.vaultSubmitting = false;
  if (reconciliation.found) {
    await finishConfirmedVaultSave({ response: { item: reconciliation.found, blockedControls: [] }, editing: false });
    return;
  }
  state.vaultCreateRecovery = reconciliation.checked ? null : pending;
  state.vaultFormError = reconciliation.checked
    ? 'This card was not found in your Watchlist. You can try adding it again.'
    : 'We still could not confirm the save. Your draft is safe; check again before retrying.';
  renderCurrentPage();
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
  if (state.vaultFormDraft) state.vaultFormDraft.cardName = item.value;
  state.vaultCardSelection = item.selection
    ? { kind: 'suggestion', ...item.selection }
    : null;
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
    setVaultNotice('Removed from your Watchlist.');
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
    setVaultNotice('Preview mode is read-only. No changes were made.');
    renderCurrentPage();
    return;
  }
  state.lifecycleError = '';
  try {
    await fetchJson(`/api/chases/${encodeURIComponent(chaseId)}/${paused ? 'pause' : 'resume'}`, { method: 'POST' });
    setVaultNotice(paused ? 'Search paused.' : 'Search resumed.');
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    setVaultNotice(apiErrorMessage(error), 'vault', 'error');
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
    setVaultNotice('Nice pickup. It’s yours!');
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
    setVaultNotice('Preview mode is read-only. No changes were made.');
    renderCurrentPage();
    return;
  }
  try {
    await fetchJson(`/api/completed-chases/${encodeURIComponent(chaseId)}/reopen`, { method: 'POST' });
    setVaultNotice('This card is back on your Watchlist.');
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    setVaultNotice(apiErrorMessage(error), 'vault', 'error');
    renderCurrentPage();
  }
}

async function bootstrap() {
  await loadAuthSurface();
  try {
    const body = await fetchJson('/api/me');
    state.user = body.user;
    state.identities = body.identities || state.identities;
    const onboarding = await loadOnboarding();
    const requestedPage = pageFromHash();
    const hasExplicitRoute = /^#(home|vault|alerts|shelf|plus|settings|onboarding)$/i.test(window.location.hash);
    state.activePage = (!isPreviewMode && onboarding?.status === 'IN_PROGRESS' && !hasExplicitRoute) || requestedPage === 'onboarding'
      ? 'onboarding'
      : state.emailConfirmation?.purpose === 'LINK_EMAIL'
        ? 'settings'
        : requestedPage;
    renderCurrentPage();
    await loadActivePageData();
    startNewAlertPresenceRefresh();
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    app.innerHTML = `
      <main id="app-main" class="signed-out">
        <section class="signed-out-card">
          <img class="boot-logo" src="/vaultr-icon.svg" alt="" aria-hidden="true">
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
    if (page === 'plus') state.planComparisonOpen = false;
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
  const actionMenu = target.closest('.vault-more-actions');
  if (action && actionMenu) actionMenu.removeAttribute('open');
  if (action === 'revisit-onboarding') {
    if (!state.onboardingLoaded) await loadOnboarding();
    if (state.onboarding?.status === 'IN_PROGRESS') {
      await navigateToPage('onboarding');
      return;
    }
    const opened = await navigateToPage('onboarding');
    if (!opened) return;
    state.onboardingRevisitMode = true;
    state.onboardingRevisitStep = 'WELCOME';
    renderCurrentPage();
    return;
  }
  if (action === 'edit-collector-profile') {
    if (!tasteOnboardingEnabled()) return;
    const opened = await navigateToPage('onboarding');
    if (!opened) return;
    state.onboardingRevisitMode = true;
    state.onboardingRevisitStep = 'PROFILE';
    renderCurrentPage();
    return;
  }
  if (action === 'exit-onboarding-revisit') {
    if (state.settingsDirty && !window.confirm('Discard your unsaved setup changes?')) return;
    resetSettingsDraft();
    state.onboardingRevisitMode = false;
    state.onboardingRevisitStep = 'WELCOME';
    await navigateToPage('settings');
    return;
  }
  if (action === 'resume-onboarding') {
    if (!state.onboardingLoaded) await loadOnboarding();
    const canResume = await navigateToPage('onboarding');
    if (!canResume) return;
    if (state.onboarding?.status !== 'IN_PROGRESS') await updateOnboarding('RESUME');
    return;
  }
  if (action === 'onboarding-continue') {
    await updateOnboarding('CONTINUE');
    return;
  }
  if (action === 'onboarding-back') {
    await updateOnboarding('BACK');
    return;
  }
  if (action === 'retry-collector-profile') {
    await loadCollectorProfile();
    return;
  }
  if (action === 'toggle-collector-subject') {
    const subject = target.getAttribute('data-subject');
    if (!subject || !state.collectorProfileDraft) return;
    const selected = new Set(state.collectorProfileDraft.subjects);
    selected.has(subject) ? selected.delete(subject) : selected.add(subject);
    state.collectorProfileDraft.subjects = [...selected];
    renderCurrentPage();
    return;
  }
  if (action === 'toggle-collector-artwork') {
    const key = target.getAttribute('data-artwork-key');
    if (!key || !state.collectorProfileDraft) return;
    const current = new Map(state.collectorProfileDraft.artwork.map((item) => [`${item.source}:${item.sourceCardId}`, item]));
    if (current.has(key)) current.delete(key);
    else {
      const item = state.collectorProfileOptions?.artwork.find((option) => `${option.source}:${option.sourceCardId}` === key);
      if (item) current.set(key, item);
    }
    state.collectorProfileDraft.artwork = [...current.values()];
    renderCurrentPage();
    return;
  }
  if (action === 'save-collector-profile') {
    await saveCollectorProfile();
    return;
  }
  if (action === 'skip-collector-profile') {
    await updateOnboarding('PROFILE_SAVED');
    return;
  }
  if (action === 'skip-onboarding') {
    if (!window.confirm('Skip setup? Unsaved changes will be discarded.')) return;
    await updateOnboarding('SKIP');
    return;
  }
  if (action === 'finish-onboarding') {
    await updateOnboarding('FINISH');
    return;
  }
  if (action === 'onboarding-preview-ready') {
    await updateOnboarding('CHASE_CREATED');
    return;
  }
  if (action === 'onboarding-chase-saved') {
    await updateOnboarding('CHASE_CREATED');
    return;
  }
  if (action === 'retry-onboarding-after-save') {
    const refreshed = await loadOnboarding();
    const advanced = refreshed?.step !== 'CHASE' || await updateOnboarding('CHASE_CREATED');
    state.onboardingSavedChasePending = !advanced;
    return;
  }
  if (action === 'onboarding-add-chase') {
    resetVaultAutocomplete();
    state.vaultCardSelection = null;
    state.vaultFormMode = 'add';
    state.vaultEditingId = null;
    state.vaultPrefillCardName = '';
    state.vaultFormDraft = vaultDraftFromChase();
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
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
    const itemCount = homeDisplayCaseItems().length;
    if (itemCount > 1) {
      const direction = action === 'previous-home-shelf' ? -1 : 1;
      const currentIndex = boundedHomeShelfIndex(state.homeShelfIndex, itemCount);
      state.homeShelfIndex = boundedHomeShelfIndex(currentIndex + direction, itemCount);
      renderCurrentPage();
    }
    return;
  }
  if (action === 'discovery-feedback') {
    await mutateDiscoveryFeedback(target, target.getAttribute('data-feedback-action'));
    return;
  }
  if (action === 'undo-discovery-feedback') {
    await mutateDiscoveryFeedback(target, 'UNDO');
    return;
  }
  if (action === 'view-alert-chase') {
    state.vaultFilter = 'ALL';
    state.pendingVaultFocusId = target.getAttribute('data-chase-id');
    await navigateToPage('vault');
    return;
  }
  if (action === 'view-discovery-card') {
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
  if (action === 'dismiss-vault-notice') {
    state.vaultNotice = null;
    renderCurrentPage();
    return;
  }
  if (action === 'open-plan-comparison') {
    state.planComparisonOpen = true;
    renderCurrentPage();
    document.querySelector('[data-action="close-plan-comparison"]')?.focus();
    return;
  }
  if (action === 'close-plan-comparison') {
    state.planComparisonOpen = false;
    renderCurrentPage();
    return;
  }
  if (action === 'view-wishlist') {
    state.planComparisonOpen = false;
    await navigateToPage('vault');
    return;
  }
  if (action === 'reconcile-vault-create') {
    await retryVaultCreateReconciliation();
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
    state.vaultFormDraft = vaultDraftFromChase();
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'add-shelf-card-to-vault') {
    const cardName = target.getAttribute('data-card-name') || '';
    resetVaultAutocomplete();
    if (!await ensureVaultLoaded()) return;
    state.vaultCardSelection = await trustedSelectionForDiscoveryCard(target, cardName);
    const selectedCardName = state.vaultCardSelection?.value || cardName;
    state.vaultFormMode = 'add';
    state.vaultEditingId = null;
    state.vaultPrefillCardName = selectedCardName;
    state.vaultFormDraft = vaultDraftFromChase({ cardName: selectedCardName });
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'change-card-selection') {
    state.vaultCardSelection = null;
    const input = document.querySelector('#vault-card-input');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
      updateCardIdentityConfirmation(input);
    }
    return;
  }
  if (action === 'open-edit-chase') {
    resetVaultAutocomplete();
    const chaseId = target.getAttribute('data-chase-id');
    const existingName = state.vault.find((entry) => entry.chase.id === chaseId)?.chase.cardName;
    const existingChase = state.vault.find((entry) => entry.chase.id === chaseId)?.chase;
    state.vaultCardSelection = existingName ? { kind: 'existing', value: existingName } : null;
    state.vaultFormMode = 'edit';
    state.vaultEditingId = chaseId;
    state.vaultPrefillCardName = '';
    state.vaultFormDraft = vaultDraftFromChase(existingChase);
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
    state.vaultFormDraft = null;
    state.vaultCreateRecovery = null;
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
    logoutReturnFocus = target;
    state.logoutConfirmationOpen = true;
    renderCurrentPage();
    document.querySelector('[data-action="cancel-logout"]')?.focus();
    return;
  }
  if (action === 'cancel-logout') {
    state.logoutConfirmationOpen = false;
    renderCurrentPage();
    restoreLogoutTriggerFocus();
    return;
  }
  if (action === 'confirm-logout') {
    state.logoutConfirmationOpen = false;
    logoutReturnFocus = null;
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    renderSignedOut();
    return;
  }
  if (action === 'redeem-email-link') {
    await redeemEmailLink();
    return;
  }
  if (action === 'reload') {
    window.location.reload();
  }
});

document.addEventListener('pointerdown', (event) => {
  const activeMenu = event.target instanceof Element ? event.target.closest('.vault-more-actions') : null;
  document.querySelectorAll('.vault-more-actions[open]').forEach((menu) => {
    if (menu !== activeMenu) menu.removeAttribute('open');
  });
});

document.addEventListener('keydown', (event) => {
  if (state.logoutConfirmationOpen) {
    const dialog = document.querySelector('.logout-dialog');
    if (event.key === 'Escape') {
      event.preventDefault();
      state.logoutConfirmationOpen = false;
      renderCurrentPage();
      restoreLogoutTriggerFocus();
      return;
    }
    if (event.key === 'Tab' && dialog) {
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.vault-more-actions[open]');
  if (!menu) return;
  event.preventDefault();
  menu.removeAttribute('open');
  menu.querySelector('summary')?.focus();
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
  if (target.closest?.('[data-vault-form]') && (target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
    const form = target.closest('[data-vault-form]');
    if (target.name === 'gradingType') syncGradeValueControl(form);
    if (form instanceof HTMLFormElement) state.vaultFormDraft = captureVaultFormDraft(form);
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
  if (form.matches('[data-email-signin-form]')) {
    event.preventDefault();
    await requestAuthEmail(form, '/auth/email/request');
    return;
  }
  if (form.matches('[data-email-link-form]')) {
    event.preventDefault();
    await requestAuthEmail(form, '/api/account/email');
    return;
  }
  if (form.matches('[data-onboarding-market-form]')) {
    event.preventDefault();
    state.settingsSaveContext = 'onboarding';
    if (state.settingsDirty) await submitSettingsForm();
    else await updateOnboarding('MARKET_SAVED');
    return;
  }
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
  if (target.matches('[data-collector-subject-search]')) {
    const query = target.value.trim().toLowerCase();
    document.querySelectorAll('[data-action="toggle-collector-subject"]').forEach((button) => {
      button.hidden = query.length > 0 && !String(button.getAttribute('data-subject') || '').toLowerCase().includes(query);
    });
    return;
  }
  if (target.closest('[data-email-signin-form], [data-email-link-form]')) {
    state.authEmailDraft = target.value;
    state.authError = '';
    return;
  }
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
    const form = target.closest('[data-vault-form]');
    if (form instanceof HTMLFormElement) state.vaultFormDraft = captureVaultFormDraft(form);
    scheduleAutocomplete(target);
    return;
  }
  if (target.closest('[data-vault-form]')) {
    const form = target.closest('[data-vault-form]');
    if (form instanceof HTMLFormElement) state.vaultFormDraft = captureVaultFormDraft(form);
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
    } else if (target instanceof HTMLImageElement && target.matches('[data-home-watchlist-image]')) {
      const placeholder = document.createElement('span');
      placeholder.className = 'home-watchlist-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'V';
      (target.closest('.artwork-trigger') || target).replaceWith(placeholder);
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshNewAlertPresence();
});

window.addEventListener('focus', () => {
  void refreshNewAlertPresence();
});

bootstrap();
