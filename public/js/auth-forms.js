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
      var mismatchMsg = document.getElementById('passwordMismatchMsg');

      function checkPasswords() {
        if (!confirmInput) return;
        if (!confirmInput.value) {
          confirmInput.classList.remove('is-invalid');
          if (mismatchMsg) {
            mismatchMsg.classList.add('d-none');
            mismatchMsg.textContent = '';
          }
          return;
        }
        if (passwordInput && passwordInput.value === confirmInput.value) {
          confirmInput.classList.remove('is-invalid');
          if (mismatchMsg) {
            mismatchMsg.classList.add('d-none');
            mismatchMsg.textContent = '';
          }
        } else {
          confirmInput.classList.add('is-invalid');
          if (mismatchMsg) {
            mismatchMsg.textContent = 'Пароли не совпадают';
            mismatchMsg.classList.remove('d-none');
          }
        }
      }

      if (passwordInput && confirmInput) {
        passwordInput.addEventListener('input', checkPasswords);
        confirmInput.addEventListener('input', checkPasswords);
      }

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
