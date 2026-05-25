/**
 * Заполняет doctor_work_history для врачей без записей (по текущему experience_years).
 *
 *   node scripts/backfill-doctor-work-history.js
 *   node scripts/backfill-doctor-work-history.js --dry-run
 */
require('dotenv').config();
const { pool } = require('../db/db');
const { replaceDoctorWorkHistory, totalExperienceYears } = require('../utils/doctorWorkHistory');

const DRY_RUN = process.argv.includes('--dry-run');

const ORGS = [
  'ГУЗ «Городская поликлиника»',
  'УЗ «4-я городская клиническая больница»',
  'ГУЗ «Центральная поликлиника»',
  'УЗ «7-я клиническая больница»',
  'ГУЗ «Поликлиника № 3»',
  'ЧУП «Медицинский центр Здоровье»',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function buildEntriesForDoctor(row) {
  let years = parseInt(row.experience_years, 10);
  if (!Number.isFinite(years) || years < 1) years = 5 + (row.id % 12);

  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  const startYear = endYear - years;

  const orgIdx = row.id % ORGS.length;
  const entries = [];

  if (years >= 12) {
    const split = Math.floor(years / 2);
    const midYear = startYear + split;
    entries.push({
      organization_name: ORGS[(orgIdx + 1) % ORGS.length],
      start_date: ymd(startYear, 3, 1),
      end_date: ymd(midYear, 2, 28),
    });
    entries.push({
      organization_name: ORGS[orgIdx],
      start_date: ymd(midYear, 3, 1),
      end_date: null,
    });
  } else {
    entries.push({
      organization_name: ORGS[orgIdx],
      start_date: ymd(startYear, Math.min(12, 1 + (row.id % 6)), 1),
      end_date: null,
    });
  }

  return entries;
}

async function run() {
  const res = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, dp.experience_years, dp.cabinet,
            (SELECT COUNT(*)::int FROM doctor_work_history w WHERE w.doctor_user_id = u.id) AS wh_count
     FROM users u
     JOIN doctor_profiles dp ON dp.user_id = u.id
     WHERE u.role = 'doctor'
     ORDER BY u.id`
  );

  let filled = 0;
  let skipped = 0;

  for (const row of res.rows) {
    if (row.wh_count > 0) {
      skipped += 1;
      continue;
    }

    const entries = buildEntriesForDoctor(row);
    const calcYears = totalExperienceYears(entries);

    console.log(
      `  #${row.id} ${row.last_name} ${row.first_name}: было ${row.experience_years} лет → ${entries.length} период(ов), стаж ${calcYears} лет`
    );
    entries.forEach((e) => {
      console.log(`      · ${e.organization_name}: ${e.start_date} — ${e.end_date || 'по н.в.'}`);
    });

    if (!DRY_RUN) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await replaceDoctorWorkHistory(client, row.id, entries);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
    filled += 1;
  }

  console.log(
    (DRY_RUN ? '[dry-run] ' : '') +
      `Готово: заполнено ${filled}, пропущено (уже есть история) ${skipped}, всего врачей ${res.rows.length}`
  );
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
