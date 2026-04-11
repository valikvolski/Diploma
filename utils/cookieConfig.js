const secure =
  process.env.COOKIE_SECURE === 'true' ||
  String(process.env.COOKIE_SECURE).toLowerCase() === '1' ||
  process.env.NODE_ENV === 'production';

function baseCookieOptions(overrides = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    ...overrides,
  };
}

module.exports = { secure, baseCookieOptions };
