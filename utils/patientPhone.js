const GOOGLE_SIGNUP_PLACEHOLDER_PHONE = '+375000000000';

function isValidBelarusPhone(phone) {
  return /^\+375[0-9]{9}$/.test(String(phone || '').trim());
}

/** True if patient must complete phone before booking (invalid or OAuth placeholder). */
function patientNeedsPhoneCompletion(phone) {
  const p = String(phone || '').trim();
  if (!p || p === GOOGLE_SIGNUP_PLACEHOLDER_PHONE) return true;
  return !isValidBelarusPhone(p);
}

module.exports = {
  GOOGLE_SIGNUP_PLACEHOLDER_PHONE,
  isValidBelarusPhone,
  patientNeedsPhoneCompletion,
};
