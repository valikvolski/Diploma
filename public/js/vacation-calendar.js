/**
 * Inline date / range picker for doctor time-off (same visual language as booking calendar).
 * Selection persists across month navigation; syncs hidden inputs exception_date + date_to.
 */
(function () {
  const MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toYmd(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function parseYmd(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const p = v.split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }

  function cmpYmd(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function mondayOffset(jsDaySun0) {
    return jsDaySun0 === 0 ? 6 : jsDaySun0 - 1;
  }

  function todayYmd() {
    const n = new Date();
    return toYmd(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function initVacationCalendar(root) {
    if (!root || root.dataset.vacCalInit === '1') return;
    root.dataset.vacCalInit = '1';

    const minYmd = root.getAttribute('data-min') || todayYmd();
    const inputFrom = document.getElementById(root.getAttribute('data-input-from') || 'excDateFrom');
    const inputTo = document.getElementById(root.getAttribute('data-input-to') || 'excDateTo');
    const modeSingle = document.getElementById('modeSingle');
    const modePeriod = document.getElementById('modePeriod');
    const summaryEl = root.querySelector('[data-vac-summary]');

    const titleEl = root.querySelector('[data-vac-title]');
    const gridEl = root.querySelector('[data-vac-grid]');
    const prevBtn = root.querySelector('[data-vac-prev]');
    const nextBtn = root.querySelector('[data-vac-next]');

    if (!inputFrom || !inputTo || !gridEl || !titleEl) return;

    // Не даём кликам уйти выше (модалки / document), чтобы навигация по месяцам не закрывала UI.
    root.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    root.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    let viewY;
    let viewM;
    let anchorStart = inputFrom.value && cmpYmd(inputFrom.value, minYmd) >= 0 ? inputFrom.value : '';
    let anchorEnd =
      inputTo.value && cmpYmd(inputTo.value, minYmd) >= 0 ? inputTo.value : '';

    function isPeriod() {
      return modePeriod && modePeriod.checked;
    }

    function normalizeRange() {
      if (!anchorStart) {
        anchorEnd = '';
        return;
      }
      if (!isPeriod()) {
        anchorEnd = anchorStart;
        return;
      }
      if (!anchorEnd) return;
      if (cmpYmd(anchorEnd, anchorStart) < 0) {
        const t = anchorStart;
        anchorStart = anchorEnd;
        anchorEnd = t;
      }
    }

    function syncInputs() {
      normalizeRange();
      inputFrom.value = anchorStart || '';
      inputTo.value = isPeriod() ? anchorEnd || '' : anchorStart || '';
      inputFrom.dispatchEvent(new Event('change', { bubbles: true }));
      inputTo.dispatchEvent(new Event('change', { bubbles: true }));
      updateSummary();
    }

    function updateSummary() {
      if (!summaryEl) return;
      if (!anchorStart) {
        summaryEl.textContent = 'Выберите дату в календаре';
        return;
      }
      if (!isPeriod() || !anchorEnd || anchorEnd === anchorStart) {
        summaryEl.textContent = 'Выбрано: ' + humanDate(anchorStart);
        return;
      }
      summaryEl.textContent = 'Период: ' + humanDate(anchorStart) + ' — ' + humanDate(anchorEnd);
    }

    function humanDate(ymd) {
      const p = parseYmd(ymd);
      if (!p) return ymd;
      return pad2(p.d) + '.' + pad2(p.m) + '.' + p.y;
    }

    function cellState(ymd) {
      if (cmpYmd(ymd, minYmd) < 0) return { kind: 'past' };
      if (!anchorStart) return { kind: 'free' };
      if (!isPeriod()) {
        if (ymd === anchorStart) return { kind: 'single' };
        return { kind: 'free' };
      }
      if (!anchorEnd || anchorEnd === anchorStart) {
        if (ymd === anchorStart) return { kind: 'start' };
        return { kind: 'free' };
      }
      if (ymd === anchorStart) return { kind: 'start' };
      if (ymd === anchorEnd) return { kind: 'end' };
      if (cmpYmd(ymd, anchorStart) > 0 && cmpYmd(ymd, anchorEnd) < 0) return { kind: 'between' };
      return { kind: 'free' };
    }

    function render() {
      titleEl.textContent = MONTHS[viewM - 1] + ' ' + viewY;
      const first = new Date(viewY, viewM - 1, 1);
      const dim = new Date(viewY, viewM, 0).getDate();
      const startPad = mondayOffset(first.getDay());
      const totalCells = Math.ceil((startPad + dim) / 7) * 7;
      gridEl.innerHTML = '';

      for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';

        if (i < startPad || i >= startPad + dim) {
          cell.className = 'booking-cal-cell booking-cal-empty';
          cell.disabled = true;
          gridEl.appendChild(cell);
          continue;
        }

        const dayNum = i - startPad + 1;
        const ymd = toYmd(viewY, viewM, dayNum);
        const st = cellState(ymd);
        const cls = ['booking-cal-cell', 'vac-cal-cell'];

        if (st.kind === 'past') {
          cls.push('past');
          cell.disabled = true;
        } else {
          cls.push('vac-cal-selectable');
          cell.addEventListener('click', function () {
            onPick(ymd);
          });
        }

        if (st.kind === 'single' || st.kind === 'start' || st.kind === 'end') cls.push('selected');
        if (st.kind === 'between') cls.push('vac-cal-in-range');

        cell.className = cls.join(' ');
        cell.setAttribute('data-date', ymd);

        const monShort = MONTHS[viewM - 1].slice(0, 3).toLowerCase() + '.';
        cell.innerHTML =
          '<span class="booking-cal-daynum">' +
          dayNum +
          '</span>' +
          '<span class="booking-cal-sub">' +
          monShort +
          '</span>';

        gridEl.appendChild(cell);
      }
    }

    function onPick(ymd) {
      if (cmpYmd(ymd, minYmd) < 0) return;

      if (!isPeriod()) {
        anchorStart = ymd;
        anchorEnd = ymd;
        syncInputs();
        render();
        return;
      }

      if (!anchorStart || (anchorStart && anchorEnd && anchorEnd !== anchorStart)) {
        anchorStart = ymd;
        anchorEnd = '';
        syncInputs();
        render();
        return;
      }

      if (anchorStart && (!anchorEnd || anchorEnd === anchorStart)) {
        anchorEnd = ymd;
        if (cmpYmd(anchorEnd, anchorStart) < 0) {
          const t = anchorStart;
          anchorStart = anchorEnd;
          anchorEnd = t;
        }
        syncInputs();
        render();
      }
    }

    function ensureViewMonth() {
      const target = anchorStart || minYmd;
      const p = parseYmd(target);
      if (p) {
        viewY = p.y;
        viewM = p.m;
      } else {
        const n = new Date();
        viewY = n.getFullYear();
        viewM = n.getMonth() + 1;
      }
    }

    function onModeChange() {
      normalizeRange();
      if (!isPeriod()) {
        anchorEnd = anchorStart;
        inputTo.required = false;
      } else {
        inputTo.required = true;
        if (anchorStart && !anchorEnd) anchorEnd = '';
      }
      syncInputs();
      render();
    }

    ensureViewMonth();
    syncInputs();
    render();

    if (modeSingle) modeSingle.addEventListener('change', onModeChange);
    if (modePeriod) modePeriod.addEventListener('change', onModeChange);

    function onNavPrev(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      viewM -= 1;
      if (viewM < 1) {
        viewM = 12;
        viewY -= 1;
      }
      queueMicrotask(function () {
        render();
      });
    }
    function onNavNext(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      viewM += 1;
      if (viewM > 12) {
        viewM = 1;
        viewY += 1;
      }
      queueMicrotask(function () {
        render();
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', onNavPrev);
      prevBtn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', onNavNext);
      nextBtn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
    }

    const modal = root.closest('.modal');
    if (modal) {
      modal.addEventListener('shown.bs.modal', function () {
        ensureViewMonth();
        if (inputFrom.value) {
          const p = parseYmd(inputFrom.value);
          if (p) {
            viewY = p.y;
            viewM = p.m;
          }
        }
        anchorStart = inputFrom.value || '';
        anchorEnd = inputTo.value || '';
        normalizeRange();
        render();
        updateSummary();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-vacation-calendar]').forEach(initVacationCalendar);
  });
})();
