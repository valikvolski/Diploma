require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../db/db');

async function seedAdmin() {
  const hash = await bcrypt.hash('Admin123', 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO NOTHING`,
    ['admin@clinic.by', hash, 'Администратор', 'Системный', '', '', 'admin', false]
  );
  console.log('Admin user created (admin@clinic.by / Admin123)');
  process.exit();
}

seedAdmin().catch(e => { console.error(e); process.exit(1); });
