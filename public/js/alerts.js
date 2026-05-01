(function () {
  'use strict';

  function dismissAlert(el) {
    if (!el) return;
    if (window.bootstrap && window.bootstrap.Alert) {
      try {
        var inst = window.bootstrap.Alert.getOrCreateInstance(el);
        inst.close();
        return;
      } catch (_) {}
    }
    el.classList.remove('show');
    el.remove();
  }

  function initAutoDismiss() {
    var alerts = document.querySelectorAll('.app-alert-auto-dismiss[data-alert-timeout]');
    alerts.forEach(function (el) {
      var ms = parseInt(el.getAttribute('data-alert-timeout') || '4500', 10);
      var timeout = Number.isFinite(ms) && ms > 0 ? ms : 4500;
      setTimeout(function () {
        dismissAlert(el);
      }, timeout);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoDismiss);
  } else {
    initAutoDismiss();
  }
})();
