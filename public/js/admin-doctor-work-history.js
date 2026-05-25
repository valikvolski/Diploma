/**
 * Динамическая «История работы» в форме врача + превью стажа.
 */
(function () {
  'use strict';

  function todayYmd() {
    var n = new Date();
    return (
      n.getFullYear() +
      '-' +
      String(n.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(n.getDate()).padStart(2, '0')
    );
  }

  function parseYmd(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) return null;
    return d;
  }

  function periodMonths(startYmd, endYmd) {
    var start = parseYmd(startYmd);
    if (!start) return 0;
    var end = endYmd ? parseYmd(endYmd) : new Date();
    if (!end || end < start) return 0;
    var months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (end.getDate() < start.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function totalYears(entries) {
    var total = entries.reduce(function (sum, e) {
      return sum + periodMonths(e.start_date, e.is_current ? null : e.end_date);
    }, 0);
    return Math.max(0, Math.round(total / 12));
  }

  function expWord(n) {
    var y10 = n % 10;
    var y100 = n % 100;
    if (y10 === 1 && y100 !== 11) return 'год';
    if (y10 >= 2 && y10 <= 4 && (y100 < 10 || y100 >= 20)) return 'года';
    return 'лет';
  }

  function clampDateValue(input, min, max) {
    if (!input || !input.value) return;
    if (max && input.value > max) input.value = max;
    if (min && input.value < min) input.value = min;
  }

  function applyDateLimits(rowEl) {
    var today = todayYmd();
    var startInput = rowEl.querySelector('.js-work-start');
    var endInput = rowEl.querySelector('.js-work-end');
    var currentCb = rowEl.querySelector('.js-work-current');

    if (startInput) {
      startInput.max = today;
      clampDateValue(startInput, null, today);
    }

    if (endInput && !endInput.disabled) {
      endInput.max = today;
      if (startInput && startInput.value) {
        endInput.min = startInput.value;
      } else {
        endInput.removeAttribute('min');
      }
      clampDateValue(endInput, startInput ? startInput.value : null, today);
    }
  }

  function rowTemplate(idx, row) {
    row = row || {};
    var org = row.organization_name || '';
    var start = row.start_date || '';
    var end = row.end_date || '';
    var isCurrent = !end && !!start;
    var today = todayYmd();
    return (
      '<div class="admin-work-history-row" data-work-row="' +
      idx +
      '">' +
      '<div class="admin-work-history-row__head d-flex justify-content-between align-items-center gap-2 mb-3">' +
      '<span class="admin-work-history-row__badge">Период ' +
      (idx + 1) +
      '</span>' +
      '<button type="button" class="btn btn-link btn-sm admin-work-history-remove js-work-remove" title="Удалить период" aria-label="Удалить период">' +
      '<i class="bi bi-x-lg" aria-hidden="true"></i><span>Убрать</span></button></div>' +
      '<div class="mb-2">' +
      '<label class="form-label small fw-semibold mb-1">Организация</label>' +
      '<input type="text" class="form-control form-control-sm js-work-org" maxlength="200" value="' +
      escapeAttr(org) +
      '" placeholder="Название клиники или организации" required />' +
      '</div>' +
      '<div class="row g-2">' +
      '<div class="col-md-6">' +
      '<label class="form-label small fw-semibold mb-1">Дата начала</label>' +
      '<input type="date" class="form-control form-control-sm js-work-start" value="' +
      escapeAttr(start) +
      '" max="' +
      today +
      '" required />' +
      '</div>' +
      '<div class="col-md-6">' +
      '<label class="form-label small fw-semibold mb-1">Дата окончания</label>' +
      '<input type="date" class="form-control form-control-sm js-work-end" value="' +
      escapeAttr(end) +
      '" max="' +
      today +
      '" ' +
      (isCurrent ? 'disabled' : '') +
      ' />' +
      '<div class="form-check mt-2">' +
      '<input class="form-check-input js-work-current" type="checkbox" id="workCurrent' +
      idx +
      '" ' +
      (isCurrent ? 'checked' : '') +
      ' />' +
      '<label class="form-check-label small" for="workCurrent' +
      idx +
      '">По настоящее время</label>' +
      '</div></div></div></div>'
    );
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function collectRows(root) {
    var rows = [];
    root.querySelectorAll('[data-work-row]').forEach(function (el) {
      var org = (el.querySelector('.js-work-org') || {}).value || '';
      var start = (el.querySelector('.js-work-start') || {}).value || '';
      var endInput = el.querySelector('.js-work-end');
      var current = (el.querySelector('.js-work-current') || {}).checked;
      var end = current ? '' : (endInput && endInput.value) || '';
      org = org.trim();
      if (!org || !start) return;
      rows.push({
        organization_name: org,
        start_date: start,
        end_date: end || null,
        is_current: current,
      });
    });
    return rows;
  }

  function updatePreview(root) {
    var yearsEl = document.getElementById('calculatedExperienceYears');
    if (!yearsEl) return;
    var years = totalYears(collectRows(root));
    yearsEl.textContent = years > 0 ? years + ' ' + expWord(years) : '0 лет';
  }

  function syncJson(root) {
    var hidden = document.getElementById('workHistoryJson');
    if (!hidden) return;
    var rows = collectRows(root).map(function (r) {
      return {
        organization_name: r.organization_name,
        start_date: r.start_date,
        end_date: r.end_date,
        is_current: r.is_current,
      };
    });
    hidden.value = JSON.stringify(rows);
  }

  function onRowInputsChange(rowEl, root) {
    applyDateLimits(rowEl);
    updatePreview(root);
    syncJson(root);
  }

  function bindRow(rowEl, root) {
    var endInput = rowEl.querySelector('.js-work-end');
    var currentCb = rowEl.querySelector('.js-work-current');
    if (currentCb && endInput) {
      currentCb.addEventListener('change', function () {
        if (currentCb.checked) {
          endInput.value = '';
          endInput.disabled = true;
        } else {
          endInput.disabled = false;
        }
        onRowInputsChange(rowEl, root);
      });
    }
    rowEl.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        onRowInputsChange(rowEl, root);
      });
      inp.addEventListener('input', function () {
        onRowInputsChange(rowEl, root);
      });
    });
    var removeBtn = rowEl.querySelector('.js-work-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        rowEl.remove();
        renumberRows(root);
        updatePreview(root);
        syncJson(root);
      });
    }
    applyDateLimits(rowEl);
  }

  function renumberRows(root) {
    root.querySelectorAll('[data-work-row]').forEach(function (el, i) {
      el.setAttribute('data-work-row', String(i));
      var badge = el.querySelector('.admin-work-history-row__badge');
      if (badge) badge.textContent = 'Период ' + (i + 1);
    });
  }

  function addRow(root, data) {
    var list = document.getElementById('workHistoryRows');
    if (!list) return;
    var idx = list.querySelectorAll('[data-work-row]').length;
    var wrap = document.createElement('div');
    wrap.innerHTML = rowTemplate(idx, data);
    var rowEl = wrap.firstElementChild;
    list.appendChild(rowEl);
    bindRow(rowEl, root);
    updatePreview(root);
    syncJson(root);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('adminWorkHistoryRoot');
    if (!root) return;

    var initial = [];
    try {
      var jsonEl = document.getElementById('admin-work-history-initial');
      if (jsonEl && jsonEl.textContent) initial = JSON.parse(jsonEl.textContent);
    } catch (_) {}

    var list = document.getElementById('workHistoryRows');
    if (list) list.innerHTML = '';

    if (initial.length) {
      initial.forEach(function (row) {
        addRow(root, row);
      });
    } else {
      addRow(root, {});
    }

    var addBtn = document.getElementById('workHistoryAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addRow(root, {});
      });
    }

    var form = document.getElementById('adminDoctorMainForm');
    if (form) {
      form.addEventListener('submit', function () {
        root.querySelectorAll('[data-work-row]').forEach(function (rowEl) {
          applyDateLimits(rowEl);
        });
        syncJson(root);
      });
    }

    updatePreview(root);
    syncJson(root);
  });
})();
