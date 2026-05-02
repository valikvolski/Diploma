/**
 * Bootstrap 5 toasts: window.showAppToast(message, 'danger' | 'success')
 */
(function () {
  'use strict';

  function getContainer() {
    return document.getElementById('appToastContainer');
  }

  window.showAppToast = function (message, variant) {
    var text = message != null ? String(message) : '';
    variant = variant === 'success' ? 'success' : 'danger';
    var c = getContainer();
    if (!c || typeof bootstrap === 'undefined' || !bootstrap.Toast) {
      if (text) window.alert(text);
      return;
    }
    var isErr = variant !== 'success';
    var wrap = document.createElement('div');
    wrap.className =
      'toast align-items-center border-0 shadow app-toast-item ' +
      (isErr ? 'text-bg-danger' : 'text-bg-success');
    wrap.setAttribute('role', 'alert');
    wrap.setAttribute('aria-live', 'assertive');

    var flex = document.createElement('div');
    flex.className = 'd-flex';

    var body = document.createElement('div');
    body.className = 'toast-body d-flex align-items-start gap-2 py-3';

    var icon = document.createElement('span');
    icon.className = 'app-toast-icon flex-shrink-0 fw-bold';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isErr ? '✗' : '✓';

    var msg = document.createElement('span');
    msg.className = 'app-toast-message';
    msg.textContent = text;

    body.appendChild(icon);
    body.appendChild(msg);
    flex.appendChild(body);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close btn-close-white me-2 m-auto';
    close.setAttribute('data-bs-dismiss', 'toast');
    close.setAttribute('aria-label', 'Закрыть');
    flex.appendChild(close);

    wrap.appendChild(flex);
    c.appendChild(wrap);

    var t = new bootstrap.Toast(wrap, { autohide: true, delay: 3500 });
    wrap.addEventListener('hidden.bs.toast', function () {
      wrap.remove();
    });
    t.show();
  };
})();
