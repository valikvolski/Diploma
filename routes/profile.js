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
const { insertAuditLog, ACTION: AUDIT_ACTION } = require('../utils/auditLog');
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

function wantsProfileAvatarJson(req) {
  return (
    req.get('X-Requested-With') === 'XMLHttpRequest' ||
    (req.get('Accept') || '').includes('application/json')
  );
}

function parsePositiveInt(value, fallback, max = 100) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

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
    const pastPage = parsePositiveInt(req.query.past_page, 1, 10000);
    const pastLimit = parsePositiveInt(req.query.past_limit, 6, 24);
    const pastOffset = (pastPage - 1) * pastLimit;
    const pastSearch = String(req.query.past_search || '').trim();
    const doctorIdRaw = String(req.query.past_doctor_id || '').trim();
    const specializationIdRaw = String(req.query.past_specialization_id || '').trim();
    const pastDoctorId = /^\d+$/.test(doctorIdRaw) ? parseInt(doctorIdRaw, 10) : null;
    const pastSpecializationId = /^\d+$/.test(specializationIdRaw) ? parseInt(specializationIdRaw, 10) : null;

    const commonFromSql = `
      FROM appointments a
      JOIN users d ON a.doctor_id = d.id
      LEFT JOIN doctor_profiles dp ON d.id = dp.user_id
      LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
      LEFT JOIN specializations s ON s.id = dsp.specialization_id
      LEFT JOIN tickets t ON t.appointment_id = a.id`;

    const upcomingRes = await pool.query(
      `SELECT
         a.id AS appointment_id,
         TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
         TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
         a.status,
         d.id AS doctor_id,
         d.last_name AS doctor_last_name,
         d.first_name AS doctor_first_name,
         d.middle_name AS doctor_middle_name,
         s.id AS specialization_id,
         s.name AS specialization,
         dp.cabinet,
         t.id AS ticket_id,
         t.ticket_number
       ${commonFromSql}
       WHERE a.patient_id = $1
         AND a.status = 'booked'
         AND a.appointment_date >= CURRENT_DATE
       ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
      [req.user.id]
    );

    const pastWhere = [
      'a.patient_id = $1',
      "NOT (a.status = 'booked' AND a.appointment_date >= CURRENT_DATE)",
    ];
    const pastParams = [req.user.id];

    if (pastDoctorId) {
      pastParams.push(pastDoctorId);
      pastWhere.push(`d.id = $${pastParams.length}`);
    }
    if (pastSpecializationId) {
      pastParams.push(pastSpecializationId);
      pastWhere.push(`s.id = $${pastParams.length}`);
    }
    if (pastSearch) {
      pastParams.push(`%${escapeLike(pastSearch.toLowerCase())}%`);
      pastWhere.push(
        `(LOWER(CONCAT_WS(' ', d.last_name, d.first_name, d.middle_name)) LIKE $${pastParams.length} ESCAPE '\\'
          OR LOWER(COALESCE(s.name, '')) LIKE $${pastParams.length} ESCAPE '\\')`
      );
    }

    const pastWhereSql = `WHERE ${pastWhere.join(' AND ')}`;

    const pastCountRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       ${commonFromSql}
       ${pastWhereSql}`,
      pastParams
    );

    const pastTotal = pastCountRes.rows[0]?.total || 0;
    const pastTotalPages = Math.max(1, Math.ceil(pastTotal / pastLimit));
    const safePastPage = Math.min(pastPage, pastTotalPages);
    const safePastOffset = (safePastPage - 1) * pastLimit;

    const pastRowsParams = [...pastParams, pastLimit, safePastOffset];
    const pastRes = await pool.query(
      `SELECT
         a.id AS appointment_id,
         TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
         TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
         a.status,
         d.id AS doctor_id,
         d.last_name AS doctor_last_name,
         d.first_name AS doctor_first_name,
         d.middle_name AS doctor_middle_name,
         s.id AS specialization_id,
         s.name AS specialization,
         dp.cabinet,
         t.id AS ticket_id,
         t.ticket_number
       ${commonFromSql}
       ${pastWhereSql}
       ORDER BY a.appointment_date DESC, a.appointment_time DESC
       LIMIT $${pastRowsParams.length - 1}
       OFFSET $${pastRowsParams.length}`,
      pastRowsParams
    );

    const doctorsFilterRes = await pool.query(
      `SELECT DISTINCT d.id, d.last_name, d.first_name, d.middle_name
       FROM appointments a
       JOIN users d ON d.id = a.doctor_id
       WHERE a.patient_id = $1
       ORDER BY d.last_name, d.first_name, d.middle_name`,
      [req.user.id]
    );

    const specsFilterRes = await pool.query(
      `SELECT DISTINCT s.id, s.name
       FROM appointments a
       JOIN users d ON d.id = a.doctor_id
       LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
       LEFT JOIN specializations s ON s.id = dsp.specialization_id
       WHERE a.patient_id = $1 AND s.id IS NOT NULL
       ORDER BY s.name`,
      [req.user.id]
    );

    const upcoming = upcomingRes.rows;
    const past = pastRes.rows;
    const activeTab = req.query.tab === 'past' || pastSearch || pastDoctorId || pastSpecializationId || pastPage > 1
      ? 'past'
      : 'upcoming';

    res.render('profile/appointments', {
      title: 'Мои записи — Запись к врачу',
      upcoming,
      past,
      pastFilters: {
        search: pastSearch,
        doctor_id: pastDoctorId ? String(pastDoctorId) : '',
        specialization_id: pastSpecializationId ? String(pastSpecializationId) : '',
      },
      pastFilterOptions: {
        doctors: doctorsFilterRes.rows,
        specializations: specsFilterRes.rows,
      },
      pastPagination: {
        currentPage: safePastPage,
        limit: pastLimit,
        totalCount: pastTotal,
        totalPages: pastTotalPages,
        hasPrev: safePastPage > 1,
        hasNext: safePastPage < pastTotalPages,
      },
      activeTab,
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
    const profileRes = await pool.query(
      `SELECT user_id,
              TO_CHAR(birth_date, 'YYYY-MM-DD') AS birth_date,
              gender,
              address
       FROM patient_profiles
       WHERE user_id = $1`,
      [req.user.id]
    );

    const userData = userRes.rows[0];
    const profile = profileRes.rows[0] || {};
    const canEditBirthDate = !profile.birth_date;

    const profileIncomplete =
      !String(userData.first_name || '').trim() ||
      !String(userData.last_name || '').trim() ||
      !String(userData.middle_name || '').trim() ||
      patientNeedsPhoneCompletion(userData.phone) ||
      !profile.birth_date;
    const profileWarningBanner = req.query.need_profile === '1' || req.query.need_phone === '1' || profileIncomplete;
    const profileWarningMessage = req.query.warning
      ? String(req.query.warning)
      : 'Перед записью необходимо заполнить профиль.';
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
        birth_date: profile.birth_date || '',
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
      profileWarningBanner,
      profileWarningMessage,
      avatarFromGoogle,
      canEditBirthDate,
      flashSuccess: req.query.success || null,
      flashError: profileWarningBanner ? null : (req.query.error || null),
    });
  } catch (err) {
    console.error('Profile edit load error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки профиля' });
  }
});

// ─── POST /profile/edit ──────────────────────────────────────────────────────

router.post('/edit', ...patientOnly, async (req, res) => {
  const { first_name, last_name, middle_name, phone, gender, address, birth_date } = req.body;
  const formData = { ...req.body, email: req.user.email };

  if (!first_name || !last_name || !middle_name || !phone) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'ФИО и телефон обязательны для заполнения',
      errors: {
        first_name: !first_name ? 'Укажите имя' : undefined,
        last_name: !last_name ? 'Укажите фамилию' : undefined,
        middle_name: !middle_name ? 'Укажите отчество' : undefined,
        phone: !phone ? 'Укажите телефон' : undefined,
      },
      flash: { type: 'danger', message: 'ФИО и телефон обязательны для заполнения' },
      profileWarningBanner: patientNeedsPhoneCompletion(phone) || !String(formData.birth_date || '').trim(),
      profileWarningMessage: 'Перед записью необходимо заполнить профиль.',
      avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
      canEditBirthDate: !String(formData.birth_date || '').trim(),
    });
  }

  const phoneNorm = normalizeBelarusPhone(phone);
  if (!phoneNorm) {
    return res.render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'Неверный формат телефона. Укажите код страны и номер полностью (например +375291234567).',
      errors: { phone: 'Проверьте код страны и длину номера.' },
      flash: { type: 'danger', message: 'Неверный формат телефона. Укажите код страны и номер полностью.' },
      profileWarningBanner: patientNeedsPhoneCompletion(phone) || !String(formData.birth_date || '').trim(),
      profileWarningMessage: 'Перед записью необходимо заполнить профиль.',
      avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
      canEditBirthDate: !String(formData.birth_date || '').trim(),
    });
  }

  try {
    const profileStateRes = await pool.query(
      `SELECT TO_CHAR(birth_date, 'YYYY-MM-DD') AS birth_date
       FROM patient_profiles
       WHERE user_id = $1`,
      [req.user.id]
    );
    const currentBirthDate = profileStateRes.rows[0]?.birth_date || null;
    const canEditBirthDate = !currentBirthDate;

    let birthDateToStore = null;
    if (canEditBirthDate && birth_date) {
      const birthDateRaw = String(birth_date).trim();
      const birthDateValid = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw) && !Number.isNaN(Date.parse(birthDateRaw));
      if (!birthDateValid) {
        return res.render('profile/edit', {
          title: 'Редактировать профиль — Запись к врачу',
          formData,
          avatarUser: avatarUserForEdit(req.user, formData),
          error: 'Неверный формат даты рождения',
          errors: { birth_date: 'Укажите корректную дату' },
          flash: { type: 'danger', message: 'Неверный формат даты рождения' },
          profileWarningBanner: patientNeedsPhoneCompletion(phoneNorm) || !birthDateToStore,
          profileWarningMessage: 'Перед записью необходимо заполнить профиль.',
          avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
          canEditBirthDate,
        });
      }
      birthDateToStore = birthDateRaw;
    }

    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, middle_name=$3, phone=$4 WHERE id=$5',
      [first_name.trim(), last_name.trim(), middle_name.trim(), phoneNorm, req.user.id]
    );

    // Upsert patient_profiles
    await pool.query(
      `INSERT INTO patient_profiles (user_id, birth_date, gender, address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET
         birth_date = COALESCE(patient_profiles.birth_date, EXCLUDED.birth_date),
         gender = EXCLUDED.gender,
         address = EXCLUDED.address`,
      [
        req.user.id,
        birthDateToStore,
        gender || null,
        address ? address.trim() : null,
      ]
    );

    // Обновляем сессию
    res.redirect('/profile/appointments?success=' + encodeURIComponent('Профиль успешно обновлён'));
  } catch (err) {
    console.error('Profile edit save error:', err);
    res.status(500).render('profile/edit', {
      title: 'Редактировать профиль — Запись к врачу',
      formData,
      avatarUser: avatarUserForEdit(req.user, formData),
      error: 'Ошибка сохранения профиля',
      errors: {},
      flash: { type: 'danger', message: 'Ошибка сохранения профиля' },
      profileWarningBanner: patientNeedsPhoneCompletion(formData.phone) || !String(formData.birth_date || '').trim(),
      profileWarningMessage: 'Перед записью необходимо заполнить профиль.',
      avatarFromGoogle: !req.user.avatar_path && !!req.user.avatar_url,
      canEditBirthDate: !String(formData.birth_date || '').trim(),
    });
  }
});

// ─── POST /profile/avatar ────────────────────────────────────────────────────

router.post('/avatar', ...patientOnly, (req, res, next) => {
  const useJson = wantsProfileAvatarJson(req);
  uploadAvatar(req, res, async (err) => {
    const editPath = '/profile/edit';
    if (redirectMulterAvatarError(err, res, editPath, { useJson })) return;
    if (err) return next(err);
    if (!verifyCsrfFromRequest(req)) {
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      if (useJson) {
        return res.status(403).json({ ok: false, error: 'csrf' });
      }
      return res.status(403).render('error', {
        message: 'Запрос отклонён (защита CSRF). Обновите страницу и попробуйте снова.',
      });
    }
    if (!req.file) {
      if (useJson) {
        return res.status(400).json({ ok: false, error: 'Выберите файл изображения' });
      }
      return res.redirect(`${editPath}?error=${encodeURIComponent('Выберите файл изображения')}`);
    }
    try {
      const rel = await finalizeTempToWebp(req.file.path, req.user.id);
      const prev = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [req.user.id]);
      const oldPath = prev.rows[0]?.avatar_path;
      await pool.query('UPDATE users SET avatar_path = $1 WHERE id = $2', [rel, req.user.id]);
      await unlinkDbPath(oldPath);
      const avatarUrl = `/${String(rel).replace(/^\/+/, '')}`;
      if (useJson) {
        return res.json({
          ok: true,
          avatarUrl,
          message: 'Фото профиля обновлено',
        });
      }
      res.redirect(`${editPath}?success=${encodeURIComponent('Фото профиля обновлено')}`);
    } catch (e) {
      console.error('Profile avatar error:', e);
      try {
        await fs.unlink(req.file.path);
      } catch (_) {}
      if (useJson) {
        return res.status(500).json({ ok: false, error: 'Не удалось обработать изображение' });
      }
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
    await insertAuditLog(pool, {
      userId: req.user.id,
      actionType: AUDIT_ACTION.AVATAR_UPDATE,
      oldValue: oldPath || '',
      newValue: '',
    });
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
