const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { baseCookieOptions } = require('./cookieConfig');

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || '';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '30d';

function parseDurationToMs(spec) {
  const m = /^(\d+)([smhd])$/i.exec(String(spec || '').trim());
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return n * 1000;
}

const REFRESH_PEPPER = process.env.JWT_REFRESH_SECRET || '';

function hashToken(raw) {
  const payload = REFRESH_PEPPER ? `${REFRESH_PEPPER}:${String(raw)}` : String(raw);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function generateRefreshRaw() {
  return crypto.randomBytes(48).toString('base64url');
}

function accessCookieMaxAgeMs() {
  return parseDurationToMs(ACCESS_EXPIRES);
}

function refreshCookieMaxAgeMs() {
  return parseDurationToMs(REFRESH_EXPIRES);
}

function clearAuthCookies(res) {
  const opts = baseCookieOptions({ maxAge: 0 });
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.cookie(ACCESS_COOKIE, '', opts);
  res.cookie(REFRESH_COOKIE, '', opts);
}

function signAccessToken(userRow) {
  if (!ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is not set');
  return jwt.sign(
    {
      sub: String(userRow.id),
      typ: 'access',
      role: userRow.role,
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

function verifyAccessToken(token) {
  if (!ACCESS_SECRET) return null;
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    if (payload.typ !== 'access' || !payload.sub) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function insertRefreshRow(pool, userId, rawRefresh, req) {
  const hash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + refreshCookieMaxAgeMs());
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, expiresAt, req.get('user-agent') || null, req.ip || null]
  );
}

async function issueTokenCookies(pool, userRow, req, res) {
  const access = signAccessToken(userRow);
  const rawRefresh = generateRefreshRaw();
  await insertRefreshRow(pool, userRow.id, rawRefresh, req);

  res.cookie(ACCESS_COOKIE, access, baseCookieOptions({ maxAge: accessCookieMaxAgeMs() }));
  res.cookie(REFRESH_COOKIE, rawRefresh, baseCookieOptions({ maxAge: refreshCookieMaxAgeMs() }));
}

async function revokeRefreshByRaw(pool, rawRefresh) {
  if (!rawRefresh) return;
  const hash = hashToken(rawRefresh);
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hash]
  );
}

/**
 * Validates refresh cookie, revokes old row, issues new refresh + access. Returns user row or null.
 */
async function rotateRefreshAndIssue(pool, rawRefresh, req, res) {
  if (!rawRefresh) return null;
  const hash = hashToken(rawRefresh);
  const { rows } = await pool.query(
    `SELECT rt.id AS rt_id, rt.user_id, rt.expires_at
     FROM refresh_tokens rt
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL`,
    [hash]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (new Date(row.expires_at) < new Date()) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [row.rt_id]);
    return null;
  }

  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [row.rt_id]);

  const userRes = await pool.query(
    `SELECT id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, avatar_url, password_hash, google_id
     FROM users WHERE id = $1`,
    [row.user_id]
  );
  if (!userRes.rows.length) return null;
  const u = userRes.rows[0];
  if (u.is_blocked) return null;

  await issueTokenCookies(pool, u, req, res);
  return u;
}

async function attachUserFromAccessOrRefresh(pool, req, res) {
  const access = req.cookies && req.cookies[ACCESS_COOKIE];
  const refresh = req.cookies && req.cookies[REFRESH_COOKIE];

  if (access) {
    const payload = verifyAccessToken(access);
    if (payload) {
      const id = parseInt(payload.sub, 10);
      if (!isNaN(id)) {
        return { id, role: payload.role };
      }
    }
  }

  if (refresh) {
    const userRow = await rotateRefreshAndIssue(pool, refresh, req, res);
    if (userRow) {
      return { id: userRow.id, role: userRow.role };
    }
    clearAuthCookies(res);
  }

  return null;
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  hashToken,
  clearAuthCookies,
  signAccessToken,
  verifyAccessToken,
  issueTokenCookies,
  revokeRefreshByRaw,
  rotateRefreshAndIssue,
  attachUserFromAccessOrRefresh,
  parseDurationToMs,
  accessCookieMaxAgeMs,
};
