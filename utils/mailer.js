const nodemailer = require('nodemailer');
const { formatAppointmentDateRu } = require('./ticketFormat');
const {
  generateTicketPdfBuffer,
  buildTicketViewModelFromMailRow,
  safeTicketPdfFilename,
} = require('./ticketPdf');

function emailAttachTicketPdfEnabled() {
  const v = (process.env.EMAIL_ATTACH_TICKET_PDF || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

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

async function sendMail({ to, subject, html, attachments }) {
  const tx = getTransporter();
  if (!tx) return { skipped: true };

  if (!isValidRecipientEmail(to)) {
    console.warn('[mailer] Пропуск отправки: некорректный email получателя.');
    return { skipped: true };
  }

  const payload = {
    from: mailFrom(),
    to: to.trim(),
    subject,
    html,
  };
  if (attachments && attachments.length) {
    payload.attachments = attachments;
  }
  await tx.sendMail(payload);
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
       p.middle_name AS patient_middle,
       d.last_name AS doctor_last,
       d.first_name AS doctor_first,
       d.middle_name AS doctor_middle,
       s.name AS specialization,
       a.appointment_date::text AS appointment_date_raw,
       COALESCE(TO_CHAR(a.appointment_time, 'HH24:MI'), '') AS appt_time,
       a.status AS appt_status,
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
  return [row.patient_last, row.patient_first, row.patient_middle].filter(Boolean).join(' ').trim();
}

/**
 * @param {object} row
 * @param {{ cancelled?: boolean }} [options]
 */
function buildElectronicTicketCardHtml(row, options = {}) {
  const cancelled = Boolean(options.cancelled);
  const ticketNum = escapeHtml(row.ticket_number || '—');
  const patient = escapeHtml(patientFullName(row) || '—');
  const doctor = escapeHtml(doctorFullName(row) || '—');
  const spec = row.specialization ? escapeHtml(row.specialization) : '—';
  const date = escapeHtml(formatAppointmentDateRu(row.appointment_date_raw));
  const time = escapeHtml((row.appt_time && String(row.appt_time).trim()) || '—');
  const cab =
    row.cabinet != null && String(row.cabinet).trim() !== ''
      ? escapeHtml('№ ' + String(row.cabinet).trim())
      : '—';

  if (cancelled) {
    const stamp = escapeHtml('Отменён');
    return `
<div style="position:relative;margin:20px 0;border-radius:12px;overflow:hidden;border:1px solid #d1d5db;background:#f1f5f9;">
  <div aria-hidden="true" style="position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:0;">
    <div style="position:absolute;left:50%;top:50%;width:320px;margin-left:-160px;margin-top:-28px;text-align:center;font-size:34px;font-weight:800;letter-spacing:0.12em;color:#991b1b;opacity:0.16;line-height:1;transform:rotate(-32deg);-webkit-transform:rotate(-32deg);font-family:Arial Black,Helvetica Neue,Helvetica,sans-serif;text-transform:uppercase;">${stamp}</div>
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="position:relative;z-index:1;border-collapse:collapse;">
    <tr><td style="background:#e2e8f0;color:#64748b;padding:16px 18px;text-align:center;border-bottom:1px solid #cbd5e1;">
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Электронный талон</div>
      <div style="font-size:20px;font-weight:700;font-family:ui-monospace,Consolas,monospace;margin-top:6px;color:#475569;">${ticketNum}</div>
    </td></tr>
    <tr><td style="padding:18px 20px;background:#f8fafc;color:#475569;">
      <table role="presentation" width="100%" style="font-size:13px;border-collapse:collapse;color:#475569;opacity:0.92;">
        <tr><td style="padding:7px 0;color:#94a3b8;width:42%;vertical-align:top;">Пациент</td><td style="padding:7px 0;font-weight:600;color:#64748b;">${patient}</td></tr>
        <tr><td style="padding:7px 0;color:#94a3b8;vertical-align:top;">Врач</td><td style="padding:7px 0;font-weight:600;color:#64748b;">${doctor}</td></tr>
        <tr><td style="padding:7px 0;color:#94a3b8;">Специализация</td><td style="padding:7px 0;color:#64748b;">${spec}</td></tr>
        <tr><td style="padding:7px 0;color:#94a3b8;">Дата приёма</td><td style="padding:7px 0;color:#64748b;">${date}</td></tr>
        <tr><td style="padding:7px 0;color:#94a3b8;">Время</td><td style="padding:7px 0;color:#64748b;">${time}</td></tr>
        <tr><td style="padding:7px 0;color:#94a3b8;">Кабинет</td><td style="padding:7px 0;color:#64748b;">${cab}</td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
  }

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:20px 0;background:#ffffff;">
  <tr><td style="background:linear-gradient(135deg,#0d6efd 0%,#0a58ca 100%);color:#ffffff;padding:18px 20px;text-align:center;">
    <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.92;">Электронный талон</div>
    <div style="font-size:22px;font-weight:700;font-family:ui-monospace,Consolas,monospace;margin-top:6px;">${ticketNum}</div>
  </td></tr>
  <tr><td style="padding:20px 22px;background:#ffffff;color:#0f172a;">
    <table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse;color:#0f172a;">
      <tr><td style="padding:8px 0;color:#64748b;width:42%;vertical-align:top;">Пациент</td><td style="padding:8px 0;font-weight:600;">${patient}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Врач</td><td style="padding:8px 0;font-weight:600;">${doctor}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Специализация</td><td style="padding:8px 0;">${spec}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Дата приёма</td><td style="padding:8px 0;">${date}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Время</td><td style="padding:8px 0;">${time}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Кабинет</td><td style="padding:8px 0;">${cab}</td></tr>
    </table>
  </td></tr>
</table>`;
}

async function maybeTicketPdfAttachments(row, { statusOverride, pdfBannerLine } = {}) {
  if (!emailAttachTicketPdfEnabled()) return undefined;
  try {
    const vm = buildTicketViewModelFromMailRow(row, { statusOverride });
    const buf = await generateTicketPdfBuffer(vm, { pdfBannerLine });
    return [{ filename: safeTicketPdfFilename(row.ticket_number), content: buf, contentType: 'application/pdf' }];
  } catch (e) {
    console.error('[mailer] PDF талона (Puppeteer):', e.message || e);
    return undefined;
  }
}

async function sendAppointmentBookedEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const card = buildElectronicTicketCardHtml(row);
    const attachments = await maybeTicketPdfAttachments(row, {});

    const body = `<p>Здравствуйте, <strong>${patient}</strong>!</p>${card}`;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: электронный талон',
      html: htmlWrapper('Электронный талон', body),
      attachments,
    });
  } catch (err) {
    console.error('[mailer] sendAppointmentBookedEmail:', err.message || err);
  }
}

async function sendAppointmentCancelledEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const card = buildElectronicTicketCardHtml(row, { cancelled: true });
    const attachments = await maybeTicketPdfAttachments(row, { statusOverride: 'cancelled' });

    const body = `<p>Здравствуйте, <strong>${patient}</strong>!</p>${card}`;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: запись отменена',
      html: htmlWrapper('Электронный талон', body),
      attachments,
    });
  } catch (err) {
    console.error('[mailer] sendAppointmentCancelledEmail:', err.message || err);
  }
}

async function sendDoctorUnavailableCancelEmail(pool, appointmentId) {
  try {
    const row = await fetchAppointmentMailPayload(pool, appointmentId);
    if (!row || !row.patient_email) return;

    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const card = buildElectronicTicketCardHtml(row, { cancelled: true });
    const attachments = await maybeTicketPdfAttachments(row, {
      statusOverride: 'cancelled',
      pdfBannerLine: 'Врач не работает в этот день',
    });

    const body = `<p>Здравствуйте, <strong>${patient}</strong>!</p>
<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;color:#9a3412;font-size:14px;line-height:1.5;font-weight:600;">
  Врач не работает в этот день.
</p>${card}`;

    await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: врач не работает в этот день',
      html: htmlWrapper('Электронный талон', body),
      attachments,
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

    const patient = escapeHtml(patientFullName(row) || 'Пациент');
    const card = buildElectronicTicketCardHtml(row);
    const attachments = await maybeTicketPdfAttachments(row, {});

    const body = `<p>Здравствуйте, <strong>${patient}</strong>!</p>${card}`;

    const result = await sendMail({
      to: row.patient_email,
      subject: 'МедЗапись: напоминание о приёме завтра',
      html: htmlWrapper('Электронный талон', body),
      attachments,
    });
    return result.sent === true;
  } catch (err) {
    console.error('[mailer] sendAppointmentReminderEmail:', err.message || err);
    return false;
  }
}

async function sendPasswordResetCodeEmail({ to, code, expiresMinutes }) {
  const c = escapeHtml(code);
  const mins = escapeHtml(String(expiresMinutes != null ? expiresMinutes : 10));
  const body = `
    <p>Здравствуйте!</p>
    <p>Код для сброса пароля в сервисе <strong>МедЗапись</strong>:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;font-family:ui-monospace,monospace;margin:20px 0;">${c}</p>
    <p>Код действителен <strong>${mins}</strong> мин. Никому его не сообщайте.</p>
    <p style="font-size:13px;color:#6c757d;">Если вы не запрашивали сброс, проигнорируйте это письмо.</p>
  `;
  try {
    await sendMail({
      to,
      subject: 'МедЗапись: код для сброса пароля',
      html: htmlWrapper('Сброс пароля', body),
    });
  } catch (err) {
    console.error('[mailer] sendPasswordResetCodeEmail:', err.message || err);
  }
}

async function sendProfilePasswordChangeCodeEmail({ to, code, expiresMinutes }) {
  const c = escapeHtml(code);
  const mins = escapeHtml(String(expiresMinutes != null ? expiresMinutes : 10));
  const body = `
    <p>Здравствуйте!</p>
    <p>Код подтверждения для <strong>смены пароля</strong> в сервисе МедЗапись:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;font-family:ui-monospace,monospace;margin:20px 0;">${c}</p>
    <p>Код действителен <strong>${mins}</strong> мин. Если вы не меняли пароль — проигнорируйте письмо.</p>
  `;
  try {
    await sendMail({
      to,
      subject: 'Код подтверждения для смены пароля',
      html: htmlWrapper('Смена пароля', body),
    });
  } catch (err) {
    console.error('[mailer] sendProfilePasswordChangeCodeEmail:', err.message || err);
  }
}

async function sendPasswordChangedNoticeEmail({ to, firstName }) {
  const name = escapeHtml(firstName || 'Пользователь');
  const loginUrl = escapeHtml(`${appBaseUrl()}/auth/login`);
  const body = `
    <p>Здравствуйте, <strong>${name}</strong>!</p>
    <p>Пароль вашего аккаунта в <strong>МедЗапись</strong> был изменён.</p>
    <p>Если это были не вы, срочно обратитесь в поддержку клиники.</p>
    <p><a href="${loginUrl}" style="color:#0d6efd;">Войти в личный кабинет</a></p>
  `;
  try {
    await sendMail({
      to,
      subject: 'МедЗапись: пароль изменён',
      html: htmlWrapper('Пароль изменён', body),
    });
  } catch (err) {
    console.error('[mailer] sendPasswordChangedNoticeEmail:', err.message || err);
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
  sendPasswordResetCodeEmail,
  sendProfilePasswordChangeCodeEmail,
  sendPasswordChangedNoticeEmail,
  getTransporter,
};
