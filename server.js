require('./dotenv-config');

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
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
const { attachUser, enrichUserLocals } = require('./middleware/auth');
const { attachCsrfToken, verifyPostCsrf } = require('./middleware/csrf');
const { flashMiddleware } = require('./middleware/flash');
const { getPatientProfileCompletion } = require('./utils/patientProfileCompletion');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://oauth2.googleapis.com'],
        frameSrc: ["'self'", 'https://accounts.google.com'],
      },
    },
  })
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(attachUser);
app.use(enrichUserLocals);
app.use(flashMiddleware);
app.use(attachCsrfToken);

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (typeof req.is === 'function' && req.is('multipart/form-data')) return next();
  verifyPostCsrf(req, res, next);
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
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const span = defaultEnd - defaultStart;
    const nowPct = span ? ((nowMin - defaultStart) / span) * 100 : 0;
    return {
      startMin: defaultStart,
      endMin: defaultEnd,
      nowPct: Math.max(0, Math.min(100, nowPct)),
      pastCount: 0,
      upcomingCount: 0,
      items: [],
    };
  }
  const toMin = (t) => {
    const s = String(t || '0:0');
    const [h, m] = s.split(':').map((x) => parseInt(x, 10) || 0);
    return h * 60 + m;
  };
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = rows
    .slice()
    .sort((a, b) => toMin(a.appointment_time) - toMin(b.appointment_time));

  const mins = sorted.map((r) => toMin(r.appointment_time));
  const pad = 45;
  let startMin = Math.min(...mins) - pad;
  let endMin = Math.max(...mins) + pad;
  startMin = Math.max(6 * 60, startMin);
  endMin = Math.min(22 * 60, endMin);
  if (endMin <= startMin) endMin = startMin + 120;
  const span = endMin - startMin;
  const slotMin = 30;
  const nowPct = span ? ((nowMin - startMin) / span) * 100 : 0;
  let pastCount = 0;
  let upcomingCount = 0;

  const items = sorted.map((r) => {
    const mm = toMin(r.appointment_time);
    const leftPct = span ? ((mm - startMin) / span) * 100 : 0;
    const widthPct = span ? Math.min(40, (slotMin / span) * 100) : 12;

    const diff = mm - nowMin;
    const isNow = Math.abs(diff) <= 10;
    const isPast = !isNow && mm < nowMin;
    const isUpcoming = !isNow && mm > nowMin;
    if (isPast) pastCount += 1;
    if (isUpcoming || isNow) upcomingCount += 1;

    return {
      ...r,
      leftPct,
      widthPct,
      isPast,
      isNow,
      isUpcoming,
      _mm: mm,
    };
  });

  // Защита от визуальных наложений: небольшое вертикальное «расслоение»
  // для близких по времени слотов.
  const minGapPct = Math.max(2.2, (slotMin / span) * 60); // адаптивно от span
  let lastLeft = -999;
  let lane = 0;
  items.forEach((it) => {
    if (it.leftPct - lastLeft < minGapPct) lane = (lane + 1) % 3;
    else lane = 0;
    it.lane = lane;
    lastLeft = it.leftPct;
  });

  return {
    startMin,
    endMin,
    nowPct: Math.max(0, Math.min(100, nowPct)),
    pastCount,
    upcomingCount,
    items: items.map(({ _mm, ...rest }) => rest),
  };
}

app.get('/', async (req, res) => {
  const user = req.user || null;
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

  const curatedTopSpecs = [
    { id: null, name: 'Терапевт' },
    { id: null, name: 'Педиатр' },
    { id: null, name: 'Кардиолог' },
    { id: null, name: 'Офтальмолог' },
  ];

  function specCardMeta(nameRaw) {
    const name = String(nameRaw || '').trim();
    const lower = name.toLowerCase();
    const base = {
      icon: 'bi-heart-pulse',
      description: 'Диагностика и консультация специалистов по профилю.',
    };
    if (lower.includes('терап')) return { icon: 'bi-clipboard2-pulse', description: 'Первичный приём, диагностика и направления к профильным специалистам.' };
    if (lower.includes('карди')) return { icon: 'bi-heart', description: 'Диагностика и лечение заболеваний сердечно‑сосудистой системы.' };
    if (lower.includes('невро')) return { icon: 'bi-activity', description: 'Консультации по неврологическим симптомам и состояниям.' };
    if (lower.includes('лор') || lower.includes('отолар')) return { icon: 'bi-ear', description: 'Заболевания уха, горла и носа, рекомендации и лечение.' };
    if (lower.includes('офталь') || lower.includes('глаз')) return { icon: 'bi-eye', description: 'Проверка зрения, консультации и диагностика заболеваний глаз.' };
    if (lower.includes('хирург')) return { icon: 'bi-scissors', description: 'Консультации по хирургическим случаям и направления на процедуры.' };
    if (lower.includes('стомат')) return { icon: 'bi-emoji-smile', description: 'Осмотр, профилактика и лечение заболеваний полости рта.' };
    if (lower.includes('гинек')) return { icon: 'bi-gender-female', description: 'Профилактика и консультации по женскому здоровью.' };
    if (lower.includes('педиатр')) return { icon: 'bi-people', description: 'Педиатрические консультации и сопровождение здоровья детей.' };
    if (lower.includes('дермат')) return { icon: 'bi-droplet', description: 'Диагностика и лечение заболеваний кожи.' };
    return base;
  }

  try {
    if (!user) {
      const [topSpecsRes, previewDocsRes] = await Promise.all([
        pool.query(`
          SELECT s.id, s.name, COALESCE(dc.cnt, 0)::int AS doctor_count
          FROM specializations s
          LEFT JOIN (
            SELECT ds.specialization_id, COUNT(DISTINCT ds.doctor_user_id) AS cnt
            FROM doctor_specializations ds
            INNER JOIN users u ON u.id = ds.doctor_user_id AND u.role = 'doctor' AND u.is_blocked = false
            GROUP BY ds.specialization_id
          ) dc ON dc.specialization_id = s.id
          ORDER BY COALESCE(dc.cnt, 0) DESC, s.name ASC
          LIMIT 4
        `),
        pool.query(
          `SELECT u.id,
                  u.last_name,
                  u.first_name,
                  u.middle_name,
                  u.avatar_path,
                  u.avatar_url,
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
      const topRows = (topSpecsRes.rows || []).map((r) => ({
        ...r,
        ...specCardMeta(r.name),
      }));
      viewData.guest = {
        topSpecializations: topRows.length
          ? topRows.slice(0, 4)
          : curatedTopSpecs.map((r) => ({ ...r, ...specCardMeta(r.name) })),
        previewDoctors: previewDocsRes.rows,
      };
    } else if (user.role === 'patient') {
      const [upcomingRes, notifRes, prevDocsRes] = await Promise.all([
        pool.query(
          `SELECT a.id AS appointment_id,
                  TO_CHAR(a.appointment_date, 'YYYY-MM-DD') AS appointment_date,
                  a.created_at AS booked_at,
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
        pool.query(
          `SELECT DISTINCT ON (a.doctor_id)
                  d.id,
                  d.last_name,
                  d.first_name,
                  d.middle_name,
                  d.avatar_path,
                  d.avatar_url,
                  dp.cabinet,
                  s.name AS specialization
           FROM appointments a
           JOIN users d ON d.id = a.doctor_id AND d.role = 'doctor' AND d.is_blocked = false
           LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
           LEFT JOIN doctor_specializations dsp ON dsp.doctor_user_id = d.id AND dsp.is_primary = TRUE
           LEFT JOIN specializations s ON s.id = dsp.specialization_id
           WHERE a.patient_id = $1
             AND a.status IN ('completed', 'cancelled', 'booked')
           ORDER BY a.doctor_id, a.appointment_date DESC, a.appointment_time DESC
           LIMIT 2`,
          [user.id]
        ),
      ]);
      const profileCompletion = await getPatientProfileCompletion(pool, user.id);

      viewData.patient = {
        upcomingAppointments: upcomingRes.rows,
        unreadNotifications: notifRes.rows,
        previouslyVisitedDoctors: prevDocsRes.rows,
        profileIncomplete: !profileCompletion.isComplete,
        profileIncompleteMessage: profileCompletion.message || 'Перед записью необходимо заполнить профиль.',
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
             AND a.status IN ('booked', 'completed')
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

app.use((req, res) => {
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Ресурс не найден', errors: {} });
  }
  return res.status(404).render('error', { message: 'Страница не найдена' });
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера', errors: {} });
  }
  return res.status(500).render('error', { message: 'Произошла внутренняя ошибка. Попробуйте позже.' });
});

async function startServer() {
  if (!process.env.JWT_ACCESS_SECRET || String(process.env.JWT_ACCESS_SECRET).length < 16) {
    console.warn('WARNING: Set a strong JWT_ACCESS_SECRET in .env (min ~16+ characters).');
  }
  if (!process.env.JWT_REFRESH_SECRET || String(process.env.JWT_REFRESH_SECRET).length < 16) {
    console.warn('WARNING: Set JWT_REFRESH_SECRET in .env — it is used to hash refresh tokens.');
  }
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
