require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { testConnection } = require('./db/db');
const authRoutes = require('./routes/auth');
const doctorsRoutes = require('./routes/doctors');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false },
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use('/auth', authRoutes);
app.use('/doctors', doctorsRoutes);

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/test-db', async (req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok', message: 'Database connected successfully' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  testConnection();
});
