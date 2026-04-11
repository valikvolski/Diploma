/**
 * Печать талона: без inline onclick (совместимость с CSP script-src-attr).
 */
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var btn = document.getElementById('ticketPrintBtn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      window.print();
    });
  });
})();
