const express = require('express');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadAvatar, unlinkDbPath, finalizeTempToWebp } = require('../middleware/avatarUpload');
const { redirectMulterAvatarError } = require('../utils/avatarErrors');
const { verifyCsrfFromRequest } = require('../middleware/csrf');
const {
  validateSpecializationSet,
  resolvePrimarySpecializationId,
} = require('../utils/specializationCompat');
const { normalizeBelarusPhone } = require('../utils/patientPhone');
const { maskPhoneForAdmin } = require('../utils/adminPhoneMask');
const { insertAuditLog, ACTION: AUDIT_ACTION } = require('../utils/auditLog');

function parseSpecializationIds(body) {
  const raw =
    body.specialization_ids != null
      ? body.specialization_ids
      : body['specialization_ids[]'];
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x) => parseInt(x, 10))
    .filter((n) => !isNaN(n));
}

async function loadSpecsForForms(clientOrPool) {
  const { rows } = await clientOrPool.query(
    `SELECT s.id,
            s.name,
            COALESCE(sg.code, s.compat_group, 'therapy') AS compat_group,
            s.specialization_group_id
     FROM specializations s
     LEFT JOIN specialization_groups sg ON sg.id = s.specialization_group_id
     ORDER BY s.name`
  );
  return rows;
}

async function loadSpecializationGroups(clientOrPool) {
  const { rows } = await clientOrPool.query(
    `SELECT sg.id, sg.code, sg.name,
            COUNT(s.id)::int AS specialization_count
     FROM specialization_groups sg
     LEFT JOIN specializations s ON s.specialization_group_id = sg.id
     GROUP BY sg.id, sg.code, sg.name
     ORDER BY sg.name`
  );
  return rows;
}

function normalizeGroupCode(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'group';
}

async function makeUniqueGroupCode(clientOrPool, name) {
  const base = normalizeGroupCode(name);
  let attempt = base;
  let i = 1;
  while (true) {
    const { rows } = await clientOrPool.query('SELECT 1 FROM specialization_groups WHERE code = $1', [attempt]);
    if (!rows.length) return attempt;
    i += 1;
    attempt = `${base}_${i}`;
  }
}

async function replaceDoctorSpecializations(client, doctorUserId, specIds, primaryId) {
  await client.query('DELETE FROM doctor_specializations WHERE doctor_user_id = $1', [
    doctorUserId,
  ]);
  for (const sid of specIds) {
    await client.query(
      `INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
       VALUES ($1, $2, $3)`,
      [doctorUserId, sid, sid === primaryId]
    );
  }
  await client.query(
    'UPDATE doctor_profiles SET specialization_id = $1 WHERE user_id = $2',
    [primaryId, doctorUserId]
  );
}

const router = express.Router();
const adminOnly = [requireAuth, requireRole(['admin'])];
const SALT_ROUNDS = 10;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parsePagination(query) {
  const pageRaw = parseInt(query.page, 10);
  const limitRaw = parseInt(query.limit, 10);
  const page = !isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  let limit = !isNaN(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

function buildPagination(totalCount, page, limit) {
  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return {
    totalCount: totalCount || 0,
    totalPages,
    currentPage,
    limit,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}

const USER_PROFILE_APPT_PAGE_SIZE = 10;
const USER_PROFILE_AUDIT_PAGE_SIZE = 15;
const USER_PROFILE_ACTIVITY_PAGE_SIZE = 20;
const USER_PROFILE_MAX_PAGE = 500;

function clampProfilePage(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, USER_PROFILE_MAX_PAGE);
}

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

const APPT_FIELDS_PATIENT = `a.id,
              TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
              TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
              a.status,
              d.last_name AS doctor_last_name,
              d.first_name AS doctor_first_name,
              d.middle_name AS doctor_middle_name`;

const APPT_FIELDS_DOCTOR = `a.id,
                    TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
                    TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
                    a.status,
                    p.last_name AS patient_last_name,
                    p.first_name AS patient_first_name,
                    p.middle_name AS patient_middle_name`;

async function fetchPatientApptBucket(pool, patientUserId, status, page, upcoming) {
  const limit = USER_PROFILE_APPT_PAGE_SIZE;
  if (upcoming) {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM appointments a
       WHERE a.patient_id = $1 AND a.status = 'booked'
         AND (a.appointment_date + a.appointment_time) > NOW()`,
      [patientUserId]
    );
    const total = countRes.rows[0].c;
    const pg = buildPagination(total, page, limit);
    const offset = (pg.currentPage - 1) * limit;
    const listRes = await pool.query(
      `SELECT ${APPT_FIELDS_PATIENT}
       FROM appointments a
       JOIN users d ON d.id = a.doctor_id
       WHERE a.patient_id = $1 AND a.status = 'booked'
         AND (a.appointment_date + a.appointment_time) > NOW()
       ORDER BY (a.appointment_date + a.appointment_time) ASC
       LIMIT $2 OFFSET $3`,
      [patientUserId, limit, offset]
    );
    return { rows: listRes.rows, pagination: pg };
  }
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM appointments a WHERE a.patient_id = $1 AND a.status = $2`,
    [patientUserId, status]
  );
  const total = countRes.rows[0].c;
  const pg = buildPagination(total, page, limit);
  const offset = (pg.currentPage - 1) * limit;
  const listRes = await pool.query(
    `SELECT ${APPT_FIELDS_PATIENT}
     FROM appointments a
     JOIN users d ON d.id = a.doctor_id
     WHERE a.patient_id = $1 AND a.status = $2
     ORDER BY a.appointment_date DESC, a.appointment_time DESC
     LIMIT $3 OFFSET $4`,
    [patientUserId, status, limit, offset]
  );
  return { rows: listRes.rows, pagination: pg };
}

async function fetchDoctorApptBucket(pool, doctorUserId, status, page, upcoming) {
  const limit = USER_PROFILE_APPT_PAGE_SIZE;
  if (upcoming) {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM appointments a
       WHERE a.doctor_id = $1 AND a.status = 'booked'
         AND (a.appointment_date + a.appointment_time) > NOW()`,
      [doctorUserId]
    );
    const total = countRes.rows[0].c;
    const pg = buildPagination(total, page, limit);
    const offset = (pg.currentPage - 1) * limit;
    const listRes = await pool.query(
      `SELECT ${APPT_FIELDS_DOCTOR}
       FROM appointments a
       JOIN users p ON p.id = a.patient_id
       WHERE a.doctor_id = $1 AND a.status = 'booked'
         AND (a.appointment_date + a.appointment_time) > NOW()
       ORDER BY (a.appointment_date + a.appointment_time) ASC
       LIMIT $2 OFFSET $3`,
      [doctorUserId, limit, offset]
    );
    return { rows: listRes.rows, pagination: pg };
  }
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM appointments a WHERE a.doctor_id = $1 AND a.status = $2`,
    [doctorUserId, status]
  );
  const total = countRes.rows[0].c;
  const pg = buildPagination(total, page, limit);
  const offset = (pg.currentPage - 1) * limit;
  const listRes = await pool.query(
    `SELECT ${APPT_FIELDS_DOCTOR}
     FROM appointments a
     JOIN users p ON p.id = a.patient_id
     WHERE a.doctor_id = $1 AND a.status = $2
     ORDER BY a.appointment_date DESC, a.appointment_time DESC
     LIMIT $3 OFFSET $4`,
    [doctorUserId, status, limit, offset]
  );
  return { rows: listRes.rows, pagination: pg };
}

function escapeLike(term) {
  return String(term).replace(/[\\%_]/g, '\\$&');
}

async function resolveDoctorUserId(inputId, clientOrPool) {
  const n = parseInt(inputId, 10);
  if (isNaN(n)) return null;

  // Canonical case: users.id
  const userHit = await clientOrPool.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'doctor'",
    [n]
  );
  if (userHit.rows.length > 0) return userHit.rows[0].id;

  // Compatibility case: doctor_profiles.id -> user_id
  const profileHit = await clientOrPool.query(
    `SELECT u.id
     FROM doctor_profiles dp
     JOIN users u ON u.id = dp.user_id
     WHERE dp.id = $1 AND u.role = 'doctor'`,
    [n]
  );
  if (profileHit.rows.length > 0) return profileHit.rows[0].id;

  return null;
}

// ─── GET /admin ──────────────────────────────────────────────────────────────

router.get('/', ...adminOnly, async (req, res) => {
  try {
    const [docs, pats, todayAppts] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE role='doctor'"),
      pool.query("SELECT COUNT(*) FROM users WHERE role='patient'"),
      pool.query("SELECT COUNT(*) FROM appointments WHERE appointment_date = CURRENT_DATE AND status='booked'"),
    ]);
    res.render('admin/dashboard', {
      title: 'Админ-панель — Запись к врачу',
      stats: {
        doctors: parseInt(docs.rows[0].count),
        patients: parseInt(pats.rows[0].count),
        todayAppointments: parseInt(todayAppts.rows[0].count),
      },
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки панели' });
  }
});

// ─── GET /admin/doctors ──────────────────────────────────────────────────────

router.get('/doctors', ...adminOnly, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = {
      specialization_id: String(req.query.specialization_id || '').trim(),
      status: String(req.query.status || '').trim(),
      search: String(req.query.search || '').trim(),
      page,
      limit,
    };

    const conditions = ["u.role = 'doctor'"];
    const params = [];

    const specId = parseInt(filters.specialization_id, 10);
    if (!isNaN(specId)) {
      params.push(specId);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM doctor_specializations dsf
           WHERE dsf.doctor_user_id = u.id AND dsf.specialization_id = $${params.length}
         )`
      );
    }

    if (filters.status === 'active') conditions.push('u.is_blocked = false');
    if (filters.status === 'blocked') conditions.push('u.is_blocked = true');

    if (filters.search) {
      params.push(`%${escapeLike(filters.search)}%`);
      const idx = params.length;
      conditions.push(
        `(u.last_name ILIKE $${idx} ESCAPE '\\'
          OR u.first_name ILIKE $${idx} ESCAPE '\\'
          OR COALESCE(u.middle_name, '') ILIKE $${idx} ESCAPE '\\'
          OR u.email ILIKE $${idx} ESCAPE '\\')`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRes, result, specsFilterRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS cnt FROM users u ${where}`, params),
      pool.query(
        `SELECT u.id, u.last_name, u.first_name, u.middle_name, u.email, u.phone, u.is_blocked, u.avatar_path, u.avatar_url,
                dp.cabinet, dp.experience_years,
                specs.spec_list AS specializations
         FROM users u
         JOIN doctor_profiles dp ON u.id = dp.user_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(
             json_agg(
               json_build_object('id', s.id, 'name', s.name, 'is_primary', ds.is_primary)
               ORDER BY ds.is_primary DESC, s.name
             ),
             '[]'::json
           ) AS spec_list
           FROM doctor_specializations ds
           JOIN specializations s ON s.id = ds.specialization_id
           WHERE ds.doctor_user_id = u.id
         ) specs ON true
         ${where}
         ORDER BY u.last_name, u.first_name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query('SELECT id, name FROM specializations ORDER BY name'),
    ]);

    const totalCount = countRes.rows[0] ? countRes.rows[0].cnt : 0;
    const pagination = buildPagination(totalCount, page, limit);

    res.render('admin/doctors', {
      title: 'Управление врачами — Админ-панель',
      doctors: result.rows,
      specializations: specsFilterRes.rows,
      filters,
      pagination,
      totalCount,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Admin doctors error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── GET /admin/doctors/new ──────────────────────────────────────────────────

router.get('/doctors/new', ...adminOnly, async (req, res) => {
  try {
    const specs = await loadSpecsForForms(pool);
    res.render('admin/doctor_form', {
      title: 'Добавить врача — Админ-панель',
      doctor: null,
      doctorSpecIds: [],
      primarySpecId: null,
      specializations: specs,
      error: req.query.error || null,
      loadChoicesCss: true,
      loadChoicesJs: true,
      loadAdminSpecChoices: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки формы' });
  }
});

// ─── POST /admin/doctors ─────────────────────────────────────────────────────

router.post('/doctors', ...adminOnly, async (req, res) => {
  const { email, password, first_name, last_name, middle_name, phone,
          cabinet, experience_years, education, description, primary_specialization_id } = req.body;
  const specIds = parseSpecializationIds(req.body);

  if (!email || !password || !first_name || !last_name) {
    return res.redirect('/admin/doctors?error=' + encodeURIComponent('Заполните обязательные поля'));
  }

  const phoneNormCreate = normalizeBelarusPhone(phone);
  if (!phoneNormCreate) {
    return res.redirect(
      '/admin/doctors/new?error=' + encodeURIComponent('Неверный формат телефона. Укажите номер с кодом страны.')
    );
  }

  try {
    const allSpecs = await loadSpecsForForms(pool);
    const v = validateSpecializationSet(specIds, allSpecs);
    if (!v.ok) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent(v.message));
    }
    const { primary } = resolvePrimarySpecializationId(specIds, primary_specialization_id);

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (exists.rows.length > 0) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent('Пользователь с таким email уже существует'));
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
         VALUES ($1, $2, $3, $4, $5, $6, 'doctor', false) RETURNING id`,
        [email.toLowerCase().trim(), hash, first_name.trim(), last_name.trim(), (middle_name || '').trim(), phoneNormCreate]
      );
      const uid = userRes.rows[0].id;
      await client.query(
        `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uid, primary, cabinet || null, parseInt(experience_years) || 0, education || null, description || null]
      );
      await replaceDoctorSpecializations(client, uid, specIds, primary);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.redirect('/admin/doctors?success=' + encodeURIComponent('Врач добавлен'));
  } catch (err) {
    console.error('Create doctor error:', err);
    res.redirect('/admin/doctors?error=' + encodeURIComponent('Ошибка создания'));
  }
});

// ─── GET /admin/doctors/:id/edit ─────────────────────────────────────────────

router.get('/doctors/:id/edit', ...adminOnly, async (req, res) => {
  try {
    const resolvedDoctorId = await resolveDoctorUserId(req.params.id, pool);
    if (!resolvedDoctorId) return res.status(404).render('error', { message: 'Врач не найден' });

    if (String(req.params.id) !== String(resolvedDoctorId)) {
      return res.redirect(`/admin/doctors/${resolvedDoctorId}/edit`);
    }

    const uRes = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND role = 'doctor'",
      [resolvedDoctorId]
    );
    if (uRes.rows.length === 0) return res.status(404).render('error', { message: 'Врач не найден' });
    const dpRes = await pool.query('SELECT * FROM doctor_profiles WHERE user_id = $1', [resolvedDoctorId]);
    const specs = await loadSpecsForForms(pool);
    const dsRes = await pool.query(
      `SELECT specialization_id, is_primary FROM doctor_specializations WHERE doctor_user_id = $1`,
      [resolvedDoctorId]
    );

    if (dpRes.rows.length === 0) {
      return res.status(400).render('error', { message: 'Профиль врача отсутствует. Обратитесь к администратору БД.' });
    }

    const u = uRes.rows[0];
    const dp = dpRes.rows[0];
    const doctorSpecIds = dsRes.rows.map((r) => r.specialization_id);
    const primaryRow = dsRes.rows.find((r) => r.is_primary);
    const primarySpecId = primaryRow ? primaryRow.specialization_id : dp.specialization_id;
    // Важно: id в шаблоне должен быть users.id (для action формы и проверок). Иначе doctor_profiles.id
    // перезапишет users.id и POST уйдёт на чужого врача → ложный «email занят» и редирект не туда.
    res.render('admin/doctor_form', {
      title: 'Редактировать врача — Админ-панель',
      doctor: { ...u, ...dp, id: u.id, profile_id: dp.id },
      doctorSpecIds,
      primarySpecId,
      specializations: specs,
      error: req.query.error || null,
      success: req.query.success || null,
      loadChoicesCss: true,
      loadChoicesJs: true,
      loadAdminSpecChoices: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/doctors/:id/edit ────────────────────────────────────────────

router.post('/doctors/:id/edit', ...adminOnly, async (req, res) => {
  const { email, new_password, first_name, last_name, middle_name, phone, is_blocked,
          cabinet, experience_years, education, description, user_id, primary_specialization_id } = req.body;
  const specIds = parseSpecializationIds(req.body);
  const rawId = req.params.id;

  if (isNaN(parseInt(rawId, 10))) {
    return res.redirect('/admin/doctors?error=' + encodeURIComponent('Некорректный ID врача'));
  }
  if (!first_name || !last_name || !email) {
    return res.redirect(`/admin/doctors/${rawId}/edit?error=` + encodeURIComponent('Заполните обязательные поля'));
  }

  const phoneNormEdit = normalizeBelarusPhone(phone);
  if (!phoneNormEdit) {
    return res.redirect(
      `/admin/doctors/${rawId}/edit?error=` + encodeURIComponent('Неверный формат телефона. Укажите номер с кодом страны.')
    );
  }

  try {
    const allSpecs = await loadSpecsForForms(pool);
    const v = validateSpecializationSet(specIds, allSpecs);
    if (!v.ok) {
      const doctorIdEarly = await resolveDoctorUserId(rawId, pool);
      const eid = doctorIdEarly != null ? doctorIdEarly : rawId;
      return res.redirect(`/admin/doctors/${eid}/edit?error=` + encodeURIComponent(v.message));
    }
    const { primary } = resolvePrimarySpecializationId(specIds, primary_specialization_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const doctorId = await resolveDoctorUserId(rawId, client);
      if (!doctorId) {
        await client.query('ROLLBACK');
        return res.redirect('/admin/doctors?error=' + encodeURIComponent('Врач не найден'));
      }

      const bodyUserId = user_id != null && String(user_id).trim() !== '' ? parseInt(user_id, 10) : null;
      if (bodyUserId != null && !isNaN(bodyUserId) && bodyUserId !== doctorId) {
        await client.query('ROLLBACK');
        return res.redirect(`/admin/doctors/${doctorId}/edit?error=` + encodeURIComponent('Некорректные данные формы'));
      }

      const emailNorm = email.toLowerCase().trim();
      const emailConflict = await client.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [emailNorm, doctorId]
      );
      if (emailConflict.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.redirect(`/admin/doctors/${doctorId}/edit?error=` + encodeURIComponent('Email уже занят другим пользователем'));
      }

      if (new_password && String(new_password).trim().length > 0) {
        if (String(new_password).trim().length < 6) {
          await client.query('ROLLBACK');
          return res.redirect(`/admin/doctors/${doctorId}/edit?error=` + encodeURIComponent('Новый пароль должен быть не короче 6 символов'));
        }
        const hash = await bcrypt.hash(String(new_password).trim(), SALT_ROUNDS);
        await client.query(
          `UPDATE users
           SET email=$1, first_name=$2, last_name=$3, middle_name=$4, phone=$5, is_blocked=$6, password_hash=$7
           WHERE id=$8 AND role='doctor'`,
          [emailNorm, first_name.trim(), last_name.trim(), (middle_name||'').trim(), phoneNormEdit, is_blocked === 'true', hash, doctorId]
        );
        await insertAuditLog(client, {
          userId: doctorId,
          actionType: AUDIT_ACTION.PASSWORD_CHANGE,
          oldValue: null,
          newValue: null,
        });
      } else {
        await client.query(
          `UPDATE users
           SET email=$1, first_name=$2, last_name=$3, middle_name=$4, phone=$5, is_blocked=$6
           WHERE id=$7 AND role='doctor'`,
          [emailNorm, first_name.trim(), last_name.trim(), (middle_name||'').trim(), phoneNormEdit, is_blocked === 'true', doctorId]
        );
      }

      const profileUpdate = await client.query(
        `UPDATE doctor_profiles
         SET specialization_id=$1, cabinet=$2, experience_years=$3, education=$4, description=$5
         WHERE user_id=$6`,
        [primary, cabinet || null, parseInt(experience_years) || 0, education || null, description || null, doctorId]
      );
      if (profileUpdate.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.redirect(`/admin/doctors/${doctorId}/edit?error=` + encodeURIComponent('Профиль врача не найден. Изменения не сохранены'));
      }

      await replaceDoctorSpecializations(client, doctorId, specIds, primary);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.redirect('/admin/doctors?success=' + encodeURIComponent('Врач обновлён'));
  } catch (err) {
    console.error('Update doctor error:', err);
    const rid = await resolveDoctorUserId(req.params.id, pool);
    const editId = rid != null ? rid : req.params.id;
    res.redirect(`/admin/doctors/${editId}/edit?error=` + encodeURIComponent('Ошибка сохранения'));
  }
});

// ─── POST /admin/doctors/:id/avatar ────────────────────────────────────────────

router.post('/doctors/:id/avatar', ...adminOnly, (req, res, next) => {
  uploadAvatar(req, res, async (err) => {
    const resolvedDoctorId = await resolveDoctorUserId(req.params.id, pool);
    const editPath = resolvedDoctorId
      ? `/admin/doctors/${resolvedDoctorId}/edit`
      : '/admin/doctors';
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
    if (!resolvedDoctorId) {
      if (req.file?.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      return res.redirect('/admin/doctors?error=' + encodeURIComponent('Врач не найден'));
    }
    if (!req.file) {
      return res.redirect(`${editPath}?error=${encodeURIComponent('Выберите файл изображения')}`);
    }
    try {
      const rel = await finalizeTempToWebp(req.file.path, resolvedDoctorId);
      const prev = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [resolvedDoctorId]);
      const oldPath = prev.rows[0]?.avatar_path;
      await pool.query('UPDATE users SET avatar_path = $1 WHERE id = $2 AND role = $3', [
        rel,
        resolvedDoctorId,
        'doctor',
      ]);
      await unlinkDbPath(oldPath);
      await insertAuditLog(pool, {
        userId: resolvedDoctorId,
        actionType: AUDIT_ACTION.AVATAR_UPDATE,
        oldValue: oldPath || '',
        newValue: rel || '',
      });
      res.redirect(`${editPath}?success=` + encodeURIComponent('Фото врача обновлено'));
    } catch (e) {
      console.error('Admin doctor avatar error:', e);
      res.redirect(`${editPath}?error=` + encodeURIComponent('Не удалось обработать изображение'));
    }
  });
});

// ─── POST /admin/doctors/:id/avatar/remove ───────────────────────────────────

router.post('/doctors/:id/avatar/remove', ...adminOnly, async (req, res) => {
  try {
    const resolvedDoctorId = await resolveDoctorUserId(req.params.id, pool);
    if (!resolvedDoctorId) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent('Врач не найден'));
    }
    const prev = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [resolvedDoctorId]);
    const oldPath = prev.rows[0]?.avatar_path;
    await pool.query('UPDATE users SET avatar_path = NULL WHERE id = $1', [resolvedDoctorId]);
    await unlinkDbPath(oldPath);
    await insertAuditLog(pool, {
      userId: resolvedDoctorId,
      actionType: AUDIT_ACTION.AVATAR_UPDATE,
      oldValue: oldPath || '',
      newValue: '',
    });
    res.redirect(
      `/admin/doctors/${resolvedDoctorId}/edit?success=` + encodeURIComponent('Фото врача удалено')
    );
  } catch (e) {
    console.error('Admin doctor avatar remove error:', e);
    const rid = await resolveDoctorUserId(req.params.id, pool);
    const p = rid != null ? `/admin/doctors/${rid}/edit` : '/admin/doctors';
    res.redirect(`${p}?error=` + encodeURIComponent('Не удалось удалить фото'));
  }
});

// ─── POST /admin/doctors/:id/delete ──────────────────────────────────────────

router.post('/doctors/:id/delete', ...adminOnly, async (req, res) => {
  try {
    const resolvedDoctorId = await resolveDoctorUserId(req.params.id, pool);
    if (!resolvedDoctorId) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent('Врач не найден'));
    }

    const active = await pool.query(
      "SELECT COUNT(*) FROM appointments WHERE doctor_id=$1 AND status='booked' AND appointment_date >= CURRENT_DATE",
      [resolvedDoctorId]
    );
    if (parseInt(active.rows[0].count) > 0) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent(
        `У врача есть ${active.rows[0].count} активных записей. Сначала отмените их.`
      ));
    }
    await pool.query('DELETE FROM users WHERE id=$1 AND role=\'doctor\'', [resolvedDoctorId]);
    res.redirect('/admin/doctors?success=' + encodeURIComponent('Врач удалён'));
  } catch (err) {
    console.error('Delete doctor error:', err);
    res.redirect('/admin/doctors?error=' + encodeURIComponent('Ошибка удаления'));
  }
});

// ─── GET /admin/specializations ──────────────────────────────────────────────

router.get('/specializations', ...adminOnly, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = {
      group_id: String(req.query.group_id || '').trim(),
      search: String(req.query.search || '').trim(),
      page,
      limit,
    };

    const conditions = [];
    const params = [];
    const groupId = parseInt(filters.group_id, 10);
    if (!isNaN(groupId)) {
      params.push(groupId);
      conditions.push(`s.specialization_group_id = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${escapeLike(filters.search)}%`);
      conditions.push(`s.name ILIKE $${params.length} ESCAPE '\\'`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRes, result, groups] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM specializations s
         ${where}`,
        params
      ),
      pool.query(
        `SELECT s.id,
                s.name,
                s.specialization_group_id,
                COALESCE(sg.name, '—') AS group_name,
                COALESCE(sg.code, s.compat_group, 'therapy') AS compat_group,
                COUNT(ds.doctor_user_id)::int AS doctor_count
         FROM specializations s
         LEFT JOIN specialization_groups sg ON sg.id = s.specialization_group_id
         LEFT JOIN doctor_specializations ds ON ds.specialization_id = s.id
         ${where}
         GROUP BY s.id, s.name, s.specialization_group_id, sg.name, sg.code, s.compat_group
         ORDER BY s.name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      loadSpecializationGroups(pool),
    ]);

    const totalCount = countRes.rows[0] ? countRes.rows[0].cnt : 0;
    const pagination = buildPagination(totalCount, page, limit);

    res.render('admin/specializations', {
      title: 'Специализации — Админ-панель',
      specializations: result.rows,
      groups,
      filters,
      pagination,
      totalCount,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/specializations ─────────────────────────────────────────────

router.post('/specializations', ...adminOnly, async (req, res) => {
  const { name, specialization_group_id } = req.body;
  if (!name || !name.trim()) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Введите название'));
  }
  const groupId = parseInt(specialization_group_id, 10);
  if (isNaN(groupId)) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Выберите группу совместимости'));
  }
  try {
    const gRes = await pool.query('SELECT id, code FROM specialization_groups WHERE id = $1', [groupId]);
    if (!gRes.rows.length) {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Выбрана несуществующая группа совместимости'));
    }
    const groupCode = gRes.rows[0].code;
    await pool.query(
      'INSERT INTO specializations (name, compat_group, specialization_group_id) VALUES ($1, $2, $3)',
      [name.trim(), groupCode, groupId]
    );
    res.redirect('/admin/specializations?success=' + encodeURIComponent('Специализация добавлена'));
  } catch (err) {
    if (err.code === '23505') {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Такая специализация уже существует'));
    }
    console.error(err);
    res.redirect('/admin/specializations?error=' + encodeURIComponent('Ошибка'));
  }
});

// ─── POST /admin/specializations/:id/edit ────────────────────────────────────
router.post('/specializations/:id/edit', ...adminOnly, async (req, res) => {
  const specializationId = parseInt(req.params.id, 10);
  const groupId = parseInt(req.body.specialization_group_id, 10);
  if (isNaN(specializationId) || isNaN(groupId)) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Некорректные параметры изменения'));
  }
  try {
    const gRes = await pool.query('SELECT id, code FROM specialization_groups WHERE id = $1', [groupId]);
    if (!gRes.rows.length) {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Выбрана несуществующая группа совместимости'));
    }
    const upd = await pool.query(
      `UPDATE specializations
       SET specialization_group_id = $1, compat_group = $2
       WHERE id = $3`,
      [groupId, gRes.rows[0].code, specializationId]
    );
    if (!upd.rowCount) {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Специализация не найдена'));
    }
    return res.redirect('/admin/specializations?success=' + encodeURIComponent('Группа совместимости обновлена'));
  } catch (err) {
    console.error(err);
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Ошибка сохранения'));
  }
});

// ─── POST /admin/specializations/:id/delete ──────────────────────────────────

router.post('/specializations/:id/delete', ...adminOnly, async (req, res) => {
  try {
    const used = await pool.query(
      'SELECT COUNT(*) FROM doctor_specializations WHERE specialization_id=$1',
      [req.params.id]
    );
    if (parseInt(used.rows[0].count) > 0) {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Нельзя удалить — есть врачи с этой специализацией'));
    }
    await pool.query('DELETE FROM specializations WHERE id=$1', [req.params.id]);
    res.redirect('/admin/specializations?success=' + encodeURIComponent('Специализация удалена'));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/specializations?error=' + encodeURIComponent('Ошибка удаления'));
  }
});

// ─── POST /admin/specialization-groups ───────────────────────────────────────
router.post('/specialization-groups', ...adminOnly, async (req, res) => {
  const name = String(req.body.group_name || '').trim();
  if (!name) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Введите название группы совместимости'));
  }
  try {
    const code = await makeUniqueGroupCode(pool, name);
    await pool.query(
      'INSERT INTO specialization_groups (name, code) VALUES ($1, $2)',
      [name, code]
    );
    return res.redirect('/admin/specializations?success=' + encodeURIComponent('Группа совместимости создана'));
  } catch (err) {
    if (err.code === '23505') {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Такая группа уже существует'));
    }
    console.error(err);
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Ошибка создания группы'));
  }
});

// ─── POST /admin/specialization-groups/:id/delete ────────────────────────────
router.post('/specialization-groups/:id/delete', ...adminOnly, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Некорректный ID группы'));
  }
  try {
    const used = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM specializations WHERE specialization_group_id = $1',
      [groupId]
    );
    if (used.rows[0].cnt > 0) {
      return res.redirect('/admin/specializations?error=' + encodeURIComponent('Нельзя удалить группу: к ней привязаны специализации'));
    }
    await pool.query('DELETE FROM specialization_groups WHERE id = $1', [groupId]);
    return res.redirect('/admin/specializations?success=' + encodeURIComponent('Группа совместимости удалена'));
  } catch (err) {
    console.error(err);
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Ошибка удаления группы'));
  }
});

// ─── GET /admin/users ────────────────────────────────────────────────────────

router.get('/users', ...adminOnly, async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const filters = {
    role: String(req.query.role || '').trim(),
    blocked: String(req.query.blocked || '').trim(),
    search: String(req.query.search || '').trim(),
    page,
    limit,
  };
  try {
    let q = 'SELECT id, email, last_name, first_name, middle_name, role, is_blocked, created_at FROM users';
    let c = 'SELECT COUNT(*)::int AS cnt FROM users';
    const params = [];
    const cond = [];

    if (filters.role) {
      params.push(filters.role);
      cond.push(`role = $${params.length}`);
    }
    if (filters.blocked === 'active') cond.push('is_blocked = false');
    if (filters.blocked === 'blocked') cond.push('is_blocked = true');
    if (filters.search) {
      params.push(`%${escapeLike(filters.search)}%`);
      const idx = params.length;
      cond.push(
        `(email ILIKE $${idx} ESCAPE '\\'
          OR last_name ILIKE $${idx} ESCAPE '\\'
          OR first_name ILIKE $${idx} ESCAPE '\\'
          OR COALESCE(middle_name, '') ILIKE $${idx} ESCAPE '\\')`
      );
    }

    if (cond.length) {
      const where = ` WHERE ${cond.join(' AND ')}`;
      q += where;
      c += where;
    }
    q += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRes, result] = await Promise.all([
      pool.query(c, params),
      pool.query(q, [...params, limit, offset]),
    ]);
    const totalCount = countRes.rows[0] ? countRes.rows[0].cnt : 0;
    const pagination = buildPagination(totalCount, page, limit);

    res.render('admin/users', {
      title: 'Пользователи — Админ-панель',
      users: result.rows,
      filters,
      pagination,
      totalCount,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/users/:id/block ─────────────────────────────────────────────

router.post('/users/:id/block', ...adminOnly, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Нельзя заблокировать самого себя'));
    }
    await pool.query('UPDATE users SET is_blocked = NOT is_blocked WHERE id = $1', [req.params.id]);
    res.redirect('/admin/users?success=' + encodeURIComponent('Статус пользователя обновлён'));
  } catch (err) {
    console.error(err);
    res.redirect('/admin/users?error=' + encodeURIComponent('Ошибка'));
  }
});

// ─── GET /admin/users/:id/change-role ─────────────────────────────────────────

router.get('/users/:id/change-role', ...adminOnly, async (req, res) => {
  try {
    const uRes = await pool.query('SELECT id, email, first_name, last_name, role FROM users WHERE id=$1', [req.params.id]);
    if (uRes.rows.length === 0) return res.status(404).render('error', { message: 'Пользователь не найден' });
    const u = uRes.rows[0];
    if (u.role !== 'patient') {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Можно изменить роль только пациенту'));
    }
    const specs = await loadSpecsForForms(pool);
    res.render('admin/change_role', {
      title: 'Назначить врачом — Админ-панель',
      targetUser: u,
      specializations: specs,
      error: req.query.error || null,
      loadChoicesCss: true,
      loadChoicesJs: true,
      loadAdminSpecChoices: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/users/:id/change-role ───────────────────────────────────────

router.post('/users/:id/change-role', ...adminOnly, async (req, res) => {
  const { cabinet, experience_years, education, description, primary_specialization_id } = req.body;
  const specIds = parseSpecializationIds(req.body);
  const userId = parseInt(req.params.id, 10);

  try {
    const uRes = await pool.query('SELECT id, role FROM users WHERE id=$1', [userId]);
    if (uRes.rows.length === 0) return res.status(404).render('error', { message: 'Пользователь не найден' });
    if (uRes.rows[0].role !== 'patient') {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Можно изменить роль только пациенту'));
    }

    const allSpecs = await loadSpecsForForms(pool);
    const v = validateSpecializationSet(specIds, allSpecs);
    if (!v.ok) {
      return res.redirect(`/admin/users/${userId}/change-role?error=` + encodeURIComponent(v.message));
    }
    const { primary } = resolvePrimarySpecializationId(specIds, primary_specialization_id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE users SET role = 'doctor' WHERE id = $1", [userId]);
      await client.query(
        `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET specialization_id=$2, cabinet=$3, experience_years=$4, education=$5, description=$6`,
        [userId, primary, cabinet || null, parseInt(experience_years) || 0, education || null, description || null]
      );
      await replaceDoctorSpecializations(client, userId, specIds, primary);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.redirect('/admin/users?success=' + encodeURIComponent('Пользователь назначен врачом'));
  } catch (err) {
    console.error('Change role error:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('Ошибка изменения роли'));
  }
});

// ─── GET /admin/users/:id (карточка пользователя) ─────────────────────────────

router.get('/users/:id', ...adminOnly, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId) || userId < 1) {
    return res.status(404).render('error', { message: 'Пользователь не найден' });
  }
  try {
    const uRes = await pool.query(
      `SELECT id, email, first_name, last_name, middle_name, role, phone, avatar_path, avatar_url, is_blocked, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!uRes.rows.length) {
      return res.status(404).render('error', { message: 'Пользователь не найден' });
    }
    const u = uRes.rows[0];
    const phoneMasked = maskPhoneForAdmin(u.phone);

    const tabRaw = String(req.query.tab || '').trim().toLowerCase();
    const profileTab = ['info', 'appts', 'activity'].includes(tabRaw) ? tabRaw : '';

    const profileQuery = {
      tab: profileTab,
      ppc: clampProfilePage(req.query.ppc),
      ppn: clampProfilePage(req.query.ppn),
      ppb: clampProfilePage(req.query.ppb),
      dpc: clampProfilePage(req.query.dpc),
      dpn: clampProfilePage(req.query.dpn),
      dpb: clampProfilePage(req.query.dpb),
      apage: clampProfilePage(req.query.apage),
      actpage: clampProfilePage(req.query.actpage || req.query.apage),
    };

    const [apPCompleted, apPCancelled, apPBooked] = await Promise.all([
      fetchPatientApptBucket(pool, userId, 'completed', profileQuery.ppc, false),
      fetchPatientApptBucket(pool, userId, 'cancelled', profileQuery.ppn, false),
      fetchPatientApptBucket(pool, userId, 'booked', profileQuery.ppb, true),
    ]);

    let apDCompleted = { rows: [], pagination: buildPagination(0, 1, USER_PROFILE_APPT_PAGE_SIZE) };
    let apDCancelled = { rows: [], pagination: buildPagination(0, 1, USER_PROFILE_APPT_PAGE_SIZE) };
    let apDBooked = { rows: [], pagination: buildPagination(0, 1, USER_PROFILE_APPT_PAGE_SIZE) };
    if (u.role === 'doctor') {
      [apDCompleted, apDCancelled, apDBooked] = await Promise.all([
        fetchDoctorApptBucket(pool, userId, 'completed', profileQuery.dpc, false),
        fetchDoctorApptBucket(pool, userId, 'cancelled', profileQuery.dpn, false),
        fetchDoctorApptBucket(pool, userId, 'booked', profileQuery.dpb, true),
      ]);
    }

    const appointmentsAsPatient = {
      completed: apPCompleted,
      cancelled: apPCancelled,
      booked: apPBooked,
    };
    const appointmentsAsDoctor = {
      completed: apDCompleted,
      cancelled: apDCancelled,
      booked: apDBooked,
    };

    // ─── Analytics (based on existing DB fields only) ────────────────────────
    const now = new Date();
    const accountCreatedAt = u.created_at ? new Date(u.created_at) : null;
    const accountAgeDays = accountCreatedAt ? Math.floor(daysBetween(now, accountCreatedAt)) : null;

    const scopeCol = u.role === 'doctor' ? 'doctor_id' : 'patient_id';
    const apptCountsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (
           WHERE status = 'booked'
             AND (appointment_date + appointment_time) > NOW()
         )::int AS upcoming
       FROM appointments
       WHERE ${scopeCol} = $1`,
      [userId]
    );
    const apptCounts = apptCountsRes.rows[0] || { total: 0, completed: 0, cancelled: 0, upcoming: 0 };

    let mostVisited = null;
    let favoriteSlot = null;
    let avgGapDays = null;
    if (u.role === 'patient') {
      const mvRes = await pool.query(
        `SELECT a.doctor_id,
                COUNT(*)::int AS cnt,
                d.last_name, d.first_name, d.middle_name,
                s.name AS specialization
         FROM appointments a
         JOIN users d ON d.id = a.doctor_id
         LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
         LEFT JOIN specializations s ON s.id = dsp.specialization_id
         WHERE a.patient_id = $1 AND a.status IN ('completed','booked','cancelled')
         GROUP BY a.doctor_id, d.last_name, d.first_name, d.middle_name, s.name
         ORDER BY cnt DESC, d.last_name ASC
         LIMIT 1`,
        [userId]
      );
      if (mvRes.rows.length) {
        const r = mvRes.rows[0];
        mostVisited = {
          doctorId: r.doctor_id,
          name: `${r.last_name} ${r.first_name}${r.middle_name ? ' ' + r.middle_name : ''}`.trim(),
          specialization: r.specialization || null,
          count: r.cnt,
        };
      }

      const slotRes = await pool.query(
        `SELECT
           CASE
             WHEN EXTRACT(HOUR FROM appointment_time) BETWEEN 6 AND 8 THEN '06:00–09:00'
             WHEN EXTRACT(HOUR FROM appointment_time) BETWEEN 9 AND 11 THEN '09:00–12:00'
             WHEN EXTRACT(HOUR FROM appointment_time) BETWEEN 12 AND 14 THEN '12:00–15:00'
             WHEN EXTRACT(HOUR FROM appointment_time) BETWEEN 15 AND 17 THEN '15:00–18:00'
             WHEN EXTRACT(HOUR FROM appointment_time) BETWEEN 18 AND 20 THEN '18:00–21:00'
             ELSE 'Другое'
           END AS slot,
           COUNT(*)::int AS cnt
         FROM appointments
         WHERE patient_id = $1 AND status IN ('booked','completed')
         GROUP BY slot
         ORDER BY cnt DESC, slot
         LIMIT 1`,
        [userId]
      );
      if (slotRes.rows.length) {
        favoriteSlot = { label: slotRes.rows[0].slot, count: slotRes.rows[0].cnt };
      }

      const avgRes = await pool.query(
        `WITH t AS (
           SELECT (appointment_date + appointment_time)::timestamptz AS ts
           FROM appointments
           WHERE patient_id = $1 AND status = 'completed'
           ORDER BY ts
         ),
         d AS (
           SELECT EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) / 86400 AS gap_days
           FROM t
         )
         SELECT AVG(gap_days) AS avg_gap
         FROM d
         WHERE gap_days IS NOT NULL`,
        [userId]
      );
      if (avgRes.rows.length && avgRes.rows[0].avg_gap != null) {
        avgGapDays = Number(avgRes.rows[0].avg_gap);
      }
    }

    let profileCompletion = null;
    try {
      if (u.role === 'patient') {
        const { getPatientProfileCompletion } = require('../utils/patientProfileCompletion');
        const pc = await getPatientProfileCompletion(pool, userId);
        const totalFields = 5;
        const missing = Array.isArray(pc.missing) ? pc.missing : [];
        const completed = Math.max(0, totalFields - missing.length);
        profileCompletion = {
          percent: Math.round((completed / totalFields) * 100),
          missing,
          isComplete: pc.isComplete === true,
        };
      }
    } catch (_) {
      profileCompletion = null;
    }

    // Refresh tokens can be used as an approximation of sessions / last login
    let authStats = null;
    try {
      const rtRes = await pool.query(
        `SELECT
           COUNT(*)::int AS sessions,
           MAX(created_at) AS last_login
         FROM refresh_tokens
         WHERE user_id = $1`,
        [userId]
      );
      authStats = {
        sessions: rtRes.rows[0].sessions || 0,
        lastLogin: rtRes.rows[0].last_login || null,
      };
    } catch (_) {
      authStats = null;
    }

    const userChartPayload = {
      statusLabels: ['Предстоящие', 'Отменённые', 'Завершённые'],
      statusCounts: [apptCounts.upcoming || 0, apptCounts.cancelled || 0, apptCounts.completed || 0],
    };

    let auditRows = [];
    let auditPagination = buildPagination(0, 1, USER_PROFILE_AUDIT_PAGE_SIZE);
    try {
      const auditCountRes = await pool.query(
        'SELECT COUNT(*)::int AS c FROM audit_logs WHERE user_id = $1',
        [userId]
      );
      const auditTotal = auditCountRes.rows[0].c;
      auditPagination = buildPagination(auditTotal, profileQuery.apage, USER_PROFILE_AUDIT_PAGE_SIZE);
      const auditOffset = (auditPagination.currentPage - 1) * USER_PROFILE_AUDIT_PAGE_SIZE;
      const aRes = await pool.query(
        `SELECT id, action_type, old_value, new_value, created_at
         FROM audit_logs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, USER_PROFILE_AUDIT_PAGE_SIZE, auditOffset]
      );
      auditRows = aRes.rows;
    } catch (auditErr) {
      auditRows = [];
      auditPagination = buildPagination(0, 1, USER_PROFILE_AUDIT_PAGE_SIZE);
    }

    // ─── Activity timeline (registration + audit + appointments) ─────────────
    let activityItems = [];
    let activityPagination = buildPagination(0, 1, USER_PROFILE_ACTIVITY_PAGE_SIZE);
    try {
      const isDoctor = u.role === 'doctor';
      const joinSql = isDoctor
        ? `JOIN users p ON p.id = a.patient_id`
        : `JOIN users d ON d.id = a.doctor_id
           LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
           LEFT JOIN specializations s ON s.id = dsp.specialization_id`;
      const nameSql = isDoctor
        ? `TRIM(CONCAT(p.last_name, ' ', p.first_name, CASE WHEN p.middle_name IS NOT NULL AND p.middle_name <> '' THEN CONCAT(' ', p.middle_name) ELSE '' END))`
        : `TRIM(CONCAT(d.last_name, ' ', d.first_name, CASE WHEN d.middle_name IS NOT NULL AND d.middle_name <> '' THEN CONCAT(' ', d.middle_name) ELSE '' END))`;
      const whoLabel = isDoctor ? 'Пациент' : 'Врач';
      const specSql = isDoctor ? `NULL::text` : `s.name`;

      const countRes = await pool.query(
        `WITH events AS (
           SELECT 'registration'::text AS kind, u.created_at AS at,
                  'Регистрация аккаунта'::text AS title,
                  NULL::text AS meta,
                  NULL::text AS old_value,
                  NULL::text AS new_value
           FROM users u WHERE u.id = $1
           UNION ALL
           SELECT 'audit'::text AS kind, al.created_at AS at,
                  al.action_type::text AS title,
                  NULL::text AS meta,
                  al.old_value::text AS old_value,
                  al.new_value::text AS new_value
           FROM audit_logs al WHERE al.user_id = $1
           UNION ALL
           SELECT 'appointment'::text AS kind,
                  (CASE
                     WHEN a.status = 'booked' THEN COALESCE(a.created_at::timestamptz, (a.appointment_date + a.appointment_time)::timestamptz)
                     ELSE (a.appointment_date + a.appointment_time)::timestamptz
                   END) AS at,
                  (CASE
                     WHEN a.status = 'booked' THEN 'Создана запись'
                     WHEN a.status = 'cancelled' THEN 'Запись отменена'
                     WHEN a.status = 'completed' THEN 'Приём завершён'
                     ELSE 'Запись'
                   END) AS title,
                  (CONCAT('${whoLabel}: ', ${nameSql}, ' · ',
                          TO_CHAR(a.appointment_date, 'DD Mon YYYY'), ' ', TO_CHAR(a.appointment_time, 'HH24:MI'),
                          (CASE WHEN ${specSql} IS NOT NULL THEN CONCAT(' · ', ${specSql}) ELSE '' END)
                  ))::text AS meta,
                  NULL::text AS old_value,
                  NULL::text AS new_value
           FROM appointments a
           ${joinSql}
           WHERE a.${isDoctor ? 'doctor_id' : 'patient_id'} = $1
         )
         SELECT COUNT(*)::int AS c FROM events`,
        [userId]
      );
      const total = countRes.rows[0].c || 0;
      activityPagination = buildPagination(total, profileQuery.actpage, USER_PROFILE_ACTIVITY_PAGE_SIZE);
      const offset = (activityPagination.currentPage - 1) * USER_PROFILE_ACTIVITY_PAGE_SIZE;
      const listRes = await pool.query(
        `WITH events AS (
           SELECT 'registration'::text AS kind, u.created_at AS at,
                  'Регистрация аккаунта'::text AS title,
                  NULL::text AS meta,
                  NULL::text AS old_value,
                  NULL::text AS new_value
           FROM users u WHERE u.id = $1
           UNION ALL
           SELECT 'audit'::text AS kind, al.created_at AS at,
                  al.action_type::text AS title,
                  NULL::text AS meta,
                  al.old_value::text AS old_value,
                  al.new_value::text AS new_value
           FROM audit_logs al WHERE al.user_id = $1
           UNION ALL
           SELECT 'appointment'::text AS kind,
                  (CASE
                     WHEN a.status = 'booked' THEN COALESCE(a.created_at::timestamptz, (a.appointment_date + a.appointment_time)::timestamptz)
                     ELSE (a.appointment_date + a.appointment_time)::timestamptz
                   END) AS at,
                  (CASE
                     WHEN a.status = 'booked' THEN 'Создана запись'
                     WHEN a.status = 'cancelled' THEN 'Запись отменена'
                     WHEN a.status = 'completed' THEN 'Приём завершён'
                     ELSE 'Запись'
                   END) AS title,
                  (CONCAT('${whoLabel}: ', ${nameSql}, ' · ',
                          TO_CHAR(a.appointment_date, 'DD Mon YYYY'), ' ', TO_CHAR(a.appointment_time, 'HH24:MI'),
                          (CASE WHEN ${specSql} IS NOT NULL THEN CONCAT(' · ', ${specSql}) ELSE '' END)
                  ))::text AS meta,
                  NULL::text AS old_value,
                  NULL::text AS new_value
           FROM appointments a
           ${joinSql}
           WHERE a.${isDoctor ? 'doctor_id' : 'patient_id'} = $1
         )
         SELECT kind, at, title, meta, old_value, new_value
         FROM events
         ORDER BY at DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [userId, USER_PROFILE_ACTIVITY_PAGE_SIZE, offset]
      );
      activityItems = listRes.rows || [];
    } catch (_) {
      activityItems = [];
      activityPagination = buildPagination(0, 1, USER_PROFILE_ACTIVITY_PAGE_SIZE);
    }

    res.render('admin/user_profile', {
      title: 'Профиль пользователя — Админ-панель',
      targetUser: {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        middle_name: u.middle_name,
        role: u.role,
        is_blocked: u.is_blocked,
        phoneMasked,
        created_at: u.created_at,
      },
      displayPerson: {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        middle_name: u.middle_name,
        avatar_path: u.avatar_path,
        avatar_url: u.avatar_url,
      },
      appointmentsAsPatient,
      appointmentsAsDoctor,
      auditRows,
      auditPagination,
      analytics: {
        appointmentCounts: apptCounts,
        accountAgeDays,
        mostVisited,
        favoriteSlot,
        avgGapDays,
        profileCompletion,
        authStats,
        chartPayload: userChartPayload,
        scope: u.role === 'doctor' ? 'doctor' : 'patient',
      },
      activityItems,
      activityPagination,
      profileQuery,
    });
  } catch (err) {
    console.error('Admin user profile error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки профиля' });
  }
});

// ─── POST /admin/users/:id/delete ────────────────────────────────────────────

router.post('/users/:id/delete', ...adminOnly, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    if (userId === req.user.id) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Нельзя удалить самого себя'));
    }
    const active = await pool.query(
      "SELECT COUNT(*) FROM appointments WHERE (doctor_id=$1 OR patient_id=$1) AND status='booked' AND appointment_date >= CURRENT_DATE",
      [userId]
    );
    if (parseInt(active.rows[0].count) > 0) {
      return res.redirect('/admin/users?error=' + encodeURIComponent(
        `У пользователя есть ${active.rows[0].count} активных записей. Сначала отмените их.`
      ));
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.redirect('/admin/users?success=' + encodeURIComponent('Пользователь удалён'));
  } catch (err) {
    console.error('Delete user error:', err);
    res.redirect('/admin/users?error=' + encodeURIComponent('Ошибка удаления'));
  }
});

// ─── GET /admin/appointments ─────────────────────────────────────────────────

router.get('/appointments', ...adminOnly, async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { date_from, date_to, status, doctor_id, patient_search } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (date_from) { params.push(date_from); conditions.push(`a.appointment_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conditions.push(`a.appointment_date <= $${params.length}`); }
    if (status)    { params.push(status);     conditions.push(`a.status = $${params.length}`); }
    if (doctor_id && !isNaN(parseInt(doctor_id, 10))) {
      params.push(parseInt(doctor_id, 10));
      conditions.push(`a.doctor_id = $${params.length}`);
    }
    if (patient_search && String(patient_search).trim()) {
      params.push(`%${escapeLike(String(patient_search).trim())}%`);
      const idx = params.length;
      conditions.push(
        `(p.last_name ILIKE $${idx} ESCAPE '\\'
          OR p.first_name ILIKE $${idx} ESCAPE '\\'
          OR COALESCE(p.middle_name, '') ILIKE $${idx} ESCAPE '\\'
          OR p.email ILIKE $${idx} ESCAPE '\\')`
      );
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [countRes, result, doctorsRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM appointments a
         JOIN users p ON a.patient_id = p.id
         JOIN users d ON a.doctor_id = d.id
         ${where}`,
        params
      ),
      pool.query(
      `SELECT a.id, TO_CHAR(a.appointment_date,'YYYY-MM-DD') AS appointment_date,
              TO_CHAR(a.appointment_time,'HH24:MI') AS appointment_time, a.status,
              p.last_name AS p_last, p.first_name AS p_first,
              d.last_name AS d_last, d.first_name AS d_first,
              s.name AS specialization
       FROM appointments a
       JOIN users p ON a.patient_id = p.id
       JOIN users d ON a.doctor_id  = d.id
       LEFT JOIN doctor_profiles dp ON d.id = dp.user_id
       LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
       LEFT JOIN specializations s ON s.id = dsp.specialization_id
       ${where}
       ORDER BY a.appointment_date DESC, a.appointment_time DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query("SELECT id, last_name, first_name FROM users WHERE role='doctor' ORDER BY last_name"),
    ]);

    const totalCount = countRes.rows[0] ? countRes.rows[0].cnt : 0;
    const pagination = buildPagination(totalCount, page, limit);

    res.render('admin/appointments', {
      title: 'Все записи — Админ-панель',
      appointments: result.rows,
      doctors: doctorsRes.rows,
      filters: {
        date_from: date_from || '',
        date_to: date_to || '',
        status: status || '',
        doctor_id: doctor_id || '',
        patient_search: patient_search || '',
        page,
        limit,
      },
      totalCount,
      pagination,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

module.exports = router;
