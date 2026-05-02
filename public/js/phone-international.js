/**
 * Телефон: код страны + национальная часть, в скрытое name=phone — только цифры (CC + national).
 * data-phone-intl на обёртке .mb-3
 */
(function () {
  'use strict';

  var RULES = [
    { code: '375', len: 9, placeholder: '(29) 123-45-67', format: formatBY },
    { code: '380', len: 9, placeholder: '(50) 123-45-67', format: formatBY },
    { code: '371', len: 8, placeholder: '21 234 567', format: format8 },
    { code: '370', len: 8, placeholder: '612 34567', format: format8 },
    { code: '48', len: 9, placeholder: '512 345 678', format: formatPL },
    { code: '7', len: 10, placeholder: '(916) 123-45-67', format: formatRU },
  ];

  function ruleByCode(code) {
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].code === code) return RULES[i];
    }
    return RULES[0];
  }

  function formatBY(digits) {
    var s = digits.replace(/\D/g, '').slice(0, 9);
    if (s.length <= 2) return s;
    var out = '(' + s.slice(0, 2) + ')';
    if (s.length <= 5) return out + ' ' + s.slice(2);
    if (s.length <= 7) return out + ' ' + s.slice(2, 5) + '-' + s.slice(5);
    return out + ' ' + s.slice(2, 5) + '-' + s.slice(5, 7) + '-' + s.slice(7);
  }

  function formatRU(digits) {
    var s = digits.replace(/\D/g, '').slice(0, 10);
    if (s.length <= 3) return s;
    var out = '(' + s.slice(0, 3) + ')';
    if (s.length <= 6) return out + ' ' + s.slice(3);
    if (s.length <= 8) return out + ' ' + s.slice(3, 6) + '-' + s.slice(6);
    return out + ' ' + s.slice(3, 6) + '-' + s.slice(6, 8) + '-' + s.slice(8);
  }

  function format8(digits) {
    var s = digits.replace(/\D/g, '').slice(0, 8);
    if (s.length <= 2) return s;
    if (s.length <= 5) return s.slice(0, 2) + ' ' + s.slice(2);
    return s.slice(0, 2) + ' ' + s.slice(2, 5) + ' ' + s.slice(5);
  }

  function formatPL(digits) {
    var s = digits.replace(/\D/g, '').slice(0, 9);
    if (s.length <= 3) return s;
    if (s.length <= 6) return s.slice(0, 3) + ' ' + s.slice(3);
    return s.slice(0, 3) + ' ' + s.slice(3, 6) + ' ' + s.slice(6);
  }

  function splitStoredDigits(fullDigits) {
    var d = String(fullDigits || '').replace(/\D/g, '');
    if (!d) return { code: '375', national: '' };
    for (var i = 0; i < RULES.length; i++) {
      var c = RULES[i].code;
      if (d.indexOf(c) === 0) {
        return { code: c, national: d.slice(c.length) };
      }
    }
    if (d.length === 9) return { code: '375', national: d };
    return { code: '375', national: '' };
  }

  function bindIntlBlock(wrap) {
    var prefix = wrap.getAttribute('data-phone-prefix') || 'phone';
    var hidden = document.getElementById(prefix + '_full');
    var sel = document.getElementById(prefix + '_cc');
    var local = document.getElementById(prefix + '_local');
    if (!hidden || !sel || !local) return;

    function applyRule() {
      var r = ruleByCode(sel.value);
      local.placeholder = r.placeholder;
      local.setCustomValidity('');
    }

    function formatLocal() {
      var r = ruleByCode(sel.value);
      var raw = local.value.replace(/\D/g, '').slice(0, r.len);
      var formatted = r.format(raw);
      if (formatted !== local.value) local.value = formatted;
      hidden.value = sel.value + raw;
    }

    function initFromHidden() {
      var sp = splitStoredDigits(hidden.value);
      sel.value = sp.code;
      applyRule();
      if (sp.national) {
        var r = ruleByCode(sp.code);
        local.value = r.format(sp.national.replace(/\D/g, ''));
      } else {
        local.value = '';
      }
      hidden.value = sel.value + local.value.replace(/\D/g, '');
    }

    sel.addEventListener('change', function () {
      local.value = '';
      applyRule();
      formatLocal();
    });

    local.addEventListener('input', formatLocal);
    local.addEventListener('blur', formatLocal);

    var form = wrap.closest('form');
    if (form) {
      form.addEventListener(
        'submit',
        function (ev) {
          formatLocal();
          var r = ruleByCode(sel.value);
          var raw = local.value.replace(/\D/g, '');
          if (local.required && raw.length === 0) {
            local.setCustomValidity('Укажите номер телефона');
            local.reportValidity();
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          if (raw.length !== r.len) {
            local.setCustomValidity('Неверная длина номера для выбранного кода');
            local.reportValidity();
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          local.setCustomValidity('');
          hidden.value = r.code + raw;
        },
        true
      );
    }

    initFromHidden();
    applyRule();
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    document.querySelectorAll('[data-phone-intl]').forEach(bindIntlBlock);
  });
})();
