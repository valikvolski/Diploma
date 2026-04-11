const nodemailer = require('nodemailer');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidRecipientEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const t = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function appBaseUrl() {
  const u = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  return u || 'http://localhost:3000';
}

let transporterCache = null;
let transporterMissingLogged = false;
let smtpAuthMissingLogged = false;

function getTransporter() {
  const host = (process.env.SMTP_HOST || '').trim();
  if (!host) {
    if (!transporterMissingLogged) {
      transporterMissingLogged = true;
      console.warn('[mailer] SMTP_HOST не задан — письма не отправляются.');
    }
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1';
  const user = (process.env.SMTP_USER || '').trim();
  // Пароль приложения Google часто копируют с пробелами — для SMTP нужна одна строка без пробелов
  const pass = String(process.env.SMTP_PASS || '')
    .replace(/\s+/g, '')
    .trim();

  if (!user || !pass) {
    if (!smtpAuthMissingLogged) {
      smtpAuthMissingLogged = true;
      console.warn(
        '[mailer] Для Gmail задайте SMTP_USER и непустой SMTP_PASS (16-символьный пароль приложения). Пустой пароль даёт ошибку PLAIN.'
      );
    }
    return null;
  }

  if (transporterCache) return transporterCache;

  transporterCache = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporterCache;
}

function mailFrom() {
  return (process.env.MAIL_FROM || '').trim() || '"МедЗапись" <no-reply@localhost>';
}

function htmlWrapper(title, bodyHtml) {
  const t = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f9;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.06);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#0d6efd 0%,#0a58ca 100%);color:#fff;padding:20px 24px;">
          <div style="font-size:18px;font-weight:700;">МедЗапись</div>
          <div style="font-size:13px;opacity:.9;margin-top:4px;">${t}</div>
        </td></tr>
        <tr><td style="padding:24px;line-height:1.55;font-size:15px;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 24px 24px;border-top:1px solid #eee;font-size:12px;color:#6c757d;">
          Это автоматическое письмо, отвечать на него не нужно.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendMail({ to, subject, html }) {
  const tx = getTransporter();
  if (!tx) return { skipped: true };

  if (!isValidRecipientEmail(to)) {
    console.warn('[mailer] Пропуск отправки: некорректный email получателя.');
    return { skipped: true };
  }

  await tx.sendMail({
    from: mailFrom(),
    to: to.trim(),
    subject,
    html,
  });
  return { sent: true };
}

/**
 * Данные для писем по записи (пациент, врач, талон).
 */
async function fetchAppointmentMailPayload(pool, appointmentId) {
  const { rows } = await pool.query(
    `SELECT
       p.email AS patient_email,
       p.first_name AS patient_first,
       p.last_name AS patient_last,
       d.last_name AS doctor_last,
       d.first_name AS doctor_first,
       d.middle_name AS doctor_middle,
       s.name AS specialization,
       TO_CHAR(a.appointment_date, 'DD.MM.YYYY') AS appt_date,
       TO_CHAR(a.appointment_time, 'HH24:MI') AS appt_time,
       dp.cabinet,
       t.id AS ticket_id,
       t.ticket_number
     FROM appointments a
     JOIN users p ON p.id = a.patient_id
     JOIN users d ON d.id = a.doctor_id
     LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
     LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
     LEFT JOIN specializations s ON s.id = dsp.specialization_id
     LEFT JOIN tickets t ON t.appointment_id = a.id
     WHERE a.id = $1`,
    [appointmentId]
  );
  return rows[0] || null;
}

function doctorFullName(row) {
  return [row.doctor_last, row.doctor_first, row.doctor_middle].filter(Boolean).join(' ').trim();
}

function patientFullName(row) {
  return [row.patient_last, row.patient_first].filter(Boolean).join(' ').trim();
}

function ticketLink(ticketId) {
  if (ticketId == null) return appBaseUrl();
  return `${appBaseUrl()}/tickets/${ticketId}`;
}

async function sendAppointmentBookedEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const doctor = escapeHtml(doctorFullName(row));
    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const spec = row.specialization ? escapeHtml(row.specialization) : '—';
    const date = escapeHtml(row.appt_date);
    const time = escapeHtml(row.appt_time);
    const cabinet = row.cabinet ? escapeHtml(String(row.cabinet)) : '—';
    const ticketNum = row.ticket_number ? escapeHtml(row.ticket_number) : '—';
    const link = escapeHtml(ticketLink(row.ticket_id));

    const body = `
      <p>Здравствуйте, <strong>${patient}</strong>!</p>
      <p>Запись подтверждена.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6c757d;">Врач</td><td style="padding:8px 0;font-weight:600;">${doctor}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Специализация</td><td style="padding:8px 0;">${spec}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Дата</td><td style="padding:8px 0;">${date}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Время</td><td style="padding:8px 0;">${time}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Кабинет</td><td style="padding:8px 0;">${cabinet}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Номер талона</td><td style="padding:8px 0;font-family:monospace;">${ticketNum}</td></tr>
      </table>
      <p><a href="${link}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">Открыть талон</a></p>
      <p style="font-size:13px;color:#6c757d;">Если кнопка не работает, скопируйте ссылку: ${link}</p>
    `;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: запись подтверждена',
      html: htmlWrapper('Запись подтверждена', body),
    });
  } catch (err) {
    console.error('[mailer] sendAppointmentBookedEmail:', err.message || err);
  }
}

async function sendAppointmentCancelledEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const doctor = escapeHtml(doctorFullName(row));
    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const spec = row.specialization ? escapeHtml(row.specialization) : '—';
    const date = escapeHtml(row.appt_date);
    const time = escapeHtml(row.appt_time);
    const cabinet = row.cabinet ? escapeHtml(String(row.cabinet)) : '—';
    const ticketNum = row.ticket_number ? escapeHtml(row.ticket_number) : '—';
    const link = escapeHtml(ticketLink(row.ticket_id));

    const body = `
      <p>Здравствуйте, <strong>${patient}</strong>!</p>
      <p>Вы отменили запись к врачу.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6c757d;">Врач</td><td style="padding:8px 0;font-weight:600;">${doctor}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Специализация</td><td style="padding:8px 0;">${spec}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Дата и время</td><td style="padding:8px 0;">${date} в ${time}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Кабинет</td><td style="padding:8px 0;">${cabinet}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Талон</td><td style="padding:8px 0;font-family:monospace;">${ticketNum}</td></tr>
      </table>
      <p><a href="${link}" style="color:#0d6efd;">Страница талона</a></p>
    `;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: запись отменена',
      html: htmlWrapper('Запись отменена', body),
    });
  } catch (err) {
    console.error('[mailer] sendAppointmentCancelledEmail:', err.message || err);
  }
}

async function sendDoctorUnavailableCancelEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const doctor = escapeHtml(doctorFullName(row));
    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const spec = row.specialization ? escapeHtml(row.specialization) : '—';
    const date = escapeHtml(row.appt_date);
    const time = escapeHtml(row.appt_time);
    const cabinet = row.cabinet ? escapeHtml(String(row.cabinet)) : '—';
    const ticketNum = row.ticket_number ? escapeHtml(row.ticket_number) : '—';
    const link = escapeHtml(ticketLink(row.ticket_id));

    const body = `
      <p>Здравствуйте, <strong>${patient}</strong>!</p>
      <p>Ваша запись отменена: <strong>врач не работает в этот день</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6c757d;">Врач</td><td style="padding:8px 0;font-weight:600;">${doctor}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Специализация</td><td style="padding:8px 0;">${spec}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Дата и время</td><td style="padding:8px 0;">${date} в ${time}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Кабинет</td><td style="padding:8px 0;">${cabinet}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Талон</td><td style="padding:8px 0;font-family:monospace;">${ticketNum}</td></tr>
      </table>
      <p style="font-size:14px;">Вы можете выбрать другое время в каталоге врачей на сайте.</p>
      <p><a href="${link}" style="color:#0d6efd;">Страница талона</a></p>
    `;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: запись отменена (врач не работает)',
      html: htmlWrapper('Запись отменена', body),
    });
  } catch (err) {
    console.error('[mailer] sendDoctorUnavailableCancelEmail:', err.message || err);
  }
}

/**
 * @returns {Promise<boolean>} true только если письмо реально ушло через SMTP (для отметки reminder_email_sent_at)
 */
async function sendAppointmentReminderEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return false;

    const doctor = escapeHtml(doctorFullName(row));
    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const spec = row.specialization ? escapeHtml(row.specialization) : '—';
    const date = escapeHtml(row.appt_date);
    const time = escapeHtml(row.appt_time);
    const cabinet = row.cabinet ? escapeHtml(String(row.cabinet)) : '—';
    const link = escapeHtml(ticketLink(row.ticket_id));

    const body = `
      <p>Здравствуйте, <strong>${patient}</strong>!</p>
      <p>Напоминание: завтра у вас приём у врача.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6c757d;">Врач</td><td style="padding:8px 0;font-weight:600;">${doctor}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Специализация</td><td style="padding:8px 0;">${spec}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Дата и время</td><td style="padding:8px 0;">${date} в ${time}</td></tr>
        <tr><td style="padding:8px 0;color:#6c757d;">Кабинет</td><td style="padding:8px 0;">${cabinet}</td></tr>
      </table>
      <p><a href="${link}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">Открыть талон</a></p>
    `;

    const result = await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: напоминание о приёме завтра',
      html: htmlWrapper('Напоминание о приёме', body),
    });
    return result.sent === true;
  } catch (err) {
    console.error('[mailer] sendAppointmentReminderEmail:', err.message || err);
    return false;
  }
}

module.exports = {
  escapeHtml,
  isValidRecipientEmail,
  fetchAppointmentMailPayload,
  sendAppointmentBookedEmail,
  sendAppointmentCancelledEmail,
  sendDoctorUnavailableCancelEmail,
  sendAppointmentReminderEmail,
  getTransporter,
};
