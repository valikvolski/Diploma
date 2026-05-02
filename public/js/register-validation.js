/**
 * Регистрация: компактные подсказки над полем вместо крупных invalid-feedback.
 */
(function () {
  'use strict';

  function anchorFor(input) {
    return input ? input.closest('.register-field-anchor') : null;
  }

  function clearMiniHint(input) {
    var anchor = anchorFor(input);
    if (!anchor) return;
    var el = anchor.querySelector(':scope > .register-mini-hint');
    if (el) {
      el.classList.add('d-none');
      el.innerHTML = '';
    }
  }

  function placeMiniHintInAnchor(anchor, el) {
    var ref =
      anchor.querySelector('.input-group') ||
      anchor.querySelector('input.form-control, select.form-select, textarea.form-control');
    if (!ref) {
      if (!anchor.contains(el)) anchor.insertBefore(el, anchor.firstChild);
      return;
    }
    if (el.nextElementSibling !== ref) {
      if (el.parentNode) el.parentNode.removeChild(el);
      anchor.insertBefore(el, ref);
    }
  }

  function showMiniHint(input, message) {
    var anchor = anchorFor(input);
    if (!anchor || !message) return;
    var el = anchor.querySelector(':scope > .register-mini-hint');
    if (!el) {
      el = document.createElement('div');
      el.className = 'register-mini-hint d-none';
      el.setAttribute('role', 'alert');
    }
    placeMiniHintInAnchor(anchor, el);
    el.innerHTML =
      '<i class="bi bi-exclamation-circle register-mini-hint__icon" aria-hidden="true"></i>' +
      '<span class="register-mini-hint__text"></span>';
    el.querySelector('.register-mini-hint__text').textContent = message;
    el.classList.remove('d-none');
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
  }

  function hideMismatchMsg() {
    var el = document.getElementById('passwordMismatchMsg');
    if (!el) return;
    el.classList.add('d-none');
    el.textContent = '';
  }

  function showMismatchMsg() {
    var el = document.getElementById('passwordMismatchMsg');
    if (!el) return;
    el.textContent = 'Пароли не совпадают';
    el.classList.remove('d-none');
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var form = document.getElementById('registerForm');
    if (!form) return;

    var passwordInput = document.getElementById('password');
    var confirmInput = document.getElementById('password_confirm');

    var watchSelectors =
      '#email, #password, #password_confirm, #last_name, #first_name, #middle_name, #birth_date, #phone_local';

    form.querySelectorAll(watchSelectors).forEach(function (field) {
      field.addEventListener('input', function () {
        clearMiniHint(field);
        if (field.id === 'password_confirm') return;
        if (field.checkValidity()) {
          field.classList.remove('is-invalid');
          field.removeAttribute('aria-invalid');
        }
      });
      field.addEventListener('change', function () {
        clearMiniHint(field);
      });
    });

    form.addEventListener(
      'submit',
      function (e) {
        form.querySelectorAll('.register-mini-hint').forEach(function (h) {
          h.classList.add('d-none');
          h.innerHTML = '';
        });
        hideMismatchMsg();

        form.querySelectorAll('input, select, textarea').forEach(function (field) {
          if (field.disabled || field.type === 'hidden') return;
          if (field.name === '_csrf') return;
          field.classList.remove('is-invalid');
          field.removeAttribute('aria-invalid');
        });

        var pwd = passwordInput ? passwordInput.value : '';
        var c = confirmInput ? confirmInput.value : '';

        if (passwordInput && pwd.length < 6) {
          e.preventDefault();
          showMiniHint(passwordInput, 'Пароль должен содержать минимум 6 символов');
          passwordInput.focus();
          return;
        }

        if (passwordInput && confirmInput && pwd.length >= 6 && pwd !== c) {
          e.preventDefault();
          confirmInput.classList.add('is-invalid');
          confirmInput.setAttribute('aria-invalid', 'true');
          showMismatchMsg();
          confirmInput.focus();
          return;
        }

        if (!form.checkValidity()) {
          e.preventDefault();
          var list = form.querySelectorAll(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
          );
          var first = null;
          list.forEach(function (field) {
            if (field.name === '_csrf') return;
            if (!field.checkValidity()) {
              var msg = field.validationMessage || 'Проверьте значение';
              showMiniHint(field, msg);
              if (!first) first = field;
            }
          });
          if (first) first.focus();
        }
      },
      false
    );
  });
})();
