(function () {
  'use strict';

  const KEY = 'medzap-theme';

  function applyTheme(mode) {
    const m = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-app-theme', m);
    document.documentElement.setAttribute('data-bs-theme', m);
    try {
      localStorage.setItem(KEY, m);
    } catch (_) {}
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-app-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.app-theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTheme();
        updateIcons();
      });
    });
    updateIcons();
  });

  function updateIcons() {
    const dark = document.documentElement.getAttribute('data-app-theme') === 'dark';
    document.querySelectorAll('.app-theme-toggle').forEach(function (btn) {
      const i = btn.querySelector('i');
      if (!i) return;
      i.className = dark ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    });
  }
})();
