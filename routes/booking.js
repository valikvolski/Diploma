const express = require('express');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
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

function generateTicketNumber() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `T-${ts}-${rand}`;
}

// Нормализует время "09:30:00" → "09:30"
function normalizeTime(t) {
  return t ? t.substring(0, 5) : t;
}

// Проверка формата YYYY-MM-DD
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

// ─── GET /api/doctors/:id/slots ───────────────────────────────────────────────

router.get('/api/doctors/:id/slots', async (req, res) => {
  const doctorId = parseInt(req.params.id, 10);
  const { date } = req.query;

  if (isNaN(doctorId) || !isValidDate(date)) {
    return res.status(400).json({ error: 'Неверные параметры запроса' });
  }

  // Запрещаем выбор прошедших дат
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = new Date(date + 'T00:00:00');
  if (selected < today) {
    return res.json({ slots: [] });
  }

  try {
    // Получаем расписание на день недели (PostgreSQL DOW: 0=Sun … 6=Sat)
    const scheduleRes = await pool.query(
      `SELECT start_time, end_time, slot_duration
       FROM schedules
       WHERE doctor_id = $1
         AND weekday = EXTRACT(DOW FROM $2::date)`,
      [doctorId, date]
    );

    if (scheduleRes.rows.length === 0) {
      return res.json({ slots: [] });
    }

    // Проверяем исключения (отпуск/больничный)
    const exceptionRes = await pool.query(
      'SELECT id FROM schedule_exceptions WHERE doctor_id = $1 AND exception_date = $2',
      [doctorId, date]
    );
    if (exceptionRes.rows.length > 0) {
      return res.json({ slots: [] });
    }

    const { start_time, end_time, slot_duration } = scheduleRes.rows[0];
    const allSlots = generateSlots(start_time, end_time, slot_duration);

    // Получаем уже занятые слоты
    const bookedRes = await pool.query(
      `SELECT appointment_time FROM appointments
       WHERE doctor_id = $1 AND appointment_date = $2 AND status IN ('booked','completed')`,
      [doctorId, date]
    );
    const bookedSet = new Set(bookedRes.rows.map(r => normalizeTime(r.appointment_time)));

    const freeSlots = allSlots.filter(s => !bookedSet.has(s));
    res.json({ slots: freeSlots });
  } catch (err) {
    console.error('Slots error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /appointments ───────────────────────────────────────────────────────

router.post(
  '/appointments',
  requireAuth,
  requireRole(['patient']),
  async (req, res) => {
    const { doctor_id, date, time } = req.body;
    const patientId = req.session.user.id;

    // Базовая валидация
    if (!doctor_id || !isValidDate(date) || !time || !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).render('error', { message: 'Некорректные данные для записи' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(date + 'T00:00:00');
    if (selected < today) {
      return res.status(400).render('error', { message: 'Нельзя записаться на прошедшую дату' });
    }

    try {
      // Проверяем что врач существует и активен
      const doctorRes = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_blocked = false",
        [doctor_id]
      );
      if (doctorRes.rows.length === 0) {
        return res.status(404).render('error', { message: 'Врач не найден' });
      }

      // Проверяем что пациент ещё не записан к этому врачу на эту дату
      const dupRes = await pool.query(
        `SELECT id FROM appointments
         WHERE patient_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND status = 'booked'`,
        [patientId, doctor_id, date]
      );
      if (dupRes.rows.length > 0) {
        return res.status(400).render('error', {
          message: 'Вы уже записаны к этому врачу на выбранную дату',
        });
      }

      // Создаём запись (UNIQUE constraint предотвращает двойное бронирование)
      const apptRes = await pool.query(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
         VALUES ($1, $2, $3, $4, 'booked')
         RETURNING id`,
        [patientId, doctor_id, date, time]
      );
      const appointmentId = apptRes.rows[0].id;

      // Создаём талон
      const ticketNumber = generateTicketNumber();
      const ticketRes = await pool.query(
        'INSERT INTO tickets (appointment_id, ticket_number) VALUES ($1, $2) RETURNING id',
        [appointmentId, ticketNumber]
      );

      res.redirect(`/tickets/${ticketRes.rows[0].id}`);
    } catch (err) {
      // Код 23505 = нарушение UNIQUE — слот уже занят
      if (err.code === '23505') {
        return res.status(409).render('error', {
          message: 'Выбранное время уже занято. Пожалуйста, выберите другое.',
        });
      }
      console.error('Booking error:', err);
      res.status(500).render('error', { message: 'Ошибка при создании записи' });
    }
  }
);

module.exports = router;
