/**
 * Profile edit: auto-upload avatar on file pick (POST /profile/avatar as JSON).
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

  /** Синхронизировать все аватарки пользователя на странице (шапка, превью и т.п.). */
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

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('[data-profile-avatar-upload]');
    if (!root) return;
    var input = root.querySelector('input[type="file"][name="avatar"]');
    var holder = root.querySelector('.user-avatar');
    var spinner = root.querySelector('.profile-avatar-upload-spinner');
    if (!input || !holder) return;

    function setLoading(on) {
      root.classList.toggle('profile-avatar-preview-wrap--loading', !!on);
      if (spinner) spinner.classList.toggle('d-none', !on);
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      if (ALLOWED_TYPES.indexOf(file.type) === -1) {
        input.value = '';
        if (window.showAppToast) {
          window.showAppToast('Разрешены только JPG, PNG и WebP', 'danger');
        }
        return;
      }
      if (file.size > MAX_BYTES) {
        input.value = '';
        if (window.showAppToast) {
          window.showAppToast('Файл не должен превышать 2 МБ', 'danger');
        }
        return;
      }

      var fd = new FormData();
      fd.append('avatar', file);
      var tok = csrfValue();
      if (tok) fd.append('_csrf', tok);

      setLoading(true);
      fetch('/profile/avatar', {
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
            var bustedUrl = withAvatarCacheBust(out.data.avatarUrl);
            applyAvatarSrcToHolder(holder, bustedUrl);
            syncUserAvatarAcrossPage(out.data.avatarUrl);
            if (window.showAppToast) {
              window.showAppToast(out.data.message || 'Фото профиля обновлено', 'success');
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
  });
})();
