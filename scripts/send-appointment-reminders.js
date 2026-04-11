/**
 * Напоминания о приёме за сутки. Запуск по cron, например раз в час:
 *   0 * * * * cd /path/to/app && npm run reminders
 *
 * Требует: npm run migrate (колонка reminder_email_sent_at), SMTP в .env
 */
require('../dotenv-config');

const { pool } = require('../db/db');
const { sendAppointmentReminderEmail } = require('../utils/mailer');

async function main() {
  const { rows } = await pool.query(
    `SELECT a.id
     FROM appointments a
     WHERE a.status = 'booked'
       AND a.appointment_date = (CURRENT_DATE + INTERVAL '1 day')::date
       AND a.reminder_email_sent_at IS NULL`
  );

  let ok = 0;
  let fail = 0;

  for (const r of rows) {
    try {
      const sent = await sendAppointmentReminderEmail(pool, r.id);
      if (sent) {
        await pool.query('UPDATE appointments SET reminder_email_sent_at = NOW() WHERE id = $1', [r.id]);
        ok += 1;
      } else {
        fail += 1;
      }
    } catch (e) {
      fail += 1;
      console.error('[reminders] id', r.id, e.message || e);
    }
  }

  console.log(`[reminders] Обработано: ${rows.length}, успешно помечено: ${ok}, ошибок: ${fail}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[reminders] Фатальная ошибка:', err);
  process.exit(1);
});
