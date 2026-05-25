/**
 * Пагинация админки: переход на страницу по клику на «…».
 */
(function () {
  'use strict';

  var popoverEl = null;
  var activeNav = null;
  var activeBtn = null;

  function ensurePopover() {
    if (popoverEl) return popoverEl;

    popoverEl = document.createElement('div');
    popoverEl.className = 'admin-pagination-popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', 'Перейти на страницу');
    popoverEl.hidden = true;
    popoverEl.innerHTML =
      '<form class="admin-pagination-popover__form" data-admin-page-jump-form>' +
      '<label class="admin-pagination-popover__label" for="adminPaginationJumpInput">Стр.</label>' +
      '<input type="number" class="form-control form-control-sm admin-pagination-popover__input" id="adminPaginationJumpInput" min="1" step="1" autocomplete="off" />' +
      '<button type="submit" class="btn btn-sm btn-primary admin-pagination-popover__submit">OK</button>' +
      '</form>';

    document.body.appendChild(popoverEl);

    var form = popoverEl.querySelector('[data-admin-page-jump-form]');
    var input = popoverEl.querySelector('input');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!activeNav) return;
      var n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) return;
      navigate(activeNav, n);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        hidePopover();
      }
    });

    return popoverEl;
  }

  function navigate(nav, n) {
    var maxPages = parseInt(nav.getAttribute('data-max-pages'), 10) || 1;
    var pageParam = nav.getAttribute('data-page-param') || 'page';
    var basePath = nav.getAttribute('data-base-path') || '';
    var jumpHref = nav.getAttribute('data-jump-href') || '';

    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > maxPages) n = maxPages;

    if (basePath) {
      var params = new URLSearchParams(window.location.search);
      if (n > 1) {
        params.set(pageParam, String(n));
      } else {
        params.delete(pageParam);
      }
      var qs = params.toString();
      window.location.href = basePath + (qs ? '?' + qs : '');
      return;
    }

    if (jumpHref) {
      try {
        var u = new URL(jumpHref, window.location.origin);
        if (n > 1) {
          u.searchParams.set(pageParam, String(n));
        } else {
          u.searchParams.delete(pageParam);
        }
        window.location.href = u.pathname + u.search;
      } catch (err) {
        window.location.href = jumpHref;
      }
      return;
    }
  }

  function hidePopover() {
    if (!popoverEl) return;
    popoverEl.hidden = true;
    popoverEl.classList.remove('is-open');
    activeNav = null;
    activeBtn = null;
  }

  function showPopover(btn) {
    var nav = btn.closest('[data-admin-pagination]');
    if (!nav) return;

    var pop = ensurePopover();
    var input = pop.querySelector('input');
    var maxPages = parseInt(nav.getAttribute('data-max-pages'), 10) || 1;

    activeNav = nav;
    activeBtn = btn;

    input.min = '1';
    input.max = String(maxPages);
    input.value = '';
    input.placeholder = '1–' + maxPages;

    pop.classList.add('is-open');
    pop.hidden = false;
    pop.style.visibility = 'hidden';
    pop.style.top = '0';
    pop.style.left = '0';

    var rect = btn.getBoundingClientRect();
    var popRect = pop.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 6;
    var left = rect.left + window.scrollX + rect.width / 2 - popRect.width / 2;

    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - popRect.width - 8));

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.visibility = '';

    input.focus();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-admin-pagination-ellipsis');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (activeBtn === btn && popoverEl && popoverEl.classList.contains('is-open')) {
        hidePopover();
      } else {
        showPopover(btn);
      }
      return;
    }

    if (popoverEl && popoverEl.classList.contains('is-open') && !popoverEl.contains(e.target)) {
      hidePopover();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hidePopover();
  });

  window.addEventListener('resize', hidePopover);
  window.addEventListener('scroll', hidePopover, true);
})();
