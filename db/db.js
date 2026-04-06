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

module.exports = { pool, testConnection };
