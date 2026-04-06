require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { testConnection } = require('./db/db');
const authRoutes = require('./routes/auth');
const doctorsRoutes = require('./routes/doctors');
const bookingRoutes = require('./routes/booking');
const ticketsRoutes = require('./routes/tickets');
const profileRoutes = require('./routes/profile');
const doctorRoutes = require('./routes/doctor');
const adminRoutes = require('./routes/admin');
const notificationsRoutes = require('./routes/notifications');

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

const { getUnreadCount } = require('./utils/notifications');

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.unreadNotifCount = 0;
  if (req.session && req.session.user) {
    try { res.locals.unreadNotifCount = await getUnreadCount(req.session.user.id); } catch (_) {}
  }
  next();
});

app.use('/auth', authRoutes);
app.use('/doctors', doctorsRoutes);
app.use(bookingRoutes);
app.use('/tickets', ticketsRoutes);
app.use('/profile', profileRoutes);
app.use('/doctor', doctorRoutes);
app.use('/admin', adminRoutes);
app.use('/notifications', notificationsRoutes);

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
