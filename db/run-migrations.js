/**
 * Выполняет все db/migrations/*.sql по имени по порядку (001, 002, …).
 * Использует DB_* из .env в корне проекта.
 *
 *   npm run migrate
 */
require('../dotenv-config');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    console.error('No db/migrations directory');
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await client.query(sql);
      console.log('OK:', f);
    }
    const n = await client.query('SELECT COUNT(*)::int AS c FROM specializations');
    console.log('Всего специализаций в БД:', n.rows[0].c);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Миграции не применены:', err.message);
  process.exit(1);
});
