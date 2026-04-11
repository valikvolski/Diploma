const GOOGLE_SIGNUP_PLACEHOLDER_PHONE = '+375000000000';

/**
 * Приводит номер к виду +375XXXXXXXXX или возвращает null.
 * Принимает: +375XXXXXXXXX, 375XXXXXXXXX, XXXXXXXXX (9 цифр).
 */
function normalizeBelarusPhone(phone) {
  const s = String(phone || '').trim();
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('375')) {
    const rest = d.slice(3);
    return /^[0-9]{9}$/.test(rest) ? `+375${rest}` : null;
  }
  if (d.length === 9 && /^[0-9]{9}$/.test(d)) {
    return `+375${d}`;
  }
  return null;
}

function isValidBelarusPhone(phone) {
  return normalizeBelarusPhone(phone) !== null;
}

/** True if patient must complete phone before booking (invalid or OAuth placeholder). */
function patientNeedsPhoneCompletion(phone) {
  const p = String(phone || '').trim();
  if (!p || p === GOOGLE_SIGNUP_PLACEHOLDER_PHONE) return true;
  return !isValidBelarusPhone(p);
}

module.exports = {
  GOOGLE_SIGNUP_PLACEHOLDER_PHONE,
  normalizeBelarusPhone,
  isValidBelarusPhone,
  patientNeedsPhoneCompletion,
};
