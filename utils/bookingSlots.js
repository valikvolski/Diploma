/**
 * Расчёт свободных слотов и доступности по месяцу (для API записи).
 */

function timeToMinutes(t) {
  const s = String(t).substring(0, 5);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateSlots(startTime, endTime, slotDuration) {
  const slots = [];
  let current = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  while (current + slotDuration <= end) {
    slots.push(minutesToTime(current));
    current += slotDuration;
  }
  return slots;
}

function normalizeTime(t) {
  return t ? String(t).substring(0, 5) : t;
}

function weekdayFromDateStr(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function ymd(year, month1to12, day) {
  const m = String(month1to12).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/** Сегодня в локальном календаре YYYY-MM-DD */
function todayLocalYmd() {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/**
 * Свободные слоты на дату (пустой массив если нет расписания / исключение / прошлое).
 */
async function getFreeSlotsForDate(pool, doctorId, dateStr, todayYmd = null) {
  const today = todayYmd || todayLocalYmd();
  if (dateStr < today) return [];

  const scheduleRes = await pool.query(
    `SELECT start_time, end_time, slot_duration
     FROM schedules
     WHERE doctor_id = $1 AND weekday = EXTRACT(DOW FROM $2::date)`,
    [doctorId, dateStr]
  );
  if (scheduleRes.rows.length === 0) return [];

  const exceptionRes = await pool.query(
    'SELECT 1 FROM schedule_exceptions WHERE doctor_id = $1 AND exception_date = $2',
    [doctorId, dateStr]
  );
  if (exceptionRes.rows.length > 0) return [];

  const { start_time, end_time, slot_duration } = scheduleRes.rows[0];
  const allSlots = generateSlots(start_time, end_time, slot_duration);

  const bookedRes = await pool.query(
    `SELECT appointment_time FROM appointments
     WHERE doctor_id = $1 AND appointment_date = $2 AND status IN ('booked','completed')`,
    [doctorId, dateStr]
  );
  const bookedSet = new Set(bookedRes.rows.map(r => normalizeTime(r.appointment_time)));
  return allSlots.filter(s => !bookedSet.has(s));
}

const availabilityCache = new Map();
const CACHE_TTL_MS = 45000;

function cacheKey(doctorId, yearMonth) {
  return `${doctorId}:${yearMonth}`;
}

function invalidateDoctorAvailabilityCache(doctorId, appointmentDateYmd) {
  if (!appointmentDateYmd || appointmentDateYmd.length < 7) return;
  const ym = appointmentDateYmd.slice(0, 7);
  availabilityCache.delete(cacheKey(doctorId, ym));
}

/**
 * Объект { "YYYY-MM-DD": count } за календарный месяц (прошлые дни — 0).
 */
async function getMonthAvailabilityMap(pool, doctorId, yearMonth, { bypassCache = false } = {}) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return {};

  const key = cacheKey(doctorId, yearMonth);
  if (!bypassCache) {
    const hit = availabilityCache.get(key);
    if (hit && Date.now() < hit.expires) return { ...hit.data };
  }

  const [yStr, mStr] = yearMonth.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  if (month < 1 || month > 12) return {};

  const dim = daysInMonth(year, month);
  const rangeStart = `${yearMonth}-01`;
  const rangeEnd = `${yearMonth}-${String(dim).padStart(2, '0')}`;
  const today = todayLocalYmd();

  const [schedulesRes, exceptionsRes, bookedRes] = await Promise.all([
    pool.query(
      'SELECT weekday, start_time, end_time, slot_duration FROM schedules WHERE doctor_id = $1',
      [doctorId]
    ),
    pool.query(
      `SELECT TO_CHAR(exception_date, 'YYYY-MM-DD') AS d
       FROM schedule_exceptions
       WHERE doctor_id = $1 AND exception_date >= $2::date AND exception_date <= $3::date`,
      [doctorId, rangeStart, rangeEnd]
    ),
    pool.query(
      `SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS d, appointment_time
       FROM appointments
       WHERE doctor_id = $1 AND appointment_date >= $2::date AND appointment_date <= $3::date
         AND status IN ('booked','completed')`,
      [doctorId, rangeStart, rangeEnd]
    ),
  ]);

  const scheduleByWd = {};
  schedulesRes.rows.forEach(r => {
    const wd = Number(r.weekday);
    if (!Number.isNaN(wd)) scheduleByWd[wd] = r;
  });

  const exceptionSet = new Set(exceptionsRes.rows.map(r => r.d));
  const bookedByDate = new Map();
  bookedRes.rows.forEach(r => {
    const d = r.d;
    if (!bookedByDate.has(d)) bookedByDate.set(d, new Set());
    bookedByDate.get(d).add(normalizeTime(r.appointment_time));
  });

  const out = {};
  for (let day = 1; day <= dim; day++) {
    const ds = ymd(year, month, day);
    if (ds < today) {
      out[ds] = 0;
      continue;
    }
    if (exceptionSet.has(ds)) {
      out[ds] = 0;
      continue;
    }
    const wd = weekdayFromDateStr(ds);
    const sch = scheduleByWd[Number(wd)];
    if (!sch || sch.start_time == null || sch.end_time == null || sch.slot_duration == null) {
      out[ds] = 0;
      continue;
    }
    const allSlots = generateSlots(sch.start_time, sch.end_time, sch.slot_duration);
    const taken = bookedByDate.get(ds) || new Set();
    const free = allSlots.filter(s => !taken.has(s)).length;
    out[ds] = free;
  }

  availabilityCache.set(key, { data: out, expires: Date.now() + CACHE_TTL_MS });
  return { ...out };
}

module.exports = {
  generateSlots,
  normalizeTime,
  timeToMinutes,
  minutesToTime,
  getFreeSlotsForDate,
  getMonthAvailabilityMap,
  invalidateDoctorAvailabilityCache,
  todayLocalYmd,
};
