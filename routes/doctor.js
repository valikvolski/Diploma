const express = require('express');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAppointmentCancelled } = require('../utils/notifications');
const { invalidateDoctorAvailabilityCache } = require('../utils/bookingSlots');

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

// ─── Helpers: dates ───────────────────────────────────────────────────────────
function ymdUtc(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(from + 'T12:00:00Z');
  const end = new Date((to || from) + 'T12:00:00Z');
  while (cur <= end) {
    dates.push(ymdUtc(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function normalizeTime(v) {
  return v ? String(v).substring(0, 5) : null;
}

// ─── GET /doctor/time-off ────────────────────────────────────────────────────
async function renderTimeOffPage(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         id,
         TO_CHAR(COALESCE(date_from, exception_date), 'YYYY-MM-DD') AS date_from,
         TO_CHAR(COALESCE(date_to, exception_date), 'YYYY-MM-DD')   AS date_to,
         COALESCE(is_day_off, TRUE) AS is_day_off,
         start_time, end_time,
         reason
       FROM schedule_exceptions
       WHERE doctor_id = $1
       ORDER BY COALESCE(date_from, exception_date) DESC, id DESC`,
      [req.session.user.id]
    );
    const today = new Date().toISOString().split('T')[0];
    const upcoming = result.rows
      .filter(r => r.date_to >= today)
      .map(r => ({ ...r, start_time: normalizeTime(r.start_time), end_time: normalizeTime(r.end_time) }));
    const past = result.rows
      .filter(r => r.date_to < today)
      .map(r => ({ ...r, start_time: normalizeTime(r.start_time), end_time: normalizeTime(r.end_time) }));

    res.render('doctor/exceptions', {
      title: 'Нерабочие дни — Кабинет врача',
      upcoming, past,
      todayStr: today,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Time-off page error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
}

router.get('/time-off', ...docOnly, renderTimeOffPage);
// legacy URL
router.get('/exceptions', ...docOnly, (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect('/doctor/time-off' + (query ? `?${query}` : ''));
});

// ─── POST /doctor/time-off ───────────────────────────────────────────────────
async function createTimeOff(req, res) {
  const { exception_date, date_to, reason, mode, is_day_off, start_time, end_time } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const dateFrom = exception_date;

  if (!dateFrom || dateFrom < today) {
    return res.redirect('/doctor/time-off?error=' + encodeURIComponent('Дата должна быть сегодня или позже'));
  }

  const dateTo = (mode === 'period' && date_to && date_to >= dateFrom) ? date_to : dateFrom;
  const dates = dateRange(dateFrom, dateTo);

  if (dates.length > 60) {
    return res.redirect('/doctor/time-off?error=' + encodeURIComponent('Максимум 60 дней за один раз'));
  }

  const dayOff = is_day_off === 'on' || is_day_off === 'true' || is_day_off === true;
  const start = dayOff ? null : normalizeTime(start_time);
  const end = dayOff ? null : normalizeTime(end_time);
  if (!dayOff) {
    if (!start || !end || start >= end) {
      return res.redirect('/doctor/time-off?error=' + encodeURIComponent('Укажите корректное рабочее время'));
    }
  }

  const doctorId = req.session.user.id;
  const reasonText = (reason || '').trim() || (dayOff ? 'Нерабочий период' : 'Изменённое время приёма');
  let totalCancelled = 0;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let affected;
      if (dayOff) {
        affected = await client.query(
          `SELECT id
           FROM appointments
           WHERE doctor_id = $1
             AND appointment_date BETWEEN $2::date AND $3::date
             AND status = 'booked'`,
          [doctorId, dateFrom, dateTo]
        );
      } else {
        affected = await client.query(
          `SELECT id
           FROM appointments
           WHERE doctor_id = $1
             AND appointment_date BETWEEN $2::date AND $3::date
             AND status = 'booked'
             AND (appointment_time < $4::time OR appointment_time >= $5::time)`,
          [doctorId, dateFrom, dateTo, start, end]
        );
      }

      if (affected.rows.length > 0) {
        await client.query(
          `UPDATE appointments
           SET status = 'cancelled'
           WHERE id = ANY($1::int[])`,
          [affected.rows.map(a => a.id)]
        );
        totalCancelled = affected.rows.length;
        for (const apt of affected.rows) {
          await notifyAppointmentCancelled(apt.id, { mode: 'day_off' });
        }
      }

      await client.query(
        `INSERT INTO schedule_exceptions
           (doctor_id, exception_date, date_from, date_to, is_day_off, start_time, end_time, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [doctorId, dateFrom, dateFrom, dateTo, dayOff, start, end, reasonText]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    for (const d of dates) {
      invalidateDoctorAvailabilityCache(doctorId, d);
    }

    let msg = dates.length === 1
      ? 'Нерабочий день сохранён'
      : 'Период изменений в графике сохранён';
    if (totalCancelled > 0) {
      msg += `, отменено записей: ${totalCancelled}, уведомления отправлены`;
    }
    res.redirect('/doctor/time-off?success=' + encodeURIComponent(msg));
  } catch (err) {
    console.error('Time-off save error:', err);
    res.redirect('/doctor/time-off?error=' + encodeURIComponent('Ошибка сохранения'));
  }
}

router.post('/time-off', ...docOnly, createTimeOff);
// legacy URL
router.post('/exceptions', ...docOnly, createTimeOff);

// ─── POST /doctor/time-off/:id/delete ────────────────────────────────────────
async function deleteTimeOff(req, res) {
  try {
    const old = await pool.query(
      `SELECT TO_CHAR(COALESCE(date_from, exception_date), 'YYYY-MM-DD') AS date_from,
              TO_CHAR(COALESCE(date_to, exception_date), 'YYYY-MM-DD') AS date_to
       FROM schedule_exceptions
       WHERE id = $1 AND doctor_id = $2`,
      [req.params.id, req.session.user.id]
    );
    await pool.query(
      'DELETE FROM schedule_exceptions WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (old.rows.length > 0) {
      for (const d of dateRange(old.rows[0].date_from, old.rows[0].date_to)) {
        invalidateDoctorAvailabilityCache(req.session.user.id, d);
      }
    }
    res.redirect('/doctor/time-off?success=' + encodeURIComponent('Запись удалена'));
  } catch (err) {
    console.error('Time-off delete error:', err);
    res.redirect('/doctor/time-off?error=' + encodeURIComponent('Ошибка удаления'));
  }
}

router.post('/time-off/:id/delete', ...docOnly, deleteTimeOff);
// legacy URL
router.post('/exceptions/:id/delete', ...docOnly, deleteTimeOff);

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

    if (status === 'cancelled') {
      await notifyAppointmentCancelled(apptId, {
        mode: 'manual',
        reason: 'Запись отменена врачом',
      });
    }

    const dateParam = redirect_date || new Date().toISOString().split('T')[0];
    res.redirect(`/doctor/patients?date=${dateParam}&success=` + encodeURIComponent('Статус обновлён'));
  } catch (err) {
    console.error('Status update error:', err);
    res.redirect('/doctor/patients?error=' + encodeURIComponent('Ошибка обновления'));
  }
});

module.exports = router;
