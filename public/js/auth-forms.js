/**
 * Auth: password visibility toggles, register helpers (strength, confirm match).
 * Телефон (375…): /js/phone-belarus.js + data-phone-by="1"
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
    var confirmFeedback = document.getElementById('confirmFeedback');
    var strengthEl = document.getElementById('passwordStrength');

    if (regForm) {
      function checkPasswords() {
        if (!confirmInput || !confirmFeedback) return;
        if (!confirmInput.value) {
          confirmFeedback.textContent = '';
          confirmInput.classList.remove('is-invalid', 'is-valid');
          return;
        }
        if (passwordInput && passwordInput.value === confirmInput.value) {
          confirmInput.classList.remove('is-invalid');
          confirmInput.classList.add('is-valid');
          confirmFeedback.className = 'form-text text-success';
          confirmFeedback.textContent = 'Пароли совпадают';
        } else {
          confirmInput.classList.remove('is-valid');
          confirmInput.classList.add('is-invalid');
          confirmFeedback.className = 'form-text text-danger';
          confirmFeedback.textContent = 'Пароли не совпадают';
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
          var html = '';
          if (len < 6) html = '<small class="text-danger">Минимум 6 символов</small>';
          else if (len < 10) html = '<small class="text-warning">Средняя длина</small>';
          else html = '<small class="text-success">Хорошая длина</small>';
          strengthEl.innerHTML = html;
        });
      }
    }
  });
})();
