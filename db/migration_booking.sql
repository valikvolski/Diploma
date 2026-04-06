-- ══════════════════════════════════════════════════════════════
-- Расписание врачей
-- weekday: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday,
--          4=Thursday, 5=Friday, 6=Saturday  (PostgreSQL DOW)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schedules (
  id            SERIAL PRIMARY KEY,
  doctor_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday       SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  slot_duration INTEGER NOT NULL DEFAULT 30,
  UNIQUE(doctor_id, weekday)
);

-- ══════════════════════════════════════════════════════════════
-- Исключения из расписания (отпуск, больничный и т.д.)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id             SERIAL PRIMARY KEY,
  doctor_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  reason         VARCHAR(100),
  UNIQUE(doctor_id, exception_date)
);

-- ══════════════════════════════════════════════════════════════
-- Записи на приём
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS appointments (
  id               SERIAL PRIMARY KEY,
  patient_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'booked'
                   CHECK (status IN ('booked','cancelled','completed')),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(doctor_id, appointment_date, appointment_time)
);

-- ══════════════════════════════════════════════════════════════
-- Талоны
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tickets (
  id             SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  ticket_number  VARCHAR(50) NOT NULL UNIQUE,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- Тестовые расписания: все врачи, Пн–Пт, 09:00–14:00, шаг 30 мин
-- Пн=1, Вт=2, Ср=3, Чт=4, Пт=5 (PostgreSQL DOW)
-- ══════════════════════════════════════════════════════════════
INSERT INTO schedules (doctor_id, weekday, start_time, end_time, slot_duration)
SELECT u.id, w.weekday, '09:00', '14:00', 30
FROM users u
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS w(weekday)
WHERE u.role = 'doctor' AND u.is_blocked = false
ON CONFLICT (doctor_id, weekday) DO NOTHING;
