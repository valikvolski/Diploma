const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/**
 * @param {string|Date|null|undefined} ymd — дата в виде YYYY-MM-DD или ISO
 * @returns {string}
 */
function formatAppointmentDateRu(ymd) {
  if (ymd == null || ymd === '') return '—';
  const s = String(ymd).trim().substring(0, 10);
  const parts = s.split('-');
  if (parts.length !== 3) return '—';
  const y = parts[0];
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || isNaN(m) || isNaN(d) || m < 1 || m > 12) return '—';
  return `${d} ${MONTHS[m - 1]} ${y} г.`;
}

module.exports = { formatAppointmentDateRu, MONTHS };
