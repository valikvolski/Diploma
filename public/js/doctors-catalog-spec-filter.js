/**
 * Choices.js single-select for doctors catalog specialization filter (#specialization_id).
 */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var el = document.getElementById('specialization_id');
    if (!el || typeof Choices === 'undefined') return;

    new Choices(el, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: '',
      searchPlaceholderValue: 'Поиск…',
      allowHTML: false,
      noResultsText: 'Ничего не найдено',
      classNames: {
        containerOuter: 'choices choices-catalog-spec',
      },
    });
  });
})();
