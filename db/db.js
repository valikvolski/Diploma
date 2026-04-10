const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Database connected');
    client.release();
  } catch (err) {
    console.error('Database connection error:', err.message);
  }
}

async function doctorSpecializationsTableExists(clientOrPool) {
  const { rows } = await clientOrPool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'doctor_specializations'
    ) AS ok`
  );
  return rows[0].ok === true;
}

function printDoctorSpecializationsMigrationHint() {
  const file = 'db/migrations/001_doctor_specializations.sql';
  console.error('');
  console.error('[db] Missing table: public.doctor_specializations (PostgreSQL 42P01).');
  console.error('[db] Apply migration with psql, for example:');
  console.error(`[db]   psql -U postgres -d clinic_db -f ${file}`);
  console.error('[db] Or: npm run migrate   (применяет все db/migrations/*.sql по порядку)');
  console.error('[db] Adjust -U and -d to match your DB_USER / DB_NAME (.env).');
  console.error(
    '[db] Dev only: set AUTO_RUN_DB_MIGRATIONS=1 (and NODE_ENV not production) to run all db/migrations/*.sql on startup.'
  );
  console.error('');
}

/** Logs a hint if the junction table is missing; optional dev auto-migrate via env. */
async function ensureDoctorSpecializationsOrWarn(dbPool) {
  let exists = false;
  try {
    exists = await doctorSpecializationsTableExists(dbPool);
  } catch (err) {
    console.error('[db] Could not check schema (is the database reachable?):', err.message);
    return false;
  }
  if (exists) return true;

  const auto =
    process.env.AUTO_RUN_DB_MIGRATIONS === '1' && process.env.NODE_ENV !== 'production';
  if (auto) {
    const dir = path.join(__dirname, 'migrations');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      const client = await dbPool.connect();
      try {
        for (const f of files) {
          const sql = fs.readFileSync(path.join(dir, f), 'utf8');
          await client.query(sql);
          console.log('[db] AUTO_RUN_DB_MIGRATIONS: applied', f);
        }
      } catch (e) {
        console.error('[db] AUTO_RUN_DB_MIGRATIONS failed:', e.message);
      } finally {
        client.release();
      }
      try {
        exists = await doctorSpecializationsTableExists(dbPool);
      } catch (_) {
        exists = false;
      }
      if (exists) {
        console.log('[db] doctor_specializations is ready.');
        return true;
      }
    }
  }

  printDoctorSpecializationsMigrationHint();
  return false;
}

module.exports = {
  pool,
  testConnection,
  doctorSpecializationsTableExists,
  ensureDoctorSpecializationsOrWarn,
};
