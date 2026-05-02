const express = require('express');
const { pool } = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { formatAppointmentDateRu } = require('../utils/ticketFormat');

const router = express.Router();

// ─── GET /tickets/:id ─────────────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) {
    return res.status(404).render('error', { message: 'Талон не найден' });
  }

  try {
    const result = await pool.query(
      `SELECT
         t.id                              AS ticket_id,
         t.ticket_number,
         t.created_at                      AS ticket_created_at,
         a.id                              AS appointment_id,
         TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
         TO_CHAR(a.appointment_time, 'HH24:MI')    AS appointment_time,
         a.status,
         a.patient_id,
         p.last_name   AS patient_last_name,
         p.first_name  AS patient_first_name,
         p.middle_name AS patient_middle_name,
         d.last_name   AS doctor_last_name,
         d.first_name  AS doctor_first_name,
         d.middle_name AS doctor_middle_name,
         s.name        AS specialization,
         dp.cabinet
       FROM tickets t
       JOIN appointments a             ON t.appointment_id = a.id
       JOIN users p                    ON a.patient_id     = p.id
       JOIN users d                    ON a.doctor_id      = d.id
       LEFT JOIN doctor_profiles dp ON d.id = dp.user_id
       LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
       LEFT JOIN specializations s ON s.id = dsp.specialization_id
       WHERE t.id = $1`,
      [ticketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', { message: 'Талон не найден' });
    }

    const ticket = result.rows[0];
    ticket.formatted_date = formatAppointmentDateRu(ticket.appointment_date);
    ticket.formatted_time = ticket.appointment_time || '—';

    if (req.user.role === 'patient' && ticket.patient_id !== req.user.id) {
      return res.status(403).render('error', { message: 'Доступ запрещён' });
    }

    res.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.set('Vary', 'Cookie');
    res.render('tickets/show', {
      title: `Талон ${ticket.ticket_number} — Запись к врачу`,
      ticket,
    });
  } catch (err) {
    console.error('Ticket error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки талона' });
  }
});

module.exports = router;
