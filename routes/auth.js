const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('../db/db');
const { baseCookieOptions } = require('../utils/cookieConfig');
const {
  issueTokenCookies,
  revokeRefreshByRaw,
  revokeAllRefreshTokensForUser,
  clearAuthCookies,
  rotateRefreshAndIssue,
} = require('../utils/jwtTokens');
const { normalizeSixDigitCode } = require('../utils/passwordResetCode');
const {
  PURPOSE_FORGOT,
  sendPasswordVerificationCode,
  verifyPurposeCodeAndSetPassword,
} = require('../utils/passwordResetOps');
const {
  sendPasswordResetCodeEmail,
  sendPasswordChangedNoticeEmail,
} = require('../utils/mailer');
const { googleAuthParams, exchangeCodeForTokens, fetchGoogleUserInfo } = require('../utils/googleOAuth');
const { deriveNamesFromGoogleProfile, syncGoogleProfileAfterLogin } = require('../utils/googleProfileSync');
const { GOOGLE_SIGNUP_PLACEHOLDER_PHONE, normalizeBelarusPhone } = require('../utils/patientPhone');

const router = express.Router();
const SALT_ROUNDS = 10;

const OAUTH_STATE_COOKIE = 'oauth_google_state';
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res, _next, options) {
    res.status(429).render('error', { message: String(options.message) });
  },
  message: 'Слишком много попыток входа. Попробуйте позже.',
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res, _next, options) {
    res.status(429).render('error', { message: String(options.message) });
  },
  message: 'Слишком много регистраций с этого адреса. Попробуйте позже.',
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res, _next, options) {
    res.status(429).render('error', { message: String(options.message) });
  },
  message: 'Слишком много запросов восстановления. Попробуйте через час.',
});

const resetPasswordSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res, _next, options) {
    res.status(429).render('error', { message: String(options.message) });
  },
  message: 'Слишком много попыток сброса пароля. Подождите немного.',
});

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeNextPath(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  return s;
}

// ─── GET /auth/forgot-password ─────────────────────────────────────────────────

router.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/forgot-password', {
    error: null,
    formData: { email: '' },
    googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
  });
});

// ─── POST /auth/forgot-password ──────────────────────────────────────────────

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  if (req.user) return res.redirect('/');

  const emailRaw = (req.body.email || '').trim();
  const formData = { email: emailRaw };

  if (!validateEmail(emailRaw)) {
    return res.render('auth/forgot-password', {
      error: 'Введите корректный адрес электронной почты',
      formData,
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });
  }

  const email = emailRaw.toLowerCase();

  try {
    const uRes = await pool.query('SELECT id, is_blocked FROM users WHERE email = $1', [email]);
    const user = uRes.rows[0];

    if (user && !user.is_blocked) {
      await sendPasswordVerificationCode(pool, {
        userId: user.id,
        email,
        purpose: PURPOSE_FORGOT,
        sendMailWithPlain: async ({ plain, expiresMinutes, to }) => {
          await sendPasswordResetCodeEmail({
            to,
            code: plain,
            expiresMinutes,
          });
        },
      });
    }

    return res.redirect('/auth/reset-password?info=sent');
  } catch (err) {
    console.error('Forgot password error:', err.message || err);
    return res.redirect('/auth/reset-password?info=sent');
  }
});

// ─── GET /auth/reset-password ────────────────────────────────────────────────

router.get('/reset-password', (req, res) => {
  if (req.user) return res.redirect('/');
  const info = req.query.info === 'sent';
  res.render('auth/reset-password', {
    error: null,
    infoSent: info,
    formData: { email: '', code: '', password: '', password_confirm: '' },
    googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
  });
});

// ─── POST /auth/reset-password ───────────────────────────────────────────────

router.post('/reset-password', resetPasswordSubmitLimiter, async (req, res) => {
  if (req.user) return res.redirect('/');

  const { email: emailRaw, password, password_confirm, code: codeRaw } = req.body;
  const formData = {
    email: (emailRaw || '').trim(),
    code: codeRaw || '',
    password: password || '',
    password_confirm: password_confirm || '',
  };

  const renderErr = (error) =>
    res.render('auth/reset-password', {
      error,
      infoSent: false,
      formData: { ...formData, password: '', password_confirm: '' },
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });

  if (!validateEmail(formData.email)) {
    return renderErr('Введите корректный email');
  }

  const code = normalizeSixDigitCode(formData.code);
  if (!/^\d{6}$/.test(code)) {
    return renderErr('Код должен состоять из 6 цифр');
  }

  if (!password || password.length < 6) {
    return renderErr('Пароль должен содержать не менее 6 символов');
  }

  if (password !== password_confirm) {
    return renderErr('Пароли не совпадают');
  }

  const email = formData.email.toLowerCase();

  try {
    const uRes = await pool.query(
      'SELECT id, email, first_name, is_blocked FROM users WHERE email = $1',
      [email]
    );
    if (!uRes.rows.length) {
      return renderErr('Не удалось сбросить пароль. Проверьте email и код.');
    }

    const user = uRes.rows[0];
    if (user.is_blocked) {
      return renderErr('Не удалось сбросить пароль. Проверьте email и код.');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const vr = await verifyPurposeCodeAndSetPassword(pool, {
      userId: user.id,
      purpose: PURPOSE_FORGOT,
      codeRaw: formData.code,
      password,
      bcryptHash: passwordHash,
    });

    if (!vr.ok) {
      const map = {
        config: 'Сброс пароля временно недоступен. Обратитесь к администратору.',
        bad_code_format: 'Код должен состоять из 6 цифр',
        weak_password: 'Пароль должен содержать не менее 6 символов',
        no_code: 'Сначала запросите код на странице «Забыли пароль?».',
        code_invalid: 'Код недействителен или уже использован. Запросите новый на странице «Забыли пароль?».',
        expired: 'Срок действия кода истёк. Запросите новый на странице «Забыли пароль?».',
        too_many_attempts: 'Превышено число попыток ввода кода. Запросите новый код.',
        wrong_code: 'Неверный код подтверждения.',
      };
      return renderErr(map[vr.error] || 'Не удалось сбросить пароль. Попробуйте снова.');
    }

    await revokeAllRefreshTokensForUser(pool, user.id);
    try {
      await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
    } catch (_) {}
    clearAuthCookies(res);

    sendPasswordChangedNoticeEmail({ to: user.email, firstName: user.first_name }).catch(() => {});

    return res.redirect(
      '/auth/login?success=' + encodeURIComponent('Пароль обновлён. Войдите с новым паролем.')
    );
  } catch (err) {
    console.error('Reset password error:', err.message || err);
    return renderErr('Произошла ошибка. Попробуйте позже.');
  }
});

// ─── GET /auth/register ──────────────────────────────────────────────────────

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID });
});

// ─── POST /auth/register ─────────────────────────────────────────────────────

router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, password_confirm, first_name, last_name, middle_name, phone, birth_date } = req.body;
  const formData = { email, first_name, last_name, middle_name, phone, birth_date };
  const renderRegisterError = (message, errors = {}) =>
    res.status(400).render('auth/register', {
      error: message,
      errors,
      flash: { type: 'danger', message },
      formData,
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });

  if (!email || !password || !password_confirm || !first_name || !last_name || !middle_name || !phone || !birth_date) {
    return renderRegisterError('Все поля обязательны для заполнения', {
      email: !email ? 'Укажите email' : undefined,
      password: !password ? 'Укажите пароль' : undefined,
      password_confirm: !password_confirm ? 'Подтвердите пароль' : undefined,
      first_name: !first_name ? 'Укажите имя' : undefined,
      last_name: !last_name ? 'Укажите фамилию' : undefined,
      middle_name: !middle_name ? 'Укажите отчество' : undefined,
      phone: !phone ? 'Укажите телефон' : undefined,
      birth_date: !birth_date ? 'Укажите дату рождения' : undefined,
    });
  }

  if (!validateEmail(email)) {
    return renderRegisterError('Введите корректный адрес электронной почты', {
      email: 'Некорректный email',
    });
  }

  if (password.length < 6) {
    return renderRegisterError('Пароль должен содержать не менее 6 символов', {
      password: 'Минимум 6 символов',
    });
  }

  if (password !== password_confirm) {
    return renderRegisterError('Пароли не совпадают', {
      password_confirm: 'Пароли не совпадают',
    });
  }

  const phoneNorm = normalizeBelarusPhone(phone);
  if (!phoneNorm) {
    return renderRegisterError('Неверный формат телефона. Пример: 375291234567', {
      phone: 'Пример: 375291234567',
    });
  }

  const birthDateRaw = String(birth_date || '').trim();
  const birthDateOk = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw) && !Number.isNaN(Date.parse(birthDateRaw));
  if (!birthDateOk || birthDateRaw < '1900-01-01') {
    return renderRegisterError('Укажите корректную дату рождения', {
      birth_date: 'Неверная дата рождения',
    });
  }
  const todayYmd = new Date().toISOString().slice(0, 10);
  if (birthDateRaw > todayYmd) {
    return renderRegisterError('Дата рождения не может быть в будущем', {
      birth_date: 'Дата рождения не может быть в будущем',
    });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return renderRegisterError('Пользователь с таким email уже зарегистрирован', {
        email: 'Email уже используется',
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const ins = await pool.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
       VALUES ($1, $2, $3, $4, $5, $6, 'patient', false)
       RETURNING id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, password_hash, google_id`,
      [email.toLowerCase().trim(), passwordHash, first_name.trim(), last_name.trim(), middle_name.trim(), phoneNorm]
    );

    const row = ins.rows[0];
    await pool.query(
      `INSERT INTO patient_profiles (user_id, birth_date)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET birth_date = COALESCE(patient_profiles.birth_date, EXCLUDED.birth_date)`,
      [row.id, birthDateRaw]
    );

    await issueTokenCookies(pool, row, req, res);
    return res.redirect('/');
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).render('auth/register', {
      error: 'Произошла ошибка при регистрации. Попробуйте позже.',
      errors: {},
      flash: { type: 'danger', message: 'Произошла ошибка при регистрации. Попробуйте позже.' },
      formData,
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });
  }
});

// ─── GET /auth/login ─────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  let success = null;
  if (req.query.registered) {
    success = 'Регистрация прошла успешно! Теперь вы можете войти.';
  } else if (req.query.password_changed === '1') {
    success = 'Пароль изменён. Войдите с новым паролем.';
  } else if (req.query.success && typeof req.query.success === 'string') {
    try {
      success = decodeURIComponent(req.query.success);
    } catch {
      success = null;
    }
    if (success && success.length > 500) success = success.slice(0, 500);
  }
  res.render('auth/login', {
    success,
    formData: { email: '' },
    next: safeNextPath(req.query.next),
    googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
  });
});

// ─── POST /auth/login ────────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const loginForm = { email: email || '' };
  const next = safeNextPath(req.body.next || req.query.next);
  const renderLoginError = (message, errors = {}) =>
    res.status(400).render('auth/login', {
      error: message,
      errors,
      flash: { type: 'danger', message },
      formData: loginForm,
      next,
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });

  if (!email || !password) {
    return renderLoginError('Введите email и пароль', {
      email: !email ? 'Укажите email' : undefined,
      password: !password ? 'Укажите пароль' : undefined,
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, middle_name, role, is_blocked, avatar_path, google_id
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return renderLoginError('Неверный email или пароль');
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return renderLoginError('Ваш аккаунт заблокирован. Обратитесь к администратору.');
    }

    if (!user.password_hash) {
      return renderLoginError(
        'Пароль для этого аккаунта ещё не задан. Войдите через Google или установите пароль через «Забыли пароль?».'
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return renderLoginError('Неверный email или пароль');
    }

    await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
    await issueTokenCookies(pool, user, req, res);
    return res.redirect(next);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).render('auth/login', {
      error: 'Произошла ошибка. Попробуйте позже.',
      errors: {},
      flash: { type: 'danger', message: 'Произошла ошибка. Попробуйте позже.' },
      formData: loginForm,
      next,
      googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    });
  }
});

// ─── POST /auth/logout ───────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  try {
    await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
  } catch (e) {
    console.error('Logout revoke error:', e);
  }
  clearAuthCookies(res);
  res.redirect('/');
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────

router.post('/refresh', refreshLimiter, async (req, res) => {
  const raw = req.cookies && req.cookies.refresh_token;
  if (!raw) {
    clearAuthCookies(res);
    return res.status(401).json({ ok: false });
  }
  const userRow = await rotateRefreshAndIssue(pool, raw, req, res);
  if (!userRow) {
    clearAuthCookies(res);
    return res.status(401).json({ ok: false });
  }
  return res.json({ ok: true });
});

// ─── GET /auth/google ─────────────────────────────────────────────────────────

router.get('/google', (req, res) => {
  if (req.user) return res.redirect('/');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_CALLBACK_URL) {
    return res.status(503).render('error', { message: 'Вход через Google временно недоступен.' });
  }
  const state = crypto.randomBytes(32).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, baseCookieOptions({ maxAge: OAUTH_STATE_MAX_AGE }));
  res.redirect(googleAuthParams(state));
});

// ─── GET /auth/google/callback ────────────────────────────────────────────────

router.get('/google/callback', async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;
  const cookieState = req.cookies && req.cookies[OAUTH_STATE_COOKIE];

  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

  if (error) {
    return res.render('auth/login', {
      error: errDesc || error || 'Вход через Google отменён',
      formData: { email: '' },
      next: '/',
      googleAuthEnabled: true,
    });
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    return res.render('auth/login', {
      error: 'Недействительный запрос OAuth. Попробуйте снова.',
      formData: { email: '' },
      next: '/',
      googleAuthEnabled: true,
    });
  }

  try {
    const tokenPayload = await exchangeCodeForTokens(String(code));
    const profile = await fetchGoogleUserInfo(tokenPayload.access_token, tokenPayload.id_token);

    if (!profile.email_verified || !profile.email) {
      return res.render('auth/login', {
        error: 'Google не подтвердил email. Выберите аккаунт с подтверждённой почтой.',
        formData: { email: '' },
        next: '/',
        googleAuthEnabled: true,
      });
    }

    const email = profile.email;
    const googleSub = profile.sub;
    if (!googleSub) {
      return res.render('auth/login', {
        error: 'Не удалось получить идентификатор профиля Google.',
        formData: { email: '' },
        next: '/',
        googleAuthEnabled: true,
      });
    }

    const userSelect = `SELECT id, email, password_hash, first_name, last_name, middle_name, role, is_blocked,
        avatar_path, avatar_url, google_id
       FROM users WHERE `;

    const byGoogle = await pool.query(userSelect + 'google_id = $1', [googleSub]);

    let user = byGoogle.rows[0];

    if (user) {
      if (user.is_blocked) {
        return res.render('auth/login', {
          error: 'Аккаунт заблокирован. Обратитесь к администратору.',
          formData: { email: '' },
          next: '/',
          googleAuthEnabled: true,
        });
      }
      await syncGoogleProfileAfterLogin(pool, user.id, profile, user);
      const refreshed = await pool.query(
        `SELECT id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, avatar_url, password_hash, google_id
         FROM users WHERE id = $1`,
        [user.id]
      );
      user = refreshed.rows[0];
      await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
      await issueTokenCookies(pool, user, req, res);
      return res.redirect('/');
    }

    const byEmail = await pool.query(userSelect + 'email = $1', [email]);

    if (byEmail.rows.length) {
      user = byEmail.rows[0];
      if (user.is_blocked) {
        return res.render('auth/login', {
          error: 'Аккаунт заблокирован. Обратитесь к администратору.',
          formData: { email: '' },
          next: '/',
          googleAuthEnabled: true,
        });
      }
      if (user.google_id && user.google_id !== googleSub) {
        return res.render('auth/login', {
          error: 'Этот email уже привязан к другому аккаунту Google.',
          formData: { email: '' },
          next: '/',
          googleAuthEnabled: true,
        });
      }
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleSub, user.id]);
        user.google_id = googleSub;
      }
      await syncGoogleProfileAfterLogin(pool, user.id, profile, user);
      const refreshed = await pool.query(
        `SELECT id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, avatar_url, password_hash, google_id
         FROM users WHERE id = $1`,
        [user.id]
      );
      user = refreshed.rows[0];
      await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
      await issueTokenCookies(pool, user, req, res);
      return res.redirect('/');
    }

    const { first_name: firstName, last_name: lastName } = deriveNamesFromGoogleProfile(profile);
    const pic = profile.picture || null;

    const ins = await pool.query(
      `INSERT INTO users
        (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked, google_id,
         google_picture_url, google_locale, google_email_verified, avatar_url)
       VALUES ($1, NULL, $2, $3, '', $4, 'patient', false, $5, $6, $7, $8, $9)
       RETURNING id, email, first_name, last_name, middle_name, role, is_blocked, avatar_path, avatar_url, password_hash, google_id`,
      [
        email,
        firstName,
        lastName,
        GOOGLE_SIGNUP_PLACEHOLDER_PHONE,
        googleSub,
        pic,
        profile.locale,
        profile.email_verified === true,
        pic,
      ]
    );

    user = ins.rows[0];
    await pool.query('INSERT INTO patient_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [
      user.id,
    ]);

    await revokeRefreshByRaw(pool, req.cookies && req.cookies.refresh_token);
    await issueTokenCookies(pool, user, req, res);
    return res.redirect('/profile/edit?need_profile=1&warning=' + encodeURIComponent('Перед записью необходимо заполнить профиль.'));
  } catch (err) {
    console.error('Google OAuth error:', err);
    return res.render('auth/login', {
      error: 'Не удалось войти через Google. Попробуйте позже.',
      formData: { email: '' },
      next: '/',
      googleAuthEnabled: true,
    });
  }
});

module.exports = router;
