(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function initHero() {
    document.querySelectorAll('.js-home-hero-item').forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  function initReveal() {
    if (reduceMotion) {
      document.querySelectorAll('.js-home-reveal, .js-home-stagger').forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }

    const io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    document.querySelectorAll('.js-home-reveal').forEach(function (el) {
      io.observe(el);
    });

    document.querySelectorAll('[data-reveal-stagger]').forEach(function (parent) {
      parent.querySelectorAll('.js-home-stagger').forEach(function (el) {
        io.observe(el);
      });
    });
  }

  function initStaggerDelays() {
    if (reduceMotion) return;
    document.querySelectorAll('[data-reveal-stagger]').forEach(function (parent) {
      parent.querySelectorAll('.js-home-stagger').forEach(function (el) {
        const order = parseInt(el.getAttribute('data-stagger-order') || '0', 10) || 0;
        el.style.transitionDelay = order * 0.12 + 's';
      });
    });
  }

  function animateCount(el, target, durationMs) {
    if (reduceMotion) {
      el.textContent = String(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (target - from) * eased);
      el.textContent = String(val);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function initCountUp() {
    document.querySelectorAll('[data-count-up]').forEach(function (el) {
      const raw = el.getAttribute('data-count-up');
      const target = parseInt(raw, 10);
      if (Number.isNaN(target)) return;

      const io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            io.unobserve(entry.target);
            animateCount(entry.target, target, 900);
          });
        },
        { threshold: 0.2 }
      );
      io.observe(el);
    });
  }

  onReady(function () {
    if (!document.querySelector('.home-root')) return;
    initStaggerDelays();
    initHero();
    initReveal();
    initCountUp();
  });
})();
