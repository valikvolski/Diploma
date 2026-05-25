/**
 * История работы врача и расчёт стажа (experience_years).
 */

const MONTH_NAMES_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

function parseYmd(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) return null;
  const [y, m, d] = String(dateStr).trim().split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function todayYmd() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Длительность периода в полных месяцах (минимум 0).
 * @param {string} startYmd
 * @param {string|null} endYmd — null = по настоящее время
 * @param {Date} [refDate]
 */
function periodMonths(startYmd, endYmd, refDate = new Date()) {
  const start = parseYmd(startYmd);
  if (!start) return 0;
  const end = endYmd ? parseYmd(endYmd) : refDate;
  if (!end) return 0;
  if (end < start) return 0;

  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Суммарный стаж в годах (округление от общего числа месяцев).
 */
function totalExperienceYears(entries, refDate = new Date()) {
  if (!Array.isArray(entries) || !entries.length) return 0;
  const totalMonths = entries.reduce(
    (sum, e) => sum + periodMonths(e.start_date, e.end_date || null, refDate),
    0
  );
  return Math.max(0, Math.round(totalMonths / 12));
}

function formatDurationRu(months) {
  const m = Math.max(0, Math.floor(months));
  if (m === 0) return 'менее месяца';
  const years = Math.floor(m / 12);
  const rest = m % 12;
  const parts = [];
  if (years > 0) {
    const y10 = years % 10;
    const y100 = years % 100;
    let word = 'лет';
    if (y10 === 1 && y100 !== 11) word = 'год';
    else if (y10 >= 2 && y10 <= 4 && (y100 < 10 || y100 >= 20)) word = 'года';
    parts.push(`${years} ${word}`);
  }
  if (rest > 0) {
    const m10 = rest % 10;
    const m100 = rest % 100;
    let word = 'месяцев';
    if (m10 === 1 && m100 !== 11) word = 'месяц';
    else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) word = 'месяца';
    parts.push(`${rest} ${word}`);
  }
  return parts.join(' ') || '0 месяцев';
}

function formatMonthYearRu(dateStr) {
  const d = parseYmd(dateStr);
  if (!d) return '—';
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatPeriodRu(startYmd, endYmd) {
  const start = formatMonthYearRu(startYmd);
  if (!endYmd) {
    return `${start} — по настоящее время`;
  }
  return `${start} — ${formatMonthYearRu(endYmd)}`;
}

function normalizeEntry(raw) {
  const org = String(raw.organization_name || raw.organization || '').trim();
  const start = String(raw.start_date || '').trim();
  const isCurrent = raw.is_current === true || raw.is_current === '1' || raw.is_current === 'true';
  let end = String(raw.end_date || '').trim();
  if (isCurrent) end = '';
  if (!org || !start) return null;
  if (!parseYmd(start)) return null;
  if (end && !parseYmd(end)) return null;
  if (end && parseYmd(end) < parseYmd(start)) return null;
  const today = todayYmd();
  if (start > today) return null;
  if (end && end > today) return null;
  return {
    organization_name: org.slice(0, 200),
    start_date: start,
    end_date: end || null,
  };
}

/**
 * Парсинг из тела запроса (JSON или массивы полей формы).
 */
/**
 * @returns {string|null} сообщение об ошибке
 */
function validateWorkHistoryFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const today = todayYmd();
  let items = [];

  if (body.work_history_json) {
    try {
      const parsed = JSON.parse(String(body.work_history_json));
      if (Array.isArray(parsed)) items = parsed;
    } catch (_) {
      return 'Некорректный формат истории работы';
    }
  }

  for (const raw of items) {
    const start = String(raw.start_date || '').trim();
    const isCurrent =
      raw.is_current === true || raw.is_current === '1' || raw.is_current === 'true';
    let end = String(raw.end_date || '').trim();
    if (isCurrent) end = '';
    if (!start) continue;
    if (start > today) return 'Дата начала работы не может быть в будущем';
    if (end && end > today) return 'Дата окончания работы не может быть в будущем';
    if (end && end < start) return 'Дата окончания не может быть раньше даты начала';
  }
  return null;
}

function parseWorkHistoryFromBody(body) {
  if (!body || typeof body !== 'object') return [];

  if (body.work_history_json) {
    try {
      const parsed = JSON.parse(String(body.work_history_json));
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeEntry).filter(Boolean);
      }
    } catch (_) {
      return [];
    }
  }

  const orgs = body['work_organization[]'] ?? body.work_organization;
  const starts = body['work_start_date[]'] ?? body.work_start_date;
  const ends = body['work_end_date[]'] ?? body.work_end_date;
  const currents = body['work_is_current[]'] ?? body.work_is_current;

  const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const o = toArr(orgs);
  const s = toArr(starts);
  const e = toArr(ends);
  const c = toArr(currents);
  const len = Math.max(o.length, s.length, e.length, c.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const entry = normalizeEntry({
      organization_name: o[i],
      start_date: s[i],
      end_date: e[i],
      is_current: c[i] === '1' || c[i] === true || c[i] === 'on',
    });
    if (entry) out.push(entry);
  }
  return out;
}

async function loadDoctorWorkHistory(poolOrClient, doctorUserId) {
  const res = await poolOrClient.query(
    `SELECT id, doctor_user_id, organization_name,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
     FROM doctor_work_history
     WHERE doctor_user_id = $1
     ORDER BY start_date DESC, id DESC`,
    [doctorUserId]
  );
  return res.rows.map((row) => ({
    ...row,
    duration_months: periodMonths(row.start_date, row.end_date),
    period_label: formatPeriodRu(row.start_date, row.end_date),
    duration_label: formatDurationRu(periodMonths(row.start_date, row.end_date)),
  }));
}

/**
 * Заменить историю работы и обновить experience_years.
 */
/**
 * Стаж по истории работы (открытые периоды — до сегодня); иначе значение из профиля.
 */
function experienceYearsFromHistory(workHistoryRows, fallbackYears = 0, refDate = new Date()) {
  if (!Array.isArray(workHistoryRows) || !workHistoryRows.length) {
    return Math.max(0, parseInt(fallbackYears, 10) || 0);
  }
  const entries = workHistoryRows.map((r) => ({
    start_date: r.start_date,
    end_date: r.end_date || null,
  }));
  return totalExperienceYears(entries, refDate);
}

async function syncDoctorExperienceYears(poolOrClient, doctorUserId) {
  const res = await poolOrClient.query(
    `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
     FROM doctor_work_history
     WHERE doctor_user_id = $1`,
    [doctorUserId]
  );
  const years = experienceYearsFromHistory(res.rows, 0);
  await poolOrClient.query('UPDATE doctor_profiles SET experience_years = $1 WHERE user_id = $2', [
    years,
    doctorUserId,
  ]);
  return years;
}

async function loadWorkHistoryMapForDoctors(poolOrClient, doctorUserIds) {
  const ids = [...new Set((doctorUserIds || []).map((id) => parseInt(id, 10)).filter((id) => !isNaN(id)))];
  const map = new Map();
  if (!ids.length) return map;
  const res = await poolOrClient.query(
    `SELECT doctor_user_id,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
     FROM doctor_work_history
     WHERE doctor_user_id = ANY($1::int[])`,
    [ids]
  );
  for (const row of res.rows) {
    const uid = row.doctor_user_id;
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid).push(row);
  }
  return map;
}

function applyExperienceToDoctorRows(doctors, historyMap) {
  return (doctors || []).map((d) => ({
    ...d,
    experience_years: experienceYearsFromHistory(historyMap.get(d.id) || [], d.experience_years),
  }));
}

async function replaceDoctorWorkHistory(client, doctorUserId, entries) {
  const normalized = (entries || []).map(normalizeEntry).filter(Boolean);
  const years = totalExperienceYears(normalized);

  await client.query('DELETE FROM doctor_work_history WHERE doctor_user_id = $1', [doctorUserId]);

  for (const row of normalized) {
    await client.query(
      `INSERT INTO doctor_work_history (doctor_user_id, organization_name, start_date, end_date)
       VALUES ($1, $2, $3::date, $4::date)`,
      [doctorUserId, row.organization_name, row.start_date, row.end_date]
    );
  }

  await client.query('UPDATE doctor_profiles SET experience_years = $1 WHERE user_id = $2', [
    years,
    doctorUserId,
  ]);

  return { years, rows: normalized };
}

module.exports = {
  parseYmd,
  todayYmd,
  periodMonths,
  totalExperienceYears,
  experienceYearsFromHistory,
  syncDoctorExperienceYears,
  loadWorkHistoryMapForDoctors,
  applyExperienceToDoctorRows,
  formatDurationRu,
  formatPeriodRu,
  formatMonthYearRu,
  validateWorkHistoryFromBody,
  parseWorkHistoryFromBody,
  loadDoctorWorkHistory,
  replaceDoctorWorkHistory,
  normalizeEntry,
};
