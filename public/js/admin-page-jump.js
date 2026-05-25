/**
 * Переход на страницу по номеру (формы [data-admin-page-jump]).
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form[data-admin-page-jump]').forEach(function (form) {
      var input = form.querySelector('input[type="number"]');
      if (!input) return;

      var maxPages = parseInt(form.getAttribute('data-max-pages'), 10) || 1;
      var pageParam = form.getAttribute('data-page-param') || 'page';
      var basePath = form.getAttribute('data-base-path') || window.location.pathname;

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var n = parseInt(input.value, 10);
        if (!Number.isFinite(n) || n < 1) n = 1;
        if (n > maxPages) n = maxPages;

        var params = new URLSearchParams(window.location.search);
        if (n > 1) {
          params.set(pageParam, String(n));
        } else {
          params.delete(pageParam);
        }

        var qs = params.toString();
        window.location.href = basePath + (qs ? '?' + qs : '');
      });
    });
  });
})();
