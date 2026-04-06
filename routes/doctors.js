const express = require('express');
const { pool } = require('../db/db');

const router = express.Router();

// ─── GET /doctors ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { specialization_id, search } = req.query;

  try {
    // Все специализации для выпадающего списка
    const specsResult = await pool.query(
      'SELECT id, name FROM specializations ORDER BY name'
    );

    // Строим фильтрованный запрос
    const conditions = ["u.role = 'doctor'", 'u.is_blocked = false'];
    const params = [];

    if (specialization_id && specialization_id !== '') {
      params.push(Number(specialization_id));
      conditions.push(`dp.specialization_id = $${params.length}`);
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(u.last_name ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.middle_name ILIKE $${idx})`
      );
    }

    const whereClause = conditions.join(' AND ');

    const doctorsResult = await pool.query(
      `SELECT
         u.id,
         u.last_name,
         u.first_name,
         u.middle_name,
         s.id   AS specialization_id,
         s.name AS specialization,
         dp.cabinet,
         dp.experience_years,
         dp.description
       FROM users u
       JOIN doctor_profiles dp ON u.id = dp.user_id
       LEFT JOIN specializations s ON dp.specialization_id = s.id
       WHERE ${whereClause}
       ORDER BY u.last_name, u.first_name`,
      params
    );

    res.render('doctors/list', {
      title: 'Врачи — Запись к врачу',
      doctors: doctorsResult.rows,
      specializations: specsResult.rows,
      filters: {
        specialization_id: specialization_id || '',
        search: search || '',
      },
    });
  } catch (err) {
    console.error('Doctors list error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки списка врачей' });
  }
});

// ─── GET /doctors/:id ────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const doctorId = parseInt(req.params.id, 10);

  if (isNaN(doctorId)) {
    return res.status(404).render('error', { message: 'Врач не найден' });
  }

  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.last_name,
         u.first_name,
         u.middle_name,
         u.phone,
         s.name AS specialization,
         dp.cabinet,
         dp.experience_years,
         dp.education,
         dp.description
       FROM users u
       JOIN doctor_profiles dp ON u.id = dp.user_id
       LEFT JOIN specializations s ON dp.specialization_id = s.id
       WHERE u.id = $1 AND u.role = 'doctor' AND u.is_blocked = false`,
      [doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', { message: 'Врач не найден' });
    }

    res.render('doctors/detail', {
      title: `${result.rows[0].last_name} ${result.rows[0].first_name} — Запись к врачу`,
      doctor: result.rows[0],
    });
  } catch (err) {
    console.error('Doctor detail error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки данных врача' });
  }
});

module.exports = router;
