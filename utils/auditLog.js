/**
 * Простой аудит действий пользователя (запись в audit_logs).
 * Ошибки не пробрасываются — приложение работает, если таблицы ещё нет.
 */

const ACTION = {
  PASSWORD_CHANGE: 'password_change',
  AVATAR_UPDATE: 'avatar_update',
};

const MAX_LEN = 2000;

async function insertAuditLog(poolOrClient, { userId, actionType, oldValue = null, newValue = null }) {
  if (!userId || !actionType) return;
  const uid = parseInt(userId, 10);
  if (isNaN(uid) || uid <= 0) return;
  const type = String(actionType).slice(0, 64);
  const ov = oldValue != null && oldValue !== '' ? String(oldValue).slice(0, MAX_LEN) : null;
  const nv = newValue != null && newValue !== '' ? String(newValue).slice(0, MAX_LEN) : null;
  try {
    await poolOrClient.query(
      `INSERT INTO audit_logs (user_id, action_type, old_value, new_value)
       VALUES ($1, $2, $3, $4)`,
      [uid, type, ov, nv]
    );
  } catch (e) {
    if (e && e.code === '42P01') return;
    console.error('[audit_logs]', e.message || e);
  }
}

module.exports = {
  ACTION,
  insertAuditLog,
};
