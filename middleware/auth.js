const { pool } = require('../db/db');
const { getUnreadCount } = require('../utils/notifications');
const {
  attachUserFromAccessOrRefresh,
  clearAuthCookies,
} = require('../utils/jwtTokens');

const ACCESS_COOKIE = 'access_token';

function mapUserRow(u) {
  return {
    id: u.id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    middle_name: u.middle_name,
    role: u.role,
    is_blocked: u.is_blocked,
    avatar_path: u.avatar_path || null,
    avatar_url: u.avatar_url || null,
  };
}

/**
 * Sets req.jwtUser minimal { id, role } from valid access JWT or refresh rotation.
 */
async function attachUser(req, res, next) {
  req.jwtUser = null;
  try {
    req.jwtUser = await attachUserFromAccessOrRefresh(pool, req, res);
  } catch (err) {
    console.error('attachUser error:', err);
    clearAuthCookies(res);
    req.jwtUser = null;
  }
  next();
}

/**
 * Loads full user from DB, blocks revoked/blocked accounts, sets req.user + res.locals.
 */
async function enrichUserLocals(req, res, next) {
  res.locals.user = null;
  res.locals.unreadNotifCount = 0;
  res.locals.currentPath = req.path || '';
  res.locals.appMountPath = (process.env.APP_BASE_PATH || '').replace(/\/$/, '');

  if (!req.jwtUser) {
    return next();
  }

  try {
    const uRes = await pool.query(
      `SELECT id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, avatar_url
       FROM users WHERE id = $1`,
      [req.jwtUser.id]
    );
    if (!uRes.rows.length || uRes.rows[0].is_blocked) {
      clearAuthCookies(res);
      req.jwtUser = null;
      return next();
    }
    const u = mapUserRow(uRes.rows[0]);
    req.user = u;
    res.locals.user = u;
    try {
      res.locals.unreadNotifCount = await getUnreadCount(u.id);
    } catch (_) {
      res.locals.unreadNotifCount = 0;
    }
  } catch (err) {
    console.error('enrichUserLocals error:', err);
    req.user = null;
    res.locals.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  const dest = req.originalUrl && req.originalUrl !== '/auth/logout' ? req.originalUrl : '/';
  res.redirect(`/auth/login?next=${encodeURIComponent(dest)}`);
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/auth/login');
    }
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }
    if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён', errors: {} });
    }
    return res.status(403).render('error', { message: 'Доступ запрещён' });
  };
}

module.exports = {
  attachUser,
  enrichUserLocals,
  requireAuth,
  requireRole,
  ACCESS_COOKIE,
};
