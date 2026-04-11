const express = require('express');
const { pool } = require('../db/db');

const router = express.Router();

// ─── GET /doctors ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { specialization_id, search } = req.query;

  try {
    // Все специализации для выпадающего списка (только из БД)
    const specsResult = await pool.query(
      'SELECT id, name FROM specializations ORDER BY name'
    );
    const knownSpecIds = new Set(specsResult.rows.map((r) => r.id));
    let filterSpecId = '';
    if (specialization_id !== undefined && specialization_id !== null && String(specialization_id).trim() !== '') {
      const n = parseInt(specialization_id, 10);
      if (!isNaN(n) && knownSpecIds.has(n)) filterSpecId = String(n);
    }

    // Строим фильтрованный запрос
    const conditions = ["u.role = 'doctor'", 'u.is_blocked = false'];
    const params = [];

    if (filterSpecId !== '') {
      params.push(Number(filterSpecId));
      conditions.push(
        `EXISTS (SELECT 1 FROM doctor_specializations dsf WHERE dsf.doctor_user_id = u.id AND dsf.specialization_id = $${params.length})`
      );
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
         u.avatar_path,
         u.avatar_url,
         dp.cabinet,
         dp.experience_years,
         dp.description,
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
       WHERE ${whereClause}
       ORDER BY u.last_name, u.first_name`,
      params
    );

    res.render('doctors/list', {
      title: 'Врачи — Запись к врачу',
      doctors: doctorsResult.rows,
      specializations: specsResult.rows,
      filters: {
        specialization_id: filterSpecId,
        search: search || '',
      },
      loadChoicesCss: true,
      loadChoicesJs: true,
      loadCatalogSpecFilter: true,
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
         u.avatar_path,
         u.avatar_url,
         dp.cabinet,
         dp.experience_years,
         dp.education,
         dp.description,
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
