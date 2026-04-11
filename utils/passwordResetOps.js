const {
  hashResetCode,
  verifyResetCode,
  generateSixDigitCode,
  normalizeSixDigitCode,
} = require('./passwordResetCode');

const PURPOSE_FORGOT = 'forgot_password';
const PURPOSE_PROFILE_CHANGE = 'password_change';

function resetExpireMs() {
  const m = parseInt(process.env.PASSWORD_RESET_EXPIRES_MINUTES || '10', 10);
  return (Number.isFinite(m) && m >= 1 && m <= 60 ? m : 10) * 60 * 1000;
}

const RESET_COOLDOWN_SEC = 60;

function resetMaxPerHour() {
  return Math.min(20, Math.max(1, parseInt(process.env.PASSWORD_RESET_MAX_EMAILS_PER_HOUR || '5', 10) || 5));
}

const RESET_MAX_ATTEMPTS = 5;

/**
 * Проверка секрета для HMAC (как при сбросе пароля).
 * @returns {boolean}
 */
function pepperConfigured() {
  try {
    hashResetCode('000000');
    return true;
  } catch {
    return false;
  }
}

/**
 * Отправка нового кода (инвалидация старых неиспользованных с тем же purpose).
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendPasswordVerificationCode(pool, { userId, email, purpose, sendMailWithPlain }) {
  if (!pepperConfigured()) {
    return { sent: false, reason: 'config' };
  }

  const { rows: coolRows } = await pool.query(
    `SELECT 1 FROM password_reset_codes
     WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - $3::interval
     LIMIT 1`,
    [userId, purpose, `${RESET_COOLDOWN_SEC} seconds`]
  );
  if (coolRows.length) {
    return { sent: false, reason: 'cooldown' };
  }

  const { rows: cntRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM password_reset_codes
     WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId, purpose]
  );
  const sentLastHour = cntRows[0] ? cntRows[0].c : 0;
  if (sentLastHour >= resetMaxPerHour()) {
    return { sent: false, reason: 'hourly_limit' };
  }

  await pool.query(
    `UPDATE password_reset_codes SET used_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose]
  );

  const plain = generateSixDigitCode();
  const codeHash = hashResetCode(plain);
  const expiresAt = new Date(Date.now() + resetExpireMs());

  await pool.query(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at, last_sent_at, purpose)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [userId, codeHash, expiresAt, purpose]
  );

  await sendMailWithPlain({ plain, expiresMinutes: resetExpireMs() / 60000, to: email });
  return { sent: true };
}

/**
 * Проверка кода и установка пароля (один purpose).
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function verifyPurposeCodeAndSetPassword(pool, { userId, purpose, codeRaw, password, bcryptHash }) {
  if (!password || password.length < 6) {
    return { ok: false, error: 'weak_password' };
  }

  try {
    hashResetCode('000000');
  } catch {
    return { ok: false, error: 'config' };
  }

  const code = normalizeSixDigitCode(codeRaw);
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'bad_code_format' };
  }

  const rowRes = await pool.query(
    `SELECT id, code_hash, attempts, expires_at
     FROM password_reset_codes
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, purpose]
  );

  if (!rowRes.rows.length) {
    const anyRes = await pool.query(
      `SELECT 1 FROM password_reset_codes WHERE user_id = $1 AND purpose = $2 LIMIT 1`,
      [userId, purpose]
    );
    if (!anyRes.rows.length) {
      return { ok: false, error: 'no_code' };
    }
    return { ok: false, error: 'code_invalid' };
  }

  const pr = rowRes.rows[0];

  if (new Date(pr.expires_at) < new Date()) {
    return { ok: false, error: 'expired' };
  }

  const ok = verifyResetCode(code, pr.code_hash);
  if (!ok) {
    const nextAttempts = pr.attempts + 1;
    if (nextAttempts >= RESET_MAX_ATTEMPTS) {
      await pool.query('UPDATE password_reset_codes SET attempts = $1, used_at = NOW() WHERE id = $2', [
        nextAttempts,
        pr.id,
      ]);
      return { ok: false, error: 'too_many_attempts' };
    }
    await pool.query('UPDATE password_reset_codes SET attempts = $1 WHERE id = $2', [nextAttempts, pr.id]);
    return { ok: false, error: 'wrong_code' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcryptHash, userId]);
    await client.query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1', [pr.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { ok: true };
}

module.exports = {
  PURPOSE_FORGOT,
  PURPOSE_PROFILE_CHANGE,
  resetExpireMs,
  RESET_COOLDOWN_SEC,
  resetMaxPerHour,
  RESET_MAX_ATTEMPTS,
  pepperConfigured,
  sendPasswordVerificationCode,
  verifyPurposeCodeAndSetPassword,
  normalizeSixDigitCode,
};
