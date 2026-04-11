const express = require('express');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAppointmentCreated } = require('../utils/notifications');
const {
  getFreeSlotsForDate,
  getMonthAvailabilityMap,
  invalidateDoctorAvailabilityCache,
} = require('../utils/bookingSlots');

const router = express.Router();

function generateTicketNumber() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `T-${ts}-${rand}`;
}

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = new Date(date + 'T00:00:00');
  if (selected < today) {
    return res.json({ slots: [] });
  }

  try {
    const slots = await getFreeSlotsForDate(pool, doctorId, date);
    res.json({ slots });
  } catch (err) {
    console.error('Slots error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/doctors/:id/availability?month=YYYY-MM ─────────────────────────

router.get('/api/doctors/:id/availability', async (req, res) => {
  const doctorId = parseInt(req.params.id, 10);
  const { month } = req.query;

  if (isNaN(doctorId) || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Укажите month=YYYY-MM' });
  }

  try {
    // Не делаем 404: страница врача уже проверена; здесь только расчёт (как у /slots)
    const availability = await getMonthAvailabilityMap(pool, doctorId, month);
    res.json(availability);
  } catch (err) {
    console.error('Availability error:', err);
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
    const patientId = req.user.id;

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
      const doctorRes = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_blocked = false",
        [doctor_id]
      );
      if (doctorRes.rows.length === 0) {
        return res.status(404).render('error', { message: 'Врач не найден' });
      }

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

      const conflictRes = await pool.query(
        `SELECT id FROM appointments
         WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3::time
           AND status IN ('booked', 'completed')`,
        [doctor_id, date, time]
      );
      if (conflictRes.rows.length > 0) {
        return res.status(409).render('error', {
          message: 'Выбранное время уже занято. Пожалуйста, выберите другое.',
        });
      }

      const freeList = await getFreeSlotsForDate(pool, doctor_id, date);
      if (!freeList.includes(time)) {
        return res.status(409).render('error', {
          message: 'Выбранное время недоступно. Обновите страницу и выберите другое.',
        });
      }

      const apptRes = await pool.query(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
         VALUES ($1, $2, $3, $4, 'booked')
         RETURNING id`,
        [patientId, doctor_id, date, time]
      );
      const appointmentId = apptRes.rows[0].id;

      const ticketNumber = generateTicketNumber();
      const ticketRes = await pool.query(
        'INSERT INTO tickets (appointment_id, ticket_number) VALUES ($1, $2) RETURNING id',
        [appointmentId, ticketNumber]
      );

      invalidateDoctorAvailabilityCache(Number(doctor_id), date);
      notifyAppointmentCreated(appointmentId).catch(e => console.error('Notify error:', e));

      res.redirect(`/tickets/${ticketRes.rows[0].id}`);
    } catch (err) {
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
