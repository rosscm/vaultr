const app = document.querySelector('#app');

const state = {
  user: null,
  activePage: 'alerts',
  priority: 'ALL',
  source: 'ALL',
  alerts: [],
  nextCursor: null,
  requestId: 0,
  hasCheckedAllAlerts: false,
  isLoadingMore: false,
  vault: [],
  completedChases: [],
  vaultPlan: null,
  vaultCurrency: 'CAD',
  vaultOptions: null,
  isVaultLoading: false,
  vaultLoaded: false,
  vaultError: null,
  vaultNotice: '',
  vaultFormMode: null,
  vaultEditingId: null,
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
  removeError: ''
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
        <h1 id="signed-out-title">Your collection is waiting.</h1>
        <p>Sign in with Discord to open your Vault, see your alerts, and pick up where you left off.</p>
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
        <a class="brand" href="/app" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span>Vaultr</span>
        </a>
        <nav class="app-nav desktop-nav" aria-label="Vaultr app navigation">
          ${navButton('vault', 'My Vault')}
          ${navButton('alerts', 'Alerts')}
          ${navButton('shelf', 'Weekly Shelf')}
        </nav>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <span class="user-name">${escapeHtml(displayName)}</span>
          <button class="button-ghost" type="button" data-action="logout">Log out</button>
        </div>
      </aside>
      <header class="mobile-header">
        <a class="brand" href="/app" aria-label="Vaultr app">
          <span class="brand-mark" aria-hidden="true"><span>V</span></span>
          <span>Vaultr</span>
        </a>
        <div class="user-area">
          ${avatarHtml(state.user)}
          <button class="button-ghost" type="button" data-action="logout">Log out</button>
        </div>
      </header>
      <main id="app-main" class="app-main">
        ${content}
      </main>
      <nav class="mobile-nav" aria-label="Vaultr mobile navigation">
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
        <p class="eyebrow">Private Alerts</p>
        <h1 id="alerts-title">What Vaultr found for your Chases</h1>
        <p>Matches worth a look, based on the cards and filters you saved.</p>
      </header>
      <div class="toolbar">
        <div class="priority-filters" aria-label="Alert priority filters">
          ${priorityButton('ALL', 'All')}
          ${priorityButton('GRAIL', 'Grail')}
          ${priorityButton('HIGH', 'High')}
          ${priorityButton('NORMAL', 'Normal')}
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
      return alertsPageMarkup(statePanelMarkup(`No ${state.priority === 'GRAIL' ? 'Grail' : state.priority.toLowerCase()} alerts yet.`, 'Try another priority or check back after Vaultr finds a new match.'));
    }
    return alertsPageMarkup(statePanelMarkup('No alerts for this source yet.', 'Try another source or check back after Vaultr finds a new match.'));
  }

  const list = state.alerts.map(alertCardMarkup).join('');
  const loadMore = state.nextCursor
    ? `<div class="load-more-row"><button class="button-ghost" type="button" data-action="load-more" ${state.isLoadingMore ? 'disabled' : ''}>${state.isLoadingMore ? 'Loading...' : 'Load more'}</button></div>`
    : '';
  return alertsPageMarkup(`<div class="alert-list" aria-label="Private alerts">${list}</div>${loadMore}`);
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
  const items = state.vault || [];
  return `
    <section aria-labelledby="vault-title">
      ${vaultHeaderMarkup()}
      ${state.vaultNotice ? `<div class="vault-notice" role="status">${escapeHtml(state.vaultNotice)}</div>` : ''}
      ${vaultSummaryMarkup()}
      ${items.length ? `<div class="vault-grid" aria-label="Saved Chases">${items.map(vaultCardMarkup).join('')}</div>` : vaultEmptyMarkup()}
      ${completedChasesSectionMarkup()}
      ${vaultDialogMarkup()}
      ${removeDialogMarkup()}
    </section>
  `;
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
      ${paused > 0 ? `<p>${escapeHtml(paused)} saved ${paused === 1 ? 'Chase is' : 'Chases are'} paused while this Vault is on Free.</p>` : ''}
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
  const paused = item.monitoringState === 'PAUSED_PLAN_LIMIT';
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
          <span class="status-pill ${paused ? 'paused' : 'active'}">${paused ? 'Paused' : 'Watching'}</span>
          <span class="priority-pill ${chase.priority === 'GRAIL' ? 'grail' : ''}">${escapeHtml(priorityLabel(chase.priority))}</span>
        </div>
        <h2>${escapeHtml(chase.cardName || 'Saved Chase')}</h2>
        ${paused ? '<p class="paused-copy">Saved in your Vault, not currently monitored on Free.</p>' : ''}
        ${details.length ? `<div class="vault-detail-row">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>` : ''}
        ${chase.targetNote ? `<p class="vault-note">${escapeHtml(chase.targetNote)}</p>` : ''}
        ${chase.negativeKeywords?.length ? `<p class="vault-note">Excludes ${escapeHtml(chase.negativeKeywords.join(', '))}</p>` : ''}
        <div class="vault-actions">
          <button class="button-ghost" type="button" data-action="open-edit-chase" data-chase-id="${escapeHtml(chase.id)}">Edit</button>
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
      </div>
    </article>
  `;
}

function completedChasesSectionMarkup() {
  const completed = state.completedChases || [];
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

function vaultDialogMarkup() {
  if (!state.vaultFormMode) return '';
  const editing = state.vaultFormMode === 'edit';
  const item = editing ? state.vault.find((entry) => entry.chase.id === state.vaultEditingId) : null;
  const chase = item?.chase || {};
  const grade = gradeToChoices(chase.grade);
  const isFullVault = state.vaultPlan?.tier === 'PRO';
  return `
    <div class="modal-backdrop" role="presentation">
      <form class="vault-dialog" data-vault-form="${editing ? 'edit' : 'add'}" aria-labelledby="vault-form-title">
        <header>
          <p class="eyebrow">${editing ? 'EDIT CHASE' : 'ADD CHASE'}</p>
          <h2 id="vault-form-title">${editing ? 'Refine this Chase' : 'Add a Chase'}</h2>
        </header>
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
        ${state.removeError ? `<p class="form-error" role="alert">${escapeHtml(state.removeError)}</p>` : ''}
        <div class="remove-options">
          <button class="button-primary remove-option" type="button" data-action="remove-chase" data-outcome="COMPLETED">
            <span class="remove-option-title">Completed</span>
            <span class="remove-option-copy">I found or bought the card</span>
          </button>
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

function placeholderMarkup(kind) {
  const content = kind === 'vault'
    ? ['My Vault', 'Your active Chases will live here', 'View and manage the cards Vaultr is watching for you.', 'Coming during beta.']
    : ['Weekly Shelf', 'Your next Shelf will have a home here too', 'Recommendations shaped by what you collect and how you respond.', 'Coming during beta.'];
  return `
    <section class="placeholder" aria-labelledby="placeholder-title">
      <p class="eyebrow">${escapeHtml(content[0])}</p>
      <h1 id="placeholder-title">${escapeHtml(content[1])}</h1>
      <p>${escapeHtml(content[2])}</p>
      <p class="placeholder-note">${escapeHtml(content[3])}</p>
    </section>
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
  if (state.activePage === 'vault') {
    renderShell(vaultPageMarkup());
    return;
  }
  if (state.activePage === 'shelf') {
    renderShell(placeholderMarkup('shelf'));
    return;
  }
  renderShell(alertsMarkup());
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
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
  if (cursor) params.set('cursor', cursor);
  return params.toString() ? `/api/alerts?${params.toString()}` : '/api/alerts';
}

async function loadAlerts({ append = false } = {}) {
  const requestId = ++state.requestId;
  if (!append) {
    state.alerts = [];
    state.nextCursor = null;
    state.hasCheckedAllAlerts = false;
    renderShell(skeletonMarkup());
  } else {
    state.isLoadingMore = true;
    renderCurrentPage();
  }

  try {
    const body = await fetchJson(alertQuery(append ? state.nextCursor : null));
    if (requestId !== state.requestId) return;
    state.alerts = append ? state.alerts.concat(body.items || []) : body.items || [];
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
    renderShell(alertsPageMarkup(statePanelMarkup("Couldn't load your alerts.", 'Try again when you are ready.', 'Try again')));
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
  state.removeError = '';
  try {
    await fetchJson(`/api/chases/${encodeURIComponent(state.removeTargetId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome })
    });
    state.vaultNotice = outcome === 'COMPLETED' ? 'Chase completed.' : 'Chase removed.';
    state.removeTargetId = null;
    await loadVault({ force: true });
  } catch (error) {
    if (String(error?.message) === 'unauthorized') return;
    state.removeError = apiErrorMessage(error);
    renderCurrentPage();
  }
}

async function bootstrap() {
  try {
    const body = await fetchJson('/api/me');
    state.user = body.user;
    state.activePage = 'alerts';
    renderShell(skeletonMarkup());
    await loadAlerts();
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
    state.activePage = page;
    renderCurrentPage();
    if (page === 'alerts' && !state.alerts.length) await loadAlerts();
    if (page === 'vault') await loadVault();
    return;
  }

  const priority = target.getAttribute('data-priority');
  if (priority) {
    state.priority = priority;
    state.activePage = 'alerts';
    await loadAlerts();
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
  if (action === 'open-add-chase') {
    resetVaultAutocomplete();
    state.vaultFormMode = 'add';
    state.vaultEditingId = null;
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'open-edit-chase') {
    resetVaultAutocomplete();
    state.vaultFormMode = 'edit';
    state.vaultEditingId = target.getAttribute('data-chase-id');
    state.vaultFormError = '';
    renderCurrentPage();
    document.querySelector('[name="cardName"]')?.focus();
    return;
  }
  if (action === 'close-vault-dialog') {
    resetVaultAutocomplete();
    state.vaultFormMode = null;
    state.vaultEditingId = null;
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
    state.activePage = 'alerts';
    await loadAlerts();
  }
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
    } else if (target instanceof HTMLImageElement && target.matches('[data-vault-card-image]')) {
      const placeholder = document.createElement('div');
      placeholder.className = 'vault-card-image placeholder-image';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = 'V';
      target.replaceWith(placeholder);
    }
  },
  true
);

bootstrap();
