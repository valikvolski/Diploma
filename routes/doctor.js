const express = require('express');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const docOnly = [requireAuth, requireRole(['doctor'])];

const WEEKDAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

// ─── GET /doctor/schedule ────────────────────────────────────────────────────

router.get('/schedule', ...docOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM schedules WHERE doctor_id = $1 ORDER BY weekday',
      [req.session.user.id]
    );
    const scheduleMap = {};
    result.rows.forEach(r => { scheduleMap[r.weekday] = r; });

    res.render('doctor/schedule', {
      title: 'Расписание — Кабинет врача',
      scheduleMap,
      weekdays: WEEKDAYS,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Doctor schedule error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки расписания' });
  }
});

// ─── POST /doctor/schedule ───────────────────────────────────────────────────

router.post('/schedule', ...docOnly, async (req, res) => {
  const { weekday, start_time, end_time, slot_duration } = req.body;
  const wd = parseInt(weekday, 10);
  const dur = parseInt(slot_duration, 10);

  if (isNaN(wd) || wd < 0 || wd > 6 || !start_time || !end_time || isNaN(dur) || dur < 10) {
    return res.redirect('/doctor/schedule?error=' + encodeURIComponent('Некорректные данные'));
  }
  if (start_time >= end_time) {
    return res.redirect('/doctor/schedule?error=' + encodeURIComponent('Время начала должно быть раньше окончания'));
  }

  try {
    await pool.query(
      `INSERT INTO schedules (doctor_id, weekday, start_time, end_time, slot_duration)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (doctor_id, weekday)
       DO UPDATE SET start_time = $3, end_time = $4, slot_duration = $5`,
      [req.session.user.id, wd, start_time, end_time, dur]
    );
    res.redirect('/doctor/schedule?success=' + encodeURIComponent('Расписание обновлено'));
  } catch (err) {
    console.error('Schedule save error:', err);
    res.redirect('/doctor/schedule?error=' + encodeURIComponent('Ошибка сохранения'));
  }
});

// ─── POST /doctor/schedule/:id/delete ────────────────────────────────────────

router.post('/schedule/:id/delete', ...docOnly, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM schedules WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.session.user.id]
    );
    res.redirect('/doctor/schedule?success=' + encodeURIComponent('День удалён из расписания'));
  } catch (err) {
    console.error('Schedule delete error:', err);
    res.redirect('/doctor/schedule?error=' + encodeURIComponent('Ошибка удаления'));
  }
});

// ─── GET /doctor/exceptions ──────────────────────────────────────────────────

router.get('/exceptions', ...docOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, TO_CHAR(exception_date, 'YYYY-MM-DD') AS exception_date, reason
       FROM schedule_exceptions
       WHERE doctor_id = $1 ORDER BY exception_date DESC`,
      [req.session.user.id]
    );
    const today = new Date().toISOString().split('T')[0];
    const upcoming = result.rows.filter(r => r.exception_date >= today);
    const past = result.rows.filter(r => r.exception_date < today);

    res.render('doctor/exceptions', {
      title: 'Исключения — Кабинет врача',
      upcoming, past,
      todayStr: today,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Exceptions error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /doctor/exceptions ─────────────────────────────────────────────────

router.post('/exceptions', ...docOnly, async (req, res) => {
  const { exception_date, reason } = req.body;
  const today = new Date().toISOString().split('T')[0];

  if (!exception_date || exception_date < today) {
    return res.redirect('/doctor/exceptions?error=' + encodeURIComponent('Дата должна быть сегодня или позже'));
  }

  try {
    await pool.query(
      `INSERT INTO schedule_exceptions (doctor_id, exception_date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (doctor_id, exception_date) DO UPDATE SET reason = $3`,
      [req.session.user.id, exception_date, reason || 'Выходной']
    );
    res.redirect('/doctor/exceptions?success=' + encodeURIComponent('Исключение добавлено'));
  } catch (err) {
    console.error('Exception add error:', err);
    res.redirect('/doctor/exceptions?error=' + encodeURIComponent('Ошибка добавления'));
  }
});

// ─── POST /doctor/exceptions/:id/delete ──────────────────────────────────────

router.post('/exceptions/:id/delete', ...docOnly, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM schedule_exceptions WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.session.user.id]
    );
    res.redirect('/doctor/exceptions?success=' + encodeURIComponent('Исключение удалено'));
  } catch (err) {
    console.error('Exception delete error:', err);
    res.redirect('/doctor/exceptions?error=' + encodeURIComponent('Ошибка удаления'));
  }
});

// ─── GET /doctor/patients ────────────────────────────────────────────────────

router.get('/patients', ...docOnly, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      `SELECT
         a.id AS appointment_id,
         TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
         a.status,
         p.last_name, p.first_name, p.middle_name, p.phone
       FROM appointments a
       JOIN users p ON a.patient_id = p.id
       WHERE a.doctor_id = $1 AND a.appointment_date = $2
       ORDER BY a.appointment_time ASC`,
      [req.session.user.id, date]
    );

    res.render('doctor/patients', {
      title: 'Пациенты — Кабинет врача',
      appointments: result.rows,
      selectedDate: date,
      todayStr: new Date().toISOString().split('T')[0],
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Doctor patients error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /doctor/appointments/:id/status ────────────────────────────────────

router.post('/appointments/:id/status', ...docOnly, async (req, res) => {
  const { status, redirect_date } = req.body;
  const apptId = parseInt(req.params.id, 10);

  if (!['completed', 'cancelled'].includes(status)) {
    return res.redirect('/doctor/patients?error=' + encodeURIComponent('Недопустимый статус'));
  }

  try {
    const check = await pool.query(
      'SELECT doctor_id, appointment_date FROM appointments WHERE id = $1',
      [apptId]
    );
    if (check.rows.length === 0 || check.rows[0].doctor_id !== req.session.user.id) {
      return res.status(403).render('error', { message: 'Доступ запрещён' });
    }

    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, apptId]);
    const dateParam = redirect_date || new Date().toISOString().split('T')[0];
    res.redirect(`/doctor/patients?date=${dateParam}&success=` + encodeURIComponent('Статус обновлён'));
  } catch (err) {
    console.error('Status update error:', err);
    res.redirect('/doctor/patients?error=' + encodeURIComponent('Ошибка обновления'));
  }
});

module.exports = router;
