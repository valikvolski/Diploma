/**
 * Маскировка телефона для отображения админом (только на сервере).
 * Формат: +375 (2*) ***-**-67 — код страны, первая цифра национальной части, последние две.
 */

const { normalizePatientPhone, PHONE_COUNTRY_RULES } = require('./patientPhone');

function maskPhoneForAdmin(phone) {
  const norm = normalizePatientPhone(phone);
  if (!norm) return '—';
  const d = norm.replace(/\D/g, '');
  if (!d) return '—';

  for (const r of PHONE_COUNTRY_RULES) {
    if (d.startsWith(r.code)) {
      const national = d.slice(r.code.length);
      if (national.length < 2) {
        return `+${r.code} ···`;
      }
      const first = national[0];
      const last2 = national.slice(-2);
      return `+${r.code} (${first}*) ***-**-${last2}`;
    }
  }

  return '—';
}

module.exports = { maskPhoneForAdmin };
