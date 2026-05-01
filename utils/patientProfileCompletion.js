const { patientNeedsPhoneCompletion } = require('./patientPhone');

function hasText(v) {
  return String(v || '').trim().length > 0;
}

async function getPatientProfileCompletion(pool, userId) {
  const res = await pool.query(
    `SELECT
       u.first_name,
       u.last_name,
       u.middle_name,
       u.phone,
       TO_CHAR(pp.birth_date, 'YYYY-MM-DD') AS birth_date
     FROM users u
     LEFT JOIN patient_profiles pp ON pp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (!res.rows.length) {
    return {
      isComplete: false,
      missing: ['user_not_found'],
    };
  }

  const row = res.rows[0];
  const missing = [];

  if (!hasText(row.first_name)) missing.push('first_name');
  if (!hasText(row.last_name)) missing.push('last_name');
  if (!hasText(row.middle_name)) missing.push('middle_name');
  if (patientNeedsPhoneCompletion(row.phone)) missing.push('phone');
  if (!hasText(row.birth_date)) missing.push('birth_date');

  return {
    isComplete: missing.length === 0,
    missing,
    message: 'Перед записью необходимо заполнить профиль.',
  };
}

module.exports = {
  getPatientProfileCompletion,
};
