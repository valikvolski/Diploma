const Tokens = require('csrf');
const { baseCookieOptions } = require('../utils/cookieConfig');

const tokens = new Tokens();
const CSRF_COOKIE = 'csrf_secret';

const CSRF_EXACT_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/google/callback',
]);

function csrfExemptPath(path) {
  return CSRF_EXACT_PATHS.has(path);
}

function ensureCsrfSecret(req, res) {
  let secret = req.cookies && req.cookies[CSRF_COOKIE];
  if (!secret) {
    secret = tokens.secretSync();
    res.cookie(CSRF_COOKIE, secret, baseCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
  }
  return secret;
}

/** Call on every request so POST error re-renders get a fresh token. */
function attachCsrfToken(req, res, next) {
  try {
    const secret = ensureCsrfSecret(req, res);
    res.locals.csrfToken = tokens.create(secret);
  } catch (e) {
    res.locals.csrfToken = '';
  }
  next();
}

function readCsrfTokenFromRequest(req) {
  if (req.body && req.body._csrf) return String(req.body._csrf);
  const h = req.get('x-csrf-token') || req.get('X-CSRF-Token');
  return h ? String(h) : '';
}

function verifyCsrfFromRequest(req) {
  if (csrfExemptPath(req.path)) return true;
  const secret = req.cookies && req.cookies[CSRF_COOKIE];
  const token = readCsrfTokenFromRequest(req);
  if (!secret || !token) return false;
  try {
    return tokens.verify(secret, token);
  } catch (_) {
    return false;
  }
}

function verifyPostCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  if (csrfExemptPath(req.path)) return next();
  if (typeof req.is === 'function' && req.is('multipart/form-data')) return next();
  if (!verifyCsrfFromRequest(req)) {
    return res.status(403).render('error', {
      message: 'Запрос отклонён (защита CSRF). Обновите страницу и попробуйте снова.',
    });
  }
  next();
}

/** After multer: multipart body contains _csrf */
function verifyMultipartCsrf(req, res, next) {
  if (!verifyCsrfFromRequest(req)) {
    return res.status(403).render('error', {
      message: 'Запрос отклонён (защита CSRF). Обновите страницу и попробуйте снова.',
    });
  }
  next();
}

module.exports = {
  attachCsrfToken,
  verifyPostCsrf,
  verifyMultipartCsrf,
  verifyCsrfFromRequest,
  csrfExemptPath,
};
