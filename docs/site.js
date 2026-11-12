const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealItems = [...document.querySelectorAll('.reveal')];

if (reducedMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach((item) => item.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => revealObserver.observe(item));
}

const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const sections = navLinks.map((link) => document.querySelector(link.hash)).filter(Boolean);
if ('IntersectionObserver' in window) {
  const navObserver = new IntersectionObserver((entries) => {
    const visible = entries.find((entry) => entry.isIntersecting);
    if (!visible) return;
    navLinks.forEach((link) => link.classList.toggle('is-active', link.hash === `#${visible.target.id}`));
  }, { rootMargin: '-35% 0px -55%', threshold: 0.01 });
  sections.forEach((section) => navObserver.observe(section));
}

document.querySelectorAll('.mobile-nav a').forEach((link) => {
  link.addEventListener('click', () => link.closest('details')?.removeAttribute('open'));
});

document.querySelectorAll('[data-walkthrough]').forEach((walkthrough) => {
  const tabs = [...walkthrough.querySelectorAll('[data-walkthrough-tab]')];
  const panels = [...walkthrough.querySelectorAll('[data-walkthrough-panel]')];
  const progress = walkthrough.querySelector('[data-walkthrough-progress]');

  const selectStage = (nextTab, moveFocus = false) => {
    const stage = nextTab.dataset.walkthroughTab;
    const index = tabs.indexOf(nextTab);
    tabs.forEach((tab) => {
      const selected = tab === nextTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.walkthroughPanel !== stage;
    });
    if (progress) progress.style.width = `${((index + 1) / tabs.length) * 100}%`;
    if (moveFocus) nextTab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectStage(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      selectStage(tabs[nextIndex], true);
    });
  });
});
