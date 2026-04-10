/**
 * Choices.js: admin multi-select specializations + primary single-select sync.
 * Expects #admin-spec-choices-config (JSON), #admin-spec-multi, #admin-spec-primary,
 * optional #specCompatHint / #specCompatHintText.
 */
(function () {
  var GROUP_RU = {
    therapy: 'терапия и смежные консервативные специальности',
    surgery: 'хирургия и операционные профили',
    ophthalmology: 'офтальмология',
    dental: 'стоматология',
    ent: 'ЛОР',
    imaging: 'инструментальная диагностика (УЗИ, рентген)',
    gynecology: 'акушерство и гинекология',
  };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var cfgEl = document.getElementById('admin-spec-choices-config');
    var multiEl = document.getElementById('admin-spec-multi');
    var primaryEl = document.getElementById('admin-spec-primary');
    if (!cfgEl || !multiEl || !primaryEl || typeof Choices === 'undefined') return;

    var cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    var SPEC_META = cfg.meta || [];
    var hintText = document.getElementById('specCompatHintText');
    var hintWrap = document.getElementById('specCompatHint');

    var multi = new Choices(multiEl, {
      removeItemButton: true,
      searchEnabled: true,
      shouldSort: false,
      placeholder: true,
      placeholderValue: 'Выберите специализации',
      noResultsText: 'Ничего не найдено',
      itemSelectText: '',
      searchPlaceholderValue: 'Поиск…',
      allowHTML: false,
      classNames: {
        containerOuter: 'choices choices-spec-multi',
      },
    });

    var primary = new Choices(primaryEl, {
      searchEnabled: true,
      shouldSort: false,
      placeholder: true,
      placeholderValue: 'Основная специализация',
      itemSelectText: '',
      searchPlaceholderValue: 'Поиск…',
      allowHTML: false,
      noResultsText: 'Ничего не найдено',
      classNames: {
        containerOuter: 'choices choices-spec-primary',
      },
    });

    function selectedIds() {
      return multi.getValue(true).map(String);
    }

    function syncPrimaryChoices(preserveValue) {
      var ids = selectedIds();
      var items = SPEC_META.filter(function (s) {
        return ids.indexOf(String(s.id)) >= 0;
      }).map(function (s) {
        return { value: String(s.id), label: s.name };
      });

      var prev =
        preserveValue !== undefined && preserveValue !== null && String(preserveValue).trim() !== ''
          ? String(preserveValue)
          : String(primary.getValue(true) || '');

      primary.clearStore();
      primary.setChoices(items, 'value', 'label', true);

      var next = '';
      if (prev && ids.indexOf(prev) >= 0) next = prev;
      else if (items.length) next = items[0].value;

      if (next) {
        try {
          primary.setChoiceByValue(next);
        } catch (err) {
          /* ignore */
        }
      }
    }

    function refreshHint() {
      if (!hintText || !hintWrap) return;
      var ids = selectedIds();
      var groups = new Set();
      ids.forEach(function (id) {
        var row = null;
        for (var mi = 0; mi < SPEC_META.length; mi++) {
          if (String(SPEC_META[mi].id) === String(id)) {
            row = SPEC_META[mi];
            break;
          }
        }
        if (row) groups.add(row.g || 'therapy');
      });

      if (ids.length === 0) {
        hintText.textContent = 'Выберите одну или несколько совместимых специализаций.';
        hintWrap.className = 'small mt-2 mb-0';
        return;
      }
      if (groups.size > 1) {
        hintText.textContent = 'Нельзя сочетать специализации из разных групп совместимости.';
        hintWrap.className = 'small mt-2 mb-0 text-danger';
        return;
      }
      var g = groups.values().next().value;
      var addable = SPEC_META.filter(function (s) {
        return (s.g || 'therapy') === g && ids.indexOf(String(s.id)) < 0;
      }).map(function (s) {
        return s.name;
      });
      hintWrap.className = 'small mt-2 mb-0 text-success';
      hintText.textContent =
        'Группа: «' +
        (GROUP_RU[g] || g) +
        '». Можно добавить: ' +
        (addable.length
          ? addable.slice(0, 8).join(', ') + (addable.length > 8 ? '…' : '')
          : 'все профили группы уже выбраны.');
    }

    multiEl.addEventListener('change', function () {
      var prevPrim = primary.getValue(true);
      syncPrimaryChoices(prevPrim);
      refreshHint();
    });

    var initPrimary =
      cfg.initialPrimary != null && String(cfg.initialPrimary).trim() !== ''
        ? String(cfg.initialPrimary)
        : undefined;
    syncPrimaryChoices(initPrimary);
    refreshHint();
  });
})();
