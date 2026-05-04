const express = require('express');
const { pool } = require('../db/db');

const router = express.Router();

const CATALOG_PAGE_SIZE = 12;

function normalizeCatalogFilters(query, knownSpecIds) {
  const search = String(query.search || '').trim();
  const pageRaw = parseInt(query.page, 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  let specializationId = '';
  if (query.specialization_id !== undefined && query.specialization_id !== null && String(query.specialization_id).trim() !== '') {
    const n = parseInt(query.specialization_id, 10);
    if (!isNaN(n) && knownSpecIds.has(n)) specializationId = String(n);
  }

  return { search, page, specialization_id: specializationId };
}

async function fetchCatalogPayload(filters, knownSpecIds, specNameById) {
  const normalized = normalizeCatalogFilters(filters, knownSpecIds);
  const conditions = ["u.role = 'doctor'", 'u.is_blocked = false'];
  const params = [];

  if (normalized.specialization_id !== '') {
    params.push(Number(normalized.specialization_id));
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM doctor_specializations dsf
         WHERE dsf.doctor_user_id = u.id
           AND dsf.specialization_id = $${params.length}
       )`
    );
  }

  if (normalized.search !== '') {
    params.push(`%${normalized.search}%`);
    const idx = params.length;
    conditions.push(`(u.last_name ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.middle_name ILIKE $${idx})`);
  }

  const whereClause = conditions.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS c
     FROM users u
     JOIN doctor_profiles dp ON dp.user_id = u.id
     WHERE ${whereClause}`,
    params
  );
  const totalCount = countRes.rows[0].c || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(normalized.page, totalPages);
  const offset = (currentPage - 1) * CATALOG_PAGE_SIZE;

  const listRes = await pool.query(
    `SELECT
       u.id,
       u.last_name,
       u.first_name,
       u.middle_name,
       u.avatar_path,
       u.avatar_url,
       dp.cabinet,
       dp.experience_years,
       s.name AS primary_specialization,
       GREATEST(
         0,
         (SELECT COUNT(*)::int FROM doctor_specializations ds_cnt WHERE ds_cnt.doctor_user_id = u.id) - 1
       ) AS extra_specializations_count
     FROM users u
     JOIN doctor_profiles dp ON dp.user_id = u.id
     LEFT JOIN specializations s ON s.id = dp.specialization_id
     WHERE ${whereClause}
     ORDER BY u.last_name ASC, u.first_name ASC, u.middle_name ASC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, CATALOG_PAGE_SIZE, offset]
  );

  return {
    filters: normalized,
    doctors: listRes.rows,
    selectedSpecializationName:
      normalized.specialization_id !== ''
        ? (specNameById.get(Number(normalized.specialization_id)) || null)
        : null,
    pagination: {
      page: currentPage,
      pageSize: CATALOG_PAGE_SIZE,
      totalCount,
      totalPages,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
    },
  };
}

// ─── GET /doctors ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    // Список специализаций с количеством врачей по основной специализации
    const specsResult = await pool.query(
      `SELECT
         s.id,
         s.name,
         COUNT(DISTINCT ds.doctor_user_id)::int AS doctor_count
       FROM specializations s
       LEFT JOIN doctor_specializations ds ON ds.specialization_id = s.id
       LEFT JOIN users u ON u.id = ds.doctor_user_id
       WHERE u.id IS NULL OR (u.role = 'doctor' AND u.is_blocked = false)
       GROUP BY s.id, s.name
       ORDER BY doctor_count DESC, s.name ASC`
    );
    const knownSpecIds = new Set(specsResult.rows.map((r) => r.id));
    const specNameById = new Map(specsResult.rows.map((r) => [Number(r.id), r.name]));
    const payload = await fetchCatalogPayload(req.query, knownSpecIds, specNameById);

    res.render('doctors/list', {
      title: 'Врачи — Запись к врачу',
      doctors: payload.doctors,
      specializations: specsResult.rows,
      filters: payload.filters,
      pagination: payload.pagination,
      selectedSpecializationName: payload.selectedSpecializationName,
      loadDoctorsCatalogDynamicJs: true,
    });
  } catch (err) {
    console.error('Doctors list error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки списка врачей' });
  }
});

// ─── GET /doctors/api/list ───────────────────────────────────────────────────
router.get('/api/list', async (req, res) => {
  try {
    const specsResult = await pool.query('SELECT id, name FROM specializations');
    const knownSpecIds = new Set(specsResult.rows.map((r) => r.id));
    const specNameById = new Map(specsResult.rows.map((r) => [Number(r.id), r.name]));
    const payload = await fetchCatalogPayload(req.query, knownSpecIds, specNameById);
    return res.json({
      ok: true,
      doctors: payload.doctors,
      filters: payload.filters,
      selectedSpecializationName: payload.selectedSpecializationName,
      pagination: payload.pagination,
    });
  } catch (err) {
    console.error('Doctors api list error:', err);
    return res.status(500).json({ ok: false, message: 'Ошибка загрузки списка врачей' });
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
