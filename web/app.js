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
  isLoadingMore: false
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
  return user?.globalName || user?.username || 'Collector';
}

function avatarHtml(user) {
  const name = userDisplayName(user);
  if (user?.id && user?.avatar) {
    const url = `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=80`;
    return `<img class="avatar" src="${url}" alt="">`;
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
    renderShell(placeholderMarkup('vault'));
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
  if (response.status === 401) {
    renderSignedOut();
    throw new Error('unauthorized');
  }
  if (!response.ok) throw new Error('request_failed');
  return response.json();
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

app.addEventListener(
  'error',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.matches('[data-alert-image]')) {
      const card = target.closest('.alert-card');
      card?.classList.remove('has-image');
      card?.classList.add('no-image');
      target.remove();
    }
  },
  true
);

bootstrap();
