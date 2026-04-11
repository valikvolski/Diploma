const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_OIDC_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

function googleAuthParams(state) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || '';
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

async function exchangeCodeForTokens(code) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_CALLBACK_URL || '';
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || 'token_exchange_failed');
    err.code = 'GOOGLE_TOKEN';
    throw err;
  }
  return data;
}

function normalizeGoogleUserinfo(raw) {
  const sub = raw.sub != null ? String(raw.sub) : raw.id != null ? String(raw.id) : '';
  let emailVerified = raw.email_verified === true || raw.email_verified === 'true';
  if (raw.email_verified === false || raw.email_verified === 'false') emailVerified = false;

  return {
    sub,
    email: raw.email ? String(raw.email).toLowerCase().trim() : '',
    email_verified: emailVerified,
    name: raw.name ? String(raw.name).trim() : '',
    given_name: raw.given_name ? String(raw.given_name).trim() : '',
    family_name: raw.family_name ? String(raw.family_name).trim() : '',
    picture: raw.picture ? String(raw.picture).trim() : null,
    locale: raw.locale ? String(raw.locale).trim() : null,
  };
}

/**
 * Prefer OIDC userinfo; decode id_token payload as fallback (unsigned body only).
 */
async function fetchGoogleUserInfo(accessToken, idToken) {
  const res = await fetch(GOOGLE_OIDC_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.sub) {
    return normalizeGoogleUserinfo(data);
  }

  if (idToken) {
    try {
      const parts = String(idToken).split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.sub) {
          return normalizeGoogleUserinfo(payload);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  const err = new Error('profile_fetch_failed');
  err.code = 'GOOGLE_PROFILE';
  throw err;
}

module.exports = {
  googleAuthParams,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
};
