const crypto = require('crypto');

function getPepper() {
  return (
    process.env.PASSWORD_RESET_CODE_PEPPER ||
    process.env.JWT_ACCESS_SECRET ||
    ''
  ).trim();
}

function hashResetCode(digits6) {
  const p = getPepper();
  if (!p) {
    throw new Error('Задайте JWT_ACCESS_SECRET или PASSWORD_RESET_CODE_PEPPER для сброса пароля');
  }
  const normalized = String(digits6).replace(/\D/g, '').padStart(6, '0').slice(-6);
  return crypto.createHmac('sha256', p).update(`pw_reset_v1:${normalized}`).digest('hex');
}

function verifyResetCode(digits6, storedHashHex) {
  try {
    const exp = hashResetCode(digits6);
    const a = Buffer.from(exp, 'hex');
    const b = Buffer.from(String(storedHashHex || ''), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Шестизначный код 000000–999999 */
function generateSixDigitCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

function normalizeSixDigitCode(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 6) return d.slice(-6);
  return d.padStart(6, '0');
}

module.exports = {
  hashResetCode,
  verifyResetCode,
  generateSixDigitCode,
  normalizeSixDigitCode,
};
