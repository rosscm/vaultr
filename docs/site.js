const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const revealItems = Array.from(document.querySelectorAll('.reveal'));
if (prefersReducedMotion) {
  revealItems.forEach((item) => item.classList.add('is-visible'));
} else if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

const navLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

if ('IntersectionObserver' in window && sections.length > 0) {
  const navObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
      });
    });
  }, { rootMargin: '-35% 0px -55% 0px', threshold: 0.01 });
  sections.forEach((section) => navObserver.observe(section));
}

document.querySelectorAll('[data-demo-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const scope = button.closest('[data-demo-scope]') ?? document;
    scope.querySelectorAll('[data-demo-action]').forEach((candidate) => {
      candidate.classList.toggle('is-selected', candidate === button);
    });
    const feedback = scope.querySelector('[data-demo-feedback]');
    if (feedback) {
      feedback.textContent = `${button.dataset.demoAction} noted in this example. Real feedback and Vault actions happen in Discord.`;
    }
  });
});

if (!prefersReducedMotion) {
  document.querySelectorAll('[data-tilt]').forEach((tiltTarget) => {
    tiltTarget.addEventListener('pointermove', (event) => {
      const rect = tiltTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      tiltTarget.style.transform = `perspective(1000px) rotateX(${y * -4}deg) rotateY(${x * 5}deg)`;
    });

    tiltTarget.addEventListener('pointerleave', () => {
      tiltTarget.style.transform = '';
    });
  });
}
