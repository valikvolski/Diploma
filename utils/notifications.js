const { pool } = require('../db/db');

async function createNotification(userId, title, message, type = 'info') {
  await pool.query(
    'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
    [userId, title, message, type]
  );
}

async function notifyAppointmentCancelled(appointmentId, reason) {
  const { rows } = await pool.query(
    `SELECT a.patient_id,
            TO_CHAR(a.appointment_date, 'DD.MM.YYYY') AS appt_date,
            TO_CHAR(a.appointment_time, 'HH24:MI') AS appt_time,
            d.last_name AS d_last, d.first_name AS d_first,
            s.name AS specialization
     FROM appointments a
     JOIN users d ON d.id = a.doctor_id
     LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
     LEFT JOIN specializations s ON s.id = dp.specialization_id
     WHERE a.id = $1`,
    [appointmentId]
  );
  if (rows.length === 0) return;

  const a = rows[0];
  const title = 'Запись отменена';
  const message = `Ваша запись к врачу ${a.d_last} ${a.d_first}` +
    (a.specialization ? ` (${a.specialization})` : '') +
    ` на ${a.appt_date} в ${a.appt_time} отменена. Причина: ${reason}`;

  await createNotification(a.patient_id, title, message, 'warning');
}

async function notifyAppointmentCreated(appointmentId) {
  const { rows } = await pool.query(
    `SELECT a.patient_id,
            TO_CHAR(a.appointment_date, 'DD.MM.YYYY') AS appt_date,
            TO_CHAR(a.appointment_time, 'HH24:MI') AS appt_time,
            d.last_name AS d_last, d.first_name AS d_first,
            s.name AS specialization, dp.cabinet
     FROM appointments a
     JOIN users d ON d.id = a.doctor_id
     LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
     LEFT JOIN specializations s ON s.id = dp.specialization_id
     WHERE a.id = $1`,
    [appointmentId]
  );
  if (rows.length === 0) return;

  const a = rows[0];
  const title = 'Запись подтверждена';
  const message = `Вы записаны к врачу ${a.d_last} ${a.d_first}` +
    (a.specialization ? ` (${a.specialization})` : '') +
    ` на ${a.appt_date} в ${a.appt_time}` +
    (a.cabinet ? `, кабинет ${a.cabinet}` : '') + '.';

  await createNotification(a.patient_id, title, message, 'success');
}

async function getUnreadCount(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
    [userId]
  );
  return parseInt(rows[0].count);
}

module.exports = {
  createNotification,
  notifyAppointmentCancelled,
  notifyAppointmentCreated,
  getUnreadCount,
};
