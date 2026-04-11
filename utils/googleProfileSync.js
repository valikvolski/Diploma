/**
 * Derive display names for a new Google user (given/family first, then parse full name).
 */
function deriveNamesFromGoogleProfile(profile) {
  let first = String(profile.given_name || '').trim();
  let last = String(profile.family_name || '').trim();
  const full = String(profile.name || '').trim();

  if (!first && !last && full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      last = parts[0];
      first = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      first = parts[0];
    }
  }

  if (!first) first = 'Пользователь';
  if (!last) last = 'Google';

  return { first_name: first, last_name: last };
}

/**
 * Values to apply only where DB first/last are empty (existing Google login / link).
 */
function googleNamesToFillBlanks(profile, existingRow) {
  const ef = String(existingRow.first_name || '').trim();
  const el = String(existingRow.last_name || '').trim();
  let gn = String(profile.given_name || '').trim() || null;
  let fn = String(profile.family_name || '').trim() || null;

  if ((!gn || !fn) && profile.name) {
    const parts = String(profile.name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (!fn) fn = parts[0];
      if (!gn) gn = parts.slice(1).join(' ');
    } else if (parts.length === 1 && !gn) {
      gn = parts[0];
    }
  }

  return {
    first: !ef && gn ? gn : null,
    last: !el && fn ? fn : null,
  };
}

function hasUploadedAvatar(row) {
  return row.avatar_path != null && String(row.avatar_path).trim() !== '';
}

/**
 * After Google login: refresh Google fields; update avatar_url only if no custom upload;
 * fill empty first/last from Google.
 */
async function syncGoogleProfileAfterLogin(pool, userId, profile, existingRow) {
  const picture = profile.picture ? String(profile.picture).trim() : null;
  const locale = profile.locale ? String(profile.locale).trim() : null;
  const emailVerified =
    profile.email_verified === true || profile.email_verified === 'true' || profile.email_verified === '1';

  const custom = hasUploadedAvatar(existingRow);

  const fill = googleNamesToFillBlanks(profile, existingRow);

  await pool.query(
    `UPDATE users SET
       google_picture_url = $2,
       google_locale = $3,
       google_email_verified = $4,
       avatar_url = CASE WHEN $5 THEN avatar_url ELSE $6 END,
       first_name = CASE
         WHEN TRIM(COALESCE(first_name, '')) = '' AND $7::text IS NOT NULL THEN $7
         ELSE first_name
       END,
       last_name = CASE
         WHEN TRIM(COALESCE(last_name, '')) = '' AND $8::text IS NOT NULL THEN $8
         ELSE last_name
       END
     WHERE id = $1`,
    [userId, picture, locale, emailVerified, custom, picture, fill.first, fill.last]
  );
}

module.exports = {
  deriveNamesFromGoogleProfile,
  googleNamesToFillBlanks,
  syncGoogleProfileAfterLogin,
  hasUploadedAvatar,
};
