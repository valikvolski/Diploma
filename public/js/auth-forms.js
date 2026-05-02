/**
 * Auth: password visibility toggles, register helpers (strength, confirm match).
 * Телефон: /js/phone-international.js (регистрация, профиль, форма врача в админке).
 */
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function bindToggle(btnId, inputId) {
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.setAttribute('aria-pressed', input.type === 'text' ? 'true' : 'false');
      var icon = btn.querySelector('i');
      if (icon) {
        icon.className = input.type === 'text' ? 'bi bi-eye-slash' : 'bi bi-eye';
      }
    });
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Показать или скрыть пароль');
  }

  onReady(function () {
    bindToggle('togglePassword', 'password');
    bindToggle('toggleConfirm', 'password_confirm');

    var regForm = document.getElementById('registerForm');
    var passwordInput = document.getElementById('password');
    var confirmInput = document.getElementById('password_confirm');
    var strengthEl = document.getElementById('passwordStrength');

    if (regForm) {
      function checkPasswords() {
        if (!confirmInput) return;
        if (!confirmInput.value) {
          confirmInput.classList.remove('is-invalid', 'is-valid');
          return;
        }
        if (passwordInput && passwordInput.value === confirmInput.value) {
          confirmInput.classList.remove('is-invalid');
          confirmInput.classList.add('is-valid');
        } else {
          confirmInput.classList.remove('is-valid');
          confirmInput.classList.add('is-invalid');
        }
      }

      if (passwordInput && confirmInput) {
        passwordInput.addEventListener('input', checkPasswords);
        confirmInput.addEventListener('input', checkPasswords);
      }

      regForm.addEventListener(
        'submit',
        function (e) {
          var pwd = passwordInput ? passwordInput.value : '';
          var c = confirmInput ? confirmInput.value : '';
          if (!passwordInput || pwd.length < 6) {
            e.preventDefault();
            if (window.showAppToast) {
              window.showAppToast('Пароль должен содержать минимум 6 символов', 'danger');
            }
            return;
          }
          if (pwd !== c) {
            e.preventDefault();
            if (window.showAppToast) {
              window.showAppToast('Пароли не совпадают', 'danger');
            }
          }
        },
        false
      );

      if (passwordInput && strengthEl) {
        passwordInput.addEventListener('input', function () {
          var len = this.value.length;
          if (len === 0) {
            strengthEl.innerHTML = '';
            return;
          }
          var pct;
          var barClass;
          if (len < 6) {
            pct = Math.max(8, Math.round((len / 6) * 33));
            barClass = 'bg-danger';
          } else if (len < 10) {
            pct = 66;
            barClass = 'bg-warning';
          } else {
            pct = 100;
            barClass = 'bg-success';
          }
          strengthEl.innerHTML =
            '<div class="progress password-strength-progress mt-1" style="height:6px" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
            pct +
            '">' +
            '<div class="progress-bar ' +
            barClass +
            '" style="width:' +
            pct +
            '%"></div></div>';
        });
      }
    }
  });
})();
