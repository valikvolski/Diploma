(function () {
  const MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toYmd(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function parseYmd(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const p = v.split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }

  function fmtRu(v) {
    const p = parseYmd(v);
    if (!p) return '';
    return pad2(p.d) + '.' + pad2(p.m) + '.' + p.y;
  }

  function mondayOffset(jsDaySun0) {
    return jsDaySun0 === 0 ? 6 : jsDaySun0 - 1;
  }

  function todayYmd() {
    const n = new Date();
    return toYmd(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function inRange(dateYmd, min, max) {
    if (min && dateYmd < min) return false;
    if (max && dateYmd > max) return false;
    return true;
  }

  function yearBounds(min, max) {
    const lo = min ? parseYmd(min) : null;
    const hi = max ? parseYmd(max) : null;
    const minY = lo ? lo.y : 1900;
    const maxY = hi ? hi.y : new Date().getFullYear();
    return { minY, maxY, min, max };
  }

  function initUnifiedDateField(source) {
    if (source.dataset.ucInit === '1') return;
    source.dataset.ucInit = '1';

    const min = source.getAttribute('min') || '';
    const max = source.getAttribute('max') || '';
    const autoSubmit = source.getAttribute('data-auto-submit') === '1';
    const required = source.required;
    const yearMonthPickers = source.getAttribute('data-uc-year-month') === '1';
    const bounds = yearBounds(min, max);

    const wrapper = document.createElement('div');
    wrapper.className = 'uc-field';

    const display = document.createElement('input');
    display.type = 'text';
    display.className = source.className;
    display.classList.add('uc-display');
    display.placeholder = 'Выберите дату';
    display.readOnly = true;
    if (source.id) display.id = source.id + '_display';
    if (source.getAttribute('aria-label')) {
      display.setAttribute('aria-label', source.getAttribute('aria-label'));
    }

    const popup = document.createElement('div');
    popup.className = 'uc-popup d-none';

    // Клики внутри попапа не должны всплывать к document — иначе после render()
    // цель события отсоединяется от DOM и срабатывает «клик снаружи» → попап закрывается.
    popup.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    popup.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Keep source input for form submit/validation/listeners.
    source.classList.add('uc-source');
    source.type = 'hidden';
    source.removeAttribute('id');
    if (required) source.required = true;

    source.parentNode.insertBefore(wrapper, source);
    wrapper.appendChild(display);
    wrapper.appendChild(source);
    wrapper.appendChild(popup);

    let state = parseYmd(source.value);
    if (!state) {
      const n = new Date();
      state = { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
    }

    function setValue(ymd) {
      source.value = ymd;
      display.value = fmtRu(ymd);
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
      if (autoSubmit && source.form) source.form.submit();
    }

    function clampStateToBounds() {
      if (state.y < bounds.minY) state.y = bounds.minY;
      if (state.y > bounds.maxY) state.y = bounds.maxY;
      const dimNow = new Date(state.y, state.m, 0).getDate();
      if (state.d > dimNow) state.d = dimNow;
      const cur = toYmd(state.y, state.m, state.d);
      if (min && cur < min) {
        const p = parseYmd(min);
        if (p) {
          state.y = p.y;
          state.m = p.m;
          state.d = p.d;
        }
      }
      if (max && cur > max) {
        const p = parseYmd(max);
        if (p) {
          state.y = p.y;
          state.m = p.m;
          state.d = p.d;
        }
      }
    }

    function render() {
      clampStateToBounds();
      const first = new Date(state.y, state.m - 1, 1);
      const dim = new Date(state.y, state.m, 0).getDate();
      const startPad = mondayOffset(first.getDay());
      const totalCells = Math.ceil((startPad + dim) / 7) * 7;
      const selected = source.value || '';
      const today = todayYmd();

      let html = '';
      html += '<div class="uc-head' + (yearMonthPickers ? ' uc-head--ym' : '') + '">';
      html += '<button type="button" class="btn btn-outline-primary btn-sm uc-nav" data-nav="-1" aria-label="Предыдущий месяц"><i class="bi bi-chevron-left"></i></button>';
      if (yearMonthPickers) {
        html += '<div class="uc-ym-selects">';
        html += '<select class="form-select form-select-sm uc-select-month" aria-label="Месяц">';
        for (let mi = 1; mi <= 12; mi++) {
          html += '<option value="' + mi + '"' + (mi === state.m ? ' selected' : '') + '>' + MONTHS[mi - 1] + '</option>';
        }
        html += '</select>';
        html += '<select class="form-select form-select-sm uc-select-year" aria-label="Год">';
        for (let yy = bounds.maxY; yy >= bounds.minY; yy--) {
          html += '<option value="' + yy + '"' + (yy === state.y ? ' selected' : '') + '>' + yy + '</option>';
        }
        html += '</select></div>';
      } else {
        html += '<strong class="uc-month-title">' + MONTHS[state.m - 1] + ' ' + state.y + '</strong>';
      }
      html += '<button type="button" class="btn btn-outline-primary btn-sm uc-nav" data-nav="1" aria-label="Следующий месяц"><i class="bi bi-chevron-right"></i></button>';
      html += '</div>';
      html += '<div class="uc-week">' + WEEKDAYS.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
      html += '<div class="uc-grid">';

      for (let i = 0; i < totalCells; i++) {
        if (i < startPad || i >= startPad + dim) {
          html += '<button type="button" class="uc-day uc-empty" tabindex="-1" disabled></button>';
          continue;
        }
        const day = i - startPad + 1;
        const ymd = toYmd(state.y, state.m, day);
        const disabled = !inRange(ymd, min, max);
        const cls = [
          'uc-day',
          disabled ? 'disabled' : '',
          ymd === selected ? 'selected' : '',
          ymd === today ? 'today' : ''
        ].join(' ').trim();
        html += '<button type="button" class="' + cls + '" data-date="' + ymd + '"' + (disabled ? ' disabled' : '') + '>' + day + '</button>';
      }

      html += '</div>';
      popup.innerHTML = html;

      popup.querySelectorAll('.uc-nav').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const step = Number(btn.getAttribute('data-nav'));
          state.m += step;
          if (state.m < 1) { state.m = 12; state.y -= 1; }
          if (state.m > 12) { state.m = 1; state.y += 1; }
          clampStateToBounds();
          queueMicrotask(function () {
            render();
          });
        });
      });

      if (yearMonthPickers) {
        const selM = popup.querySelector('.uc-select-month');
        const selY = popup.querySelector('.uc-select-year');
        if (selM) {
          selM.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          selM.addEventListener('click', function (e) { e.stopPropagation(); });
          selM.addEventListener('change', function (ev) {
            ev.stopPropagation();
            state.m = parseInt(selM.value, 10) || 1;
            clampStateToBounds();
            queueMicrotask(function () { render(); });
          });
        }
        if (selY) {
          selY.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          selY.addEventListener('click', function (e) { e.stopPropagation(); });
          selY.addEventListener('change', function (ev) {
            ev.stopPropagation();
            state.y = parseInt(selY.value, 10) || bounds.minY;
            clampStateToBounds();
            queueMicrotask(function () { render(); });
          });
        }
      }

      popup.querySelectorAll('.uc-day[data-date]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const ymd = btn.getAttribute('data-date');
          setValue(ymd);
          closePopup();
        });
      });
    }

    function openPopup() {
      const sel = parseYmd(source.value);
      if (sel) {
        state.y = sel.y;
        state.m = sel.m;
        state.d = sel.d;
      }
      popup.classList.remove('d-none');
      render();
    }

    function closePopup() {
      popup.classList.add('d-none');
    }

    display.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    display.addEventListener('click', function (e) {
      e.stopPropagation();
      if (popup.classList.contains('d-none')) openPopup();
      else closePopup();
    });

    document.addEventListener('click', function (e) {
      if (!wrapper.contains(e.target)) closePopup();
    });

    if (source.value) display.value = fmtRu(source.value);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[type="date"][data-unified-calendar="1"]').forEach(initUnifiedDateField);
  });
})();

