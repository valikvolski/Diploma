(function () {
  'use strict';

  function readPayload() {
    var el = document.getElementById('admin-user-chart-json');
    if (!el || !el.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function chartColors() {
    var dark = document.documentElement.getAttribute('data-app-theme') === 'dark';
    return {
      text: dark ? '#e2e8f0' : '#475569',
      doughnut: ['#1a6ee6', '#ef4444', '#10b981'],
      border: dark ? '#1e293b' : '#fff',
    };
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    if (typeof Chart === 'undefined') return;
    var data = readPayload();
    if (!data || !data.statusLabels || !data.statusCounts) return;

    var el = document.getElementById('admin-user-chart-status');
    if (!el) return;

    var c = chartColors();
    var sum = (data.statusCounts || []).reduce(function (a, b) {
      return a + (Number(b) || 0);
    }, 0);
    if (!sum) {
      var p = document.createElement('p');
      p.className = 'text-muted small mb-0 text-center py-5';
      p.textContent = 'Пока нет данных';
      el.replaceWith(p);
      return;
    }

    new Chart(el, {
      type: 'doughnut',
      data: {
        labels: data.statusLabels,
        datasets: [
          {
            data: data.statusCounts,
            backgroundColor: c.doughnut,
            borderWidth: 2,
            borderColor: c.border,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: c.text, padding: 12, font: { size: 12 } },
          },
        },
      },
    });
  });
})();

