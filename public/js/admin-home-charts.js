(function () {
  'use strict';

  function readPayload() {
    var el = document.getElementById('admin-home-chart-json');
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
      grid: dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(15, 23, 42, 0.08)',
      primary: dark ? '#60a5fa' : '#1a6ee6',
      primaryFill: dark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(26, 110, 230, 0.12)',
      doughnut: ['#1a6ee6', '#f59e0b', '#10b981', '#94a3b8'],
    };
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    if (typeof Chart === 'undefined') return;
    var data = readPayload();
    if (!data || !data.daysLabels || !data.statusLabels) return;

    var c = chartColors();

    var barEl = document.getElementById('admin-chart-appts-by-day');
    if (barEl && data.daysLabels.length) {
      new Chart(barEl, {
        type: 'bar',
        data: {
          labels: data.daysLabels,
          datasets: [
            {
              label: 'Записей по дате приёма',
              data: data.daysCounts,
              backgroundColor: c.primaryFill,
              borderColor: c.primary,
              borderWidth: 1.5,
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
            },
          },
          scales: {
            x: {
              ticks: { color: c.text, maxRotation: 45, minRotation: 0 },
              grid: { color: c.grid },
            },
            y: {
              beginAtZero: true,
              ticks: { color: c.text, stepSize: 1 },
              grid: { color: c.grid },
            },
          },
        },
      });
    }

    var doughEl = document.getElementById('admin-chart-status');
    if (doughEl) {
      var counts = data.statusCounts || [0, 0, 0, 0];
      var sum = counts.reduce(function (a, b) {
        return a + b;
      }, 0);
      if (sum === 0) {
        doughEl.parentElement.classList.add('admin-chart-empty');
        var p = document.createElement('p');
        p.className = 'text-muted small mb-0 text-center py-5';
        p.textContent = 'Пока нет записей в базе';
        doughEl.replaceWith(p);
        return;
      }

      new Chart(doughEl, {
        type: 'doughnut',
        data: {
          labels: data.statusLabels,
          datasets: [
            {
              data: counts,
              backgroundColor: c.doughnut,
              borderWidth: 2,
              borderColor: document.documentElement.getAttribute('data-app-theme') === 'dark' ? '#1e293b' : '#fff',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: c.text, padding: 14, font: { size: 12 } },
            },
          },
        },
      });
    }
  });
})();
