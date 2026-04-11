const express = require('express');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadAvatar, unlinkDbPath, finalizeTempToWebp } = require('../middleware/avatarUpload');
const { redirectMulterAvatarError } = require('../utils/avatarErrors');
const { patientNeedsPhoneCompletion, normalizeBelarusPhone } = require('../utils/patientPhone');
const { verifyCsrfFromRequest } = require('../middleware/csrf');
const { sendAppointmentCancelledEmail, sendProfilePasswordChangeCodeEmail, sendPasswordChangedNoticeEmail } = require('../utils/mailer');
const {
  PURPOSE_PROFILE_CHANGE,
  sendPasswordVerificationCode,
  verifyPurposeCodeAndSetPassword,
} = require('../utils/passwordResetOps');
const {
  revokeAllRefreshTokensForUser,
  revokeRefreshByRaw,
  clearAuthCookies,
} = require('../utils/jwtTokens');

const router = express.Router();
const patientOnly = [requireAuth, requireRole(['patient'])];
const SALT_ROUNDS = 10;

const profilePasswordSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ ok: false, error: 'rate_limit', message: 'Слишком много запросов. Попробуйте позже.' });
  },
});

const profilePasswordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 35,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({ ok: false, error: 'rate_limit', message: 'Слишком много попыток. Подождите.' });
  },
});

function avatarUserForEdit(currentUser, formData) {
  return {
    id: currentUser.id,
    email: formData.email,
    first_name: formData.first_name,
    last_name: formData.last_name,
    avatar_path: currentUser.avatar_path,
    avatar_url: currentUser.avatar_url || null,
  };
}

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
       LEFT JOIN doctor_profiles dp ON d.id = dp.user_id
       LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
       LEFT JOIN specializations s ON s.id = dsp.specialization_id
       LEFT JOIN tickets t             ON t.appointment_id = a.id
       WHERE a.patient_id = $1
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [req.user.id]
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

    if (appt.patient_id !== req.user.id) {
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

    sendAppointmentCancelledEmail(pool, appointmentId);

    res.redirect('/profile/appointments?success=' + encodeURIComponent('Запись успешно отменена'));
  } catch (err) {
    console.error('Cancel error:', err);
    res.redirect('/profile/appointments?error=' + encodeURIComponent('Ошибка при отмене записи'));
  }
});

// ─── GET /profile/edit ───────────────────────────────────────────────────────

router.get('/edit', ...patientOnly, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const profileRes = await pool.query('SELECT * FROM patient_profiles WHERE user_id = $1', [req.user.id]);

    const userData = userRes.rows[0];
    const profile = profileRes.rows[0] || {};

    const needPhoneBanner =
      req.query.need_phone === '1' || patientNeedsPhoneCompletion(userData.phone);
    const avatarFromGoogle =
      !userData.avatar_path &&
      !!(userData.avatar_url || userData.google_picture_url);

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
      },
      avatarUser: {
        id: userData.id,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        avatar_path: userData.avatar_path,
        avatar_url: userData.avatar_url,
      },
      needPhoneBanner,
      avatarFromGoogle,
      flashSuccess: req.query.success || null,
      flashError: req.query.error || null,
    });
  } catch (err) {
    console.error('Profile edit load error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки профиля' });
  }
});

// ─── POST /profile/edit ──────────────────────────────────────────────────────

router.post('/edit', ...patientOnly, async (req, res) => {
  const { first_name, last_name, middle_name, phone, birth_date, gender, address } = req.body;
  const formData = { ...req.body, email: req.user.email };

  const profileEditExtras = {
    needPhoneBanner: patientNeedsPhoneCompletion(phone),
    avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
  };

  if (!first_name || !last_name || !middle_name || !phone) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'ФИО и телефон обязательны для заполнения',
      ...profileEditExtras,
    });
  }

  const phoneNorm = normalizeBelarusPhone(phone);
  if (!phoneNorm) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'Неверный формат телефона. Пример: 375291234567',
      ...profileEditExtras,
    });
  }

  try {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, middle_name=$3, phone=$4 WHERE id=$5',
      [first_name.trim(), last_name.trim(), middle_name.trim(), phoneNorm, req.user.id]
    );

    // Upsert patient_profiles
    await pool.query(
      `INSERT INTO patient_profiles (user_id, birth_date, gender, address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET birth_date = EXCLUDED.birth_date, gender = EXCLUDED.gender, address = EXCLUDED.address`,
      [
        req.user.id,
        birth_date || null,
        gender || null,
        address ? address.trim() : null,
      ]
    );

    // Обновляем сессию
    res.redirect('/profile/appointments?success=' + encodeURIComponent('Профиль успешно обновлён'));
  } catch (err) {
    console.error('Profile edit save error:', err);
    res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'Ошибка сохранения профиля',
      needPhoneBanner: patientNeedsPhoneCompletion(formData.phone),
      avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
    });
  }
});

// ─── POST /profile/avatar ────────────────────────────────────────────────────

router.post('/avatar', ...patientOnly, (req, res, next) => {
  uploadAvatar(req, res, async (err) => {
    const editPath = '/profile/edit';
    if (redirectMulterAvatarError(err, res, editPath)) return;
    if (err) return next(err);
    if (!verifyCsrfFromRequest(req)) {
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      return res.status(403).render('error', {
        message: 'Запрос отклонён (защита CSRF). Обновите страницу и попробуйте снова.',
      });
    }
    if (!req.file) {
      return res.redirect(`${editPath}?error=${encodeURIComponent('Выберите файл изображения')}`);
    }
    try {
      const rel = await finalizeTempToWebp(req.file.path, req.user.id);
      const prev = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [req.user.id]);
      const oldPath = prev.rows[0]?.avatar_path;
      await pool.query('UPDATE users SET avatar_path = $1 WHERE id = $2', [rel, req.user.id]);
      await unlinkDbPath(oldPath);
      res.redirect(`${editPath}?success=${encodeURIComponent('Фото профиля обновлено')}`);
    } catch (e) {
      console.error('Profile avatar error:', e);
      try {
        await fs.unlink(req.file.path);
      } catch (_) {}
      res.redirect(`${editPath}?error=${encodeURIComponent('Не удалось обработать изображение')}`);
    }
  });
});

// ─── POST /profile/avatar/remove ─────────────────────────────────────────────

router.post('/avatar/remove', ...patientOnly, async (req, res) => {
  try {
    const prev = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [req.user.id]);
    const oldPath = prev.rows[0]?.avatar_path;
    await pool.query('UPDATE users SET avatar_path = NULL WHERE id = $1', [req.user.id]);
    await unlinkDbPath(oldPath);
    res.redirect('/profile/edit?success=' + encodeURIComponent('Фото профиля удалено'));
  } catch (e) {
    console.error('Profile avatar remove error:', e);
    res.redirect('/profile/edit?error=' + encodeURIComponent('Не удалось удалить фото'));
  }
});

// ─── POST /profile/password/send-code (JSON, пациент) ─────────────────────────

router.post('/password/send-code', profilePasswordSendLimiter, ...patientOnly, async (req, res) => {
  if (!verifyCsrfFromRequest(req)) {
    return res.status(403).json({ ok: false, error: 'csrf' });
  }
  try {
    const uRes = await pool.query('SELECT id, email, is_blocked FROM users WHERE id = $1', [req.user.id]);
    if (!uRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'user' });
    }
    const u = uRes.rows[0];
    if (u.is_blocked) {
      return res.status(403).json({ ok: false, error: 'blocked' });
    }

    const result = await sendPasswordVerificationCode(pool, {
      userId: u.id,
      email: u.email,
      purpose: PURPOSE_PROFILE_CHANGE,
      sendMailWithPlain: async ({ plain, expiresMinutes, to }) => {
        await sendProfilePasswordChangeCodeEmail({
          to,
          code: plain,
          expiresMinutes,
        });
      },
    });

    if (result.reason === 'config') {
      return res.status(503).json({ ok: false, error: 'config', message: 'Сервис временно недоступен.' });
    }
    if (!result.sent && result.reason === 'cooldown') {
      return res.json({
        ok: true,
        sent: false,
        message: 'Подождите минуту перед повторной отправкой кода.',
      });
    }
    if (!result.sent && result.reason === 'hourly_limit') {
      return res.json({
        ok: true,
        sent: false,
        message: 'Превышен лимит писем в час. Попробуйте позже.',
      });
    }
    return res.json({ ok: true, sent: true });
  } catch (err) {
    console.error('Profile password send-code:', err.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ─── POST /profile/password/change (JSON, пациент) ───────────────────────────

router.post('/password/change', profilePasswordChangeLimiter, ...patientOnly, async (req, res) => {
  if (!verifyCsrfFromRequest(req)) {
    return res.status(403).json({ ok: false, error: 'csrf' });
  }

  const { code, password, password_confirm } = req.body || {};
  const pwd = typeof password === 'string' ? password : '';
  const pwd2 = typeof password_confirm === 'string' ? password_confirm : '';

  if (!pwd || pwd.length < 6) {
    return res.status(400).json({ ok: false, error: 'weak_password' });
  }
  if (pwd !== pwd2) {
    return res.status(400).json({ ok: false, error: 'mismatch' });
  }

  try {
    const uRes = await pool.query('SELECT id, email, first_name, is_blocked FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!uRes.rows.length || uRes.rows[0].is_blocked) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const u = uRes.rows[0];

    const passwordHash = await bcrypt.hash(pwd, SALT_ROUNDS);
    const vr = await verifyPurposeCodeAndSetPassword(pool, {
      userId: u.id,
      purpose: PURPOSE_PROFILE_CHANGE,
      codeRaw: code,
      password: pwd,
      bcryptHash: passwordHash,
    });

    if (!vr.ok) {
      return res.status(400).json({ ok: false, error: vr.error });
    }

    await revokeAllRefreshTokensForUser(pool, u.id);
    try {
      await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
    } catch (_) {}
    clearAuthCookies(res);

    sendPasswordChangedNoticeEmail({ to: u.email, firstName: u.first_name }).catch(() => {});

    return res.json({
      ok: true,
      redirect: '/auth/login?password_changed=1',
    });
  } catch (err) {
    console.error('Profile password change:', err.message || err);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

module.exports = router;
