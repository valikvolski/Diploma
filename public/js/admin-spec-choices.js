/**
 * Choices.js: admin specializations multi-select with compat_group locking.
 * Disables incompatible options when one+ spec selected; re-enables when cleared.
 */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var cfgEl = document.getElementById('admin-spec-choices-config');
    var multiEl = document.getElementById('admin-spec-multi');
    var primaryEl = document.getElementById('admin-spec-primary');
    var formEl = multiEl && multiEl.closest('form');
    var errEl = document.getElementById('spec-field-error');
    var hintEl = document.getElementById('specCompatCompact');

    if (!cfgEl || !multiEl || !primaryEl || typeof Choices === 'undefined') return;

    var cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    var SPEC_META = cfg.meta || [];
    var metaById = {};
    SPEC_META.forEach(function (s) {
      metaById[String(s.id)] = s;
    });

    var rebuilding = false;

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
        containerOuter: 'choices choices-spec-multi choices--admin-spec',
      },
    });

    var primary = new Choices(primaryEl, {
      searchEnabled: false,
      shouldSort: false,
      placeholder: true,
      placeholderValue: 'Основная',
      itemSelectText: '',
      allowHTML: false,
      classNames: {
        containerOuter: 'choices choices-spec-primary choices--admin-spec-primary',
      },
    });

    function selectedIds() {
      return multi.getValue(true).map(String);
    }

    function primaryValueRaw() {
      var v = primary.getValue(true);
      if (v == null || v === '') return '';
      if (Array.isArray(v)) return v.length ? String(v[0]) : '';
      return String(v);
    }

    function getLockGroup(ids) {
      if (!ids.length) return null;
      var groups = new Set();
      ids.forEach(function (id) {
        var row = metaById[id];
        if (row) groups.add(row.g || 'therapy');
      });
      if (groups.size > 1) return '__CONFLICT__';
      return groups.values().next().value;
    }

    function validateClient() {
      var ids = selectedIds().map(function (x) {
        return parseInt(x, 10);
      }).filter(function (n) {
        return !isNaN(n);
      });
      if (!ids.length) {
        return { ok: false, message: 'Выберите хотя бы одну специализацию.' };
      }
      var g = getLockGroup(ids.map(String));
      if (g === '__CONFLICT__') {
        return { ok: false, message: 'Нельзя сочетать специализации из разных групп. Оставьте профили одной группы.' };
      }
      return { ok: true };
    }

    function setFieldError(msg) {
      if (!errEl) return;
      if (msg) {
        errEl.textContent = msg;
        errEl.classList.remove('d-none');
      } else {
        errEl.textContent = '';
        errEl.classList.add('d-none');
      }
    }

    function updateCompactHint() {
      if (!hintEl) return;
      var ids = selectedIds();
      var lock = getLockGroup(ids);
      if (!ids.length) {
        hintEl.textContent = '';
        hintEl.classList.add('d-none');
        return;
      }
      hintEl.classList.remove('d-none');
      if (lock === '__CONFLICT__') {
        hintEl.textContent = 'Удалите лишние специализации — допустима только одна группа совместимости.';
        hintEl.classList.remove('text-muted');
        hintEl.classList.add('text-danger');
        return;
      }
      hintEl.classList.add('text-muted');
      hintEl.classList.remove('text-danger');
      hintEl.textContent = 'Доступны совместимые специализации той же группы.';
    }

    function buildChoiceList() {
      var ids = selectedIds();
      var lock = getLockGroup(ids);
      return SPEC_META.map(function (s) {
        var id = String(s.id);
        var isSelected = ids.indexOf(id) >= 0;
        var disabled = false;
        if (lock === '__CONFLICT__') {
          disabled = !isSelected;
        } else if (lock && !isSelected) {
          disabled = (s.g || 'therapy') !== lock;
        }
        return { value: id, label: s.name, selected: isSelected, disabled: disabled };
      });
    }

    function applyCompatToMulti() {
      if (rebuilding) return;
      rebuilding = true;
      try {
        var prevPrimary = primaryValueRaw();
        var list = buildChoiceList();
        multi.clearStore();
        multi.setChoices(list, 'value', 'label', true);
        syncPrimaryChoices(prevPrimary);
        updateCompactHint();
        setFieldError('');
      } finally {
        rebuilding = false;
      }
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
          : primaryValueRaw();

      primary.clearStore();
      if (!items.length) {
        primary.setChoices(
          [{ value: '', label: '— Сначала выберите специализации —', selected: true, disabled: false }],
          'value',
          'label',
          true
        );
        return;
      }

      primary.setChoices(
        [{ value: '', label: '— Не выбрано —', selected: false, disabled: false }].concat(items),
        'value',
        'label',
        true
      );

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

    multiEl.addEventListener('change', function () {
      if (rebuilding) return;
      applyCompatToMulti();
    });

    if (formEl) {
      formEl.addEventListener('submit', function (e) {
        var v = validateClient();
        if (!v.ok) {
          e.preventDefault();
          setFieldError(v.message);
        }
      });
    }

    var initPrimary =
      cfg.initialPrimary != null && String(cfg.initialPrimary).trim() !== ''
        ? String(cfg.initialPrimary)
        : '';

    applyCompatToMulti();
    if (initPrimary) {
      try {
        primary.setChoiceByValue(initPrimary);
      } catch (e) {
        /* ignore */
      }
    }
    updateCompactHint();
  });
})();
