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

const demoMessages = {
  'View Alert': 'Demo only. No listing opened.',
  'Add to Chase': 'Added to Chase in this demo.',
  'More like this': "Got it. We'll lean a little more this way.",
  'Not for me': "Got it. We'll show you less like this."
};

document.querySelectorAll('[data-demo-action]').forEach((button) => {
  button.setAttribute('aria-pressed', 'false');

  button.addEventListener('click', () => {
    const scope = button.closest('[data-demo-scope]') ?? document;
    const card = button.closest('.shelf-card');
    const action = button.dataset.demoAction;

    scope.querySelectorAll('[data-demo-action]').forEach((candidate) => {
      const isSelected = candidate === button;
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });

    if (card) {
      card.classList.toggle('is-liked', action === 'More like this');
      card.classList.toggle('is-muted', action === 'Not for me');
      if (action === 'Add to Chase') {
        button.textContent = 'Added to Chase ✓';
      }
    }

    const feedback = scope.querySelector('[data-demo-feedback]') ?? document.querySelector('.shelf-demo-feedback');
    if (feedback && action) {
      feedback.textContent = demoMessages[action] ?? `${action} noted in this demo.`;
    }
  });
});

document.querySelectorAll('[data-shelf-reset]').forEach((button) => {
  button.addEventListener('click', () => {
    const section = button.closest('section') ?? document;
    section.querySelectorAll('.shelf-card').forEach((card) => {
      card.classList.remove('is-liked', 'is-muted');
    });
    section.querySelectorAll('[data-demo-action]').forEach((actionButton) => {
      actionButton.classList.remove('is-selected');
      actionButton.setAttribute('aria-pressed', 'false');
      if (actionButton.dataset.demoAction === 'Add to Chase') {
        actionButton.textContent = 'Add to Chase';
      }
    });
    const feedback = section.querySelector('[data-demo-feedback]');
    if (feedback) {
      feedback.textContent = "Demo only. These actions don't change an account.";
    }
  });
});

document.querySelectorAll('[data-alert-preview-image], [data-alert-full-image]').forEach((image) => {
  const showFallback = () => {
    image.classList.add('is-missing');
    const fallback = image.hasAttribute('data-alert-preview-image')
      ? document.querySelector('[data-alert-preview-fallback]')
      : document.querySelector('[data-alert-full-fallback]');
    fallback?.classList.add('is-visible');
  };

  image.addEventListener('error', showFallback, { once: true });
  if (image.complete && image.naturalWidth === 0) {
    showFallback();
  }
});

const lightbox = document.querySelector('[data-alert-lightbox]');
const lightboxPanel = document.querySelector('.lightbox-panel');
let lightboxTrigger = null;

const closeLightbox = () => {
  if (!lightbox) return;
  lightbox.hidden = true;
  document.body.classList.remove('is-lightbox-open');
  if (lightboxTrigger instanceof HTMLElement) {
    lightboxTrigger.focus();
  }
  lightboxTrigger = null;
};

document.querySelectorAll('[data-alert-lightbox-open]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!lightbox || !lightboxPanel) return;
    lightboxTrigger = button;
    lightbox.hidden = false;
    document.body.classList.add('is-lightbox-open');
    lightboxPanel.focus();
  });
});

document.querySelectorAll('[data-alert-lightbox-close]').forEach((button) => {
  button.addEventListener('click', closeLightbox);
});

document.addEventListener('keydown', (event) => {
  if (!lightbox || lightbox.hidden) return;

  if (event.key === 'Escape') {
    closeLightbox();
    return;
  }

  if (event.key === 'Tab' && lightboxPanel) {
    const focusable = Array.from(
      lightboxPanel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((element) => element instanceof HTMLElement && !element.hasAttribute('disabled'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

const runHeroWorkflow = (workflow) => {
  const cards = Array.from(workflow.querySelectorAll('[data-workflow-card]'));
  const lines = Array.from(workflow.querySelectorAll('.workflow-line'));
  cards.forEach((card, index) => {
    window.setTimeout(() => {
      cards.forEach((candidate, candidateIndex) => {
        candidate.classList.toggle('is-live', candidateIndex === index);
        candidate.classList.toggle('is-past', candidateIndex < index);
      });
      lines.forEach((line, lineIndex) => {
        line.classList.toggle('is-live', lineIndex === index - 1);
        line.classList.toggle('is-past', lineIndex < index - 1);
      });
    }, index * 720);
  });
};

if (!prefersReducedMotion) {
  document.querySelectorAll('[data-hero-workflow]').forEach((workflow) => {
    if ('IntersectionObserver' in window) {
      const workflowObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          runHeroWorkflow(workflow);
          workflowObserver.unobserve(workflow);
        });
      }, { threshold: 0.35 });
      workflowObserver.observe(workflow);
    } else {
      runHeroWorkflow(workflow);
    }
  });
}

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
