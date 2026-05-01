function flashCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 15 * 1000,
  };
}

function normalizeType(v) {
  const t = String(v || '').toLowerCase().trim();
  if (t === 'success') return 'success';
  if (t === 'danger' || t === 'error') return 'danger';
  if (t === 'warning' || t === 'warn') return 'warning';
  return 'info';
}

function normalizeFlash(input) {
  if (!input || typeof input !== 'object') return null;
  const message = String(input.message || '').trim();
  if (!message) return null;
  return { type: normalizeType(input.type), message };
}

function fromQuery(req) {
  if (!req || !req.query) return null;
  if (req.query.success) return normalizeFlash({ type: 'success', message: req.query.success });
  if (req.query.error) return normalizeFlash({ type: 'danger', message: req.query.error });
  if (req.query.warning) return normalizeFlash({ type: 'warning', message: req.query.warning });
  if (req.query.info) return normalizeFlash({ type: 'info', message: req.query.info });
  return null;
}

function flashMiddleware(req, res, next) {
  let flash = null;
  const raw = req.cookies && req.cookies.app_flash ? req.cookies.app_flash : null;
  if (raw) {
    try {
      flash = normalizeFlash(JSON.parse(raw));
    } catch (_) {
      flash = null;
    }
    res.clearCookie('app_flash', { path: '/' });
  }
  if (!flash) flash = fromQuery(req);
  res.locals.flash = flash;

  req.setFlash = (type, message) => {
    const payload = normalizeFlash({ type, message });
    if (!payload) return;
    res.cookie('app_flash', JSON.stringify(payload), flashCookieOptions());
  };

  res.flashRedirect = (url, type, message) => {
    req.setFlash(type, message);
    return res.redirect(url);
  };

  next();
}

module.exports = {
  flashMiddleware,
  normalizeFlash,
};
