-- ══════════════════════════════════════════════════════
-- Таблица профилей врачей
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doctor_profiles (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialization_id INTEGER REFERENCES specializations(id),
  cabinet          VARCHAR(20),
  experience_years INTEGER DEFAULT 0,
  education        TEXT,
  description      TEXT,
  UNIQUE(user_id)
);

-- ══════════════════════════════════════════════════════
-- Специализации (полный список = db/migrations/002_specializations_seed.sql)
-- ══════════════════════════════════════════════════════
ALTER TABLE specializations
  ADD COLUMN IF NOT EXISTS compat_group VARCHAR(32) NOT NULL DEFAULT 'therapy';

CREATE UNIQUE INDEX IF NOT EXISTS specializations_name_unique ON specializations (name);

INSERT INTO specializations (name, compat_group) VALUES
  ('Аллерголог-иммунолог', 'therapy'),
  ('Анестезиолог-реаниматолог', 'surgery'),
  ('Врач УЗИ', 'imaging'),
  ('Гастроэнтеролог', 'therapy'),
  ('Гинеколог', 'gynecology'),
  ('Дерматолог', 'therapy'),
  ('Инфекционист', 'therapy'),
  ('Кардиолог', 'therapy'),
  ('ЛОР (оториноларинголог)', 'ent'),
  ('Невролог', 'therapy'),
  ('Нефролог', 'therapy'),
  ('Онколог', 'therapy'),
  ('Офтальмолог', 'ophthalmology'),
  ('Педиатр', 'therapy'),
  ('Проктолог', 'surgery'),
  ('Психиатр', 'therapy'),
  ('Пульмонолог', 'therapy'),
  ('Ревматолог', 'therapy'),
  ('Рентгенолог', 'imaging'),
  ('Стоматолог', 'dental'),
  ('Терапевт', 'therapy'),
  ('Травматолог-ортопед', 'surgery'),
  ('Уролог', 'surgery'),
  ('Хирург', 'surgery'),
  ('Эндокринолог', 'therapy')
ON CONFLICT (name) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- Тестовые врачи (users + doctor_profiles)
-- ══════════════════════════════════════════════════════

-- Врач 1: Терапевт
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('ivanova.doctor@clinic.ru', '$2b$10$placeholder', 'Иванова', 'Елена', 'Сергеевна', '+375291001001', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '101', 15,
  'Белорусский государственный медицинский университет, 2008. Ординатура по терапии.',
  'Опытный терапевт с 15-летним стажем. Специализируется на лечении хронических заболеваний органов дыхания и сердечно-сосудистой системы. Проводит комплексные обследования и разрабатывает индивидуальные программы лечения.'
FROM users u, specializations s
WHERE u.email='ivanova.doctor@clinic.ru' AND s.name='Терапевт'
ON CONFLICT (user_id) DO NOTHING;

-- Врач 2: Кардиолог
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('petrov.doctor@clinic.ru', '$2b$10$placeholder', 'Петров', 'Александр', 'Николаевич', '+375291001002', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '205', 22,
  'Гродненский государственный медицинский университет, 2001. Кандидат медицинских наук.',
  'Высококвалифицированный кардиолог, кандидат медицинских наук. Специализируется на диагностике и лечении ишемической болезни сердца, гипертонии и аритмий. Автор более 30 научных публикаций.'
FROM users u, specializations s
WHERE u.email='petrov.doctor@clinic.ru' AND s.name='Кардиолог'
ON CONFLICT (user_id) DO NOTHING;

-- Врач 3: Невролог
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('sidorova.doctor@clinic.ru', '$2b$10$placeholder', 'Сидорова', 'Наталья', 'Владимировна', '+375291001003', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '312', 10,
  'Витебский государственный медицинский университет, 2013. Специализация — неврология.',
  'Невролог с 10-летним стажем. Занимается лечением мигрени, остеохондроза, вегетососудистой дистонии и последствий инсульта. Применяет современные методы диагностики и реабилитации.'
FROM users u, specializations s
WHERE u.email='sidorova.doctor@clinic.ru' AND s.name='Невролог'
ON CONFLICT (user_id) DO NOTHING;

-- Врач 4: Офтальмолог
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('kozlov.doctor@clinic.ru', '$2b$10$placeholder', 'Козлов', 'Дмитрий', 'Андреевич', '+375291001004', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '118', 8,
  'БГМУ, 2015. Интернатура по офтальмологии. Сертификат по лазерной хирургии глаза.',
  'Молодой и перспективный офтальмолог. Проводит диагностику и лечение катаракты, глаукомы, нарушений рефракции. Владеет современными методами обследования органа зрения.'
FROM users u, specializations s
WHERE u.email='kozlov.doctor@clinic.ru' AND s.name='Офтальмолог'
ON CONFLICT (user_id) DO NOTHING;

-- Врач 5: Педиатр
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('morozova.doctor@clinic.ru', '$2b$10$placeholder', 'Морозова', 'Ирина', 'Павловна', '+375291001005', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '214', 18,
  'БГМУ, педиатрический факультет, 2005. Высшая квалификационная категория.',
  'Опытный педиатр высшей категории с 18-летним стажем. Ведёт наблюдение за детьми с рождения до 18 лет. Специализируется на профилактике и лечении респираторных заболеваний у детей.'
FROM users u, specializations s
WHERE u.email='morozova.doctor@clinic.ru' AND s.name='Педиатр'
ON CONFLICT (user_id) DO NOTHING;

-- Врач 6: Хирург
INSERT INTO users (email, password_hash, last_name, first_name, middle_name, phone, role, is_blocked)
VALUES ('volkov.doctor@clinic.ru', '$2b$10$placeholder', 'Волков', 'Сергей', 'Игоревич', '+375291001006', 'doctor', false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization_id, cabinet, experience_years, education, description)
SELECT u.id, s.id, '401', 25,
  'БГМУ, 1998. Доктор медицинских наук, профессор кафедры хирургии.',
  'Хирург высшей категории, доктор медицинских наук. Специализируется на абдоминальной хирургии и малоинвазивных операциях. Выполнил более 5000 успешных операций за карьеру.'
FROM users u, specializations s
WHERE u.email='volkov.doctor@clinic.ru' AND s.name='Хирург'
ON CONFLICT (user_id) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- Связь врач ↔ специализации (см. db/migrations/001_doctor_specializations.sql)
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doctor_specializations (
  doctor_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialization_id INTEGER NOT NULL REFERENCES specializations(id),
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doctor_user_id, specialization_id)
);

ALTER TABLE doctor_specializations
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS doctor_specializations_one_primary
  ON doctor_specializations (doctor_user_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_doctor_specializations_spec
  ON doctor_specializations (specialization_id);

INSERT INTO doctor_specializations (doctor_user_id, specialization_id, is_primary)
SELECT dp.user_id, dp.specialization_id, TRUE
FROM doctor_profiles dp
WHERE dp.specialization_id IS NOT NULL
ON CONFLICT (doctor_user_id, specialization_id) DO NOTHING;

UPDATE doctor_specializations ds SET is_primary = FALSE;

UPDATE doctor_specializations ds
SET is_primary = TRUE
FROM (
  SELECT doctor_user_id, MIN(specialization_id) AS sid
  FROM doctor_specializations
  GROUP BY doctor_user_id
) x
WHERE ds.doctor_user_id = x.doctor_user_id AND ds.specialization_id = x.sid;

UPDATE doctor_profiles dp
SET specialization_id = sub.sid
FROM (
  SELECT doctor_user_id, specialization_id AS sid
  FROM doctor_specializations
  WHERE is_primary
) sub
WHERE dp.user_id = sub.doctor_user_id;
