require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { pool, testConnection, ensureDoctorSpecializationsOrWarn } = require('./db/db');
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
  res.locals.currentPath = req.path || '';
  res.locals.appMountPath = (process.env.APP_BASE_PATH || '').replace(/\/$/, '');
  if (req.session && req.session.user) {
    try {
      const uRes = await pool.query('SELECT avatar_path FROM users WHERE id = $1', [req.session.user.id]);
      if (uRes.rows.length) req.session.user.avatar_path = uRes.rows[0].avatar_path;
      res.locals.user = req.session.user;
    } catch (_) {}
    try {
      res.locals.unreadNotifCount = await getUnreadCount(req.session.user.id);
    } catch (_) {}
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

function buildDoctorTimeline(rows) {
  const defaultStart = 9 * 60;
  const defaultEnd = 18 * 60;
  if (!rows || !rows.length) {
    return { startMin: defaultStart, endMin: defaultEnd, items: [] };
  }
  const toMin = (t) => {
    const s = String(t || '0:0');
    const [h, m] = s.split(':').map((x) => parseInt(x, 10) || 0);
    return h * 60 + m;
  };
  const mins = rows.map((r) => toMin(r.appointment_time));
  const pad = 45;
  let startMin = Math.min(...mins) - pad;
  let endMin = Math.max(...mins) + pad;
  startMin = Math.max(6 * 60, startMin);
  endMin = Math.min(22 * 60, endMin);
  if (endMin <= startMin) endMin = startMin + 120;
  const span = endMin - startMin;
  const slotMin = 30;
  const items = rows.map((r) => {
    const mm = toMin(r.appointment_time);
    const leftPct = span ? ((mm - startMin) / span) * 100 : 0;
    const widthPct = span ? Math.min(40, (slotMin / span) * 100) : 12;
    return { ...r, leftPct, widthPct };
  });
  return { startMin, endMin, items };
}

app.get('/', async (req, res) => {
  const user = req.session.user || null;
  const role = user ? user.role : 'guest';
  const viewData = {
    title: 'МедЗапись — онлайн-запись к врачу',
    fullWidth: true,
    loadHomeAnimations: true,
    role,
    guest: null,
    patient: null,
    doctor: null,
    admin: null,
  };

  try {
    if (!user) {
      const [specsRes, previewDocsRes] = await Promise.all([
        pool.query('SELECT id, name FROM specializations ORDER BY name'),
        pool.query(
          `SELECT u.id,
                  u.last_name,
                  u.first_name,
                  u.middle_name,
                  u.avatar_path,
                  dp.cabinet,
                  dp.experience_years,
                  specs.spec_list AS specializations
           FROM users u
           JOIN doctor_profiles dp ON u.id = dp.user_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(
               json_agg(
                 json_build_object('name', s.name, 'is_primary', ds.is_primary)
                 ORDER BY ds.is_primary DESC, s.name
               ),
               '[]'::json
             ) AS spec_list
             FROM doctor_specializations ds
             JOIN specializations s ON s.id = ds.specialization_id
             WHERE ds.doctor_user_id = u.id
           ) specs ON true
           WHERE u.role = 'doctor' AND u.is_blocked = false
           ORDER BY u.last_name, u.first_name
           LIMIT 3`
        ),
      ]);
      viewData.guest = {
        specializations: specsRes.rows,
        previewDoctors: previewDocsRes.rows,
      };
    } else if (user.role === 'patient') {
      const [upcomingRes, notifRes] = await Promise.all([
        pool.query(
          `SELECT a.id AS appointment_id,
                  a.appointment_date,
                  TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
                  d.last_name AS doctor_last_name,
                  d.first_name AS doctor_first_name,
                  d.middle_name AS doctor_middle_name,
                  dp.cabinet,
                  s.name AS specialization,
                  t.id AS ticket_id
           FROM appointments a
           JOIN users d ON d.id = a.doctor_id
           LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
           LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
           LEFT JOIN specializations s ON s.id = dsp.specialization_id
           LEFT JOIN tickets t ON t.appointment_id = a.id
           WHERE a.patient_id = $1
             AND a.status = 'booked'
             AND (a.appointment_date > CURRENT_DATE
               OR (a.appointment_date = CURRENT_DATE AND a.appointment_time >= CURRENT_TIME))
           ORDER BY a.appointment_date, a.appointment_time
           LIMIT 3`,
          [user.id]
        ),
        pool.query(
          `SELECT id, title, message, created_at
           FROM notifications
           WHERE user_id = $1 AND is_read = false
           ORDER BY created_at DESC
           LIMIT 5`,
          [user.id]
        ),
      ]);

      viewData.patient = {
        upcomingAppointments: upcomingRes.rows,
        unreadNotifications: notifRes.rows,
      };
    } else if (user.role === 'doctor') {
      const [todayRes, nextRes] = await Promise.all([
        pool.query(
          `SELECT a.id,
                  TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
                  p.last_name,
                  p.first_name,
                  p.middle_name,
                  a.status
           FROM appointments a
           JOIN users p ON p.id = a.patient_id
           WHERE a.doctor_id = $1
             AND a.appointment_date = CURRENT_DATE
           ORDER BY a.appointment_time`,
          [user.id]
        ),
        pool.query(
          `SELECT a.id,
                  TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
                  p.last_name,
                  p.first_name,
                  p.middle_name
           FROM appointments a
           JOIN users p ON p.id = a.patient_id
           WHERE a.doctor_id = $1
             AND a.status = 'booked'
             AND (a.appointment_date > CURRENT_DATE
               OR (a.appointment_date = CURRENT_DATE AND a.appointment_time >= CURRENT_TIME))
           ORDER BY a.appointment_date, a.appointment_time
           LIMIT 1`,
          [user.id]
        ),
      ]);

      viewData.doctor = {
        todayAppointments: todayRes.rows,
        todayCount: todayRes.rows.length,
        nextPatient: nextRes.rows[0] || null,
        timeline: buildDoctorTimeline(todayRes.rows),
      };
    } else if (user.role === 'admin') {
      const [
        doctorsRes,
        patientsRes,
        todayApptsRes,
        specsRes,
        recentApptRes,
        recentUsersRes,
        apptsByDayRes,
        apptsByStatusRes,
      ] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM users WHERE role = 'doctor'"),
        pool.query("SELECT COUNT(*) FROM users WHERE role = 'patient'"),
        pool.query(
          `SELECT COUNT(*) FROM appointments
           WHERE appointment_date = CURRENT_DATE AND status = 'booked'`
        ),
        pool.query('SELECT COUNT(*) FROM specializations'),
        pool.query(
          `SELECT a.id,
                  a.created_at,
                  a.appointment_date,
                  TO_CHAR(a.appointment_time, 'HH24:MI') AS appointment_time,
                  a.status,
                  p.last_name AS p_last_name,
                  p.first_name AS p_first_name,
                  d.last_name AS d_last_name,
                  d.first_name AS d_first_name,
                  s.name AS specialization
           FROM appointments a
           JOIN users p ON p.id = a.patient_id
           JOIN users d ON d.id = a.doctor_id
           LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
           LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
           LEFT JOIN specializations s ON s.id = dsp.specialization_id
           ORDER BY a.created_at DESC NULLS LAST, a.id DESC
           LIMIT 8`
        ),
        pool.query(
          `SELECT id, created_at, role, email, last_name, first_name
           FROM users
           ORDER BY created_at DESC NULLS LAST, id DESC
           LIMIT 8`
        ),
        pool.query(
          `SELECT gs::date AS d, COUNT(a.id)::int AS cnt
           FROM generate_series(
             (CURRENT_DATE - INTERVAL '13 days')::date,
             CURRENT_DATE::date,
             '1 day'::interval
           ) AS gs
           LEFT JOIN appointments a ON a.appointment_date = gs::date
           GROUP BY gs
           ORDER BY gs`
        ),
        pool.query(
          `SELECT status, COUNT(*)::int AS cnt
           FROM appointments
           GROUP BY status`
        ),
      ]);

      const activity = [];
      recentApptRes.rows.forEach((r) => {
        const t = r.created_at
          ? new Date(r.created_at).getTime()
          : new Date(`${String(r.appointment_date).slice(0, 10)}T12:00:00`).getTime();
        activity.push({
          kind: 'appointment',
          at: t,
          title: 'Запись',
          meta: `${r.p_last_name} ${r.p_first_name} → ${r.d_last_name} ${r.d_first_name} · ${String(r.appointment_date).slice(0, 10)} ${r.appointment_time}`,
        });
      });
      recentUsersRes.rows.forEach((r) => {
        const roleRu =
          r.role === 'doctor' ? 'врач' : r.role === 'admin' ? 'админ' : 'пациент';
        const t = r.created_at ? new Date(r.created_at).getTime() : 0;
        activity.push({
          kind: 'registration',
          at: t,
          title: 'Регистрация',
          meta: `${r.last_name} ${r.first_name} · ${r.email} (${roleRu})`,
        });
      });
      activity.sort((a, b) => b.at - a.at);
      const recentActivity = activity.slice(0, 10);

      const statusCounts = { booked: 0, cancelled: 0, completed: 0, other: 0 };
      apptsByStatusRes.rows.forEach((row) => {
        const k = row.status;
        if (k === 'booked') statusCounts.booked += row.cnt;
        else if (k === 'cancelled') statusCounts.cancelled += row.cnt;
        else if (k === 'completed') statusCounts.completed += row.cnt;
        else statusCounts.other += row.cnt;
      });

      const chartPayload = {
        daysLabels: apptsByDayRes.rows.map((row) => {
          const d = new Date(row.d);
          return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }),
        daysCounts: apptsByDayRes.rows.map((row) => row.cnt),
        statusLabels: ['Забронировано', 'Отменено', 'Завершено', 'Прочее'],
        statusCounts: [
          statusCounts.booked,
          statusCounts.cancelled,
          statusCounts.completed,
          statusCounts.other,
        ],
      };

      viewData.admin = {
        stats: {
          doctors: parseInt(doctorsRes.rows[0].count, 10) || 0,
          patients: parseInt(patientsRes.rows[0].count, 10) || 0,
          todayAppointments: parseInt(todayApptsRes.rows[0].count, 10) || 0,
          specializations: parseInt(specsRes.rows[0].count, 10) || 0,
        },
        recentAppointments: recentApptRes.rows,
        recentActivity,
        chartPayload,
      };
    }
  } catch (err) {
    console.error('Home page data error:', err);
  }

  res.render('index', viewData);
});

app.get('/test-db', async (req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok', message: 'Database connected successfully' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

async function startServer() {
  await testConnection();
  await ensureDoctorSpecializationsOrWarn(pool);
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
