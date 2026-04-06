const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');

const router = express.Router();
const adminOnly = [requireAuth, requireRole(['admin'])];
const SALT_ROUNDS = 10;

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
              s.name AS specialization, dp.cabinet, dp.experience_years
       FROM users u
       LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
       LEFT JOIN specializations s ON dp.specialization_id = s.id
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
    const specs = await pool.query('SELECT id, name FROM specializations ORDER BY name');
    res.render('admin/doctor_form', {
      title: 'Добавить врача — Админ-панель',
      doctor: null,
      specializations: specs.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки формы' });
  }
});

// ─── POST /admin/doctors ─────────────────────────────────────────────────────

router.post('/doctors', ...adminOnly, async (req, res) => {
  const { email, password, first_name, last_name, middle_name, phone,
          specialization_id, cabinet, experience_years, education, description } = req.body;

  if (!email || !password || !first_name || !last_name) {
    return res.redirect('/admin/doctors?error=' + encodeURIComponent('Заполните обязательные поля'));
  }

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (exists.rows.length > 0) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent('Пользователь с таким email уже существует'));
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
       VALUES ($1, $2, $3, $4, $5, $6, 'doctor', false) RETURNING id`,
      [email.toLowerCase().trim(), hash, first_name.trim(), last_name.trim(), (middle_name || '').trim(), (phone || '').trim()]
    );

    await pool.query(
      `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userRes.rows[0].id, specialization_id || null, cabinet || null,
       parseInt(experience_years) || 0, education || null, description || null]
    );

    res.redirect('/admin/doctors?success=' + encodeURIComponent('Врач добавлен'));
  } catch (err) {
    console.error('Create doctor error:', err);
    res.redirect('/admin/doctors?error=' + encodeURIComponent('Ошибка создания'));
  }
});

// ─── GET /admin/doctors/:id/edit ─────────────────────────────────────────────

router.get('/doctors/:id/edit', ...adminOnly, async (req, res) => {
  try {
    const uRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (uRes.rows.length === 0) return res.status(404).render('error', { message: 'Врач не найден' });
    const dpRes = await pool.query('SELECT * FROM doctor_profiles WHERE user_id = $1', [req.params.id]);
    const specs = await pool.query('SELECT id, name FROM specializations ORDER BY name');

    res.render('admin/doctor_form', {
      title: 'Редактировать врача — Админ-панель',
      doctor: { ...uRes.rows[0], ...(dpRes.rows[0] || {}) },
      specializations: specs.rows,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/doctors/:id/edit ────────────────────────────────────────────

router.post('/doctors/:id/edit', ...adminOnly, async (req, res) => {
  const { first_name, last_name, middle_name, phone, is_blocked,
          specialization_id, cabinet, experience_years, education, description } = req.body;

  try {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, middle_name=$3, phone=$4, is_blocked=$5 WHERE id=$6',
      [first_name.trim(), last_name.trim(), (middle_name||'').trim(), (phone||'').trim(),
       is_blocked === 'true', req.params.id]
    );

    await pool.query(
      `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET specialization_id=$2, cabinet=$3, experience_years=$4, education=$5, description=$6`,
      [req.params.id, specialization_id || null, cabinet || null,
       parseInt(experience_years) || 0, education || null, description || null]
    );

    res.redirect('/admin/doctors?success=' + encodeURIComponent('Врач обновлён'));
  } catch (err) {
    console.error('Update doctor error:', err);
    res.redirect(`/admin/doctors/${req.params.id}/edit?error=` + encodeURIComponent('Ошибка сохранения'));
  }
});

// ─── POST /admin/doctors/:id/delete ──────────────────────────────────────────

router.post('/doctors/:id/delete', ...adminOnly, async (req, res) => {
  try {
    const active = await pool.query(
      "SELECT COUNT(*) FROM appointments WHERE doctor_id=$1 AND status='booked' AND appointment_date >= CURRENT_DATE",
      [req.params.id]
    );
    if (parseInt(active.rows[0].count) > 0) {
      return res.redirect('/admin/doctors?error=' + encodeURIComponent(
        `У врача есть ${active.rows[0].count} активных записей. Сначала отмените их.`
      ));
    }
    await pool.query('DELETE FROM users WHERE id=$1 AND role=\'doctor\'', [req.params.id]);
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
      `SELECT s.id, s.name,
              COUNT(dp.id) AS doctor_count
       FROM specializations s
       LEFT JOIN doctor_profiles dp ON dp.specialization_id = s.id
       GROUP BY s.id, s.name ORDER BY s.name`
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
    await pool.query('INSERT INTO specializations (name) VALUES ($1)', [name.trim()]);
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
    const used = await pool.query('SELECT COUNT(*) FROM doctor_profiles WHERE specialization_id=$1', [req.params.id]);
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
    const specs = await pool.query('SELECT id, name FROM specializations ORDER BY name');
    res.render('admin/change_role', {
      title: 'Назначить врачом — Админ-панель',
      targetUser: u,
      specializations: specs.rows,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки' });
  }
});

// ─── POST /admin/users/:id/change-role ───────────────────────────────────────

router.post('/users/:id/change-role', ...adminOnly, async (req, res) => {
  const { specialization_id, cabinet, experience_years, education, description } = req.body;
  const userId = parseInt(req.params.id, 10);

  try {
    const uRes = await pool.query('SELECT id, role FROM users WHERE id=$1', [userId]);
    if (uRes.rows.length === 0) return res.status(404).render('error', { message: 'Пользователь не найден' });
    if (uRes.rows[0].role !== 'patient') {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Можно изменить роль только пациенту'));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE users SET role = 'doctor' WHERE id = $1", [userId]);
      await client.query(
        `INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET specialization_id=$2, cabinet=$3, experience_years=$4, education=$5, description=$6`,
        [userId, specialization_id || null, cabinet || null, parseInt(experience_years) || 0, education || null, description || null]
      );
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
       LEFT JOIN specializations s  ON dp.specialization_id = s.id
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
