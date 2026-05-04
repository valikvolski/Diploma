require('../dotenv-config');

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../db/db');

const DOCTOR_PREFIX = 'doctor.demo.';
const PATIENT_PREFIX = 'patient.demo.';
const DEMO_DOMAIN = '@medzapis.local';
const DEMO_REASON_PREFIX = '[DEMO]';

const TARGET_DOCTORS = 100;
const TARGET_PATIENTS = 300;
const TARGET_APPOINTMENTS = 2200;
const STATUS_RATIO = { completed: 0.45, cancelled: 0.2, booked: 0.35 };

const DOCTOR_PASSWORD = 'Doctor123!';
const PATIENT_PASSWORD = 'Patient123!';
const SALT_ROUNDS = 10;

const FIRST_NAMES_M = ['Александр', 'Андрей', 'Игорь', 'Максим', 'Павел', 'Сергей', 'Дмитрий', 'Олег', 'Артем', 'Николай'];
const FIRST_NAMES_F = ['Елена', 'Ирина', 'Наталья', 'Мария', 'Анна', 'Ольга', 'Светлана', 'Юлия', 'Татьяна', 'Виктория'];
const LAST_NAMES_M = ['Иванов', 'Петров', 'Сидоров', 'Козлов', 'Смирнов', 'Морозов', 'Новиков', 'Егоров', 'Волков', 'Попов'];
const LAST_NAMES_F = ['Иванова', 'Петрова', 'Сидорова', 'Козлова', 'Смирнова', 'Морозова', 'Новикова', 'Егорова', 'Волкова', 'Попова'];
const MIDDLE_NAMES_M = ['Александрович', 'Игоревич', 'Сергеевич', 'Павлович', 'Дмитриевич', 'Олегович'];
const MIDDLE_NAMES_F = ['Александровна', 'Игоревна', 'Сергеевна', 'Павловна', 'Дмитриевна', 'Олеговна'];
const STREET_NAMES = ['ул. Ленина', 'ул. Победы', 'ул. Советская', 'ул. Гагарина', 'ул. Центральная', 'пр. Независимости'];
const CITIES = ['Минск', 'Гродно', 'Брест', 'Витебск', 'Гомель', 'Могилёв'];
const EDUCATIONS = [
  'БГМУ, лечебный факультет',
  'ГрГМУ, клиническая ординатура',
  'ВГМУ, интернатура по профилю',
  'БГМУ, специализация и повышение квалификации',
];
const DOCTOR_DESCRIPTIONS = [
  'Ведет амбулаторный прием, проводит диагностику и подбирает индивидуальный план лечения.',
  'Специализируется на профилактике, ранней диагностике и сопровождении хронических состояний.',
  'Работает по современным клиническим протоколам и принципам доказательной медицины.',
];

const REQUIRED_SPECIALIZATIONS = [
  { name: 'Терапевт', compat_group: 'therapy' },
  { name: 'Хирург', compat_group: 'surgery' },
  { name: 'ЛОР (оториноларинголог)', compat_group: 'ent' },
  { name: 'Офтальмолог', compat_group: 'ophthalmology' },
  { name: 'Невролог', compat_group: 'therapy' },
  { name: 'Кардиолог', compat_group: 'therapy' },
  { name: 'Дерматолог', compat_group: 'therapy' },
  { name: 'Стоматолог', compat_group: 'dental' },
  { name: 'Гинеколог', compat_group: 'gynecology' },
  { name: 'Уролог', compat_group: 'surgery' },
  { name: 'Эндокринолог', compat_group: 'therapy' },
  { name: 'Педиатр', compat_group: 'therapy' },
  { name: 'Гастроэнтеролог', compat_group: 'therapy' },
  { name: 'Пульмонолог', compat_group: 'therapy' },
  { name: 'Психиатр', compat_group: 'therapy' },
  { name: 'Травматолог-ортопед', compat_group: 'surgery' },
];

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[rnd(0, arr.length - 1)];
}

function chance(prob) {
  return Math.random() < prob;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function randomDateBetween(from, to) {
  const t1 = from.getTime();
  const t2 = to.getTime();
  return new Date(t1 + Math.floor(Math.random() * (t2 - t1 + 1)));
}

function dateSql(d) {
  return d.toISOString().slice(0, 10);
}

function timeSql(hour, min) {
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function toMinutes(hhmmss) {
  const [h, m] = String(hhmmss).slice(0, 5).split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function hhmmFromMinutes(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function emailByPrefix(prefix, n) {
  return `${prefix}${String(n).padStart(4, '0')}${DEMO_DOMAIN}`;
}

function randomPhone(seedNum) {
  const tail = String(1000000 + (seedNum % 9000000));
  const code = pick(['29', '25', '33', '44']);
  return `+375${code}${tail}`;
}

function randomCabinet() {
  const n = rnd(101, 620);
  return chance(0.18) ? `${n}${pick(['А', 'Б'])}` : String(n);
}

function randomAddress() {
  return `${pick(CITIES)}, ${pick(STREET_NAMES)}, д. ${rnd(1, 180)}, кв. ${rnd(1, 220)}`;
}

function randomPolicy(i) {
  return `POL-${String(100000000 + i).padStart(9, '0')}`;
}

function personName(gender) {
  if (gender === 'female') {
    return {
      first: pick(FIRST_NAMES_F),
      last: pick(LAST_NAMES_F),
      middle: pick(MIDDLE_NAMES_F),
    };
  }
  return {
    first: pick(FIRST_NAMES_M),
    last: pick(LAST_NAMES_M),
    middle: pick(MIDDLE_NAMES_M),
  };
}

function toStatusTargets(total) {
  const completed = Math.round(total * STATUS_RATIO.completed);
  const cancelled = Math.round(total * STATUS_RATIO.cancelled);
  const booked = Math.max(0, total - completed - cancelled);
  return { completed, cancelled, booked };
}

function randomCreatedAtWithinMonths(monthsBackMax = 12) {
  const to = new Date();
  const from = addDays(to, -monthsBackMax * 30);
  return randomDateBetween(from, to);
}

async function tableExists(client, tableName) {
  const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [tableName]);
  return r.rows[0] && r.rows[0].ok === true;
}

async function ensureSpecializations(client) {
  for (const s of REQUIRED_SPECIALIZATIONS) {
    await client.query(
      `INSERT INTO specializations (name, compat_group)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET compat_group = EXCLUDED.compat_group`,
      [s.name, s.compat_group]
    );
  }
  const res = await client.query(`SELECT id, name FROM specializations ORDER BY id`);
  return res.rows;
}

async function fetchDemoUsers(client, role, prefix) {
  const res = await client.query(
    `SELECT id, email
     FROM users
     WHERE role = $1
       AND email LIKE $2
     ORDER BY id`,
    [role, `${prefix}%${DEMO_DOMAIN}`]
  );
  return res.rows;
}

async function createDoctors(client, existingDoctors, specializations, passwordHash) {
  const createdDoctorIds = [];
  const need = Math.max(0, TARGET_DOCTORS - existingDoctors.length);
  let lastIdx = existingDoctors.length;

  for (let i = 0; i < need; i++) {
    lastIdx += 1;
    const gender = chance(0.6) ? 'female' : 'male';
    const n = personName(gender);
    const email = emailByPrefix(DOCTOR_PREFIX, lastIdx);
    const createdAt = randomCreatedAtWithinMonths(12);
    const phone = randomPhone(10000 + lastIdx);

    const uRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'doctor', false, $7)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email, passwordHash, n.first, n.last, n.middle, phone, createdAt]
    );
    if (!uRes.rows.length) continue;
    const doctorId = uRes.rows[0].id;
    createdDoctorIds.push(doctorId);

    const primary = pick(specializations);
    await client.query(
      `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
       SET specialization_id = EXCLUDED.specialization_id,
           cabinet = EXCLUDED.cabinet,
           experience_years = EXCLUDED.experience_years,
           education = EXCLUDED.education,
           description = EXCLUDED.description`,
      [
        doctorId,
        primary.id,
        randomCabinet(),
        rnd(1, 35),
        pick(EDUCATIONS),
        pick(DOCTOR_DESCRIPTIONS),
      ]
    );

    const specCount = rnd(1, 3);
    const chosen = [primary];
    while (chosen.length < specCount) {
      const s = pick(specializations);
      if (!chosen.some((x) => x.id === s.id)) chosen.push(s);
    }
    await client.query(
      `INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
       VALUES ($1, $2, true)
       ON CONFLICT (doctor_user_id, specialization_id) DO UPDATE SET is_primary = true`,
      [doctorId, primary.id]
    );
    for (const s of chosen) {
      if (s.id === primary.id) continue;
      await client.query(
        `INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
         VALUES ($1, $2, false)
         ON CONFLICT (doctor_user_id, specialization_id) DO NOTHING`,
        [doctorId, s.id]
      );
    }
    await client.query(
      `UPDATE doctor_specializations
       SET is_primary = CASE WHEN specialization_id = $2 THEN true ELSE false END
       WHERE doctor_user_id = $1`,
      [doctorId, primary.id]
    );
  }

  return createdDoctorIds;
}

async function createPatients(client, existingPatients, passwordHash) {
  const createdPatientIds = [];
  const need = Math.max(0, TARGET_PATIENTS - existingPatients.length);
  let lastIdx = existingPatients.length;

  for (let i = 0; i < need; i++) {
    lastIdx += 1;
    const gender = chance(0.55) ? 'female' : 'male';
    const n = personName(gender);
    const email = emailByPrefix(PATIENT_PREFIX, lastIdx);
    const createdAt = randomCreatedAtWithinMonths(12);
    const phone = randomPhone(50000 + lastIdx);
    const blocked = chance(0.08);

    const uRes = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'patient', $7, $8)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email, passwordHash, n.first, n.last, n.middle, phone, blocked, createdAt]
    );
    if (!uRes.rows.length) continue;
    const patientId = uRes.rows[0].id;
    createdPatientIds.push(patientId);

    const age = rnd(18, 75);
    const birth = addDays(new Date(), -(age * 365 + rnd(0, 364)));
    await client.query(
      `INSERT INTO patient_profiles (user_id, birth_date, gender, address, policy_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET birth_date = EXCLUDED.birth_date,
           gender = EXCLUDED.gender,
           address = EXCLUDED.address,
           policy_number = EXCLUDED.policy_number`,
      [patientId, dateSql(birth), gender, randomAddress(), randomPolicy(100000 + lastIdx)]
    );
  }

  return createdPatientIds;
}

async function ensureAllProfiles(client, doctorIds, patientIds, specializations) {
  for (const id of doctorIds) {
    const pRes = await client.query('SELECT 1 FROM doctor_profiles WHERE user_id = $1', [id]);
    if (!pRes.rows.length) {
      const spec = pick(specializations);
      await client.query(
        `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO NOTHING`,
        [id, spec.id, randomCabinet(), rnd(1, 35), pick(EDUCATIONS), pick(DOCTOR_DESCRIPTIONS)]
      );
      await client.query(
        `INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
         VALUES ($1, $2, true)
         ON CONFLICT (doctor_user_id, specialization_id) DO UPDATE SET is_primary = true`,
        [id, spec.id]
      );
      await client.query(
        `UPDATE doctor_specializations
         SET is_primary = CASE WHEN specialization_id = $2 THEN true ELSE false END
         WHERE doctor_user_id = $1`,
        [id, spec.id]
      );
    }
  }

  for (const id of patientIds) {
    await client.query(
      `INSERT INTO patient_profiles (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [id]
    );
  }
}

function schedulePreset() {
  const r = Math.random();
  if (r < 0.7) {
    return { weekdays: [1, 2, 3, 4, 5], start: '09:00:00', end: '17:00:00', slot: chance(0.8) ? 30 : 20 };
  }
  if (r < 0.85) {
    return { weekdays: [2, 3, 4, 5, 6], start: '10:00:00', end: '18:00:00', slot: chance(0.7) ? 30 : 20 };
  }
  return { weekdays: [1, 2, 4, 5], start: '08:30:00', end: '16:30:00', slot: 30 };
}

async function ensureSchedules(client, doctorIds) {
  for (const doctorId of doctorIds) {
    const existing = await client.query('SELECT weekday FROM schedules WHERE doctor_id = $1', [doctorId]);
    if (existing.rows.length >= 4) continue;
    const p = schedulePreset();
    for (const wd of p.weekdays) {
      await client.query(
        `INSERT INTO schedules (doctor_id, weekday, start_time, end_time, slot_duration)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (doctor_id, weekday) DO UPDATE
         SET start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             slot_duration = EXCLUDED.slot_duration`,
        [doctorId, wd, p.start, p.end, p.slot]
      );
    }
  }
}

async function ensureScheduleExceptions(client, doctorIds) {
  let created = 0;
  for (const doctorId of doctorIds) {
    if (!chance(0.36)) continue;
    const exRes = await client.query(
      `SELECT id
       FROM schedule_exceptions
       WHERE doctor_id = $1
         AND reason LIKE $2`,
      [doctorId, `${DEMO_REASON_PREFIX}%`]
    );
    if (exRes.rows.length) continue;

    const count = rnd(1, 3);
    for (let i = 0; i < count; i++) {
      const mode = pick(['dayoff', 'vacation', 'custom']);
      if (mode === 'dayoff') {
        const day = addDays(new Date(), rnd(-40, 45));
        const d = dateSql(day);
        await client.query(
          `INSERT INTO schedule_exceptions
           (doctor_id, exception_date, date_from, date_to, is_day_off, start_time, end_time, reason)
           VALUES ($1, $2, $2, $2, true, NULL, NULL, $3)`,
          [doctorId, d, `${DEMO_REASON_PREFIX} выходной`]
        );
      } else if (mode === 'vacation') {
        const start = addDays(new Date(), rnd(-25, 30));
        const len = rnd(3, 10);
        const end = addDays(start, len);
        await client.query(
          `INSERT INTO schedule_exceptions
           (doctor_id, exception_date, date_from, date_to, is_day_off, start_time, end_time, reason)
           VALUES ($1, $2, $2, $3, true, NULL, NULL, $4)`,
          [doctorId, dateSql(start), dateSql(end), `${DEMO_REASON_PREFIX} отпуск`]
        );
      } else {
        const day = addDays(new Date(), rnd(-25, 35));
        const d = dateSql(day);
        const startHour = pick([8, 9, 10, 11]);
        const endHour = startHour + pick([5, 6, 7]);
        await client.query(
          `INSERT INTO schedule_exceptions
           (doctor_id, exception_date, date_from, date_to, is_day_off, start_time, end_time, reason)
           VALUES ($1, $2, $2, $2, false, $3, $4, $5)`,
          [doctorId, d, timeSql(startHour, 0), timeSql(endHour, 0), `${DEMO_REASON_PREFIX} измененные часы`]
        );
      }
      created += 1;
    }
  }
  return created;
}

async function loadDoctorCalendars(client, doctorIds) {
  const schedulesRes = await client.query(
    `SELECT doctor_id, weekday, start_time::text AS start_time, end_time::text AS end_time, slot_duration
     FROM schedules
     WHERE doctor_id = ANY($1::int[])`,
    [doctorIds]
  );
  const exceptionsRes = await client.query(
    `SELECT doctor_id,
            date_from::date AS date_from,
            date_to::date AS date_to,
            exception_date::date AS exception_date,
            is_day_off,
            start_time::text AS start_time,
            end_time::text AS end_time
     FROM schedule_exceptions
     WHERE doctor_id = ANY($1::int[])`,
    [doctorIds]
  );

  const scheduleByDoctor = new Map();
  for (const r of schedulesRes.rows) {
    if (!scheduleByDoctor.has(r.doctor_id)) scheduleByDoctor.set(r.doctor_id, new Map());
    scheduleByDoctor.get(r.doctor_id).set(Number(r.weekday), {
      start: r.start_time,
      end: r.end_time,
      slotDuration: Number(r.slot_duration) || 30,
    });
  }

  const exceptionsByDoctor = new Map();
  for (const r of exceptionsRes.rows) {
    if (!exceptionsByDoctor.has(r.doctor_id)) exceptionsByDoctor.set(r.doctor_id, []);
    exceptionsByDoctor.get(r.doctor_id).push({
      dateFrom: dateSql(new Date(r.date_from)),
      dateTo: dateSql(new Date(r.date_to)),
      exceptionDate: r.exception_date ? dateSql(new Date(r.exception_date)) : null,
      isDayOff: r.is_day_off === true,
      start: r.start_time,
      end: r.end_time,
    });
  }

  return { scheduleByDoctor, exceptionsByDoctor };
}

function dateInRange(d, from, to) {
  return d >= from && d <= to;
}

function resolveDayPlan(doctorId, dateObj, scheduleByDoctor, exceptionsByDoctor) {
  const wd = dateObj.getDay();
  const sch = scheduleByDoctor.get(doctorId);
  if (!sch || !sch.has(wd)) return null;

  let plan = { ...sch.get(wd) };
  const day = dateSql(dateObj);
  const ex = (exceptionsByDoctor.get(doctorId) || []).find((x) =>
    dateInRange(day, x.dateFrom || day, x.dateTo || day) || (x.exceptionDate && x.exceptionDate === day)
  );
  if (ex) {
    if (ex.isDayOff) return null;
    if (ex.start) plan.start = ex.start;
    if (ex.end) plan.end = ex.end;
  }

  return plan;
}

function randomAppointmentDate(status) {
  const now = new Date();
  if (status === 'completed') return addDays(now, -rnd(1, 90));
  if (status === 'booked') return addDays(now, rnd(1, 30));
  return chance(0.7) ? addDays(now, rnd(1, 45)) : addDays(now, -rnd(1, 60));
}

function randomCreatedAtForAppointment(status, apptDateObj) {
  const apptDateTime = new Date(apptDateObj);
  if (status === 'booked') {
    return randomDateBetween(addDays(new Date(), -20), new Date());
  }
  const back = rnd(1, 25);
  return randomDateBetween(addDays(apptDateTime, -back), addDays(apptDateTime, -1));
}

async function createAppointmentsTicketsNotifications(client, doctorIds, patientIds) {
  const resExisting = await client.query(
    `SELECT a.id, a.patient_id, a.doctor_id, a.appointment_date::date AS appointment_date,
            a.appointment_time::text AS appointment_time, a.status
     FROM appointments a
     WHERE a.doctor_id = ANY($1::int[]) AND a.patient_id = ANY($2::int[])`,
    [doctorIds, patientIds]
  );
  const existingCounts = { completed: 0, cancelled: 0, booked: 0 };
  const occupied = new Set();
  for (const r of resExisting.rows) {
    if (existingCounts[r.status] != null) existingCounts[r.status] += 1;
    occupied.add(`${r.doctor_id}|${dateSql(new Date(r.appointment_date))}|${String(r.appointment_time).slice(0, 5)}`);
  }

  const targetByStatus = toStatusTargets(TARGET_APPOINTMENTS);
  const missing = {
    completed: Math.max(0, targetByStatus.completed - (existingCounts.completed || 0)),
    cancelled: Math.max(0, targetByStatus.cancelled - (existingCounts.cancelled || 0)),
    booked: Math.max(0, targetByStatus.booked - (existingCounts.booked || 0)),
  };

  const { scheduleByDoctor, exceptionsByDoctor } = await loadDoctorCalendars(client, doctorIds);

  const createdByStatus = { completed: 0, cancelled: 0, booked: 0 };
  let ticketsCreated = 0;
  let notificationsCreated = 0;

  const statusOrder = [
    ...Array(missing.completed).fill('completed'),
    ...Array(missing.cancelled).fill('cancelled'),
    ...Array(missing.booked).fill('booked'),
  ];

  const maxAttempts = statusOrder.length * 180;
  let attempts = 0;
  let idx = 0;
  while (idx < statusOrder.length && attempts < maxAttempts) {
    attempts += 1;
    const status = statusOrder[idx];

    const doctorId = pick(doctorIds);
    const patientId = pick(patientIds);
    const apptDateObj = randomAppointmentDate(status);
    const dayPlan = resolveDayPlan(doctorId, apptDateObj, scheduleByDoctor, exceptionsByDoctor);
    if (!dayPlan) continue;

    const startMin = toMinutes(dayPlan.start);
    const endMin = toMinutes(dayPlan.end);
    const step = Math.max(10, Number(dayPlan.slotDuration) || 30);
    if (endMin - startMin < step) continue;

    const slots = [];
    for (let m = startMin; m + step <= endMin; m += step) slots.push(m);
    if (!slots.length) continue;
    const m = pick(slots);
    const hhmm = hhmmFromMinutes(m);
    const dateStr = dateSql(apptDateObj);
    const key = `${doctorId}|${dateStr}|${hhmm}`;
    if (occupied.has(key)) continue;

    const createdAt = randomCreatedAtForAppointment(status, apptDateObj);
    const apptIns = await client.query(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [patientId, doctorId, dateStr, `${hhmm}:00`, status, createdAt]
    );
    const appointmentId = apptIns.rows[0].id;
    occupied.add(key);
    createdByStatus[status] += 1;
    idx += 1;

    const tIns = await client.query(
      `INSERT INTO tickets (appointment_id, ticket_number, created_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [appointmentId, `TMP-${appointmentId}-${Date.now()}-${rnd(100, 999)}`, createdAt]
    );
    const ticketId = tIns.rows[0].id;
    await client.query('UPDATE tickets SET ticket_number = $1 WHERE id = $2', [`МЗ-${String(ticketId).padStart(6, '0')}`, ticketId]);
    ticketsCreated += 1;

    const datePart = new Date(dateStr).toLocaleDateString('ru-RU');
    const timePart = hhmm;
    if (status === 'booked') {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, $2, $3, 'info', $4, $5), ($6, $2, $7, 'info', $8, $9)`,
        [
          patientId,
          'Запись создана',
          `Ваша запись подтверждена на ${datePart} в ${timePart}.`,
          chance(0.45),
          createdAt,
          doctorId,
          `Новая запись пациента на ${datePart} в ${timePart}.`,
          chance(0.35),
          createdAt,
        ]
      );
      notificationsCreated += 2;
    } else if (status === 'cancelled') {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, $2, $3, 'warning', $4, $5), ($6, $2, $7, 'warning', $8, $9)`,
        [
          patientId,
          'Запись отменена',
          `Запись на ${datePart} в ${timePart} была отменена.`,
          chance(0.55),
          createdAt,
          doctorId,
          `Запись пациента на ${datePart} в ${timePart} отменена.`,
          chance(0.5),
          createdAt,
        ]
      );
      notificationsCreated += 2;
    } else {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
         VALUES ($1, $2, $3, 'info', $4, $5)`,
        [patientId, 'Приём завершён', `Приём ${datePart} в ${timePart} отмечен как завершён.`, chance(0.75), createdAt]
      );
      notificationsCreated += 1;
    }
  }

  return {
    createdByStatus,
    ticketsCreated,
    notificationsCreated,
    existingCounts,
    targetByStatus,
  };
}

async function maybeSeedAuthTables(client, demoUserIds) {
  let refreshCreated = 0;
  let resetCodesCreated = 0;

  const hasRefresh = await tableExists(client, 'refresh_tokens');
  if (hasRefresh) {
    for (let i = 0; i < Math.min(60, demoUserIds.length); i++) {
      const uid = pick(demoUserIds);
      const tokenHash = crypto.randomBytes(32).toString('hex');
      const createdAt = addDays(new Date(), -rnd(1, 40));
      const expiresAt = addDays(new Date(), rnd(3, 30));
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token_hash) DO NOTHING`,
        [uid, tokenHash, expiresAt, createdAt, 'DemoSeed/1.0', `192.168.1.${rnd(2, 240)}`]
      );
      refreshCreated += 1;
    }
  }

  const hasReset = await tableExists(client, 'password_reset_codes');
  if (hasReset) {
    for (let i = 0; i < Math.min(20, demoUserIds.length); i++) {
      const uid = pick(demoUserIds);
      const codeHash = crypto.createHash('sha256').update(`demo-${uid}-${Date.now()}-${i}`).digest('hex');
      const createdAt = addDays(new Date(), -rnd(0, 10));
      const expiresAt = addDays(new Date(), rnd(1, 3));
      await client.query(
        `INSERT INTO password_reset_codes
           (user_id, code_hash, expires_at, created_at, attempts, last_sent_at, purpose)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uid, codeHash, expiresAt, createdAt, rnd(0, 2), createdAt, chance(0.5) ? 'forgot_password' : 'profile_change']
      );
      resetCodesCreated += 1;
    }
  }

  return { refreshCreated, resetCodesCreated };
}

async function integrityChecks(client, doctorIds, patientIds) {
  const duplicateSlots = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT doctor_id, appointment_date, appointment_time, COUNT(*) AS n
       FROM appointments
       GROUP BY doctor_id, appointment_date, appointment_time
       HAVING COUNT(*) > 1
     ) x`
  );

  const noTicket = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM appointments a
     WHERE a.doctor_id = ANY($1::int[])
       AND a.patient_id = ANY($2::int[])
       AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.appointment_id = a.id)`,
    [doctorIds, patientIds]
  );

  const multiTickets = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT appointment_id, COUNT(*) AS n
       FROM tickets
       GROUP BY appointment_id
       HAVING COUNT(*) > 1
     ) x`
  );

  const orphanTickets = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM tickets t
     LEFT JOIN appointments a ON a.id = t.appointment_id
     WHERE a.id IS NULL`
  );

  return {
    duplicateSlots: duplicateSlots.rows[0].c || 0,
    appointmentsWithoutTicket: noTicket.rows[0].c || 0,
    appointmentsWithMultipleTickets: multiTickets.rows[0].c || 0,
    orphanTickets: orphanTickets.rows[0].c || 0,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Seeding demo data for MedZapis...');
    const adminBefore = await client.query(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY id`);

    if (adminBefore.rows.length !== 1) {
      console.warn(`WARNING: expected exactly 1 admin, found ${adminBefore.rows.length}. Script will continue without modifying admins.`);
    }

    await client.query('BEGIN');

    const [doctorHash, patientHash] = await Promise.all([
      bcrypt.hash(DOCTOR_PASSWORD, SALT_ROUNDS),
      bcrypt.hash(PATIENT_PASSWORD, SALT_ROUNDS),
    ]);

    const specializations = await ensureSpecializations(client);
    const existingDoctors = await fetchDemoUsers(client, 'doctor', DOCTOR_PREFIX);
    const existingPatients = await fetchDemoUsers(client, 'patient', PATIENT_PREFIX);

    const createdDoctorIds = await createDoctors(client, existingDoctors, specializations, doctorHash);
    const createdPatientIds = await createPatients(client, existingPatients, patientHash);

    const doctorsNow = await fetchDemoUsers(client, 'doctor', DOCTOR_PREFIX);
    const patientsNow = await fetchDemoUsers(client, 'patient', PATIENT_PREFIX);
    const doctorIds = doctorsNow.map((x) => x.id);
    const patientIds = patientsNow.map((x) => x.id);

    await ensureAllProfiles(client, doctorIds, patientIds, specializations);
    await ensureSchedules(client, doctorIds);
    const scheduleExceptionsCreated = await ensureScheduleExceptions(client, doctorIds);

    const apptSummary = await createAppointmentsTicketsNotifications(client, doctorIds, patientIds);
    const authSeed = await maybeSeedAuthTables(client, [...doctorIds, ...patientIds]);

    const adminAfter = await client.query(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY id`);

    await client.query('COMMIT');

    const checks = await integrityChecks(client, doctorIds, patientIds);

    const adminUnchanged =
      adminBefore.rows.length === adminAfter.rows.length &&
      adminBefore.rows.every((r, i) => r.id === adminAfter.rows[i].id && r.email === adminAfter.rows[i].email);

    console.log('');
    console.log('=== DEMO SEED SUMMARY ===');
    console.log(`Doctors created: ${createdDoctorIds.length}; total demo doctors: ${doctorIds.length}`);
    console.log(`Patients created: ${createdPatientIds.length}; total demo patients: ${patientIds.length}`);
    console.log(
      `Appointments created: completed=${apptSummary.createdByStatus.completed}, cancelled=${apptSummary.createdByStatus.cancelled}, booked=${apptSummary.createdByStatus.booked}`
    );
    console.log(
      `Appointments existing before (demo subset): completed=${apptSummary.existingCounts.completed}, cancelled=${apptSummary.existingCounts.cancelled}, booked=${apptSummary.existingCounts.booked}`
    );
    console.log(
      `Appointment targets (demo subset): completed=${apptSummary.targetByStatus.completed}, cancelled=${apptSummary.targetByStatus.cancelled}, booked=${apptSummary.targetByStatus.booked}`
    );
    console.log(`Tickets created: ${apptSummary.ticketsCreated}`);
    console.log(`Notifications created: ${apptSummary.notificationsCreated}`);
    console.log(`Schedule exceptions created: ${scheduleExceptionsCreated}`);
    console.log(`Refresh tokens created (optional): ${authSeed.refreshCreated}`);
    console.log(`Password reset codes created (optional): ${authSeed.resetCodesCreated}`);
    console.log(`Admin unchanged: ${adminUnchanged ? 'YES' : 'NO'} (admins before=${adminBefore.rows.length}, after=${adminAfter.rows.length})`);
    console.log('');
    console.log('=== INTEGRITY CHECKS ===');
    console.log(`Duplicate doctor/date/time slots (global): ${checks.duplicateSlots}`);
    console.log(`Demo appointments without ticket: ${checks.appointmentsWithoutTicket}`);
    console.log(`Appointments with multiple tickets (global): ${checks.appointmentsWithMultipleTickets}`);
    console.log(`Orphan tickets: ${checks.orphanTickets}`);
    console.log('');
    console.log('Demo credentials:');
    console.log(`Doctors: ${DOCTOR_PREFIX}0001${DEMO_DOMAIN} ... password "${DOCTOR_PASSWORD}"`);
    console.log(`Patients: ${PATIENT_PREFIX}0001${DEMO_DOMAIN} ... password "${PATIENT_PASSWORD}"`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Demo seed failed:', err && err.stack ? err.stack : err.message);
  process.exit(1);
});

