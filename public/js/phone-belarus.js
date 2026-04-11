/**
 * Поле телефона (код 375): только цифры при вводе, без «+» в поле; на blur — 375 + 9 цифр.
 * Помечайте поле: data-phone-by="1"
 */
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /** Оставить только цифры; до 12 если начинается с 375, иначе до 9 (национальная часть). */
  function sanitizePhoneInput(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('375') === 0) {
      return d.slice(0, 12);
    }
    return d.slice(0, 9);
  }

  /** Пустое поле не трогаем; 9 цифр → 375…; 375 + 9 цифр → без изменений длины. */
  function normalizePhoneBlur(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 9) return '375' + d;
    if (d.length === 12 && d.indexOf('375') === 0) return d;
    return d;
  }

  function bindPhoneField(el) {
    el.addEventListener('input', function () {
      var next = sanitizePhoneInput(this.value);
      if (next !== this.value) this.value = next;
    });
    el.addEventListener('blur', function () {
      var next = normalizePhoneBlur(this.value);
      if (next !== this.value) this.value = next;
    });
  }

  onReady(function () {
    document.querySelectorAll('input[data-phone-by="1"]').forEach(bindPhoneField);
  });
})();
