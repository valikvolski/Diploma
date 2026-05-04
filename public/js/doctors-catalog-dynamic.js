(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(last, first) {
    var l = String(last || '').trim();
    var f = String(first || '').trim();
    var v = ((l ? l.charAt(0) : '') + (f ? f.charAt(0) : '')).toUpperCase();
    return v || '?';
  }

  function expWord(n) {
    n = Number(n) || 0;
    if (n % 100 >= 11 && n % 100 <= 19) return 'лет';
    if (n % 10 === 1) return 'год';
    if (n % 10 >= 2 && n % 10 <= 4) return 'года';
    return 'лет';
  }

  function doctorCardHtml(d, selectedSpecName) {
    var avatar = '';
    if (d.avatar_path) {
      var path = '/' + String(d.avatar_path).replace(/^\/+/, '');
      avatar = '<img src="' + esc(path) + '" alt="" class="rounded-circle border" width="46" height="46" loading="lazy" style="object-fit:cover;">';
    } else if (d.avatar_url) {
      avatar = '<img src="' + esc(d.avatar_url) + '" alt="" class="rounded-circle border" width="46" height="46" loading="lazy" style="object-fit:cover;">';
    } else {
      avatar =
        '<div class="rounded-circle d-flex align-items-center justify-content-center text-white fw-semibold" style="width:46px;height:46px;background:linear-gradient(135deg,#2c7be5,#4f46e5);">' +
        esc(initials(d.last_name, d.first_name)) +
        '</div>';
    }

    var fullName = [d.last_name, d.first_name, d.middle_name || ''].join(' ').trim();
    var exp = Number(d.experience_years) > 0 ? ('Стаж: ' + Number(d.experience_years) + ' ' + expWord(d.experience_years)) : 'Стаж не указан';
    var cabinet = d.cabinet ? (' <span class="ms-2">Каб. ' + esc(d.cabinet) + '</span>') : '';
    var specLabel = selectedSpecName || d.primary_specialization || 'Специализация не указана';
    var extra = Number(d.extra_specializations_count || 0) > 0
      ? ('<span class="badge bg-light text-muted border flex-shrink-0">+' + Number(d.extra_specializations_count) + '</span>')
      : '';

    return (
      '<div class="col-12 col-md-6 col-lg-4 col-xl-3">' +
      '  <article class="card h-100 border-0 shadow-sm doctor-catalog-card">' +
      '    <div class="card-body p-3 d-flex flex-column">' +
      '      <div class="d-flex align-items-start gap-2 mb-2 min-w-0">' +
      '        <div class="flex-shrink-0">' + avatar + '</div>' +
      '        <div class="min-w-0 flex-grow-1">' +
      '          <h3 class="h6 mb-1 doctor-tile-name">' + esc(fullName) + '</h3>' +
      '          <div class="d-flex align-items-center gap-1 min-w-0">' +
      '            <span class="badge spec-badge text-truncate d-inline-block" style="max-width:100%;">' + esc(specLabel) + '</span>' +
                   extra +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="small text-muted mb-3">' + exp + cabinet + '</div>' +
      '      <div class="mt-auto"><a href="/doctors/' + Number(d.id) + '" class="btn btn-outline-primary btn-sm rounded-pill w-100">Записаться</a></div>' +
      '    </div>' +
      '  </article>' +
      '</div>'
    );
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var rootState = window.__DOCTORS_CATALOG_STATE__ || {};
    var state = {
      search: String(rootState.search || ''),
      specialization_id: String(rootState.specialization_id || ''),
      selectedSpecializationName: String(rootState.selectedSpecializationName || ''),
      page: Number(rootState.page || 1),
      totalPages: Number(rootState.totalPages || 1),
    };

    var grid = document.getElementById('catalog-doctors-grid');
    var loadMoreBtn = document.getElementById('catalog-load-more');
    var totalCountEl = document.getElementById('catalog-total-count');
    var pageIndicator = document.getElementById('catalog-page-indicator');
    var loadingEl = document.getElementById('catalog-loading');
    var specRoot = document.getElementById('catalog-spec-root');
    var specList = document.getElementById('catalog-spec-list');
    var specListWrap = document.getElementById('catalog-spec-list-wrap');
    var toggleAllBtn = document.getElementById('catalog-toggle-all-specs');
    var searchForm = document.getElementById('catalog-search-form');
    var searchInput = document.getElementById('catalog-search');
    if (!grid || !loadMoreBtn || !specList || !specRoot || !searchForm || !searchInput) return;

    var specsExpanded = specListWrap && specListWrap.classList.contains('is-expanded');

    function syncToggleAllText(expanded) {
      if (!toggleAllBtn) return;
      toggleAllBtn.textContent = expanded ? 'Свернуть' : 'Показать еще';
      toggleAllBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function rowTopsFor(elements) {
      var tops = [];
      elements.forEach(function (el) {
        var t = el.offsetTop;
        var seen = tops.some(function (x) { return Math.abs(x - t) <= 2; });
        if (!seen) tops.push(t);
      });
      tops.sort(function (a, b) { return a - b; });
      return tops;
    }

    function applyTwoRowsClamp() {
      if (!specList) return;
      var chips = Array.from(specList.querySelectorAll('.js-spec-filter'));
      chips.forEach(function (el) {
        el.classList.remove('catalog-spec-item-hidden');
      });
      if (!toggleAllBtn) return;
      if (specsExpanded) return;
      if (!chips.length) return;

      var guard = 0;
      while (guard < chips.length + 5) {
        guard += 1;
        var visibleChips = chips.filter(function (el) { return !el.classList.contains('catalog-spec-item-hidden'); });
        var rows = rowTopsFor(visibleChips.concat([toggleAllBtn]));
        if (rows.length <= 2) break;
        if (!visibleChips.length) break;
        visibleChips[visibleChips.length - 1].classList.add('catalog-spec-item-hidden');
      }
    }

    var clampTimer = null;
    function scheduleClamp() {
      if (clampTimer) clearTimeout(clampTimer);
      clampTimer = setTimeout(applyTwoRowsClamp, 120);
    }

    if (toggleAllBtn && specListWrap) {
      syncToggleAllText(specsExpanded);
      toggleAllBtn.addEventListener('click', function () {
        specsExpanded = specListWrap.classList.toggle('is-expanded');
        syncToggleAllText(specsExpanded);
        applyTwoRowsClamp();
      });
    }

    function setSpecActive(specId) {
      var links = specRoot.querySelectorAll('.js-spec-filter');
      links.forEach(function (a) {
        var current = String(a.getAttribute('data-spec-id') || '');
        var active = current === String(specId || '');
        a.classList.toggle('btn-primary', active);
        a.classList.toggle('btn-outline-primary', !active);
      });
    }

    function buildQuery(nextPage) {
      var q = new URLSearchParams();
      if (state.search) q.set('search', state.search);
      if (state.specialization_id) q.set('specialization_id', state.specialization_id);
      if (nextPage > 1) q.set('page', String(nextPage));
      return q.toString();
    }

    function updateUrl() {
      var qs = buildQuery(state.page);
      var url = '/doctors' + (qs ? ('?' + qs) : '');
      window.history.replaceState({ doctorsCatalog: true }, '', url);
    }

    function setLoading(isLoading) {
      if (loadingEl) loadingEl.classList.toggle('d-none', !isLoading);
      loadMoreBtn.disabled = !!isLoading;
      if (grid) grid.classList.toggle('catalog-grid-loading', !!isLoading);
    }

    function updateGridHtml(nextHtml, append) {
      // Keep height stable during DOM replacement to avoid jumps/flicker.
      var prevHeight = grid.offsetHeight;
      grid.style.minHeight = prevHeight > 0 ? (prevHeight + 'px') : '';
      grid.classList.add('catalog-grid-fade-out');
      window.requestAnimationFrame(function () {
        if (append) grid.insertAdjacentHTML('beforeend', nextHtml);
        else grid.innerHTML = nextHtml;
        grid.classList.remove('catalog-grid-fade-out');
        grid.classList.add('catalog-grid-fade-in');
        setTimeout(function () {
          grid.classList.remove('catalog-grid-fade-in');
          grid.style.minHeight = '';
        }, 210);
      });
    }

    function applyPayload(payload, append) {
      var rows = Array.isArray(payload.doctors) ? payload.doctors : [];
      var nextHtml = '';
      if (!rows.length && !append) {
        nextHtml =
          '<div class="col-12"><div class="text-center app-card p-5"><div class="empty-state__icon text-muted mb-3"><i class="bi bi-search"></i></div><h5 class="text-muted fw-semibold">Врачи не найдены</h5><p class="text-muted small mb-0">Попробуйте изменить фильтры</p></div></div>';
      } else {
        rows.forEach(function (d) {
          nextHtml += doctorCardHtml(d, state.selectedSpecializationName);
        });
      }
      updateGridHtml(nextHtml, append);
      state.page = Number(payload.pagination.page || 1);
      state.totalPages = Number(payload.pagination.totalPages || 1);
      state.selectedSpecializationName = String(payload.selectedSpecializationName || '');
      if (totalCountEl) totalCountEl.textContent = String(payload.pagination.totalCount || 0);
      if (pageIndicator) pageIndicator.textContent = state.page + ' / ' + state.totalPages;
      loadMoreBtn.hidden = !(payload.pagination.hasNext === true);
      setSpecActive(state.specialization_id);
      updateUrl();
      applyTwoRowsClamp();
    }

    var inflight = null;
    async function loadDoctors(opts) {
      opts = opts || {};
      if (inflight) return;
      var page = opts.page || 1;
      var append = opts.append === true;
      setLoading(true);
      try {
        var qs = new URLSearchParams();
        if (state.search) qs.set('search', state.search);
        if (state.specialization_id) qs.set('specialization_id', state.specialization_id);
        qs.set('page', String(page));
        qs.set('ajax', '1');
        inflight = fetch('/doctors/api/list?' + qs.toString(), {
          headers: { Accept: 'application/json' },
        });
        var resp = await inflight;
        var payload = await resp.json();
        if (!resp.ok || !payload || payload.ok !== true) throw new Error('Failed to load doctors');
        applyPayload(payload, append);
      } catch (e) {
        if (!append) {
          updateGridHtml('<div class="col-12"><div class="alert alert-danger mb-0">Не удалось загрузить врачей. Попробуйте ещё раз.</div></div>', false);
        }
      } finally {
        inflight = null;
        setLoading(false);
      }
    }

    specRoot.addEventListener('click', function (e) {
      var a = e.target.closest('.js-spec-filter');
      if (!a) return;
      e.preventDefault();
      state.specialization_id = String(a.getAttribute('data-spec-id') || '');
      state.page = 1;
      loadDoctors({ page: 1, append: false });
    });

    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = String(searchInput.value || '').trim();
        state.page = 1;
        loadDoctors({ page: 1, append: false });
      }, 350);
    });

    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      state.search = String(searchInput.value || '').trim();
      state.page = 1;
      loadDoctors({ page: 1, append: false });
    });

    loadMoreBtn.addEventListener('click', function () {
      if (state.page >= state.totalPages) return;
      loadDoctors({ page: state.page + 1, append: true });
    });

    window.addEventListener('popstate', function () {
      var params = new URLSearchParams(window.location.search || '');
      state.search = String(params.get('search') || '');
      state.specialization_id = String(params.get('specialization_id') || '');
      var p = parseInt(params.get('page'), 10);
      state.page = Number.isFinite(p) && p > 0 ? p : 1;
      searchInput.value = state.search;
      loadDoctors({ page: state.page, append: false });
    });

    window.addEventListener('resize', scheduleClamp);
    scheduleClamp();
  });
})();
