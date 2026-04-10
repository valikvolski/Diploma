/**
 * Applies db/migrations/001_doctor_specializations.sql using DB_* from .env.
 * Usage (from project root): node db/apply-migration-001.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlPath = path.join(__dirname, 'migrations', '001_doctor_specializations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  try {
    await client.query(sql);
    const reg = await client.query(`SELECT to_regclass('public.doctor_specializations') AS reg`);
    const cnt = await client.query('SELECT COUNT(*)::int AS n FROM doctor_specializations');
    console.log('Migration 001 applied OK.');
    console.log('  to_regclass(public.doctor_specializations) =', reg.rows[0].reg);
    console.log('  COUNT(*) FROM doctor_specializations =', cnt.rows[0].n);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
