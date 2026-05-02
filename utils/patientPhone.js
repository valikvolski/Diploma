const GOOGLE_SIGNUP_PLACEHOLDER_PHONE = '+375000000000';

/** Правила: код страны (без +) и число национальных цифр. Порядок — от более длинного кода к короткому. */
const PHONE_COUNTRY_RULES = [
  { code: '375', nationalDigits: 9 },
  { code: '380', nationalDigits: 9 },
  { code: '371', nationalDigits: 8 },
  { code: '370', nationalDigits: 8 },
  { code: '48', nationalDigits: 9 },
  { code: '7', nationalDigits: 10 },
];

/**
 * Приводит номер к виду +CC… или null.
 * Принимает полную строку с цифрами или +, либо только 9 цифр (Беларусь по умолчанию).
 */
function normalizePatientPhone(phone) {
  const s = String(phone || '').trim();
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (!d) return null;

  for (const r of PHONE_COUNTRY_RULES) {
    if (d.startsWith(r.code)) {
      const rest = d.slice(r.code.length);
      if (rest.length === r.nationalDigits && /^[0-9]+$/.test(rest)) {
        return `+${r.code}${rest}`;
      }
      return null;
    }
  }

  if (d.length === 9 && /^[0-9]{9}$/.test(d)) {
    return `+375${d}`;
  }

  return null;
}

/** @deprecated Используйте normalizePatientPhone; оставлено для совместимости импортов. */
function normalizeBelarusPhone(phone) {
  return normalizePatientPhone(phone);
}

function isValidPatientPhone(phone) {
  return normalizePatientPhone(phone) !== null;
}

function isValidBelarusPhone(phone) {
  return isValidPatientPhone(phone);
}

/** True if patient must complete phone before booking (invalid or OAuth placeholder). */
function patientNeedsPhoneCompletion(phone) {
  const p = String(phone || '').trim();
  if (!p || p === GOOGLE_SIGNUP_PLACEHOLDER_PHONE) return true;
  return !isValidPatientPhone(p);
}

module.exports = {
  GOOGLE_SIGNUP_PLACEHOLDER_PHONE,
  PHONE_COUNTRY_RULES,
  normalizePatientPhone,
  normalizeBelarusPhone,
  isValidPatientPhone,
  isValidBelarusPhone,
  patientNeedsPhoneCompletion,
};
