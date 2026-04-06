const express = require('express');
const { pool } = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { getUnreadCount } = require('../utils/notifications');

const router = express.Router();

// ─── GET /notifications ──────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, message, type, is_read,
              TO_CHAR(created_at, 'YYYY-MM-DD') AS date_str,
              TO_CHAR(created_at, 'HH24:MI') AS time_str
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.session.user.id]
    );
    res.render('notifications/list', {
      title: 'Уведомления — Запись к врачу',
      notifications: result.rows,
    });
  } catch (err) {
    console.error('Notifications list error:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки уведомлений' });
  }
});

// ─── POST /notifications/:id/read ────────────────────────────────────────────

router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// ─── POST /notifications/read-all ────────────────────────────────────────────

router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.session.user.id]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error(err);
    res.redirect('/notifications');
  }
});

// ─── GET /api/notifications/unread-count ─────────────────────────────────────

router.get('/api/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await getUnreadCount(req.session.user.id);
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.json({ count: 0 });
  }
});

module.exports = router;
