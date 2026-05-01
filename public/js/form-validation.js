(function () {
  'use strict';

  function setFieldState(field) {
    if (!field || field.disabled || field.type === 'hidden') return;
    var valid = field.checkValidity();
    field.classList.toggle('is-valid', valid && String(field.value || '').trim() !== '');
    field.classList.toggle('is-invalid', !valid);
    var feedback = field.nextElementSibling;
    if (!feedback || !feedback.classList || !feedback.classList.contains('invalid-feedback')) {
      feedback = document.createElement('div');
      feedback.className = 'invalid-feedback';
      field.insertAdjacentElement('afterend', feedback);
    }
    if (!valid) {
      feedback.textContent = field.validationMessage || 'Проверьте корректность значения.';
    }
  }

  function bindForm(form) {
    if (!form) return;
    form.setAttribute('novalidate', 'novalidate');

    form.addEventListener('submit', function (event) {
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
      }
      form.querySelectorAll('input,select,textarea').forEach(setFieldState);
      form.classList.add('was-validated');
    });

    form.querySelectorAll('input,select,textarea').forEach(function (field) {
      field.addEventListener('input', function () {
        setFieldState(field);
      });
      field.addEventListener('blur', function () {
        setFieldState(field);
      });
    });
  }

  function init() {
    document.querySelectorAll('form').forEach(bindForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
