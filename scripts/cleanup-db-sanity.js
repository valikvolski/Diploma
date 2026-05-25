/**
 * Очистка тестовых данных: даты вне окна записи, «зависшие» booked, записи из далёкого будущего.
 *
 * Использование:
 *   node scripts/cleanup-db-sanity.js          # выполнить
 *   node scripts/cleanup-db-sanity.js --dry-run # только отчёт
 */
require('dotenv').config();
const { pool } = require('../db/db');
const { bookingMaxDateYmd } = require('../utils/bookingWindow');

const DRY_RUN = process.argv.includes('--dry-run');

async function count(sql, params = []) {
  const r = await pool.query(sql, params);
  return parseInt(r.rows[0].c, 10) || 0;
}

async function run() {
  const maxDate = bookingMaxDateYmd();
  console.log(DRY_RUN ? '[dry-run] ' : '', 'Очистка БД. Сегодня по серверу: CURRENT_DATE, макс. дата записи:', maxDate);

  const steps = [
    {
      label: 'Записи позже окна записи (все статусы)',
      countSql: `SELECT COUNT(*)::int AS c FROM appointments WHERE appointment_date > $1::date`,
      deleteSql: `DELETE FROM appointments WHERE appointment_date > $1::date`,
      params: [maxDate],
    },
    {
      label: 'Зависшие booked (время приёма уже прошло)',
      countSql: `SELECT COUNT(*)::int AS c FROM appointments
                 WHERE status = 'booked'
                   AND (appointment_date::timestamp + appointment_time) < NOW()`,
      deleteSql: `DELETE FROM appointments
                  WHERE status = 'booked'
                    AND (appointment_date::timestamp + appointment_time) < NOW()`,
      params: [],
    },
    {
      label: 'Исключения расписания (date_from позже окна записи)',
      countSql: `SELECT COUNT(*)::int AS c FROM schedule_exceptions WHERE date_from > $1::date`,
      deleteSql: `DELETE FROM schedule_exceptions WHERE date_from > $1::date`,
      params: [maxDate],
    },
    {
      label: 'Уведомления с created_at в будущем',
      countSql: `SELECT COUNT(*)::int AS c FROM notifications WHERE created_at > NOW() + interval '1 minute'`,
      deleteSql: `DELETE FROM notifications WHERE created_at > NOW() + interval '1 minute'`,
      params: [],
    },
    {
      label: 'Аудит с created_at в будущем',
      countSql: `SELECT COUNT(*)::int AS c FROM audit_logs WHERE created_at > NOW() + interval '1 minute'`,
      deleteSql: `DELETE FROM audit_logs WHERE created_at > NOW() + interval '1 minute'`,
      params: [],
    },
  ];

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    for (const step of steps) {
      const n = await count(step.countSql, step.params);
      console.log(`  ${step.label}: ${n}`);
      if (!DRY_RUN && n > 0) {
        await client.query(step.deleteSql, step.params);
      }
    }

    const futureUsers = await count(
      `SELECT COUNT(*)::int AS c FROM users WHERE created_at > NOW() + interval '1 minute'`
    );
    console.log(`  Пользователи с created_at в будущем (обрезать до NOW): ${futureUsers}`);
    if (!DRY_RUN && futureUsers > 0) {
      await client.query(
        `UPDATE users SET created_at = NOW() WHERE created_at > NOW() + interval '1 minute'`
      );
    }

    const futureApptCreated = await count(
      `SELECT COUNT(*)::int AS c FROM appointments WHERE created_at > NOW() + interval '1 minute'`
    );
    console.log(`  Записи с created_at в будущем (обрезать): ${futureApptCreated}`);
    if (!DRY_RUN && futureApptCreated > 0) {
      await client.query(
        `UPDATE appointments SET created_at = NOW() WHERE created_at > NOW() + interval '1 minute'`
      );
    }

    if (!DRY_RUN) await client.query('COMMIT');
    console.log(DRY_RUN ? 'Готово (dry-run, изменений нет).' : 'Готово.');
  } catch (e) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
