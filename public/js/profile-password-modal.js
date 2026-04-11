/**
 * Модалка смены пароля на /profile/edit (код по почте + JSON API).
 */
(function () {
  'use strict';

  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute('content') || '' : '';
  }

  function bindToggle(btnId, inputId) {
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      var icon = btn.querySelector('i');
      if (icon) icon.className = input.type === 'text' ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
  }

  function setSending(btn, loading) {
    if (!btn) return;
    var label = btn.querySelector('.pw-change-btn-label');
    var spin = btn.querySelector('.pw-change-btn-spinner');
    var load = btn.querySelector('.pw-change-btn-loading');
    btn.disabled = !!loading;
    if (label) label.classList.toggle('d-none', !!loading);
    if (spin) spin.classList.toggle('d-none', !loading);
    if (load) load.classList.toggle('d-none', !loading);
  }

  function setSubmitting(btn, loading) {
    if (!btn) return;
    var label = btn.querySelector('.pw-change-submit-label');
    var spin = btn.querySelector('.pw-change-submit-spinner');
    btn.disabled = !!loading;
    if (label) label.classList.toggle('d-none', !!loading);
    if (spin) spin.classList.toggle('d-none', !loading);
  }

  var ERR_CHANGE = {
    wrong_code: 'Неверный код.',
    expired: 'Срок действия кода истёк. Запросите новый.',
    too_many_attempts: 'Слишком много попыток. Запросите новый код.',
    no_code: 'Сначала отправьте код на почту.',
    code_invalid: 'Код недействителен. Запросите новый.',
    bad_code_format: 'Введите 6 цифр кода.',
    weak_password: 'Пароль не короче 6 символов.',
    mismatch: 'Пароли не совпадают.',
    csrf: 'Обновите страницу и попробуйте снова.',
    forbidden: 'Действие недоступно.',
    server: 'Ошибка сервера. Попробуйте позже.',
  };

  function resetModal() {
    var stepA = document.getElementById('pwChangeStepA');
    var stepB = document.getElementById('pwChangeStepB');
    var sent = document.getElementById('pwChangeCodeSent');
    var errA = document.getElementById('pwChangeStepAError');
    var errB = document.getElementById('pwChangeStepBError');
    var code = document.getElementById('pwChangeCode');
    var p1 = document.getElementById('pwChangeNew');
    var p2 = document.getElementById('pwChangeNew2');
    var sendBtn = document.getElementById('pwChangeSendCode');
    var subBtn = document.getElementById('pwChangeSubmit');
    if (stepA) stepA.classList.remove('d-none');
    if (stepB) stepB.classList.add('d-none');
    if (sent) sent.classList.add('d-none');
    if (errA) {
      errA.classList.add('d-none');
      errA.textContent = '';
    }
    if (errB) {
      errB.classList.add('d-none');
      errB.textContent = '';
    }
    if (code) code.value = '';
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    setSending(sendBtn, false);
    setSubmitting(subBtn, false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindToggle('pwChangeToggle1', 'pwChangeNew');
    bindToggle('pwChangeToggle2', 'pwChangeNew2');

    var modalEl = document.getElementById('changePasswordModal');
    if (modalEl) {
      modalEl.addEventListener('hidden.bs.modal', resetModal);
    }

    var sendBtn = document.getElementById('pwChangeSendCode');
    if (sendBtn) {
      sendBtn.addEventListener('click', async function () {
        var errA = document.getElementById('pwChangeStepAError');
        if (errA) {
          errA.classList.add('d-none');
          errA.textContent = '';
        }
        setSending(sendBtn, true);
        try {
          var res = await fetch('/profile/password/send-code', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken(),
              Accept: 'application/json',
            },
            body: '{}',
          });
          var data = await res.json().catch(function () {
            return {};
          });
          if (res.status === 403 && data.error === 'csrf') {
            if (errA) {
              errA.textContent = ERR_CHANGE.csrf;
              errA.classList.remove('d-none');
            }
            setSending(sendBtn, false);
            return;
          }
          if (!data.ok) {
            if (errA) {
              errA.textContent =
                data.message ||
                (res.status === 503 ? 'Сервис временно недоступен.' : 'Не удалось отправить код.');
              errA.classList.remove('d-none');
            }
            setSending(sendBtn, false);
            return;
          }
          if (data.message && !data.sent) {
            if (errA) {
              errA.textContent = data.message;
              errA.classList.remove('d-none');
            }
            setSending(sendBtn, false);
            return;
          }
          var sent = document.getElementById('pwChangeCodeSent');
          if (sent) sent.classList.remove('d-none');
          var stepB = document.getElementById('pwChangeStepB');
          if (stepB) stepB.classList.remove('d-none');
        } catch (e) {
          if (errA) {
            errA.textContent = 'Нет связи с сервером.';
            errA.classList.remove('d-none');
          }
        }
        setSending(sendBtn, false);
      });
    }

    var subBtn = document.getElementById('pwChangeSubmit');
    if (subBtn) {
      subBtn.addEventListener('click', async function () {
        var errB = document.getElementById('pwChangeStepBError');
        if (errB) {
          errB.classList.add('d-none');
          errB.textContent = '';
        }
        var code = (document.getElementById('pwChangeCode') || {}).value || '';
        var p1 = (document.getElementById('pwChangeNew') || {}).value || '';
        var p2 = (document.getElementById('pwChangeNew2') || {}).value || '';
        if (p1 !== p2) {
          if (errB) {
            errB.textContent = ERR_CHANGE.mismatch;
            errB.classList.remove('d-none');
          }
          return;
        }
        setSubmitting(subBtn, true);
        try {
          var res = await fetch('/profile/password/change', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken(),
              Accept: 'application/json',
            },
            body: JSON.stringify({ code: code, password: p1, password_confirm: p2 }),
          });
          var data = await res.json().catch(function () {
            return {};
          });
          if (data.ok && data.redirect) {
            window.location.href = data.redirect;
            return;
          }
          var key = data.error || 'server';
          if (errB) {
            errB.textContent = ERR_CHANGE[key] || data.message || 'Не удалось сменить пароль.';
            errB.classList.remove('d-none');
          }
        } catch (e) {
          if (errB) {
            errB.textContent = 'Нет связи с сервером.';
            errB.classList.remove('d-none');
          }
        }
        setSubmitting(subBtn, false);
      });
    }
  });
})();
