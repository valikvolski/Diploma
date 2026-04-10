const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/db');

const router = express.Router();
const SALT_ROUNDS = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── GET /auth/register ──────────────────────────────────────────────────────

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register');
});

// ─── POST /auth/register ─────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, password_confirm, first_name, last_name, middle_name, phone } = req.body;
  const formData = { email, first_name, last_name, middle_name, phone };

  // Server-side validation
  if (!email || !password || !password_confirm || !first_name || !last_name || !middle_name || !phone) {
    return res.render('auth/register', {
      error: 'Все поля обязательны для заполнения',
      formData,
    });
  }

  if (!validateEmail(email)) {
    return res.render('auth/register', {
      error: 'Введите корректный адрес электронной почты',
      formData,
    });
  }

  if (password.length < 6) {
    return res.render('auth/register', {
      error: 'Пароль должен содержать не менее 6 символов',
      formData,
    });
  }

  if (password !== password_confirm) {
    return res.render('auth/register', {
      error: 'Пароли не совпадают',
      formData,
    });
  }

  if (!/^\+375[0-9]{9}$/.test(phone.trim())) {
    return res.render('auth/register', {
      error: 'Неверный формат телефона. Пример: +375291234567',
      formData,
    });
  }

  try {
    // Check duplicate email
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existing.rows.length > 0) {
      return res.render('auth/register', {
        error: 'Пользователь с таким email уже зарегистрирован',
        formData,
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, middle_name, phone, role, is_blocked)
       VALUES ($1, $2, $3, $4, $5, $6, 'patient', false)`,
      [
        email.toLowerCase().trim(),
        passwordHash,
        first_name.trim(),
        last_name.trim(),
        middle_name.trim(),
        phone.trim(),
      ]
    );

    res.redirect('/auth/login?registered=1');
  } catch (err) {
    console.error('Registration error:', err);
    res.render('auth/register', {
      error: 'Произошла ошибка при регистрации. Попробуйте позже.',
      formData,
    });
  }
});

// ─── GET /auth/login ─────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const success = req.query.registered
    ? 'Регистрация прошла успешно! Теперь вы можете войти.'
    : null;
  res.render('auth/login', { success, formData: { email: '' } });
});

// ─── POST /auth/login ────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const loginForm = { email: email || '' };

  if (!email || !password) {
    return res.render('auth/login', { error: 'Введите email и пароль', formData: loginForm });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.render('auth/login', { error: 'Неверный email или пароль', formData: loginForm });
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return res.render('auth/login', {
        error: 'Ваш аккаунт заблокирован. Обратитесь к администратору.',
        formData: loginForm,
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.render('auth/login', { error: 'Неверный email или пароль', formData: loginForm });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      middle_name: user.middle_name,
      role: user.role,
      is_blocked: user.is_blocked,
    };

    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { error: 'Произошла ошибка. Попробуйте позже.', formData: loginForm });
  }
});

// ─── POST /auth/logout ───────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.redirect('/');
  });
});

module.exports = router;
