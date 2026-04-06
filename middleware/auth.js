function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/auth/login');
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/auth/login');
    }
    if (allowedRoles.includes(req.session.user.role)) {
      return next();
    }
    res.status(403).send('Доступ запрещён');
  };
}

module.exports = { requireAuth, requireRole };
