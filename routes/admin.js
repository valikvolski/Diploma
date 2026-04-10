const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  validateSpecializationSet,
  resolvePrimarySpecializationId,
} = require('../utils/specializationCompat');

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
    'SELECT id, name, compat_group FROM specializations ORDER BY name'
  );
  return rows;
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
    const result = await pool.query(
      `SELECT u.id, u.last_name, u.first_name, u.middle_name, u.email, u.phone, u.is_blocked,
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
       WHERE u.role = 'doctor'
       ORDER BY u.last_name`
    );
    res.render('admin/doctors', {
      title: 'Управление врачами — Админ-панель',
      doctors: result.rows,
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
        [email.toLowerCase().trim(), hash, first_name.trim(), last_name.trim(), (middle_name || '').trim(), (phone || '').trim()]
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
          [emailNorm, first_name.trim(), last_name.trim(), (middle_name||'').trim(), (phone||'').trim(), is_blocked === 'true', hash, doctorId]
        );
      } else {
        await client.query(
          `UPDATE users
           SET email=$1, first_name=$2, last_name=$3, middle_name=$4, phone=$5, is_blocked=$6
           WHERE id=$7 AND role='doctor'`,
          [emailNorm, first_name.trim(), last_name.trim(), (middle_name||'').trim(), (phone||'').trim(), is_blocked === 'true', doctorId]
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
    const result = await pool.query(
      `SELECT s.id, s.name, s.compat_group,
              COUNT(ds.doctor_user_id) AS doctor_count
       FROM specializations s
       LEFT JOIN doctor_specializations ds ON ds.specialization_id = s.id
       GROUP BY s.id, s.name, s.compat_group ORDER BY s.name`
    );
    res.render('admin/specializations', {
      title: 'Специализации — Админ-панель',
      specializations: result.rows,
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
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.redirect('/admin/specializations?error=' + encodeURIComponent('Введите название'));
  }
  try {
    await pool.query(
      'INSERT INTO specializations (name, compat_group) VALUES ($1, $2)',
      [name.trim(), 'therapy']
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

// ─── GET /admin/users ────────────────────────────────────────────────────────

router.get('/users', ...adminOnly, async (req, res) => {
  const roleFilter = req.query.role || '';
  try {
    let q = 'SELECT id, email, last_name, first_name, middle_name, role, is_blocked, created_at FROM users';
    const params = [];
    if (roleFilter) { q += ' WHERE role = $1'; params.push(roleFilter); }
    q += ' ORDER BY created_at DESC';

    const result = await pool.query(q, params);
    res.render('admin/users', {
      title: 'Пользователи — Админ-панель',
      users: result.rows,
      roleFilter,
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
    if (parseInt(req.params.id) === req.session.user.id) {
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

// ─── POST /admin/users/:id/delete ────────────────────────────────────────────

router.post('/users/:id/delete', ...adminOnly, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    if (userId === req.session.user.id) {
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
  const { date_from, date_to, status, doctor_id } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (date_from) { params.push(date_from); conditions.push(`a.appointment_date >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conditions.push(`a.appointment_date <= $${params.length}`); }
    if (status)    { params.push(status);     conditions.push(`a.status = $${params.length}`); }
    if (doctor_id) { params.push(doctor_id);  conditions.push(`a.doctor_id = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
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
       LIMIT 200`, params
    );

    const doctorsRes = await pool.query("SELECT id, last_name, first_name FROM users WHERE role='doctor' ORDER BY last_name");

    res.render('admin/appointments', {
      title: 'Все записи — Админ-панель',
      appointments: result.rows,
      doctors: doctorsRes.rows,
      filters: { date_from: date_from||'', date_to: date_to||'', status: status||'', doctor_id: doctor_id||'' },
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

module.exports = router;
