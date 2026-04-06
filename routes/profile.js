const express = require('express');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const patientOnly = [requireAuth, requireRole(['patient'])];

// ─── GET /profile → редирект ─────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  res.redirect('/profile/appointments');
});

// ─── GET /profile/appointments ───────────────────────────────────────────────

router.get('/appointments', ...patientOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id AS appointment_id,
         TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
         TO_CHAR(a.appointment_time, 'HH24:MI')    AS appointment_time,
         a.status,
         a.appointment_date AS raw_date,
         d.id          AS doctor_id,
         d.last_name   AS doctor_last_name,
         d.first_name  AS doctor_first_name,
         d.middle_name AS doctor_middle_name,
         s.name        AS specialization,
         dp.cabinet,
         t.id          AS ticket_id,
         t.ticket_number
       FROM appointments a
       JOIN users d                    ON a.doctor_id = d.id
       LEFT JOIN doctor_profiles dp    ON d.id = dp.user_id
       LEFT JOIN specializations s     ON dp.specialization_id = s.id
       LEFT JOIN tickets t             ON t.appointment_id = a.id
       WHERE a.patient_id = $1
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [req.session.user.id]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = [];
    const past = [];

    result.rows.forEach(row => {
      const rd = new Date(row.raw_date);
      rd.setHours(0, 0, 0, 0);
      if (rd >= today && row.status === 'booked') {
        upcoming.push(row);
      } else {
        past.push(row);
      }
    });

    // Сортировка: предстоящие — по возрастанию даты
    upcoming.sort((a, b) => a.appointment_date.localeCompare(b.appointment_date) || a.appointment_time.localeCompare(b.appointment_time));

    res.render('profile/appointments', {
      title: 'Мои записи — Запись к врачу',
      upcoming,
      past,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Profile appointments error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки записей' });
  }
});

// ─── POST /profile/appointments/:id/cancel ───────────────────────────────────

router.post('/appointments/:id/cancel', ...patientOnly, async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  if (isNaN(appointmentId)) {
    return res.redirect('/profile/appointments?error=' + encodeURIComponent('Запись не найдена'));
  }

  try {
    const check = await pool.query(
      `SELECT id, patient_id, appointment_date, status
       FROM appointments WHERE id = $1`,
      [appointmentId]
    );

    if (check.rows.length === 0) {
      return res.redirect('/profile/appointments?error=' + encodeURIComponent('Запись не найдена'));
    }

    const appt = check.rows[0];

    if (appt.patient_id !== req.session.user.id) {
      return res.status(403).render('error', { message: 'Доступ запрещён' });
    }

    if (appt.status !== 'booked') {
      return res.redirect('/profile/appointments?error=' + encodeURIComponent('Эту запись нельзя отменить'));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const apptDate = new Date(appt.appointment_date);
    apptDate.setHours(0, 0, 0, 0);
    if (apptDate < today) {
      return res.redirect('/profile/appointments?error=' + encodeURIComponent('Нельзя отменить прошедшую запись'));
    }

    await pool.query(
      "UPDATE appointments SET status = 'cancelled' WHERE id = $1",
      [appointmentId]
    );

    res.redirect('/profile/appointments?success=' + encodeURIComponent('Запись успешно отменена'));
  } catch (err) {
    console.error('Cancel error:', err);
    res.redirect('/profile/appointments?error=' + encodeURIComponent('Ошибка при отмене записи'));
  }
});

// ─── GET /profile/edit ───────────────────────────────────────────────────────

router.get('/edit', ...patientOnly, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    const profileRes = await pool.query('SELECT * FROM patient_profiles WHERE user_id = $1', [req.session.user.id]);

    const userData = userRes.rows[0];
    const profile = profileRes.rows[0] || {};

    res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData: {
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        middle_name: userData.middle_name,
        phone: userData.phone,
        birth_date: profile.birth_date ? new Date(profile.birth_date).toISOString().split('T')[0] : '',
        gender: profile.gender || '',
        address: profile.address || '',
        policy_number: profile.policy_number || '',
      },
    });
  } catch (err) {
    console.error('Profile edit load error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки профиля' });
  }
});

// ─── POST /profile/edit ──────────────────────────────────────────────────────

router.post('/edit', ...patientOnly, async (req, res) => {
  const { first_name, last_name, middle_name, phone, birth_date, gender, address, policy_number } = req.body;
  const formData = { ...req.body, email: req.session.user.email };

  if (!first_name || !last_name || !middle_name || !phone) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      error: 'ФИО и телефон обязательны для заполнения',
    });
  }

  if (!/^\+375[0-9]{9}$/.test(phone.trim())) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      error: 'Неверный формат телефона. Пример: +375291234567',
    });
  }

  try {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, middle_name=$3, phone=$4 WHERE id=$5',
      [first_name.trim(), last_name.trim(), middle_name.trim(), phone.trim(), req.session.user.id]
    );

    // Upsert patient_profiles
    await pool.query(
      `INSERT INTO patient_profiles (user_id, birth_date, gender, address, policy_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET birth_date=$2, gender=$3, address=$4, policy_number=$5`,
      [
        req.session.user.id,
        birth_date || null,
        gender || null,
        address ? address.trim() : null,
        policy_number ? policy_number.trim() : null,
      ]
    );

    // Обновляем сессию
    req.session.user.first_name = first_name.trim();
    req.session.user.last_name = last_name.trim();
    req.session.user.middle_name = middle_name.trim();

    res.redirect('/profile/appointments?success=' + encodeURIComponent('Профиль успешно обновлён'));
  } catch (err) {
    console.error('Profile edit save error:', err);
    res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      error: 'Ошибка сохранения профиля',
    });
  }
});

module.exports = router;
