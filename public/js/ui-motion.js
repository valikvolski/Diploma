(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function initReveal() {
    const targets = document.querySelectorAll('.js-reveal');
    if (!targets.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    targets.forEach((el) => io.observe(el));
  }

  function initStagger() {
    if (reduce) return;
    document.querySelectorAll('[data-stagger-group]').forEach((group) => {
      group.querySelectorAll('.js-stagger').forEach((el) => {
        const order = parseInt(el.getAttribute('data-stagger-order') || '0', 10) || 0;
        el.style.transitionDelay = (order * 100) + 'ms';
      });
    });
  }

  function initSlotRipple() {
    if (reduce) return;
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.slot-btn');
      if (!btn || btn.disabled) return;
      btn.classList.remove('slot-ripple');
      requestAnimationFrame(function () {
        btn.classList.add('slot-ripple');
      });
    });
  }

  function initBadgePulse() {
    const badge = document.getElementById('notif-badge');
    if (!badge || reduce) return;

    const observer = new MutationObserver(function () {
      if (badge.classList.contains('d-none')) return;
      badge.classList.remove('badge-pop');
      requestAnimationFrame(function () {
        badge.classList.add('badge-pop');
      });
      const bell = document.querySelector('.app-notif-btn i.bi-bell');
      if (bell) {
        bell.classList.remove('bell-shake');
        requestAnimationFrame(function () {
          bell.classList.add('bell-shake');
        });
      }
    });
    observer.observe(badge, { childList: true, characterData: true, subtree: true });
  }

  onReady(function () {
    initStagger();
    initReveal();
    initSlotRipple();
    initBadgePulse();
  });
})();
