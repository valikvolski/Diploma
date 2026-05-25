/**
 * Автозагрузка аватара: [data-avatar-auto-upload] + data-upload-url (или legacy data-profile-avatar-upload).
 */
(function () {
  'use strict';

  var MAX_BYTES = 2 * 1024 * 1024;
  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function csrfValue() {
    var inp = document.querySelector('input[name="_csrf"]');
    return inp ? inp.value : '';
  }

  function ensureImg(holder) {
    if (!holder) return null;
    var img = holder.querySelector('.user-avatar__img');
    if (img) return img;
    holder.classList.add('user-avatar--has-img');
    holder.style.background = '';
    var initials = holder.querySelector('.user-avatar__initials');
    if (initials) initials.remove();
    img = document.createElement('img');
    img.className = 'user-avatar__img';
    img.alt = '';
    img.setAttribute('width', '256');
    img.setAttribute('height', '256');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    holder.appendChild(img);
    return img;
  }

  function withAvatarCacheBust(url) {
    var u = String(url || '').trim();
    if (!u) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  }

  function applyAvatarSrcToHolder(holder, bustedUrl) {
    var img = ensureImg(holder);
    if (img) img.src = bustedUrl;
  }

  function syncUserAvatarAcrossPage(avatarUrl) {
    var busted = withAvatarCacheBust(avatarUrl);
    document.querySelectorAll('.app-nav-avatar-wrap .user-avatar').forEach(function (h) {
      applyAvatarSrcToHolder(h, busted);
    });
  }

  function parseFetchResponse(res, text) {
    var data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {}
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  function wirePickControls(root) {
    var input = root.querySelector('input[type="file"][name="avatar"]');
    var panel = root.closest('.profile-avatar-panel') || document;
    function pick() {
      if (input) input.click();
    }
    panel.querySelectorAll('[data-avatar-pick-trigger]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        pick();
      });
    });
  }

  function initAvatarRoot(root) {
    var uploadUrl =
      root.getAttribute('data-upload-url') ||
      (root.hasAttribute('data-profile-avatar-upload') ? '/profile/avatar' : '');
    if (!uploadUrl) return;

    var input = root.querySelector('input[type="file"][name="avatar"]');
    var holderWrap = root.querySelector('[id$="Holder"]');
    var holder = holderWrap ? holderWrap.querySelector('.user-avatar') : root.querySelector('.user-avatar');
    var spinner = root.querySelector('.profile-avatar-upload-spinner');
    if (!input || !holder) return;

    wirePickControls(root);

    function setLoading(on) {
      root.classList.toggle('profile-avatar-preview-wrap--loading', !!on);
      if (spinner) spinner.classList.toggle('d-none', !on);
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      if (ALLOWED_TYPES.indexOf(file.type) === -1) {
        input.value = '';
        if (window.showAppToast) window.showAppToast('Разрешены только JPG, PNG и WebP', 'danger');
        return;
      }
      if (file.size > MAX_BYTES) {
        input.value = '';
        if (window.showAppToast) window.showAppToast('Файл не должен превышать 2 МБ', 'danger');
        return;
      }

      var fd = new FormData();
      fd.append('avatar', file);
      var tok = csrfValue();
      if (tok) fd.append('_csrf', tok);

      setLoading(true);
      fetch(uploadUrl, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
          'X-CSRF-Token': tok,
        },
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return parseFetchResponse(res, text);
          });
        })
        .then(function (out) {
          setLoading(false);
          input.value = '';
          if (out.ok && out.data && out.data.ok && out.data.avatarUrl) {
            applyAvatarSrcToHolder(holder, withAvatarCacheBust(out.data.avatarUrl));
            syncUserAvatarAcrossPage(out.data.avatarUrl);
            if (window.showAppToast) {
              window.showAppToast(out.data.message || 'Фото обновлено', 'success');
            }
            return;
          }
          var err =
            (out.data && out.data.error) ||
            (out.status === 403 ? 'Сессия устарела. Обновите страницу.' : 'Не удалось загрузить фото');
          if (out.data && out.data.error === 'csrf') {
            err = 'Обновите страницу и попробуйте снова.';
          }
          if (window.showAppToast) window.showAppToast(err, 'danger');
        })
        .catch(function () {
          setLoading(false);
          input.value = '';
          if (window.showAppToast) window.showAppToast('Ошибка сети', 'danger');
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var roots = document.querySelectorAll('[data-avatar-auto-upload], [data-profile-avatar-upload]');
    roots.forEach(initAvatarRoot);

    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      if (el.id && el.id.indexOf('Hint') !== -1 && typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        new bootstrap.Tooltip(el, { container: 'body' });
      }
    });
  });
})();
