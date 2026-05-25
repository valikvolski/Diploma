/**
 * Окно онлайн-записи: текущий календарный месяц и ещё два следующих.
 */

function ymd(year, month1to12, day) {
  const m = String(month1to12).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function todayLocalYmd() {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** Сколько месяцев вперёд от начала текущего (включая текущий): 1 + 2 = 3 */
const BOOKING_MONTHS_SPAN = 3;

function parseYmdParts(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return { y, m, d };
}

/** Последний день доступный для записи (конец месяца «текущий + 2»). */
function bookingMaxDateYmd(refDate = new Date()) {
  const end = new Date(refDate.getFullYear(), refDate.getMonth() + BOOKING_MONTHS_SPAN, 0);
  return ymd(end.getFullYear(), end.getMonth() + 1, end.getDate());
}

function bookingMinMonthKey(refDate = new Date()) {
  const y = refDate.getFullYear();
  const m = refDate.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function bookingMaxMonthKey(refDate = new Date()) {
  const max = bookingMaxDateYmd(refDate);
  const { y, m } = parseYmdParts(max);
  return `${y}-${String(m).padStart(2, '0')}`;
}

function isDateInBookingWindow(dateStr, refDate = new Date()) {
  const today = todayLocalYmd();
  const max = bookingMaxDateYmd(refDate);
  return dateStr >= today && dateStr <= max;
}

function isMonthInBookingWindow(yearMonth, refDate = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
  const min = bookingMinMonthKey(refDate);
  const max = bookingMaxMonthKey(refDate);
  return yearMonth >= min && yearMonth <= max;
}

function monthKeyToIndex(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return y * 12 + (m - 1);
}

module.exports = {
  BOOKING_MONTHS_SPAN,
  bookingMaxDateYmd,
  bookingMinMonthKey,
  bookingMaxMonthKey,
  isDateInBookingWindow,
  isMonthInBookingWindow,
  monthKeyToIndex,
};
